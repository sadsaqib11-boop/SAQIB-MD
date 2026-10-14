/**
 * SAQIB-MD — shared helpers
 */
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

/** Fetch JSON with timeout + error handling */
async function getJSON(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Fetch text with timeout */
async function getText(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Download a Baileys media message into a Buffer */
async function downloadMedia(message, type) {
  const stream = downloadContentFromMessage(message, type);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
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
function jidInfo(jid) {
  const resolved = contacts.resolve(jid);
  const isLid = resolved.endsWith('@lid');
  const num = resolved.split('@')[0].split(':')[0];
  return { jid: resolved, num, isLid };
}

/**
 * Resolve the "target" of a command: the person being replied to, the first
 * @mention, or a phone number passed as an argument. Returns a jidInfo or null.
 */
function targetOf(ctx) {
  // 1) replied-to message (handler already LID-resolved the participant)
  const qp = ctx.quoted?.key?.participant;
  if (qp) return jidInfo(qp);
  // 2) explicit @mention
  const mj = contextOf(ctx.m)?.mentionedJid;
  if (Array.isArray(mj) && mj.length) return jidInfo(mj[0]);
  // 3) a phone number in the args
  const num = cleanNumber(ctx.arg || '');
  if (num.length >= 7) return { jid: `${num}@s.whatsapp.net`, num, isLid: false };
  return null;
}

module.exports = {
  getJSON, getText, downloadMedia, pick, randInt, formatDuration, cleanNumber, sleep, escRe,
  contextOf, jidInfo, targetOf,
};
