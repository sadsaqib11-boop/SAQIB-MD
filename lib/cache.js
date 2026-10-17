/**
 * SAQIB-MD — tiny in-memory cache + message store (speed + antidelete)
 * No external deps. LRU-ish with TTL. Keeps the bot fast and memory-bounded.
 */

class TTLCache {
  constructor(max = 500, ttlMs = 10 * 60 * 1000) {
    this.max = max;
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.exp) { this.map.delete(key); return undefined; }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.v;
  }
  set(key, val, ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { v: val, exp: Date.now() + (ttlMs || this.ttl) });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
  has(key) { return this.get(key) !== undefined; }
  del(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

// AI response cache — makes repeated questions instant. Bigger + longer-lived
// now (Phase 3): 800 entries kept for 6 hours, so the same question is answered
// from memory almost instantly across a whole session.
const aiCache = new TTLCache(800, 6 * 60 * 60 * 1000);

// TikTok search cache — resolved (direct-play) clips keyed by the search query.
// A repeat `.tts <same words>` skips the whole search + resolve round-trip.
// Kept short (15 min) because tikwm's direct-play CDN URLs expire.
const ttCache = new TTLCache(500, 15 * 60 * 1000);

// Generic search/source cache (movie candidate URLs, etc.) — lets a repeat
// request skip the slow yt-dlp search step.
const srcCache = new TTLCache(500, 60 * 60 * 1000);

// .tts downloaded video BUFFERS (~3-8MB each): a repeated query replays the
// row instantly instead of re-downloading from TikTok's CDN. Capped small —
// 8 clips x 15 min bounds memory to ~60MB worst case.
const ttBufCache = new TTLCache(8, 15 * 60 * 1000);

// Recent-message store — powers anti-delete (keyed by message id).
const msgStore = new TTLCache(800, 15 * 60 * 1000);

// Profile-picture URL cache — `.pp` / `.gpp` / `.getgcdp` / `.botdp` all hit
// WhatsApp's servers for the same URL; caching it removes a full round-trip.
// A "no DP" result is cached only briefly so a freshly-set picture shows fast.
const dpCache = new TTLCache(300, 5 * 60 * 1000);
const DP_OK_MS = 5 * 60 * 1000;
const DP_NONE_MS = 30 * 1000;

/**
 * Cached `sock.profilePictureUrl(jid, type)`. Throws (like the raw call) when
 * there is no picture, so callers keep their existing try/catch behaviour.
 */
async function cachedProfilePic(sock, jid, type = 'image') {
  const key = `${jid}|${type}`;
  const hit = dpCache.get(key);
  if (hit !== undefined) {
    if (hit === null) throw new Error('no dp');
    return hit;
  }
  try {
    const url = await sock.profilePictureUrl(jid, type);
    if (url) { dpCache.set(key, url, DP_OK_MS); return url; }
    dpCache.set(key, null, DP_NONE_MS);
    throw new Error('no dp');
  } catch (e) {
    dpCache.set(key, null, DP_NONE_MS);
    throw e;
  }
}

/* ---------------------------------------------------------------------------
 * Outgoing-message tracker — powers the `.clear` command.
 * ---------------------------------------------------------------------------
 * WhatsApp only lets a bot delete ITS OWN messages. To "clear a chat" we must
 * remember the keys of the messages we sent, per chat, so `.clear` can revoke
 * them. Bounded per chat and per process so it can never grow without limit.
 */
const sentByChat = new Map(); // jid -> [key, ...]  (newest last)
const SENT_PER_CHAT = 250;
const SENT_CHATS = 500;

/** Remember an outgoing message key for a chat. */
function recordSent(jid, key) {
  if (!jid || !key || !key.id) return;
  let arr = sentByChat.get(jid);
  if (!arr) { arr = []; sentByChat.set(jid, arr); }
  arr.push(key);
  if (arr.length > SENT_PER_CHAT) arr.splice(0, arr.length - SENT_PER_CHAT);
  if (sentByChat.size > SENT_CHATS) {
    const first = sentByChat.keys().next().value;
    sentByChat.delete(first);
  }
}

/** Return (and forget) every recorded outgoing key for a chat. */
function takeSent(jid) {
  const arr = sentByChat.get(jid) || [];
  sentByChat.delete(jid);
  return arr;
}

module.exports = { TTLCache, aiCache, ttCache, srcCache, ttBufCache, msgStore, dpCache, cachedProfilePic, recordSent, takeSent };
