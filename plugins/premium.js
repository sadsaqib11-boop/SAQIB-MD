/**
 * PREMIUM — enforcement features + premium utilities
 * --------------------------------------------------
 * Toggles (owner only): antidelete, antispam, autoreact, autostatus,
 *                       autoviewonce, autobio, chatbot
 * Commands: readmore, vcf, tts, carbon, ss, tourl, emojimix, premium
 *
 * The `onMessage` hook runs for EVERY message and enforces:
 *   - anti-link (delete links in groups)
 *   - auto-react (react to messages)
 *   - chatbot (AI auto-reply in private chats)
 *   - auto-status (view statuses)
 *   - auto-view-once (save view-once media)
 *   - anti-spam (rate-limit users)
 */
const config = require('../config');
const { getJSON, downloadMedia, pick } = require('../lib/helpers');
const { isGroupAdmin } = require('../lib/handler');

const LINK_RE = /(https?:\/\/|www\.|chat\.whatsapp\.com|t\.me\/|wa\.me\/|bit\.ly|tinyurl)/i;

// ---- Emoji Kitchen (Google gstatic) — no API key, works for supported pairs ----
const EK_DATES = ['20201001', '20210521', '20211115', '20220506', '20220823', '20230301', '20230403', '20230803'];
function cp(e) { return [...e].map((c) => c.codePointAt(0).toString(16)).join('-'); }
/** Find a Google Emoji Kitchen PNG for two emojis (parallel HEAD probes). */
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
const spamMap = new Map(); // sender -> { count, ts }
const SPAM_LIMIT = 6;      // messages
const SPAM_WINDOW = 5000;  // ms

function saveEnv(key, val) {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    let lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n').filter(Boolean) : [];
    lines = lines.filter((l) => !l.startsWith(key + '='));
    lines.push(`${key}=${val}`);
    fs.writeFileSync(envPath, lines.join('\n'));
  } catch { /* ignore */ }
}

const TOGGLES = {
  antidelete: 'ANTIDELETE', antispam: 'ANTISPAM', autoreact: 'AUTO_REACT',
  autostatus: 'AUTOSTATUS', autoviewonce: 'AUTOVIEWONCE', autobio: 'AUTOBIO', chatbot: 'CHATBOT',
};

/* ============================ per-message hook ============================ */
async function onMessage(ctx) {
  const { sock, m, from, isGroup, sender, text, command, isOwner } = ctx;
  const isStatus = from === 'status@broadcast';

  // ---- auto-status: view incoming statuses ----
  if (isStatus) {
    if (config.AUTOSTATUS) {
      try {
        await sock.readMessages([m.key]);
        if (config.AUTO_REACT) {
          await sock.sendMessage('status@broadcast', { react: { text: pick(config.REACT_EMOJIS), key: m.key } },
            { statusJidList: [m.key.participant || m.key.remoteJid] }).catch(() => {});
        }
      } catch { /* ignore */ }
    }
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
    if (rec.count > SPAM_LIMIT) return; // drop spammy messages
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

  // ---- auto-react ----
  if (config.AUTO_REACT && !command && Math.random() < 0.35) {
    try { await sock.sendMessage(from, { react: { text: pick(config.REACT_EMOJIS), key: m.key } }); } catch { /* ignore */ }
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
  const { command, reply, arg } = ctx;

  // ---- toggles ----
  if (TOGGLES[command]) {
    const key = TOGGLES[command];
    config[key] = !config[key];
    saveEnv(key, config[key]);
    await reply(`✅ *${command.toUpperCase()}* ab *${config[key] ? 'ON 🟢' : 'OFF 🔴'}* hy.`);
    return;
  }

  switch (command) {
    case 'premium':
      await reply(
        `👑 *${config.BOT_NAME} — PREMIUM*\n\n` +
        `🛡️ Anti-Delete: ${config.ANTIDELETE ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `🔗 Anti-Link: ${config.ANTILINK ? 'ON 🟢' : 'OFF 🔴'}\n` +
        `🚫 Anti-Spam: ${config.ANTISPAM ? 'ON 🟢' : 'OFF 🔴'}\n` +
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

    case 'tts': {
      if (!arg) return reply(`❌ Text do. Example: ${config.PREFIX}tts Assalam o alaikum`);
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

    case 'emojimix': {
      const [a, b] = (arg || '').split(/\s+/);
      if (!a || !b) return reply(`❌ Do emoji do. Example: ${config.PREFIX}emojimix 😂 🥰`);
      try {
        const url = await emojiKitchen(a, b);
        if (!url) throw new Error('no mix');
        await ctx.send(ctx.from, { image: { url }, caption: `${a} + ${b} 🎨` }, { quoted: ctx.m });
      } catch { await reply('❌ Ye emoji combo support nahi hy. Koi aur combo try karo.'); }
      return;
    }

    default:
      await reply('❓ Unknown premium command');
  }
};

module.exports = {
  commands: [
    ...Object.keys(TOGGLES), 'premium', 'readmore', 'vcf', 'tts', 'carbon', 'ss', 'tourl', 'emojimix',
  ],
  category: '👑 PREMIUM',
  handler,
  onMessage,
};
