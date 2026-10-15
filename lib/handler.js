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
const { cleanNumber } = require('./helpers');
const { msgStore } = require('./cache');
const bans = require('./bans');
const debug = require('./debug');
const contacts = require('./contacts');
const prefixes = require('./prefixes');
const interactions = require('./interactions');

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

/** Closest command name to `input` (and its edit distance). */
function closestCommand(input, commands) {
  let best = null, bestD = Infinity;
  for (const c of commands) {
    const d = levenshtein(input, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return { cmd: best, dist: bestD };
}

/** Every registered command name. */
function allCommandNames() {
  const out = [];
  for (const p of registry.all()) for (const c of p.commands) out.push(c);
  return out;
}

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
  const from = m.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  const sender = isGroup ? resolveSender(m.key.participant || from, m) : resolveSender(from, m);
  const pushname = m.pushName || 'User';
  const text = getText(m).trim();
  const senderNum0 = cleanNumber(sender.split('@')[0].split(':')[0]);

  // PER-USER PREFIX: each user parses commands with their OWN prefix. If they
  // haven't set one, the global default applies. Nobody's prefix can affect
  // anybody else's.
  const prefix = prefixes.forUser(senderNum0);

  let command = null;
  let args = [];
  if (text.startsWith(prefix)) {
    const parts = text.slice(prefix.length).trim().split(/\s+/);
    command = (parts.shift() || '').toLowerCase();
    args = parts;
  }

  const quoted = getQuoted(m);
  const senderNum = senderNum0;

  const ctx = {
    sock, m, from, isGroup, sender, senderNum, pushname, session,
    text, command, args,
    arg: args.join(' '),
    quoted,
    prefix,
    isOwner: isOwner(sender, session, m),
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

  // Learn LID -> real phone-number mappings from every message we see.
  contacts.learnFromMessage(m);

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
  // Groups use the master switch; inbox works if EITHER the master switch OR the
  // inbox-specific toggle is on.
  const antiOn = isGroup ? config.ANTIDELETE : (config.ANTIDELETE || config.ANTIDELETE_INBOX);
  if (isRevoke && antiOn) {
    const orig = msgStore.get(proto.key?.id);
    if (orig) {
      // WHO deleted it: prefer the revoke's own participant, fall back to the
      // original sender. Both are LID-resolved so a real number shows, not a
      // fake-looking `+<lid>`.
      const whoJid = proto.participant || m.key.participant || orig.key?.participant || orig.key?.remoteJid || m.key.remoteJid;
      const who = contacts.displayNum(contacts.resolve(whoJid));
      // WHERE: the chat the message originally lived in (NOT wherever the
      // revoke event happened to arrive) — this was showing up in the wrong
      // chat before.
      const whereJid = orig.key?.remoteJid || m.key.remoteJid;
      const whereIsGroup = String(whereJid).endsWith('@g.us');
      const where = whereIsGroup ? 'Group' : 'Inbox';
      // Group name, when we can get it cheaply.
      let whereName = '';
      if (whereIsGroup) {
        try {
          const meta = await sock.groupMetadata(whereJid);
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
            `🛡️ *ANTI-DELETE (${where})*\n` +
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
        // if it was media, re-send it into the SAME chat it came from
        if (!body && orig.message) {
          await sock.sendMessage(whereJid, { forward: orig }, { quoted: orig }).catch(() => {});
        }
      } catch { /* ignore */ }
    }
  }

  const ctx = buildContext(sock, m, session);

  // ---- debug: record every incoming message (visible via /api/debug) ----
  debug.incoming({
    from, isGroup, sender: ctx.senderNum, text: ctx.text.slice(0, 120),
    command: ctx.command, isOwner: ctx.isOwner, fromMe: !!m.key?.fromMe,
  });

  // ---- banned users are silently ignored (owner is always allowed) ----
  if (bans.has(ctx.senderNum) && !ctx.isOwner) { debug.info('banned user ignored', { num: ctx.senderNum }); return; }

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

  // ---- typo auto-correct: if the command is misspelled, run the closest one ----
  if (!plug) {
    const { cmd, dist } = closestCommand(ctx.command, allCommandNames());
    const maxD = ctx.command.length <= 4 ? 1 : ctx.command.length <= 7 ? 2 : 3;
    if (cmd && dist <= maxD) {
      ctx.command = cmd;
      plug = registry.find(cmd);
    }
  }

  if (!plug) { debug.info('no plugin for command', { command: ctx.command }); return; }

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
    await ctx.reply('🔒 Ye command sirf *owner* ke liye hai.').catch(() => {});
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
    debug.command({ command: ctx.command, from, sender: ctx.senderNum, isGroup });
    await plug.handler(ctx);
  } catch (e) {
    console.error(`[ERR] ${ctx.command}:`, e?.message || e);
    debug.error(`command failed: ${ctx.command}`, { error: e?.message || String(e), stack: String(e?.stack || '').split('\n').slice(0, 3).join(' | ') });
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
