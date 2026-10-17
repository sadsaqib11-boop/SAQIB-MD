/**
 * SAQIB-MD — shared helpers
 */
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');

/**
 * Read an image file and ALWAYS return a real binary image buffer.
 *
 * Some bot pictures ship as BASE64 TEXT (a `.jpg` whose bytes are actually
 * "/9j/4AAQSkZJRg…"). Sending that raw text to WhatsApp makes the image send
 * fail and the menu/profile pic silently stays blank — the "bot picture not
 * showing" bug. Here we detect a non-binary file and base64-decode it, so both
 * a real JPEG/PNG and a base64-encoded one work.
 */
function readImageBuffer(pic) {
  let buf = fs.readFileSync(pic);
  const looksBinary =
    (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||                        // JPEG
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||      // PNG
    (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) ||                        // GIF
    (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP'); // WEBP
  if (!looksBinary) {
    const text = buf.toString('utf8').trim().replace(/^data:image\/[a-z]+;base64,/i, '');
    if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 100) {
      try {
        const dec = Buffer.from(text.replace(/\s+/g, ''), 'base64');
        if (dec.length > 100) buf = dec;
      } catch { /* keep original */ }
    }
  }
  return buf;
}

// SPEED: keep external API connections warm (no fresh TCP+TLS handshake per
// call) and raise the connection pool so parallel commands don't queue.
try {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({
    connect: { timeout: 15000 },
    keepAliveTimeout: 60_000,      // hold warm connections for 60s
    keepAliveMaxTimeout: 120_000,
    connections: 128,
    pipelining: 1,
  }));
} catch { /* undici not installed — Node's default agent is still fine */ }

// SPEED: pre-connect (DNS + TLS) to the hosts used by hot commands so the
// first real call after boot skips the handshake. These are the most-used
// endpoints across the plugin set; warming them removes 200-600ms from the
// first hit of each. Failures are ignored (offline hosts simply skip).
const WARM_HOSTS = [
  'https://text.pollinations.ai',
  'https://image.pollinations.ai',
  'https://api.github.com',
  'https://nekos.best',
  'https://api.aladhan.com',
  'https://api.alquran.cloud',
  'https://open.er-api.com',
  'https://api.datamuse.com',
  'https://api.urbandictionary.com',
  'https://wttr.in',
  'https://generativelanguage.googleapis.com',
  // Translation endpoints — warmed so the FIRST non-English reply after boot
  // skips the DNS + TLS handshake (removes ~200-600ms from that first reply).
  'https://clients5.google.com',
  'https://translate.googleapis.com',
];
async function warmupHosts() {
  await Promise.allSettled(WARM_HOSTS.map((h) => fetch(h, { method: 'HEAD' }).catch(() => {})));
}

/** A retryable error? (network blip, timeout, 429, 5xx) */
function isRetryable(err, status) {
  if (status && (status === 429 || status >= 500)) return true;
  const m = String(err?.message || err || '').toLowerCase();
  return /abort|timeout|network|fetch failed|econnreset|econnrefused|socket|und_err|enotfound|etimedout/.test(m);
}

/**
 * Fetch with timeout + bounded retries. Retries only transient failures
 * (network blips / 429 / 5xx) so a dead host fails fast instead of hanging.
 */
