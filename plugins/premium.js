/**
 * PREMIUM — auto/anti toggles + premium utilities
 * -----------------------------------------------
 * Toggles (live, persisted, default OFF):
 *   antidelete, antideleteinbox, antispam, autoreact, autoviewonce,
 *   autobio, chatbot, anticall, anticallmsg, autoreadstatus, online, antimention
 *
 * The `onMessage` hook runs for EVERY message and enforces:
 *   - auto-status (view/react to statuses)
 *   - anti-spam (rate-limit users)
 *   - anti-link (delete links in groups)
 *   - auto-view-once (save view-once media)
 *   - auto-react (react to messages)
 *   - chatbot (AI auto-reply in private chats)
 */
const config = require('../config');
const { getJSON, downloadMedia, pick, cleanNumber, targetOf } = require('../lib/helpers');
const { isGroupAdmin } = require('../lib/handler');
const settings = require('../lib/settings');
const lang = require('../lib/lang');
const reacts = require('../lib/reacts');
const { cachedProfilePic } = require('../lib/cache');

const ON_WORDS = ['on', 'true', '1', 'enable', 'enabled', 'yes', 'haan', 'han'];
const OFF_WORDS = ['off', 'false', '0', 'disable', 'disabled', 'no', 'nahi', 'na'];
const parseOnOff = (a) => {
  const s = String(a || '').trim().toLowerCase();
  if (ON_WORDS.includes(s)) return true;
  if (OFF_WORDS.includes(s)) return false;
  return null;
};
const yn = (v) => (v ? 'ON 🟢' : 'OFF 🔴');
const antideleteStatus = () => `🛡️ *Anti-Delete*\n▪️ Master: ${yn(config.ANTIDELETE)}\n▪️ Group watch: ${yn(config.ANTIDELETE)}\n▪️ Where it lands: *${config.ANTIDELETE_TO_CHAT ? 'Chat (where it was deleted)' : 'Yourself (your own inbox)'}*\n\n_${config.PREFIX}antidelete inbox | ${config.PREFIX}antidelete chat_`;
const autoreactStatus = () => `😀 *Auto-React*\n▪️ Master: ${yn(config.AUTO_REACT)}\n▪️ Group: ${yn(config.AUTO_REACT_GROUP)}\n▪️ Chat: ${yn(config.AUTO_REACT_CHAT)}`;

const LINK_RE = /(https?:\/\/|www\.|chat\.whatsapp\.com|t\.me\/|wa\.me\/|bit\.ly|tinyurl)/i;

/* ------------------------ status / view-once helpers ---------------------- */
/** Pull the contextInfo (works for text + media messages). */
function contextOf(m) {
  return (
    m.message?.extendedTextMessage?.contextInfo ||
    m.message?.imageMessage?.contextInfo ||
    m.message?.videoMessage?.contextInfo ||
    m.message?.documentMessage?.contextInfo ||
    m.message?.audioMessage?.contextInfo ||
    null
  );
}

/** Unwrap a view-once wrapper into its inner media message. */
function unwrapViewOnce(qm) {
  if (!qm) return null;
  return qm.viewOnceMessage?.message || qm.viewOnceMessageV2?.message || qm.viewOnceMessageV2Extension?.message || null;
}

/** Emoji-only detector (popular emoji reply to restore a view-once). */
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\u200d\ufe0f\u2640-\u2642\u2600-\u27bf\u2b00-\u2bff\s]+$/u;
function isEmojiOnly(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 24) return false;
  if (!EMOJI_ONLY_RE.test(t)) return false;
  return /\p{Extended_Pictographic}/u.test(t);
}

// ---- Emoji Kitchen (Google gstatic) ----
const EK_DATES = ['20201001', '20210521', '20211115', '20220506', '20220823', '20230301', '20230403', '20230803'];
function cp(e) { return [...e].map((c) => c.codePointAt(0).toString(16)).join('-'); }
async function emojiKitchen(a, b) {
  const ca = cp(a); const cb = cp(b);
  const urls = [];
  for (const d of EK_DATES) {
    urls.push(`https://www.gstatic.com/android/keyboard/emojikitchen/${d}/u${ca}/u${ca}_u${cb}.png`);
    urls.push(`https://www.gstatic.com/android/keyboard/emojikitchen/${d}/u${cb}/u${cb}_u${ca}.png`);
  }
  const hits = await Promise.all(urls.map(async (u) => {
    try { const r = await fetch(u, { method: 'HEAD' }); return r.ok ? u : null; } catch { return null; }
  }));
  return hits.find(Boolean) || null;
}

