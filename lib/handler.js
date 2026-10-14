/**
 * SAQIB-MD — message handler & command dispatcher
 * -----------------------------------------------
 * - anti-delete works in GROUPS **and** INBOX (DMs)
 * - MODE=private → only the owner (linked number) can run commands
 * - MODE=public  → everyone can run commands
 * - no hard "owner only" gate: the person who linked the bot is the owner,
 *   but every command is usable by everyone (per requirement).
 */
const config = require('../config');
const registry = require('../plugins/_registry');
const { cleanNumber } = require('./helpers');
const { msgStore } = require('./cache');

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

/** Is the sender the owner (global owner, this session's owner, or a sudo user)? */
function isOwner(senderJid, session) {
  const num = cleanNumber((senderJid || '').split('@')[0].split(':')[0]);
  if (!num) return false;
  if (num === config.OWNER_NUMBER) return true;
  if (session && num === session.ownerNumber) return true;
  if (config.SUDO.includes(num)) return true;
  return false;
}

/** Build the command context object passed to plugins */
function buildContext(sock, m, session) {
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
    sock, m, from, isGroup, sender, senderNum, pushname, session,
    text, command, args,
    arg: args.join(' '),
    quoted,
    isOwner: isOwner(sender, session),
    reply: (txt, extra = {}) => sock.sendMessage(from, { text: String(txt), ...extra }, { quoted: m }),
    sendSticker: (buffer, isAnimated = false) => sock.sendMessage(from, { sticker: buffer, isAnimated }, { quoted: m }),
    send: (jid, content, opts = {}) => sock.sendMessage(jid, content, opts),
    react: (emoji, key = m.key) => sock.sendMessage(from, { react: { text: emoji, key } }),
  };
  return ctx;
}

/** Main entry: called for every incoming message */
async function handleMessage(sock, m, session = null) {
  if (!m.message) return;
  // ignore the bot's own outgoing echoes
  if (m.key.id && m.key.id.startsWith('BAE5') && m.key.id.length === 16) return;

  const from = m.key.remoteJid || '';
  const isGroup = from.endsWith('@g.us');
  const isStatus = from === 'status@broadcast';

  // ---- store recent messages (powers anti-delete) ----
  if (!isStatus && m.key.id) msgStore.set(m.key.id, m);

  if (config.AUTO_READ && !isStatus) sock.readMessages([m.key]).catch(() => {}); // fire-and-forget

  // ---- anti-delete: detect a revoke and resend the original ----
  // Works in GROUPS *and* INBOX. `ANTIDELETE` is the master switch.
  const proto = m.message?.protocolMessage;
  const isRevoke = proto && (proto.type === 0 || proto.type === 'REVOKE' || proto.type === 'MESSAGE_EDIT');
  if (isRevoke && config.ANTIDELETE) {
    const orig = msgStore.get(proto.key?.id);
    if (orig) {
      const who = (m.key.participant || m.key.remoteJid || '').split('@')[0].split(':')[0];
      const where = isGroup ? 'Group' : 'Inbox';
      const body = getText(orig);
      try {
        await sock.sendMessage(m.key.remoteJid, {
          text: `🛡️ *Anti-Delete (${where})*\n👤 +${who} ne message delete kiya:\n\n${body || '(media)'}`,
        }, { quoted: orig }).catch(() => {});
        // if it was media, re-send it
        if (!body && orig.message) {
          await sock.sendMessage(m.key.remoteJid, { forward: orig }, { quoted: orig }).catch(() => {});
        }
      } catch { /* ignore */ }
    }
  }

  const ctx = buildContext(sock, m, session);

  // ---- per-message hooks (antilink, autoreact, chatbot, autostatus, …) ----
  // Run in the BACKGROUND so command replies are never delayed (speed).
  for (const hook of registry.hooks()) {
    try { Promise.resolve(hook(ctx)).catch(() => {}); } catch { /* ignore */ }
  }

  if (!ctx.command) return;

  const plug = registry.find(ctx.command);
  if (!plug) return;

  // private mode -> only the owner (menu/help/ping/alive always allowed)
  if (config.MODE === 'private' && !ctx.isOwner && !['menu', 'help', 'ping', 'alive'].includes(ctx.command)) {
    return;
  }

  // NOTE: ownerOnly is intentionally NOT enforced (per requirement — every
  // command is usable by everyone). The flag is kept for reference only.

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