async function fetchWithRetry(url, opts, timeoutMs, parse, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}`);
        e.status = res.status;
        if (attempt < retries && isRetryable(e, res.status)) { lastErr = e; await sleep(300 * (attempt + 1)); continue; }
        throw e;
      }
      return await parse(res);
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isRetryable(err)) { await sleep(300 * (attempt + 1)); continue; }
      throw err;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

/** Fetch JSON with timeout + retries */
function getJSON(url, opts = {}, timeoutMs = 20000) {
  return fetchWithRetry(url, opts, timeoutMs, (res) => res.json());
}

/** Fetch text with timeout + retries */
function getText(url, opts = {}, timeoutMs = 20000) {
  return fetchWithRetry(url, opts, timeoutMs, (res) => res.text());
}

/**
 * Download a Baileys media message into a Buffer.
 *
 * IMPORTANT: baileys v7 hands back whatever `getHttpStream` produced — a Node
 * `Readable` normally, but on some runtimes/fetch implementations a raw web
 * `ReadableStream` (which is NOT async-iterable) slips through. The old code
 * did `for await (const c of stream)` and died with
 * "stream is not async iterable", which broke every image tool, sticker and
 * media command. We now handle all three shapes explicitly and never assume
 * the stream is iterable.
 */
async function downloadMedia(message, type) {
  const stream = await downloadContentFromMessage(message, type);

  // Shape 1 — web ReadableStream (has getReader, no async iterator).
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
    return Buffer.concat(chunks);
  }

  // Shape 2 — Node stream (Readable). Use events; works on every runtime.
  if (stream && typeof stream.on === 'function') {
    const chunks = await new Promise((resolve, reject) => {
      const acc = [];
      stream.on('data', (c) => acc.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      stream.on('end', () => resolve(acc));
      stream.on('error', reject);
      // A stream that already ended before we attached listeners would hang.
      if (stream.readableEnded) resolve(acc);
    });
    return Buffer.concat(chunks);
  }

  // Shape 3 — async iterable (generator), the original happy path.
  if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }

  // Shape 4 — already a Buffer / Uint8Array.
  if (Buffer.isBuffer(stream)) return stream;
  if (stream instanceof Uint8Array) return Buffer.from(stream);

  throw new Error('could not read the media stream format (unsupported stream type)');
}

/** Random element */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Random int between min and max (inclusive) */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Format milliseconds -> "1h 2m 3s" */
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

/** Clean a phone number to digits only */
const cleanNumber = (n) => String(n || '').replace(/[^0-9]/g, '');

/** Sleep */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Escape regex special chars */
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const contacts = require('./contacts');

/** Pull contextInfo from any message type (text, media, sticker, …). */
function contextOf(m) {
  return (
    m?.message?.extendedTextMessage?.contextInfo ||
    m?.message?.imageMessage?.contextInfo ||
    m?.message?.videoMessage?.contextInfo ||
    m?.message?.documentMessage?.contextInfo ||
    m?.message?.documentWithCaptionMessage?.message?.documentMessage?.contextInfo ||
    m?.message?.audioMessage?.contextInfo ||
    m?.message?.stickerMessage?.contextInfo ||
    null
  );
}

/**
 * Turn any JID into a *mention-safe* descriptor.
 * WhatsApp now hands out LIDs (`212223345675336@lid`); mentioning them with the
 * wrong domain (`@s.whatsapp.net`) is exactly what produced the "fake number"
 * bug. We resolve LID→real number when known, otherwise keep the `@lid` domain
 * (which the client renders as the contact's name, never as a raw number).
 */
function jidInfo(jid, name) {
  const resolved = contacts.resolve(jid);
  const isLid = resolved.endsWith('@lid');
  const num = resolved.split('@')[0].split(':')[0];
  // `tag` is what should be PRINTED in the message text. For an unresolved LID
  // the digits are not a phone number, so printing `@<digits>` makes WhatsApp
  // render it against the wrong contact — which is what made the characters and
  // fun plugins look like they were aimed at the wrong person. Print the name
  // instead and keep the LID only as the mention target.
  const safe = contacts.safeMention(jid, name);
  return { jid: resolved, num, isLid, tag: safe.tag, safe: safe.safe };
}

/**
 * Resolve the "target" of a command: the person being replied to, the first
 * @mention, or a phone number passed as an argument. Returns a jidInfo or null.
 */
function targetOf(ctx) {
  // The name to print when a LID cannot be resolved to a real number.
  const nameOf = (jid) => {
    const bare = String(jid || '').split('@')[0].split(':')[0];
    return ctx.pushname || ctx.quoted?.pushName || bare || 'tum';
  };
  // 1) replied-to message (handler already LID-resolved the participant)
  const qp = ctx.quoted?.key?.participant;
  if (qp) return jidInfo(qp, ctx.quoted?.pushName || ctx.pushname);
  // 2) explicit @mention
  const mj = contextOf(ctx.m)?.mentionedJid;
  if (Array.isArray(mj) && mj.length) return jidInfo(mj[0], nameOf(mj[0]));
  // 3) a phone number in the args
  const num = cleanNumber(ctx.arg || '');
  if (num.length >= 7) return { jid: `${num}@s.whatsapp.net`, num, isLid: false, tag: `@${num}`, safe: true };
  return null;
}

module.exports = {
  getJSON, getText, downloadMedia, pick, randInt, formatDuration, cleanNumber, sleep, escRe,
  contextOf, jidInfo, targetOf, warmupHosts, readImageBuffer,
};
