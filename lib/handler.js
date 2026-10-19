/**
 * SAQIB-MD — message handler & command dispatcher
 * -----------------------------------------------
 * - anti-delete works in GROUPS **and** INBOX (DMs)
 * - MODE=private → only the owner (linked number) + sudo users can run commands
 * - MODE=public  → everyone can run commands
 * - commands flagged `ownerOnly` are restricted to the owner in every mode
 * - the owner is always recognised (fromMe + LID resolution), so private mode
 *   can never lock the owner out of their own bot.
 */
const config = require('../config');
const registry = require('../plugins/_registry');
const selfheal = require('./selfheal');
const { cleanNumber } = require('./helpers');
const { msgStore } = require('./cache');
const { recordSent } = require('./cache');
const bans = require('./bans');
const debug = require('./debug');
const contacts = require('./contacts');
const prefixes = require('./prefixes');
const interactions = require('./interactions');
const lang = require('./lang');

/** Levenshtein distance (for typo auto-correct). */
function levenshtein(a, b) {
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Closest command name to `input` (and its edit distance).
 *
 * SPEED: two prunes make this O(few) instead of O(1837):
 *   1. only names whose length is within `maxD` of the input can be within
 *      `maxD` edits, so everything else is skipped without any Levenshtein work;
 *   2. an exact match (distance 0) short-circuits immediately.
 * The candidate list itself is built once (see allCommandNames) and bucketed by
 * length, so we never even iterate the full list.
 */
function closestCommand(input, maxD) {
  const li = input.length;
  const lo = Math.max(1, li - maxD), hi = li + maxD;
  let best = null, bestD = maxD + 1;

  // FAST PASS — real typos almost always keep the first character, so scan that
  // small bucket first (still length-filtered).
  const first = _byFirst.get(input[0]);
  if (first) {
    for (const c of first) {
      if (c.length < lo || c.length > hi) continue;
      const d = levenshtein(input, c);
      if (d < bestD) { bestD = d; best = c; if (d === 0) return { cmd: best, dist: 0 }; }
    }
    if (best) return { cmd: best, dist: bestD };
  }

  // SLOW PASS — fallback for typos that also changed the first character.
  for (let L = lo; L <= hi; L++) {
    const bucket = _byLen.get(L);
    if (!bucket) continue;
    for (const c of bucket) {
      const d = levenshtein(input, c);
      if (d < bestD) { bestD = d; best = c; if (d === 0) return { cmd: best, dist: 0 }; }
    }
  }
  return { cmd: best, dist: bestD };
}

/**
 * Every registered command name, bucketed by length (built once).
 * SPEED: plugins load a single time at boot, so this index is immutable and
 * never needs rebuilding — the old code re-allocated a 1800-element array on
 * every unknown command.
 */
let _cmdNames = null;
let _byLen = null;
let _byFirst = null;
function allCommandNames() {
  if (_cmdNames) return _cmdNames;
  const out = [];
  const byLen = new Map();
  const byFirst = new Map();
  for (const p of registry.all()) {
    for (const c of p.commands) {
      out.push(c);
      const L = c.length;
      if (!byLen.has(L)) byLen.set(L, []);
      byLen.get(L).push(c);
      const f = c[0];
      if (!byFirst.has(f)) byFirst.set(f, []);
      byFirst.get(f).push(c);
    }
  }
  _cmdNames = out;
  _byLen = byLen;
  _byFirst = byFirst;
  return out;
}

/**
 * Drop the memoised command/typo index so the next message rebuilds it from the
 * (possibly freshly reloaded) registry. Used by the REAL `.update` / `.refresh`
 * system refresh (lib/system.js) after plugins are re-read from disk.
 */
function resetCommandIndex() {
  _cmdNames = null;
  _byLen = null;
  _byFirst = null;
}

/**
 * SPEED (under load): batch read receipts. One WebSocket round-trip per
 * message becomes one per flush window (250ms, ≤25 keys per call). Read
 * receipts still arrive — WhatsApp itself batches them the same way — but a
 * busy group no longer produces dozens of tiny WS frames per second.
 */
const _readQ = [];
let _readTimer = null;
function queueReadReceipt(sock, key) {
  _readQ.push({ sock, key });
  if (_readTimer) return;
  _readTimer = setTimeout(function flush() {
    _readTimer = null;
    const batch = _readQ.splice(0, 25);
    const bySock = new Map();
    for (const { sock: s, key: k } of batch) {
      if (!bySock.has(s)) bySock.set(s, []);
      bySock.get(s).push(k);
    }
    for (const [s, keys] of bySock) { try { s.readMessages(keys).catch(() => {}); } catch { /* ignore */ } }
    // Self-re-arm: anything left over (burst > 25, or late arrivals) still
    // flushes instead of sitting in the queue until the next message.
    if (_readQ.length) { _readTimer = setTimeout(flush, 250); if (_readTimer.unref) _readTimer.unref(); }
  }, 250);
  if (_readTimer.unref) _readTimer.unref();
}

/** New LID-era group JIDs (e.g. 972505071304-1421504059@g.us) reject sends AND
 *  metadata reads under the @g.us form; the <id>@lid variant is accepted.
 *  Verified live Oct 19 2026 via /api/gsend-test (plainSend ERR forbidden, lidSend OK). */
function groupSendJid(jid) {
  const m = String(jid || '').match(/^(\d+)-\d+@g\.us$/);
  return m ? m[1] + '@lid' : String(jid || '');
}

/** The <id>@lid form of ANY group jid (hyphenated OR plain). Used as a FALLBACK
 *  when the @g.us form is rejected with `forbidden`: LID-era groups accept the
 *  `<id>@lid` form even though the bot IS a member. Verified live Oct 19 2026:
 *  replying to 120363431929405318@g.us -> forbidden, but 120363431929405318@lid
 *  -> delivered (2 replies). Normal groups never reach this path because their
 *  @g.us form succeeds first. */
function lidFormOf(jid) {
  const m = String(jid || '').match(/^(\d+)(?:-\d+)?@g\.us$/);
  return m ? m[1] + '@lid' : null;
}

/** Send, transparently retrying ONCE via the @lid form when a group send is
 *  rejected with `forbidden` (LID-era group dual-addressing). Keeps normal
 *  groups on the plain @g.us path so nothing else changes. */
// Group jids already discovered to need the @lid form (skip the doomed @g.us
// attempt on every later send).
const _lidJids = new Set();

/** Race a promise against a timeout so a stalled network call (e.g. a
 *  groupMetadata read that never answers for some LID groups) can never hang a
 *  command / admin check forever. */
function withTimeout(p, ms, label = 'op') {
  return Promise.race([
    p,
    new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`${label} timed out`)), ms); if (t.unref) t.unref(); }),
  ]);
}
async function sendWithFallback(sock, jid, content, opts) {
  const s = String(jid || '');
  const known = _lidJids.has(s) ? lidFormOf(s) : null;
  if (known) return sock.sendMessage(known, content, opts);
  try {
    return await sock.sendMessage(s, content, opts);
  } catch (e) {
    const msg = String(e?.message || e);
    const lid = /forbidden|not-?author|40[36]\b|not-allowed/i.test(msg) ? lidFormOf(s) : null;
    if (!lid) throw e;
    _lidJids.add(s);
    return await sock.sendMessage(lid, content, opts);
  }
}

