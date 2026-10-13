/**
 * SAQIB-MD — message handler & command dispatcher
 */
const config = require('../config');
const registry = require('../plugins/_registry');
const { cleanNumber } = require('./helpers');

/** Extract plain text from a Baileys message */
function getText(m) {
  return (
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    m.message?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    ''
  );
}

/** Resolve the quoted (replied-to) message */
function getQuoted(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  return {
    key: { remoteJid: m.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
    message: ctx.quotedMessage,
  };
}

/** Is the sender the owner (or a sudo user)? */
function isOwner(senderJid) {
  const num = cleanNumber((senderJid || '').split('@')[0].split(':')[0]);
  if (!num) return false;
  return num === config.OWNER_NUMBER || config.SUDO.includes(num);
}

/** Build the command context object passed to plugins */
function buildContext(sock, m) {
  const from = m.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  const sender = isGroup ? (m.key.participant || from) : from;
  const pushname = m.pushName || 'User';
  const text = getText(m).trim();

  let command = null;
  let args = [];
  if (text.startsWith(config.PREFIX)) {
    const parts = text.slice(config.PREFIX.length).trim().split(/\s+/);
    command = (parts.shift() || '').toLowerCase();
    args = parts;
  }

  const quoted = getQuoted(m);
  const senderNum = cleanNumber(sender.split('@')[0].split(':')[0]);

  const ctx = {
    sock, m, from, isGroup, sender, senderNum, pushname,
    text, command, args,
    arg: args.join(' '),
    quoted,
    isOwner: isOwner(sender),
    reply: (txt, extra = {}) => sock.sendMessage(from, { text: String(txt), ...extra }, { quoted: m }),
    sendSticker: (buffer, isAnimated = false) => sock.sendMessage(from, { sticker: buffer, isAnimated }, { quoted: m }),
    send: (jid, content, opts = {}) => sock.sendMessage(jid, content, opts),
    react: (emoji, key = m.key) => sock.sendMessage(from, { react: { text: emoji, key } }),
  };
  return ctx;
}

/** Main entry: called for every incoming message */
async function handleMessage(sock, m) {
  if (!m.message) return;
  // ignore the bot's own outgoing echoes
  if (m.key.id && m.key.id.startsWith('BAE5') && m.key.id.length === 16) return;

  if (config.AUTO_READ) sock.readMessages([m.key]).catch(() => {}); // fire-and-forget (no latency)

  const ctx = buildContext(sock, m);
  if (!ctx.command) return;

  const plug = registry.find(ctx.command);
  if (!plug) return;

  // private mode -> only owner (menu/help always allowed)
  if (config.MODE === 'private' && !ctx.isOwner && !['menu', 'help', 'ping', 'alive'].includes(ctx.command)) return;

  if (plug.ownerOnly && !ctx.isOwner) {
    await ctx.reply('❌ Ye command sirf bot *owner* ke liye hai.').catch(() => {});
    return;
  }
  if (plug.groupOnly && !ctx.isGroup) {
    await ctx.reply('❌ Ye command sirf *group* mein chalti hai.').catch(() => {});
    return;
  }
  if (plug.adminOnly && ctx.isGroup) {
    const ok = await isGroupAdmin(sock, ctx.from, ctx.sender).catch(() => false);
    if (!ok) { await ctx.reply('❌ Ye command sirf *group admins* ke liye hai.').catch(() => {}); return; }
  }

  if (config.AUTO_TYPING) sock.sendPresenceUpdate('composing', ctx.from).catch(() => {}); // fire-and-forget

  try {
    await plug.handler(ctx);
  } catch (e) {
    console.error(`[ERR] ${ctx.command}:`, e?.message || e);
    await ctx.reply(`❌ Error: ${e?.message || 'kuch ghalat ho gaya'}`).catch(() => {});
  } finally {
    if (config.AUTO_TYPING) sock.sendPresenceUpdate('paused', ctx.from).catch(() => {});
  }
}

/** Check if a JID is an admin of the group */
async function isGroupAdmin(sock, jid, participant) {
  const meta = await sock.groupMetadata(jid);
  const p = meta.participants.find((x) => x.id === participant);
  return !!(p && (p.admin === 'admin' || p.admin === 'superadmin'));
}

module.exports = { handleMessage, buildContext, getText, getQuoted, isOwner, isGroupAdmin };