// ---- anti-spam state ----
const spamMap = new Map();
const SPAM_LIMIT = 6;
const SPAM_WINDOW = 5000;

const TOGGLES = {
  antidelete: 'ANTIDELETE',
  antideleteinbox: 'ANTIDELETE_INBOX',
  antispam: 'ANTISPAM',
  autoreact: 'AUTO_REACT',
  autoviewonce: 'AUTOVIEWONCE',
  antiviewonce: 'AUTOVIEWONCE',   // alias — she types `.antiviewonce`
  antiedit: 'ANTIEDIT',
  botlanguage: null,
  autobio: 'AUTOBIO',
  chatbot: 'CHATBOT',
  anticall: 'ANTICALL',
  anticallmsg: 'ANTICALL',
  autoreadstatus: 'AUTOREAD_STATUS',
  autostatus: 'AUTOSTATUS',
  autosavestatus: 'AUTOSAVESTATUS',
  online: 'ONLINE',
  antimention: 'ANTIMENTION',
};

/* ============================ per-message hook ============================ */
async function onMessage(ctx) {
  const { sock, m, from, isGroup, sender, senderNum, text, command, isOwner, session } = ctx;
  const isStatus = from === 'status@broadcast' || m?.key?.remoteJid === 'status@broadcast';

  // ---- auto-status: view incoming statuses ----
  // The status author is m.key.participant, NOT remoteJid (which is always
  // 'status@broadcast'). Passing the wrong jid here is why reactions used to
  // go nowhere even when the feature was switched on.
  if (isStatus) {
    const author = m?.key?.participant || m?.participant || '';
    // Fire-and-forget: viewing + reacting to a status must never hold the hook.
    try { if (config.AUTOSTATUS) sock.readMessages([m.key]).catch(() => {}); } catch { /* ignore */ }
    if (config.AUTO_REACT && author) {
      try {
        const myEmojis = reacts.forUser(senderNum, config.REACT_EMOJIS);
        sock.sendMessage('status@broadcast', {
          react: { text: pick(myEmojis), key: m.key },
        }, { statusJidList: [author] }).catch(() => {});
      } catch { /* ignore */ }
    }
    return;
  }

  // ---- auto-react (FAST PATH — runs FIRST, before any slow I/O) ----
  // SPEED: this used to sit at the very END of the hook, behind anti-link
  // network lookups, view-once media downloads and status saves — so the
  // reaction only fired after all of that finished. It now runs immediately
  // (and is NOT awaited), which makes auto-react feel instant.
  {
    const reactScopeOk = isGroup ? config.AUTO_REACT_GROUP : config.AUTO_REACT_CHAT;
    if (config.AUTO_REACT && reactScopeOk && !command) {
      try {
        const myEmojis = reacts.forUser(senderNum, config.REACT_EMOJIS);
        sock.sendMessage(from, { react: { text: pick(myEmojis), key: m.key } }).catch(() => {});
      } catch { /* ignore */ }
    }
  }

  // ---- anti-spam ----
  if (config.ANTISPAM && !isOwner) {
    const now = Date.now();
    const rec = spamMap.get(sender) || { count: 0, ts: now };
    if (now - rec.ts > SPAM_WINDOW) { rec.count = 0; rec.ts = now; }
    rec.count += 1;
    spamMap.set(sender, rec);
    if (rec.count === SPAM_LIMIT + 1) {
      await sock.sendMessage(from, { text: `🚫 *Anti-Spam:* +${contacts.displayNum(ctx.senderNum)} please slow down!` }).catch(() => {});
      return;
    }
    if (rec.count > SPAM_LIMIT) return;
  }

  // ---- anti-link (groups) ----
  if (config.ANTILINK && isGroup && !isOwner && text && LINK_RE.test(text)) {
    const admin = await isGroupAdmin(sock, from, sender, m).catch(() => false);
    if (!admin) {
      try {
        await sock.sendMessage(from, { delete: m.key });
        await sock.sendMessage(from, { text: `🔗 *Anti-Link:* +${contacts.displayNum(ctx.senderNum)} sending links is not allowed!` }).catch(() => {});
      } catch { /* ignore */ }
      return;
    }
  }

  // ---- auto-view-once: save view-once media to owner ----
  if (config.AUTOVIEWONCE) {
    const vo = m.message?.viewOnceMessage?.message || m.message?.viewOnceMessageV2?.message || m.message?.viewOnceMessageV2Extension?.message;
    if (vo) {
      try {
        const img = vo.imageMessage;
        const vid = vo.videoMessage;
        const media = img || vid;
        if (media) {
          const type = img ? 'image' : 'video';
          const buf = await downloadMedia(media, type);
          // Destination = the OWNER only (config.OWNER_NUMBER). The user asked
          // that auto-saved media never land in random users' inboxes — it must
          // always go to the owner's number, never `session.number`/sender.
          const selfNum = config.OWNER_NUMBER;
          const target = selfNum ? `${selfNum}@s.whatsapp.net` : from;
          const cap = `👁️ *View-Once Saved*\n👤 +${contacts.displayNum(ctx.senderNum)}\n💬 ${media.caption || ''}`;
          if (type === 'image') await sock.sendMessage(target, { image: buf, caption: cap });
          else await sock.sendMessage(target, { video: buf, caption: cap });
        }
      } catch { /* ignore */ }
    }
  }

  // ---- reply to a STATUS -> auto-save the status media/text to owner ----
  if (config.AUTOSAVESTATUS) {
    const ci = contextOf(m);
    if (ci && ci.remoteJid === 'status@broadcast' && ci.quotedMessage) {
      const q = ci.quotedMessage;
      // Send it to the OWNER only (config.OWNER_NUMBER) — never to a random
      // user's inbox.
      const selfNum = config.OWNER_NUMBER;
      const ownerJid = selfNum ? `${selfNum}@s.whatsapp.net` : from;
      const who = cleanNumber((ci.participant || m.key.participant || from || '').split('@')[0].split(':')[0]);
      try {
        if (q.imageMessage) {
          const buf = await downloadMedia(q.imageMessage, 'image');
          await sock.sendMessage(ownerJid, { image: buf, caption: `📥 *Status Saved*\n👤 +${contacts.displayNum(who)}\n💬 ${q.imageMessage.caption || ''}` });
        } else if (q.videoMessage) {
          const buf = await downloadMedia(q.videoMessage, 'video');
          await sock.sendMessage(ownerJid, { video: buf, caption: `📥 *Status Saved*\n👤 +${contacts.displayNum(who)}\n💬 ${q.videoMessage.caption || ''}` });
        } else {
          const txt = q.conversation || q.extendedTextMessage?.text || '';
          if (txt) await sock.sendMessage(ownerJid, { text: `📥 *Status Saved*\n👤 +${contacts.displayNum(who)}\n\n${txt}` });
        }
      } catch { /* ignore */ }
    }
  }

  // ---- reply to a VIEW-ONCE with a popular emoji -> auto-restore (no cmd) ----
  {
    const ci = contextOf(m);
    const replyText = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    if (ci && ci.quotedMessage && isEmojiOnly(replyText)) {
      const inner = unwrapViewOnce(ci.quotedMessage);
      const src = inner || ci.quotedMessage;
      const media = src.imageMessage || src.videoMessage;
      const isViewOnce = !!inner || !!media?.viewOnce;
      if (media && isViewOnce) {
        const type = src.imageMessage ? 'image' : 'video';
        try {
          const buf = await downloadMedia(media, type);
          const cap = `🔓 *View-once restored*\n👑 ${config.BOT_NAME}`;
          // USERS' NEED: the restore reply goes back into the same chat (this
          // is the feature, not spam) — quoted on the original message.
          if (type === 'image') await sock.sendMessage(from, { image: buf, caption: cap }, { quoted: m });
          else await sock.sendMessage(from, { video: buf, caption: cap }, { quoted: m });
        } catch { /* ignore */ }
        return; // handled — skip auto-react for this emoji
      }
    }
  }

  // (auto-react now runs at the TOP of this hook — see the FAST PATH block.)

  // ---- chatbot (AI auto-reply, private chats only, non-command) ----
  if (config.CHATBOT && !command && !isGroup && text && !isOwner) {
    try {
      const ai = require('./ai');
      const answer = await ai.askAI(text);
      await sock.sendMessage(from, { text: answer }, { quoted: m });
    } catch { /* ignore */ }
  }
}

