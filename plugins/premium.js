/**
 * PREMIUM — auto/anti toggles + premium utilities
 * -----------------------------------------------
 * Toggles (live, persisted, default OFF):
 *   antidelete, antideleteinbox, antispam, autoreact, autoviewonce,
 *   autobio, chatbot, anticall, anticallmsg, autoreadstatus, online
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
const reacts = require('../lib/reacts');

const ON_WORDS = ['on', 'true', '1', 'enable', 'enabled', 'yes', 'haan', 'han'];
const OFF_WORDS = ['off', 'false', '0', 'disable', 'disabled', 'no', 'nahi', 'na'];
const parseOnOff = (a) => {
  const s = String(a || '').trim().toLowerCase();
  if (ON_WORDS.includes(s)) return true;
  if (OFF_WORDS.includes(s)) return false;
  return null;
};
const yn = (v) => (v ? 'ON 🟢' : 'OFF 🔴');
const antideleteStatus = () => `🛡️ *Anti-Delete*\n▪️ Group: ${yn(config.ANTIDELETE)}\n▪️ Chat/Inbox: ${yn(config.ANTIDELETE_INBOX)}`;
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
  autobio: 'AUTOBIO',
  chatbot: 'CHATBOT',
  anticall: 'ANTICALL',
  anticallmsg: 'ANTICALL',
  autoreadstatus: 'AUTOREAD_STATUS',
  autostatus: 'AUTOSTATUS',
  autosavestatus: 'AUTOSAVESTATUS',
  online: 'ONLINE',
};

/* ============================ per-message hook ============================ */
async function onMessage(ctx) {
  const { sock, m, from, isGroup, sender, senderNum, text, command, isOwner } = ctx;
  const isStatus = from === 'status@broadcast' || m?.key?.remoteJid === 'status@broadcast';

  // ---- auto-status: view incoming statuses ----
  // The status author is m.key.participant, NOT remoteJid (which is always
  // 'status@broadcast'). Passing the wrong jid here is why reactions used to
  // go nowhere even when the feature was switched on.
  if (isStatus) {
    const author = m?.key?.participant || m?.participant || '';
    try {
      if (config.AUTOSTATUS) await sock.readMessages([m.key]);
      if (config.AUTO_REACT && author) {
        const myEmojis = reacts.forUser(senderNum, config.REACT_EMOJIS);
        await sock.sendMessage('status@broadcast', {
          react: { text: pick(myEmojis), key: m.key },
        }, { statusJidList: [author] }).catch(() => {});
      }
    } catch { /* ignore */ }
    return;
  }

  // ---- anti-spam ----
  if (config.ANTISPAM && !isOwner) {
    const now = Date.now();
    const rec = spamMap.get(sender) || { count: 0, ts: now };
    if (now - rec.ts > SPAM_WINDOW) { rec.count = 0; rec.ts = now; }
    rec.count += 1;
    spamMap.set(sender, rec);
    if (rec.count === SPAM_LIMIT + 1) {
      await sock.sendMessage(from, { text: `🚫 *Anti-Spam:* +${ctx.senderNum} thoda slow karo!` }).catch(() => {});
      return;
    }
    if (rec.count > SPAM_LIMIT) return;
  }

  // ---- anti-link (groups) ----
  if (config.ANTILINK && isGroup && !isOwner && text && LINK_RE.test(text)) {
    const admin = await isGroupAdmin(sock, from, sender).catch(() => false);
    if (!admin) {
      try {
        await sock.sendMessage(from, { delete: m.key });
        await sock.sendMessage(from, { text: `🔗 *Anti-Link:* +${ctx.senderNum} link bhejna mana hy!` }).catch(() => {});
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
          const target = config.OWNER_NUMBER ? `${config.OWNER_NUMBER}@s.whatsapp.net` : from;
          const cap = `👁️ *View-Once Saved*\n👤 +${ctx.senderNum}\n💬 ${media.caption || ''}`;
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
      const ownerJid = config.OWNER_NUMBER ? `${config.OWNER_NUMBER}@s.whatsapp.net` : from;
      const who = cleanNumber((ci.participant || m.key.participant || from || '').split('@')[0].split(':')[0]);
      try {
        if (q.imageMessage) {
          const buf = await downloadMedia(q.imageMessage, 'image');
          await sock.sendMessage(ownerJid, { image: buf, caption: `📥 *Status Saved*\n👤 +${who}\n💬 ${q.imageMessage.caption || ''}` });
        } else if (q.videoMessage) {
          const buf = await downloadMedia(q.videoMessage, 'video');
          await sock.sendMessage(ownerJid, { video: buf, caption: `📥 *Status Saved*\n👤 +${who}\n💬 ${q.videoMessage.caption || ''}` });
        } else {
          const txt = q.conversation || q.extendedTextMessage?.text || '';
          if (txt) await sock.sendMessage(ownerJid, { text: `📥 *Status Saved*\n👤 +${who}\n\n${txt}` });
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
          if (type === 'image') await sock.sendMessage(from, { image: buf, caption: cap }, { quoted: m });
          else await sock.sendMessage(from, { video: buf, caption: cap }, { quoted: m });
        } catch { /* ignore */ }
        return; // handled — skip auto-react for this emoji
      }
    }
  }

  // ---- auto-react (respects group/chat scope) ----
  // NOTE: this used to be gated behind `Math.random() < 0.35`, so roughly two out
  // of three messages got no reaction at all — that randomness was the whole
  // "reacts to some messages, not others" complaint. Auto-react now fires on
  // every eligible message; the setting itself is the on/off switch.
  const reactScopeOk = isGroup ? config.AUTO_REACT_GROUP : config.AUTO_REACT_CHAT;
  const myEmojis = require('../lib/reacts').forUser(senderNum, config.REACT_EMOJIS);
  if (config.AUTO_REACT && reactScopeOk && !command) {
    try { await sock.sendMessage(from, { react: { text: pick(myEmojis), key: m.key } }); } catch { /* ignore */ }
  }

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
  const { command, reply, arg, senderNum } = ctx;

  // ---- anti-delete (scoped: group / chat-inbox / all) ----
  if (command === 'antidelete' || command === 'antideleteinbox') {
    const parts = String(arg || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    let scope = ['chat', 'inbox', 'group', 'all', 'status', 'show'].includes(parts[0]) ? parts[0] : null;
    if (command === 'antideleteinbox') scope = 'inbox';
    if (scope === 'status' || scope === 'show') return reply(antideleteStatus());
    const val = parseOnOff(parts[scope ? 1 : 0]);
    if (scope === 'chat' || scope === 'inbox') config.ANTIDELETE_INBOX = val === null ? !config.ANTIDELETE_INBOX : val;
    else if (scope === 'group') config.ANTIDELETE = val === null ? !config.ANTIDELETE : val;
    else if (scope === 'all') { const v = val === null ? !(config.ANTIDELETE || config.ANTIDELETE_INBOX) : val; config.ANTIDELETE = v; config.ANTIDELETE_INBOX = v; }
    else config.ANTIDELETE = val === null ? !config.ANTIDELETE : val;
    settings.save();
    await reply(antideleteStatus());
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
        `😀 *Tumhare auto-react emojis*\n${mine.join(' ')}\n\n` +
        `Badalne ke liye: \`${config.PREFIX}setreact 🔥 ❤️ 🎉\`\n` +
        `Default par wapas: \`${config.PREFIX}setreact reset\``
      );
    }
    if (/^(reset|default|clear|off)$/i.test(raw)) {
      reacts.reset(senderNum);
      return reply(`✅ Tumhare react emojis *default* par wapas aa gaye: ${config.REACT_EMOJIS.join(' ')}`);
    }
    const list = raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return reply(`❌ Emojis likho. Example: \`${config.PREFIX}setreact 🔥 ❤️ 🎉\``);
    if (!reacts.set(senderNum, list)) return reply('❌ Emojis save nahi ho sake, dobara try karo.');
    return reply(`✅ *Ho gaya!* Ab tumhare auto-react emojis:\n${reacts.forUser(senderNum, config.REACT_EMOJIS).join(' ')}\n\n_(${config.PREFIX}setreact reset se default wapas)_`);
  }

  // ---- simple toggles ----
  // Supports explicit args: `.antispam on` -> ON, `.antispam off` -> OFF.
  // With no arg it flips the current state.
  if (TOGGLES[command]) {
    const key = TOGGLES[command];
    const val = parseOnOff(arg);
    config[key] = val === null ? !config[key] : val;
    settings.save();
    await reply(`✅ *${command.toUpperCase()}* ab *${config[key] ? 'ON 🟢' : 'OFF 🔴'}* hy.`);
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
      if (!num) return reply(`❌ Number do. Example: ${config.PREFIX}vcf 923001234567`);
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${config.OWNER_NAME}\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD`;
      await ctx.send(ctx.from, { contacts: { displayName: config.OWNER_NAME, contacts: [{ vcard }] } }, { quoted: ctx.m });
      return;
    }

    case 'say': case 'speak': case 'voice': {
      if (!arg) return reply(`❌ Text do. Example: ${config.PREFIX}say Assalam o alaikum`);
      try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(arg)}&tl=ur&client=tw-ob`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error('TTS fail');
        const buf = Buffer.from(await res.arrayBuffer());
        await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg', ptt: true }, { quoted: ctx.m });
      } catch { await reply('❌ TTS fail ho gaya.'); }
      return;
    }

    case 'carbon': {
      if (!arg) return reply(`❌ Code do. Example: ${config.PREFIX}carbon console.log("hi")`);
      try {
        const res = await fetch('https://carbonara.solopov.dev/api/cook', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: arg, language: 'auto', theme: 'dracula' }),
        });
        if (!res.ok) throw new Error('carbon fail');
        const buf = Buffer.from(await res.arrayBuffer());
        await ctx.send(ctx.from, { image: buf, caption: '🎨 Code → Image' }, { quoted: ctx.m });
      } catch { await reply('❌ Carbon fail ho gaya.'); }
      return;
    }

    case 'ss': {
      if (!arg) return reply(`❌ URL do. Example: ${config.PREFIX}ss https://google.com`);
      try {
        const url = arg.startsWith('http') ? arg : 'https://' + arg;
        const r = await getJSON(`https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&waitUntil=networkidle0`);
        const shot = r?.data?.screenshot?.url;
        if (!shot) throw new Error('no shot');
        await ctx.send(ctx.from, { image: { url: shot }, caption: `📸 Screenshot\n🔗 ${url}` }, { quoted: ctx.m });
      } catch { await reply('❌ Screenshot fail ho gaya.'); }
      return;
    }

    case 'tourl': {
      const imgMsg = ctx.m.message?.imageMessage || ctx.quoted?.message?.imageMessage;
      if (!imgMsg) return reply(`❌ Kisi image ko reply karo ya image ke sath likho ${config.PREFIX}tourl`);
      try {
        const buf = await downloadMedia(imgMsg, 'image');
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', new Blob([buf]), 'image.jpg');
        const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
        const url = (await res.text()).trim();
        if (!url.startsWith('http')) throw new Error('upload fail');
        await reply(`🔗 *URL:* ${url}`);
      } catch { await reply('❌ Upload fail ho gaya.'); }
      return;
    }

    case 'emojimix': case 'emix': {
      const [a, b] = (arg || '').split(/\s+/);
      if (!a || !b) return reply(`❌ Do emoji do. Example: ${config.PREFIX}emojimix 😂 🥰`);
      try {
        const url = await emojiKitchen(a, b);
        if (!url) throw new Error('no mix');
        await ctx.send(ctx.from, { image: { url }, caption: `${a} + ${b} 🎨` }, { quoted: ctx.m });
      } catch { await reply('❌ Ye emoji combo support nahi hy. Koi aur combo try karo.'); }
      return;
    }

    case 'pp': case 'profilepic': case 'getdp': {
      const target = targetOf(ctx);
      const who = target ? target.jid : ctx.sender;
      try {
        const pp = await ctx.sock.profilePictureUrl(who, 'image');
        await ctx.send(ctx.from, {
          image: { url: pp },
          caption: `🖼️ *Profile Picture*\n👤 @${target ? target.num : ctx.senderNum}`,
          mentions: [who],
        }, { quoted: ctx.m });
      } catch { await reply('❌ DP nahi mili ya private hy.'); }
      return;
    }

    case 'gpp': case 'groupdp': {
      if (!ctx.isGroup) return reply('❌ Ye command sirf group me chalti hy.');
      try {
        const pp = await ctx.sock.profilePictureUrl(ctx.from, 'image');
        await ctx.send(ctx.from, { image: { url: pp }, caption: `🖼️ *Group Profile Picture*\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
      } catch { await reply('❌ Group DP nahi mili.'); }
      return;
    }

    default:
      await reply('❓ Unknown premium command');
  }
};

module.exports = {
  commands: [
    ...Object.keys(TOGGLES), 'premium', 'readmore', 'vcf', 'say', 'speak', 'voice', 'carbon', 'ss', 'tourl', 'emojimix', 'emix',
    'pp', 'profilepic', 'getdp', 'gpp', 'groupdp',
    'setreact', 'myreact', 'reacts',
  ],
  category: '👑 PREMIUM',
  handler,
  onMessage,
};