/** Wrap a socket so EVERY send \u2014 ctx.reply, ctx.send, or a plugin calling
 *  sock.sendMessage(ctx.from, \u2026) directly \u2014 gets the @lid fallback above.
 *  Idempotent (guarded) and transparent: all other props pass straight through. */
function wrapSockSend(sock) {
  if (!sock || sock.__lidWrapped) return sock;
  // Group-scoped calls that ALSO reject the @g.us form for LID-era groups
  // (metadata reads, participant updates, setting/name/desc changes, invites).
  // Plugins call these directly on `sock`, so they must go through the same
  // fallback or group commands (.ginfo/.tagall/.kick/.promote/.mute/\u2026) keep
  // failing with a bogus "make me an admin" message in those groups.
  const GROUP_METHODS = new Set([
    'groupMetadata', 'groupParticipantsUpdate', 'groupSettingUpdate',
    'groupUpdateSubject', 'groupUpdateDescription', 'groupRevokeInvite',
    'groupInviteCode', 'groupAcceptInvite', 'groupCreate', 'groupLeave',
    'groupRequestParticipantsList', 'groupRequestParticipantsUpdate',
    'groupToggleEphemeral', 'groupMemberAddMode', 'groupJoinApprovalMode',
  ]);
  const callWithFallback = async (t, method, args) => {
    const jid = String(args[0] || '');
    const known = _lidJids.has(jid) ? lidFormOf(jid) : null;
    if (known) return t[method](known, ...args.slice(1));
    try {
      return await t[method](...args);
    } catch (e) {
      const msg = String(e?.message || e);
      const lid = /forbidden|not-?author|40[36]\b|not-allowed/i.test(msg) ? lidFormOf(jid) : null;
      if (!lid) throw e;
      _lidJids.add(jid);
      return await t[method](lid, ...args.slice(1));
    }
  };
  return new Proxy(sock, {
    get(t, p) {
      if (p === 'sendMessage') return (jid, content, opts) => sendWithFallback(t, jid, content, opts);
      if (p === '__lidWrapped') return true;
      if (typeof p === 'string' && GROUP_METHODS.has(p) && typeof t[p] === 'function') {
        return (...args) => callWithFallback(t, p, args);
      }
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

/** Peel WhatsApp wrapper layers (disappearing messages, view-once, etc.)
 *  so groups with ephemeral messages on still yield real text. */
function unwrapMessage(m) {
  let msg = m?.message;
  const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage'];
  let guard = 0;
  while (msg && guard++ < 6) {
    const w = wrappers.find((k) => msg[k]);
    if (!w) break;
    msg = msg[w]?.message || msg[w];
  }
  return msg;
}

/** Extract plain text from a Baileys message */
function getText(m) {
  const msg = unwrapMessage(m);
  return (
    msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    msg?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    msg?.documentMessage?.caption ||
    ''
  );
}

/** Resolve the quoted (replied-to) message */
function getQuoted(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  return {
    // Resolve the replied-to participant's LID to their real phone number so
    // mentions never show a fake-looking `+<lid>`.
    key: { remoteJid: m.key.remoteJid, id: ctx.stanzaId, participant: contacts.resolve(ctx.participant) },
    message: ctx.quotedMessage,
  };
}

/** Resolve a sender JID to the real phone JID, mapping WhatsApp LIDs when possible. */
function resolveSender(jid, m) {
  let j = String(jid || '');
  if (j.endsWith('@lid')) {
    const pn = m?.key?.senderPn || m?.key?.participantPn || null;
    if (pn && !String(pn).endsWith('@lid')) j = pn;
    else j = contacts.resolve(j);
  }
  return j;
}

/** Is the sender the owner (global owner, this session's owner, or a sudo user)? */
function isOwner(senderJid, session, m) {
  // The bot runs as a LINKED DEVICE of the owner's own WhatsApp — anything the
  // owner types from that phone arrives with fromMe=true and (often) a LID
  // sender JID. It is always the owner speaking.
  if (m?.key?.fromMe) return true;
  const num = cleanNumber((resolveSender(senderJid, m) || '').split('@')[0].split(':')[0]);
  if (!num) return false;
  if (num === config.OWNER_NUMBER) return true;
  if (session && num === session.ownerNumber) return true;
  if (config.SUDO.includes(num)) return true;
  return false;
}

/** Build the command context object passed to plugins */
function buildContext(sock, m, session) {
  // Every send from this context (ctx.reply / ctx.send / plugin sock.sendMessage)
  // goes through the @lid-fallback wrapper, so LID-era groups that reject the
  // @g.us form still receive replies. `from` stays the REAL @g.us jid so all the
  // isGroup / admin / unpostable logic keeps working.
  sock = wrapSockSend(sock);
  const from = m.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  // DIAG: dump raw payload for group messages whose jid is not in the
  // participating list (dual-JID/LID groups) so the real group identity and
  // addressing mode can be inspected.
  if (isGroup && !_failNotified.get('__raw:' + from)) {
    _failNotified.set('__raw:' + from, Date.now());
    try { debug.info('RAW GROUP MSG', { from, key: JSON.stringify(m.key).slice(0, 300), addressing: m.addressingMode || m.key.addressingMode || '?', msgKeys: Object.keys(m.message || {}), participant: String(m.key.participant || '') }); } catch { /* ignore */ }
  }
  const sender = isGroup ? resolveSender(m.key.participant || from, m) : resolveSender(from, m);
  const pushname = m.pushName || 'User';
  const text = getText(m).trim();
  const senderNum0 = cleanNumber(sender.split('@')[0].split(':')[0]);

  // PER-USER PREFIX: each user parses commands with their OWN prefix. If they
  // haven't set one, the global default applies. Nobody's prefix can affect
  // anybody else's.
  const prefix = prefixes.forUser(senderNum0);

  // GROUP-FRIENDLY PARSING ------------------------------------------------
  // The default prefix is an emoji, which is painful to type on a phone inside
  // a group. In groups we therefore also accept:
  //   1. the user's normal prefix                      (unchanged)
  //   2. an @-mention of the bot followed by a command ("@Bot ping")
  //   3. a bare command name that the registry actually knows ("ping")
  // DM behaviour is untouched — only groups get the lenient parsing, so nobody
  // can accidentally trigger commands in a private chat.
  const isGroupChat = from.endsWith('@g.us');

  // Does THIS message mention (tag) the bot? Detected for EVERY chat type
  // (groups and DMs) so the anti-mention feature works everywhere. `mentionsBot`
  // is exposed on the ctx so the handler can ignore tagged messages when
  // ANTIMENTION is on. (It was previously referenced but never declared, which
  // silently disabled the whole feature.)
  const me = sock?.user;
  const myId = me?.id || '';
  const myLid = me?.lid || '';
  const mentionedJids = Array.isArray(m.message?.extendedTextMessage?.contextInfo?.mentionedJid)
    ? m.message.extendedTextMessage.contextInfo.mentionedJid : [];
  const mentionsBot = mentionedJids.some((j) => j === myId || j === myLid || (myId && j.split('@')[0] === myId.split('@')[0]))
    || (!!myId && text.includes('@' + myId.split('@')[0]));

  let command = null;
  let args = [];
  let body = text;
  let hadPrefix = false;

  // (1) normal prefix
  if (body.startsWith(prefix)) {
    body = body.slice(prefix.length).trim();
    hadPrefix = true;
  } else if (isGroupChat) {
    // (2) bot mentioned at the start of the message  ("@Bot ping")
    const mentionRe = /^@\S+\s*/;
    if (mentionsBot) body = body.replace(mentionRe, '').trim();
    // (3) bare known command
    if (!mentionsBot) {
      const first = body.split(/\s+/)[0].toLowerCase();
      if (!registry.find(first)) body = '';   // not a command -> leave body empty
    }
  }

  if (body) {
    const parts = body.trim().split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase();
    // Only treat it as a command if the registry knows it AND the message
    // carried the user's prefix.
    // STRICT PREFIX (user rule, 2026-10-19): no prefix -> no command. The old
    // group leniency (bare "ping", "@Bot ping" without a dot) is gone — in
    // groups too, a command is a command only with the prefix.
    if (cmd && hadPrefix) {
      command = cmd;
      args = parts;
    }
  }

  const quoted = getQuoted(m);
  const senderNum = senderNum0;

  // LANGUAGE: the reply language is looked up LAZILY (on every reply) so that
  // the instant `.botlanguage sd` runs, that very confirmation — and everything
  // after it — comes back in Sindhi, instead of the old language.
  const langFor = () => { try { return lang.forUser(senderNum0); } catch { return 'en'; } };

  const ctx = {
    sock, m, from, isGroup, sender, senderNum, pushname, session,
    text, command, args,
    arg: args.join(' '),
    quoted,
    prefix,
    hadPrefix,
    mentionsBot,
    isOwner: isOwner(sender, session, m),
    // SPEED: the English path (the default, and the vast majority of replies)
    // sends in the SAME tick — no async wrapper, no await, no microtask hop.
    // Only a non-English user pays for the (cached, hedged) translation.
    // NOTE: every outgoing key is recorded so `.clear` can revoke the bot's
    // OWN messages (WhatsApp only lets a bot delete what it sent).
    reply: (txt, extra = {}) => {
      // A group we were just rejected from cannot receive ANY reply right now —
      // skip it instead of firing another doomed send (and another log line).
      if (isUnpostable(from)) return Promise.resolve(null);
      const code = langFor();
      // NOTE: track() returns a promise that NEVER rejects. Previously it
      // returned the raw send promise, so a failed group send (403 forbidden)
      // bubbled up as `[ERR] <cmd>: forbidden` and aborted the command. Now the
      // failure is handled by onSendFail and the command keeps running.
      const track = (p) => {
        if (p && typeof p.then === 'function') {
          return p.then((res) => { try { recordSent(from, res?.key); } catch { /* ignore */ } return res; })
            .catch((e) => { Promise.resolve(onSendFail(ctx, from, e, String(txt))).catch(() => {}); return null; });
        }
        return p;
      };
      if (!code || code === 'en') return track(sock.sendMessage(from, { text: String(txt), ...extra }, { quoted: m }));
      return lang.translate(String(txt), code)
        .catch(() => String(txt))
        .then((t) => track(sock.sendMessage(from, { text: t, ...extra }, { quoted: m })));
    },
    sendSticker: (buffer, isAnimated = false) => sock.sendMessage(from, { sticker: buffer, isAnimated }, { quoted: m }),
    send: (jid, content, opts = {}) => {
      if (isUnpostable(jid)) return Promise.resolve(null);
      const code = langFor();
      const track = (p) => {
        if (p && typeof p.then === 'function') {
          return p.then((res) => { try { recordSent(jid, res?.key); } catch { /* ignore */ } return res; })
            .catch((e) => { Promise.resolve(onSendFail(ctx, jid, e, content?.text || content?.caption || '')).catch(() => {}); return null; });
        }
        return p;
      };
      if (!code || code === 'en' || !content || typeof content !== 'object') {
        return track(sock.sendMessage(jid, content, opts));
      }
      // SPEED: translate the text and the caption in PARALLEL (was sequential).
      const jobs = [];
      if (typeof content.text === 'string') jobs.push(lang.translate(content.text, code).then((t) => ['text', t]).catch(() => null));
      if (typeof content.caption === 'string') jobs.push(lang.translate(content.caption, code).then((t) => ['caption', t]).catch(() => null));
      if (!jobs.length) return track(sock.sendMessage(jid, content, opts));
      return Promise.all(jobs).then((pairs) => {
        let c = content;
        for (const p of pairs) if (p) c = { ...c, [p[0]]: p[1] };
        return track(sock.sendMessage(jid, c, opts));
      });
    },
    react: (emoji, key = m.key) => sock.sendMessage(from, { react: { text: emoji, key } }),
  };
  return ctx;
}

/** Failed group sends used to vanish into `.catch(() => {})` — in a big
 * announce-only group ("sirf admin send kar sakta hai") a non-admin bot's EVERY
 * reply is rejected, so the bot looked completely dead with zero log errors.
 * Now: log it, and notify the OWNER directly (max once per group per 10 min).
 * Fixes the "990-member group me bot bilkul nahi chalta" report. */
const _failNotified = new Map(); // jid -> last notice ts
const _unknownNotified = new Map(); // chat -> last unknown-command reply ts
// A group we have just been REJECTED from (forbidden / not-authorized): remember
// it for a few minutes so we stop hammering it with replies that can never land
// (that flood is what filled the logs and re-notified the owner again and again).
const _unpostable = new Map(); // jid -> { until, reason }
const UNPOSTABLE_TTL = 5 * 60 * 1000;
function isUnpostable(jid) {
  const u = _unpostable.get(jid);
  if (!u) return false;
  if (Date.now() > u.until) { _unpostable.delete(jid); return false; }
  return true;
}
function markUnpostable(jid, reason) {
  _unpostable.set(jid, { until: Date.now() + UNPOSTABLE_TTL, reason: String(reason || '').slice(0, 120) });
  try { _groupMetaCache.delete(jid); } catch { /* cache may not be ready yet */ }
}
async function onSendFail(ctx, jid, e, text) {
  const msg = String(e?.message || e || 'unknown');
  try { debug.error('send fail', { jid, session: ctx?.sock?.user?.id || '?', error: msg.slice(0, 120), stack: String(e?.stack || '').split('\n').slice(0, 4).join(' | ').slice(0, 300) }); } catch { /* ignore */ }
  const isGroup = String(jid).endsWith('@g.us');
  if (!isGroup) return;
  const now = Date.now();
  // A permission rejection (403 forbidden / not-authorized) means this reply can
  // NEVER land right now. Remember it so we stop retrying it for a few minutes.
  // NOTE: a bare 401 is session-level (reconnect handles it), so it is NOT
  // treated as a per-group permission failure here.
  const perm = /forbidden|not-?author|40[36]\b|not-allowed/i.test(msg);
  if (perm) markUnpostable(jid, msg);
  // NO USER DM. The user explicitly asked that the bot NEVER auto-message
  // random users' inboxes. If the bot cannot post in the group, the requester
  // simply does not get a DM — only the OWNER is told (below).
  // OWNER NOTICE: tell the owner what happened and why (max once per group / 10 min).
  if (now - (_failNotified.get(jid) || 0) < 10 * 60 * 1000) return;
  _failNotified.set(jid, now);
  // ACCURATE diagnosis — the old code ALWAYS said "make me an admin", which was
  // wrong (and confusing) when the real reason was that the bot is not even a
  // member of the group (removed, or a stale/old group link). Ask the live
  // metadata who the bot is here before blaming admin rights.
  let hint = '';
  if (perm) {
    try {
      const m = await botMembership(ctx?.sock, jid).catch(() => null);
      if (m && !m.member) hint = 'I am NOT a member of this group (I was removed, or this is a stale/old group link). Re-add me — and if the group is announce-only, make me an admin.';
      else if (m && m.announce && !m.admin) hint = 'this group is ANNOUNCE-ONLY and I am not an admin — make me an admin.';
      else if (m && !m.admin) hint = 'I am in the group but WhatsApp rejected the post — make me an admin.';
      else if (m && m.admin) hint = 'I AM an admin here, yet WhatsApp still rejected the post — this session looks stale; re-link this number.';
    } catch { /* fall through to the generic hints */ }
  }
  if (!hint) {
    if (/forbidden|not-?author|40[13]/i.test(msg)) hint = 'only ADMINs can post in this group — make me an admin.';
    else if (/406|not-allowed|announce/i.test(msg)) hint = 'this group is ANNOUNCE-ONLY — only admins can post. Make me an admin.';
    else if (/rate-overlimit|spam/i.test(msg)) hint = 'WhatsApp applied a temporary rate limit — it clears in a few minutes.';
  }
  const ownerText = `⚠️ *${config.BOT_NAME} replies are NOT reaching ${String(jid).split('@')[0]} (group).*\n${hint || 'Reason: ' + msg.slice(0, 90)}`;
  try { ctx?.sock?.sendMessage(`${config.OWNER_NUMBER}@s.whatsapp.net`, { text: ownerText })?.catch?.(() => {}); } catch { /* ignore */ }
}

/** Main entry: called for every incoming message */
/**
 * SPEED: group metadata is a network round-trip to WhatsApp on every call, so
 * caching it removes 300-800ms from every group command. A 3-minute TTL keeps
 * it correct (membership/admin changes are rare) while cutting round-trips.
 */
const _groupMetaCache = new Map(); // jid -> { at, meta }
const GROUP_META_TTL = 3 * 60 * 1000;
async function getGroupMeta(sock, jid) {
  jid = groupSendJid(jid);
  const hit = _groupMetaCache.get(jid);
  if (hit && Date.now() - hit.at < GROUP_META_TTL) return hit.meta;
  let meta;
  try {
    meta = await withTimeout(sock.groupMetadata(jid), 8000, 'groupMetadata');
  } catch (e) {
    const lid = lidFormOf(jid);
    if (!lid) throw e;
    meta = await withTimeout(sock.groupMetadata(lid), 8000, 'groupMetadata(@lid)');
  }
  _groupMetaCache.set(jid, { at: Date.now(), meta });
  if (_groupMetaCache.size > 200) {
    for (const [k, v] of _groupMetaCache) if (Date.now() - v.at > GROUP_META_TTL) _groupMetaCache.delete(k);
  }
  return meta;
}

/**
 * Check if a JID is an admin of the group (cached).
 *
 * WhatsApp now hands out LID JIDs (`…@lid`) alongside the real phone JIDs, and
 * group metadata can list a member under EITHER form. The old exact-string match
 * (`x.id === participant`) therefore failed whenever the sender was resolved to
 * a phone number but the participant list stored a LID (or vice-versa) — which
 * is exactly why a real admin was told "this command is only for admins".
 *
 * We now compare by NORMALISED NUMBER across every id a participant can carry
 * (id / lid / phoneNumber / jid), so it works no matter which form each side
 * uses. `m` (optional) lets us also match the raw LID the message arrived with.
 */
function numOf(j) { return String(j || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, ''); }
async function isGroupAdmin(sock, jid, participant, m = null) {
  const meta = await getGroupMeta(sock, jid);
  const targets = new Set(
    [participant, m?.key?.participant, m?.key?.participantPn, m?.key?.senderPn]
      .map(numOf).filter(Boolean)
  );
  if (!targets.size) return false;
  const p = (meta.participants || []).find((x) => {
    const ids = [x.id, x.lid, x.phoneNumber, x.jid].map(numOf).filter(Boolean);
    return ids.some((id) => targets.has(id));
  });
  return !!(p && (p.admin === 'admin' || p.admin === 'superadmin'));
}

/**
 * Is the BOT itself a member / admin of the group? Uses the SAME normalised
 * number matching as isGroupAdmin, so it survives the LID-vs-phone-JID split
 * (a raw `p.id === sock.user.id` compare fails whenever the participant list
 * stores a LID, which is exactly what made the old "make me an admin" notice
 * fire even for groups the bot had been removed from).
 * Returns { member, admin, announce } — used to explain a failed send correctly.
 */
async function botMembership(sock, jid) {
  if (!sock) return null;
  const meta = await getGroupMeta(sock, jid);
  const bots = new Set([sock.user?.id, sock.user?.lid, sock.user?.phoneNumber].map(numOf).filter(Boolean));
  const p = (meta.participants || []).find((x) => {
    const ids = [x.id, x.lid, x.phoneNumber, x.jid].map(numOf).filter(Boolean);
    return ids.some((id) => bots.has(id));
  });
  return {
    member: !!p,
    admin: !!(p && (p.admin === 'admin' || p.admin === 'superadmin')),
    announce: !!meta.announce,
  };
}

async function handleMessage(sock, m, session = null) {
  if (!m.message) return;
  // SPEED: warm the group-metadata cache in the BACKGROUND the moment a group
  // message arrives. Admin checks later in the same message then hit the cache
  // instead of paying a 300-800ms network round-trip.
  let metaWarm = null;
  try {
    const jid = m.key?.remoteJid || '';
    if (jid.endsWith('@g.us') && !_groupMetaCache.has(jid)) {
      metaWarm = getGroupMeta(sock, jid).catch(() => {});
    }
  } catch { /* ignore */ }
  // ignore the bot's own outgoing echoes
  if (m.key.id && m.key.id.startsWith('BAE5') && m.key.id.length === 16) return;

  // Learn LID -> real phone-number mappings from every message we see.
  contacts.learnFromMessage(m);

  const from = m.key.remoteJid || '';
  const isGroup = from.endsWith('@g.us');
  const isStatus = from === 'status@broadcast';

  // ---- store recent messages (powers anti-delete) ----
  if (!isStatus && m.key.id) msgStore.set(m.key.id, m);

  if (config.AUTO_READ && !isStatus) queueReadReceipt(sock, m.key); // batched, fire-and-forget

  // ---- anti-delete: detect a revoke and resend the original ----
  // Works in GROUPS *and* INBOX. `ANTIDELETE` is the master switch.
  const proto = m.message?.protocolMessage;
  const isEdit = proto && proto.type === 'MESSAGE_EDIT';
  const isRevoke = proto && (proto.type === 0 || proto.type === 'REVOKE' || isEdit);
  // Groups use the master switch; inbox works if EITHER the master switch OR the
  // inbox-specific toggle is on.
  const antiOn = isGroup ? config.ANTIDELETE : (config.ANTIDELETE || config.ANTIDELETE_INBOX);
  // An EDIT is a separate feature with its own switch (`.antiedit on|off`) —
  // otherwise `.antidelete off` would silently kill edit-catching too, and there
  // was no way to catch edits without also catching deletes.
  if (isEdit && !config.ANTIEDIT) { /* edit-catching is off */ }
  else if (isRevoke && (antiOn || (isEdit && config.ANTIEDIT))) {
    const orig = msgStore.get(proto.key?.id);
    if (orig) {
      // WHO deleted it: prefer the revoke's own participant, fall back to the
      // original sender. Both are LID-resolved so a real number shows, not a
      // fake-looking `+<lid>`.
      const whoJid = proto.participant || m.key.participant || orig.key?.participant || orig.key?.remoteJid || m.key.remoteJid;
      const who = contacts.displayNum(contacts.resolve(whoJid));
      // WHERE: two different destinations, and the difference matters to her:
      //
      //   `.antidelete`        -> INBOX  = YOUR OWN chat with yourself
      //                          ("yourself" — so a deleted message lands in the
      //                          user's own inbox, private, not in the group)
      //   `.antidelete chat`   -> CHAT   = the chat it was actually deleted in
      //                          (the group / DM it originally lived in)
      //
      // Previously it ALWAYS went to the original chat, so the inbox/chat
      // distinction did nothing. `selfJid` is the session owner's own JID.
      const originJid = orig.key?.remoteJid || m.key.remoteJid;
      const originIsGroup = String(originJid).endsWith('@g.us');
      // INBOX destination = the OWNER (config.OWNER_NUMBER) first, so a caught
      // deletion always lands in the owner's own chat — never a random user's.
      const selfJid = (config.OWNER_NUMBER ? `${config.OWNER_NUMBER}@s.whatsapp.net` : '') ||
        (session?.number ? `${session.number}@s.whatsapp.net` : '') ||
        (sock?.user?.id ? `${String(sock.user.id).split(':')[0].split('@')[0]}@s.whatsapp.net` : '');
      const toChat = !!config.ANTIDELETE_TO_CHAT;
      const whereJid = toChat ? originJid : (selfJid || originJid);
      const whereIsGroup = String(whereJid).endsWith('@g.us');
      const where = whereIsGroup ? 'Group' : (toChat ? 'Chat' : 'Yourself (inbox)');
      // Group name, when we can get it cheaply.
      let whereName = '';
      if (whereIsGroup) {
        try {
          const meta = await getGroupMeta(sock, whereJid);
          whereName = meta?.subject || '';
        } catch { /* not critical */ }
      }
      // WHEN: original send time and deletion time, in PKT.
      const pkt = (ts) => {
        try {
          return new Date(ts).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', hour12: true });
        } catch { return '—'; }
      };
      const sentAt = orig.messageTimestamp ? pkt(Number(orig.messageTimestamp) * 1000) : '—';
      const delAt = pkt(Date.now());

      const body = getText(orig);
      const kind = orig.message?.imageMessage ? '🖼️ Image'
        : orig.message?.videoMessage ? '🎬 Video'
        : orig.message?.audioMessage ? '🎵 Audio'
        : orig.message?.stickerMessage ? '🎨 Sticker'
        : orig.message?.documentMessage ? '📄 Document'
        : '📝 Text';

      try {
        await sock.sendMessage(whereJid, {
          text:
            `${isEdit ? '✏️ *ANTI-EDIT*' : '🛡️ *ANTI-DELETE*'} *(${where})*\n` +
            `━━━━━━━━━━━━━━━\n` +
            `👤 *Deleted by:* +${who}\n` +
            (whereName ? `👥 *Group:* ${whereName}\n` : '') +
            `💬 *Chat:* ${whereIsGroup ? 'Group' : 'DM'}\n` +
            `🗂️ *Type:* ${kind}\n` +
            `📤 *Sent:* ${sentAt}\n` +
            `🗑️ *Deleted:* ${delAt}\n` +
            `━━━━━━━━━━━━━━━\n\n` +
            (body ? `_Original message:_\n${body}` : '_Original message: (media)_'),
        }, { quoted: orig }).catch(() => {});
        // if it was media, re-send it to the SAME destination as the notice
        if (!body && orig.message) {
          await sock.sendMessage(whereJid, { forward: orig }, { quoted: orig }).catch(() => {});
        }
      } catch { /* ignore */ }
    }
  }

  const ctx = buildContext(sock, m, session);

  // ---- resolve GROUP-ADMIN status ONCE, up-front --------------------------
  // Plugins read `ctx.isAdmin` (the group-moderation hook in group2.js, the
  // admin-ping reply, …), but buildContext is synchronous and could never await
  // the participant list — so `ctx.isAdmin` was ALWAYS undefined. That made the
  // "admins are exempt" guard in the moderation hook never fire, and real
  // admins were being punished for everyone else's links/bad words. Resolve it
  // here from the already-warming, 3-minute-cached group metadata (cheap).
  if (ctx.isGroup && !ctx.isOwner) {
    try {
      if (metaWarm) await metaWarm;
      ctx.isAdmin = await isGroupAdmin(sock, ctx.from, ctx.sender, ctx.m);
    } catch { ctx.isAdmin = false; }
  } else {
    ctx.isAdmin = !!ctx.isOwner;
  }

  // ---- debug: record every incoming message (visible via /api/debug) ----
  // Empty-text group messages (stickers/protocol noise from huge groups) flood
  // the ~80-event ring buffer and bury the useful lines — keep only real texts.
  if (!isGroup || ctx.text) {
    debug.incoming({
      from, isGroup, sender: ctx.senderNum, text: ctx.text.slice(0, 120),
      command: ctx.command, isOwner: ctx.isOwner, fromMe: !!m.key?.fromMe,
    });
  }

  // ---- banned users are silently ignored (owner is always allowed) ----
  if (bans.has(ctx.senderNum) && !ctx.isOwner) { debug.info('banned user ignored', { num: ctx.senderNum }); return; }

  // ---- anti-mention: when ON, a message that mentions the bot is ignored ----
  // Nobody can summon the bot by tagging it. The owner is always allowed, and
  // explicit PREFIX commands (`.menu`) keep working normally.
  if (config.ANTIMENTION && ctx.mentionsBot && !ctx.isOwner && !ctx.hadPrefix) {
    debug.info('antimention: mention ignored', { sender: ctx.senderNum, isGroup });
    return;
  }

  // ---- per-message hooks (antilink, autoreact, chatbot, autostatus, …) ----
  // Run in the BACKGROUND so command replies are never delayed (speed).
  for (const hook of registry.hooks()) {
    try { Promise.resolve(hook(ctx)).catch(() => {}); } catch { /* ignore */ }
  }

  // ---- interactive replies (.wyr, .truth-or-dare, …) ----
  // A plain (non-command) message may be an answer to a pending prompt.
  if (!ctx.command) {
    const consumed = await interactions.handle(ctx).catch(() => false);
    if (consumed) return;
    return;
  }

  let plug = registry.find(ctx.command);

  // ---- LENIENT COMMAND MATCHING ------------------------------------------
  // Users rarely type commands perfectly on a phone keyboard. Three levels of
  // forgiveness, tried in order, so ".up time" still runs ".uptime" and a
  // sloppy ".meni" still opens the menu:
  //
  //   1. SPACED-OUT COMMANDS — ".up time", ".bot lang": the command name got
  //      split across tokens, so try JOINING the first few tokens back
  //      together ("up"+"time" -> "uptime") before anything else. A joined
  //      variant is only accepted if the registry actually knows it, so
  //      ordinary sentences can never collide with a real command.
  //   2. TYPO AUTO-CORRECT — ".meni" -> "menu": run the closest registered
  //      command within an edit-distance budget (looser than before, so
  //      real-world typos of medium-length names actually resolve).
  //   3. FALLBACK — if even the typo pass finds nothing, the command simply
  //      doesn't exist and the handler stays silent, as before.
  if (!plug && Array.isArray(ctx.args) && ctx.args.length) {
    for (let take = 1; take <= Math.min(2, ctx.args.length); take++) {
      const joined = (ctx.command + ctx.args.slice(0, take).join('')).toLowerCase();
      const joinedPlug = registry.find(joined);
      if (joinedPlug) {
        ctx.command = joined;
        ctx.args = ctx.args.slice(take);
        ctx.arg = ctx.args.join(' ');
        plug = joinedPlug;
        break;
      }
    }
  }

  if (!plug) {
    const maxD = ctx.command.length <= 3 ? 1 : ctx.command.length <= 8 ? 2 : 3;
    allCommandNames(); // build the length-bucketed index once (no-op afterwards)
    const { cmd, dist } = closestCommand(ctx.command, maxD);
    if (cmd && dist <= maxD) {
      ctx.command = cmd;
      plug = registry.find(cmd);
    }
  }

  if (!plug) {
    debug.info('no plugin for command', { command: ctx.command });
    // HELPFUL FALLBACK: a wrong command should never be met with silence.
    // Tell the user it does not exist, offer the closest real command, and
    // point at the discovery commands. Private mode still stays silent for
    // non-owners (a bot that answers strangers is still answering strangers).
    if (String(config.MODE).toLowerCase() === 'private' && !ctx.isOwner) return;
    const { cmd, dist } = closestCommand(ctx.command, 3);
    let text = `❌ Unknown command: *${config.PREFIX}${ctx.command}*`;
    if (cmd && dist <= 3) text += `\n\nDid you mean *${config.PREFIX}${cmd}*?`;
    text += `\n\n💡 How to use commands:\n• *${config.PREFIX}menu* — see everything\n• *${config.PREFIX}findcmd <word>* — search commands\n• *${config.PREFIX}help <category>* — one category's commands`;
    const _now = Date.now();
    if (_now - (_unknownNotified.get(ctx.from) || 0) > 20 * 1000) {
      _unknownNotified.set(ctx.from, _now);
      await ctx.reply(text).catch(() => {});
    }
    return;
  }

  // ---- MODE gate ---------------------------------------------------------
  // public  -> everyone can run commands (default)
  // private -> only the owner / sudo users can run commands.
  // The owner is ALWAYS allowed (fromMe + LID-resolved), so switching to
  // private can never lock the owner out of their own bot again.
  const isSudo = Array.isArray(config.SUDO) && config.SUDO.includes(ctx.senderNum);
  if (String(config.MODE).toLowerCase() === 'private' && !ctx.isOwner && !isSudo) {
    debug.info('private mode: non-owner blocked', { command: ctx.command, sender: ctx.senderNum, isGroup: ctx.isGroup });
    // Stay COMPLETELY silent — no reply at all, in groups or DMs. A "private
    // mode" bot that answers back is still answering strangers; she asked for
    // no response whatsoever.
    return;
  }

  // ---- owner-only commands (.restart, .broadcast, .ban, .pair, …) ----
  if (plug.ownerOnly && !ctx.isOwner) {
    await ctx.reply('🔒 This command is for the *owner* only.').catch(() => {});
    return;
  }

  if (plug.groupOnly && !ctx.isGroup) {
    await ctx.reply('❌ This command only works in *groups*.').catch(() => {});
    return;
  }
  if (plug.adminOnly && ctx.isGroup) {
    // The OWNER always passes admin checks (they own the bot, so they must be
    // able to run every command in any group). For everyone else we match the
    // sender against the participant list by normalised number, which handles
    // the LID-vs-phone-JID mismatch that used to reject real admins.
    const ok = ctx.isOwner || await isGroupAdmin(sock, ctx.from, ctx.sender, ctx.m).catch(() => false);
    if (!ok) { await ctx.reply('❌ This command is for *group admins* only.').catch(() => {}); return; }
  }

  if (config.AUTO_TYPING) sock.sendPresenceUpdate('composing', ctx.from).catch(() => {}); // fire-and-forget

  try {
    debug.command({ command: ctx.command, from, sender: ctx.senderNum, isGroup });
    const _t0 = Date.now();
    await plug.handler(ctx);
    // SPEED: surface slow commands (visible via /api/debug) so bottlenecks are
    // easy to spot without host-log access.
    const _dt = Date.now() - _t0;
    debug.latency(ctx.command, _dt);
    if (_dt > 500) debug.info('slow command', { command: ctx.command, ms: _dt });
  } catch (e) {
    console.error(`[ERR] ${ctx.command}:`, e?.message || e);
    debug.error(`command failed: ${ctx.command}`, { error: e?.message || String(e), stack: String(e?.stack || '').split('\n').slice(0, 3).join(' | ') });
    // Self-healing: try safe auto-recoveries and report to the owner (deduped).
    try { selfheal.report(ctx.command, e, { senderNum: ctx.senderNum, isGroup: ctx.isGroup, from: ctx.from }).catch(() => {}); } catch { /* ignore */ }
    await ctx.reply(`❌ Error: ${e?.message || 'something went wrong'}`).catch(() => {});
  } finally {
    if (config.AUTO_TYPING) sock.sendPresenceUpdate('paused', ctx.from).catch(() => {});
  }
}



function clearGroupMetaCache() { _groupMetaCache.clear(); try { _unpostable.clear(); _lidJids.clear(); } catch { /* ignore */ } }

module.exports = { handleMessage, buildContext, getText, getQuoted, isOwner, isGroupAdmin, botMembership, getGroupMeta, clearGroupMetaCache, resetCommandIndex };