/* ============================ commands ============================ */
const handler = async (ctx) => {
const contacts = require('../lib/contacts');
  const { command, reply, arg, senderNum } = ctx;

  // ---- anti-delete ----
  //   .antidelete              -> master on/off
  //   .antidelete inbox        -> WHERE: the deleted message is sent to YOUR OWN
  //                               chat with yourself (private inbox)
  //   .antidelete chat         -> WHERE: the deleted message is sent back into
  //                               the chat it was actually deleted in
  //   .antidelete group        -> watch GROUPS
  //   .antidelete all          -> everything on/off
  // The inbox/chat choice is the destination; it is independent of whether
  // groups or DMs are watched.
  if (command === 'antidelete' || command === 'antideleteinbox') {
    const parts = String(arg || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const scope = ['chat', 'inbox', 'group', 'all', 'status', 'show', 'where']
      .includes(parts[0]) ? parts[0] : null;
    if (scope === 'status' || scope === 'show' || scope === 'where') return reply(antideleteStatus());

    // Destination: inbox (yourself) or chat (where it happened).
    if (scope === 'inbox' || scope === 'chat') {
      const v = parseOnOff(parts[1]);
      // `.antidelete inbox` -> destination = YOUR OWN inbox  (ANTIDELETE_TO_CHAT = false)
      // `.antidelete chat`  -> destination = where it was deleted (ANTIDELETE_TO_CHAT = true)
      // `on` (or bare) selects this destination and enables the feature.
      // `off` disables anti-delete without changing the saved destination.
      // `on` must not be treated as the TO_CHAT value, or `.antidelete inbox on`
      // would route to the chat.
      if (v === false) {
        config.ANTIDELETE = false;
        config.ANTIDELETE_INBOX = false;
        settings.save();
        await reply(antideleteStatus());
        return;
      }
      config.ANTIDELETE_TO_CHAT = scope === 'chat';
      config.ANTIDELETE = true;
      settings.save();
      await reply(
        `✅ Anti-delete will now arrive in *${config.ANTIDELETE_TO_CHAT ? 'the CHAT' : 'YOURSELF (inbox)'}*.\n` +
        `_(where it was deleted: \`${config.PREFIX}antidelete chat\` | your inbox: \`${config.PREFIX}antidelete inbox\`)_`
      );
      return;
    }

    if (command === 'antideleteinbox') { config.ANTIDELETE = true; config.ANTIDELETE_TO_CHAT = false; settings.save(); await reply(antideleteStatus()); return; }

    const val = parseOnOff(parts[scope ? 1 : 0]);
    if (scope === 'group') config.ANTIDELETE = val === null ? !config.ANTIDELETE : val;
    else if (scope === 'all') { const v = val === null ? !(config.ANTIDELETE || config.ANTIDELETE_INBOX) : val; config.ANTIDELETE = v; config.ANTIDELETE_INBOX = v; }
    else config.ANTIDELETE = val === null ? !config.ANTIDELETE : val;
    settings.save();
    await reply(antideleteStatus());
    return;
  }

  // ---- anti-edit: catch a message being EDITED and show old vs new ----
  if (command === 'antiedit') {
    const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();
    if (!parts.length || sub === 'show' || sub === 'status') {
      return reply(
        `✏️ *ANTI-EDIT*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `▪️ Now: *${config.ANTIEDIT ? 'ON 🟢' : 'OFF 🔴'}*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `*What do you want to do?*\n` +
        `▪️ \`${config.PREFIX}antiedit on\` — catch edited messages\n` +
        `▪️ \`${config.PREFIX}antiedit off\` — turn it off\n` +
        `_(when a message is edited you get the old + new text)_`
      );
    }
    const val = parseOnOff(sub);
    if (val === null) return reply(`❓ Type \`${config.PREFIX}antiedit on\` or \`${config.PREFIX}antiedit off\`.`);
    config.ANTIEDIT = val;
    settings.save();
    return reply(`✅ Anti-Edit is now *${val ? 'ON 🟢' : 'OFF 🔴'}*.`);
  }

  // ---- bot language (100+ languages) ----
  //   .botlanguage              -> show current + hint
  //   .botlanguage list [n]     -> browse all languages (paginated)
  //   .botlanguage <code|name>  -> set the bot's language for YOU
  //   .botlanguage reset        -> back to English
  if (command === 'botlanguage' || command === 'lang' || command === 'language') {
    const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();
    const me = lang.infoFor(senderNum);

    if (!parts.length) {
      // Show ALL languages right here so the user can pick without digging
      // through paginated lists (his ask: ".botlanguage likhy to all languages
      // aa jayen, apni mrzi sy change kr ly").
      const entries = Object.entries(lang.LANGS);
      const lines = entries.map(([c, [en, nat]]) => `▪️ \`${c}\` — ${en}${nat !== en ? ` (${nat})` : ''}`);
      await reply(
        `🌍 *BOT LANGUAGES* (${entries.length})\n` +
        `━━━━━━━━━━━━━━━\n` +
        `▪️ Abhi: *${me.name}* (${me.native}) — \`${me.code}\`\n` +
        `━━━━━━━━━━━━━━━\n` +
        lines.join('\n') +
        `\n━━━━━━━━━━━━━━━\n` +
        `Change: \`${config.PREFIX}botlanguage <code>\` — e.g. \`${config.PREFIX}botlanguage ur\``
      );
      return;
    }

    if (sub === 'list' || sub === 'all') {
      const page = Math.max(1, parseInt(parts[1], 10) || 1);
      const per = 30;
      const entries = Object.entries(lang.LANGS);
      const total = Math.ceil(entries.length / per);
      const slice = entries.slice((page - 1) * per, page * per);
      if (!slice.length) return reply(`❌ Page ${page} does not exist. Total ${total} pages.`);
      await reply(
        `🌍 *LANGUAGES* (${entries.length}) — page ${page}/${total}\n` +
        `━━━━━━━━━━━━━━━\n` +
        slice.map(([c, [en, nat]]) => `▪️ \`${c}\` — ${en}${nat !== en ? ` (${nat})` : ''}`).join('\n') +
        `\n━━━━━━━━━━━━━━━\n\`${config.PREFIX}botlanguage list ${page + 1}\` — next page`
      );
      return;
    }

    if (sub === 'reset' || sub === 'default') {
      lang.reset(senderNum);
      await reply('✅ Language is back to *English*.');
      return;
    }

    // exact code first, then alias/name, then fuzzy search
    const code = lang.set(senderNum, sub);
    if (code) {
      const [en, nat] = lang.LANGS[code];
      // Confirm IN THE NEW LANGUAGE so the change is obvious instantly (the
      // "Farsi lag gaya, pata hi nahi chala" complaint). Falls back to English
      // if the translator is unreachable.
      const say = '✅ Language changed. From now on, every reply of mine will be in this language.';
      const tr = await lang.translate(say, code);
      await reply(`🌍 *${en}* (${nat})\n\n${tr}`);
      return;
    }
    const hits = lang.search(parts.join(' '));
    if (hits.length === 1) {
      const [c, [en, nat]] = hits[0];
      lang.set(senderNum, c);
      const say = '✅ Language changed. From now on, every reply of mine will be in this language.';
      const tr = await lang.translate(say, c);
      await reply(`🌍 *${en}* (${nat})\n\n${tr}`);
      return;
    }
    if (hits.length > 1) {
      return reply(
        `🤔 *${hits.length}* languages matched — type the exact code:\n` +
        hits.slice(0, 15).map(([c, [en]]) => `▪️ \`${c}\` — ${en}`).join('\n')
      );
    }
    await reply(
      `❌ \`${parts[0]}\` was not found.\n` +
      `See all ${Object.keys(lang.LANGS).length} languages with \`${config.PREFIX}botlanguage list\`.`
    );
    return;
  }

  // ---- auto-react (scoped: group / chat / all) ----
  if (command === 'autoreact') {
    const parts = String(arg || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const scope = ['chat', 'group', 'all', 'status', 'show'].includes(parts[0]) ? parts[0] : null;
    if (scope === 'status' || scope === 'show') return reply(autoreactStatus());
    const val = parseOnOff(parts[scope ? 1 : 0]);
    if (scope === 'chat') config.AUTO_REACT_CHAT = val === null ? !config.AUTO_REACT_CHAT : val;
    else if (scope === 'group') config.AUTO_REACT_GROUP = val === null ? !config.AUTO_REACT_GROUP : val;
    else if (scope === 'all') { const v = val === null ? !config.AUTO_REACT : val; config.AUTO_REACT = v; config.AUTO_REACT_GROUP = v; config.AUTO_REACT_CHAT = v; }
    else config.AUTO_REACT = val === null ? !config.AUTO_REACT : val;
    settings.save();
    await reply(autoreactStatus());
    return;
  }

  // ---- .setreact — each user picks their OWN auto-react emojis ----
  if (command === 'setreact' || command === 'myreact' || command === 'reacts') {
    const raw = String(arg || '').trim();
    if (!raw) {
      const mine = reacts.forUser(senderNum, config.REACT_EMOJIS);
      return reply(
        `😀 *Your auto-react emojis*\n${mine.join(' ')}\n\n` +
        `To change them: \`${config.PREFIX}setreact 🔥 ❤️ 🎉\`\n` +
        `Back to default: \`${config.PREFIX}setreact reset\``
      );
    }
    if (/^(reset|default|clear|off)$/i.test(raw)) {
      reacts.reset(senderNum);
      return reply(`✅ Your react emojis are back to *default*: ${config.REACT_EMOJIS.join(' ')}`);
    }
    const list = raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return reply(`❌ Give some emojis. Example: \`${config.PREFIX}setreact 🔥 ❤️ 🎉\``);
    if (!reacts.set(senderNum, list)) return reply('❌ Could not save the emojis, please try again.');
    return reply(`✅ *Done!* Your auto-react emojis are now:\n${reacts.forUser(senderNum, config.REACT_EMOJIS).join(' ')}\n\n_(${config.PREFIX}setreact reset to go back to default)_`);
  }

  // ---- simple toggles ----
  // Supports explicit args: `.antispam on` -> ON, `.antispam off` -> OFF.
  // With no arg it flips the current state.
  // ---- anti-call (special: asks instead of guessing, and supports a message) ----
  //   .anticall              -> bot ASKS "on or off?" instead of flipping blindly
  //   .anticall on / off     -> set it
  //   .anticall message <txt>-> custom text sent when a call is rejected
  //   .anticall message clear-> stop sending any text (silent reject)
  //   .anticall show         -> current state
  if (command === 'anticall' || command === 'anticallmsg') {
    const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();

    if (!parts.length) {
      return reply(
        `📵 *ANTI-CALL*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `▪️ Now: *${config.ANTICALL ? 'ON 🟢' : 'OFF 🔴'}*\n` +
        `▪️ Message: ${config.ANTICALL_MSG ? `_${config.ANTICALL_MSG}_` : '_none (silent reject)_'}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `*What do you want to do?*\n` +
        `▪️ \`${config.PREFIX}anticall on\` — reject calls\n` +
        `▪️ \`${config.PREFIX}anticall off\` — allow calls\n` +
        `▪️ \`${config.PREFIX}anticall message <text>\` — set your own message\n` +
        `▪️ \`${config.PREFIX}anticall message clear\` — remove the message`
      );
    }

    if (sub === 'show' || sub === 'status') {
      return reply(`📵 Anti-Call: *${config.ANTICALL ? 'ON 🟢' : 'OFF 🔴'}*\n💬 Message: ${config.ANTICALL_MSG || '_none_'}`);
    }

    if (sub === 'message' || sub === 'msg') {
      const rest = parts.slice(1).join(' ').trim();
      if (!rest) return reply(`❌ Write a message: \`${config.PREFIX}anticall message Please do not call.\``);
      if (['clear', 'reset', 'none', 'off', 'hatao'].includes(rest.toLowerCase())) {
        config.ANTICALL_MSG = '';
        settings.save();
        return reply('✅ Anti-Call message removed — calls will be rejected silently.');
      }
      config.ANTICALL_MSG = rest;
      settings.save();
      return reply(`✅ Anti-Call message set: _${rest}_\n_(this is sent when a call is rejected)_`);
    }

    const val = parseOnOff(sub);
    if (val === null) {
      return reply(`❓ Not understood. Type \`${config.PREFIX}anticall on\` or \`${config.PREFIX}anticall off\`.`);
    }
    config.ANTICALL = val;
    settings.save();
    return reply(`✅ Anti-Call is now *${val ? 'ON 🟢' : 'OFF 🔴'}*.`);
  }

  // ---- every other on/off toggle ----
  // Bare `.antilink` used to silently FLIP the setting, which is confusing (she
  // typed `.anticall` expecting a question and got "off"). Now: no argument =>
  // ask which one; explicit on/off => set it. Same style for every toggle.
  if (TOGGLES[command]) {
    const key = TOGGLES[command];
    const val = parseOnOff(arg);
    if (val === null) {
      return reply(
        `⚙️ *${command.toUpperCase()}*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `▪️ Now: *${config[key] ? 'ON 🟢' : 'OFF 🔴'}*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `What do you want to do?\n` +
        `▪️ \`${config.PREFIX}${command} on\`\n` +
        `▪️ \`${config.PREFIX}${command} off\``
      );
    }
    config[key] = val;
    settings.save();

    // `.online` needs a LIVE presence update. markOnlineOnConnect only applies
    // when the socket is first created, so flipping the flag on an already
    // connected socket did nothing at all — which is why .online looked broken.
    if (key === 'ONLINE') {
      try {
        await ctx.sock.sendPresenceUpdate(config.ONLINE ? 'available' : 'unavailable');
      } catch { /* ignore */ }
    }

    await reply(`✅ *${command.toUpperCase()}* is now *${config[key] ? 'ON 🟢' : 'OFF 🔴'}*.`);
    return;
  }

  switch (command) {
    case 'premium':
      await reply(
        `👑 *${config.BOT_NAME} — PREMIUM*\n\n` +
        `🛡️ Anti-Delete: ${config.ANTIDELETE ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `📥 Anti-Delete Inbox: ${config.ANTIDELETE_INBOX ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `🔗 Anti-Link: ${config.ANTILINK ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `🚫 Anti-Spam: ${config.ANTISPAM ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `📵 Anti-Call: ${config.ANTICALL ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `🙅 Anti-Mention: ${config.ANTIMENTION ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `😀 Auto-React: ${config.AUTO_REACT ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `👁️ Auto-ViewOnce: ${config.AUTOVIEWONCE ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `📊 Auto-Status: ${config.AUTOSTATUS ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `🤖 Chatbot: ${config.CHATBOT ? 'ON 🟢' : 'OFF 🔴'}\n\n` +
        `_Toggle: ${config.PREFIX}antidelete / ${config.PREFIX}antilink / ${config.PREFIX}autoreact …_`
      );
      return;

    case 'readmore':
      if (!arg) return reply(`❌ Example: ${config.PREFIX}readmore Hello`);
      await reply(`${arg}\n${'\u200b'.repeat(4000)}\n${arg}`);
      return;

    case 'vcf': {
      const num = (arg || '').replace(/[^0-9]/g, '');
      if (!num) return reply(`❌ Give a number. Example: ${config.PREFIX}vcf 923001234567`);
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${config.OWNER_NAME}\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD`;
      await ctx.send(ctx.from, { contacts: { displayName: config.OWNER_NAME, contacts: [{ vcard }] } }, { quoted: ctx.m });
      return;
    }

    case 'say': case 'speak': case 'voice': {
      if (!arg) return reply(`❌ Give some text. Example: ${config.PREFIX}say Assalam o alaikum`);
      try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(arg)}&tl=ur&client=tw-ob`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error('TTS fail');
        const buf = Buffer.from(await res.arrayBuffer());
        await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg', ptt: true }, { quoted: ctx.m });
      } catch { await reply('❌ TTS failed.'); }
      return;
    }

    case 'carbon': {
      if (!arg) return reply(`❌ Give some code. Example: ${config.PREFIX}carbon console.log("hi")`);
      try {
        const res = await fetch('https://carbonara.solopov.dev/api/cook', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: arg, language: 'auto', theme: 'dracula' }),
        });
        if (!res.ok) throw new Error('carbon fail');
        const buf = Buffer.from(await res.arrayBuffer());
        await ctx.send(ctx.from, { image: buf, caption: '🎨 Code → Image' }, { quoted: ctx.m });
      } catch { await reply('❌ Carbon failed.'); }
      return;
    }

    case 'ss': {
      if (!arg) return reply(`❌ Give a URL. Example: ${config.PREFIX}ss https://google.com`);
      try {
        const url = arg.startsWith('http') ? arg : 'https://' + arg;
        const r = await getJSON(`https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&waitUntil=networkidle0`);
        const shot = r?.data?.screenshot?.url;
        if (!shot) throw new Error('no shot');
        await ctx.send(ctx.from, { image: { url: shot }, caption: `📸 Screenshot\n🔗 ${url}` }, { quoted: ctx.m });
      } catch { await reply('❌ Screenshot failed.'); }
      return;
    }

    case 'tourl': {
      const imgMsg = ctx.m.message?.imageMessage || ctx.quoted?.message?.imageMessage;
      if (!imgMsg) return reply(`❌ Reply to an image, or send an image with ${config.PREFIX}tourl`);
      try {
        const buf = await downloadMedia(imgMsg, 'image');
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', new Blob([buf]), 'image.jpg');
        const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
        const url = (await res.text()).trim();
        if (!url.startsWith('http')) throw new Error('upload fail');
        await reply(`🔗 *URL:* ${url}`);
      } catch { await reply('❌ Upload failed.'); }
      return;
    }

    case 'emojimix': case 'emix': {
      const [a, b] = (arg || '').split(/\s+/);
      if (!a || !b) return reply(`❌ Give two emojis. Example: ${config.PREFIX}emojimix 😂 🥰`);
      try {
        const url = await emojiKitchen(a, b);
        if (!url) throw new Error('no mix');
        await ctx.send(ctx.from, { image: { url }, caption: `${a} + ${b} 🎨` }, { quoted: ctx.m });
      } catch { await reply('❌ That emoji combo is not supported. Try another combo.'); }
      return;
    }

    case 'pp': case 'profilepic': case 'getdp': {
      const target = targetOf(ctx);
      const who = target ? target.jid : ctx.sender;
      try {
        const pp = await cachedProfilePic(ctx.sock, who, 'image');
        await ctx.send(ctx.from, {
          image: { url: pp },
          caption: `🖼️ *Profile Picture*\n👤 @${target ? target.num : ctx.senderNum}`,
          mentions: [who],
        }, { quoted: ctx.m });
      } catch { await reply('❌ No profile picture found, or it is private.'); }
      return;
    }

    case 'gpp': case 'groupdp': case 'getgcdp': {
      if (!ctx.isGroup) return reply('❌ This command only works in a group.');
      try {
        const pp = await cachedProfilePic(ctx.sock, ctx.from, 'image');
        await ctx.send(ctx.from, { image: { url: pp }, caption: `🖼️ *Group Profile Picture*\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
      } catch { await reply('❌ No group profile picture found.'); }
      return;
    }

    default:
      await reply('❓ Unknown premium command');
  }
};

module.exports = {
  commands: [
    ...Object.keys(TOGGLES), 'premium', 'readmore', 'vcf', 'say', 'speak', 'voice', 'carbon', 'ss', 'tourl', 'emojimix', 'emix',
    'pp', 'profilepic', 'getdp', 'gpp', 'groupdp', 'getgcdp',
    'setreact', 'myreact', 'reacts',
    // .botlanguage was handled but never registered — .lang/.language were
    // frontend-only dummies (audit 2026-10-19). Now they route.
    'lang', 'language',
  ],
  category: '💎 PREMIUM',
  handler,
  onMessage,
};
