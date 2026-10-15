/**
 * MAIN — menu, help, menuall, ping, alive, uptime, owner, id, getpp,
 *        githubstalk, define, yts, praytime, runtime, repo, clear
 *
 * MENU SYSTEM
 *   .menu              -> shows all CATEGORIES (with the bot picture)
 *   .menu <category>   -> shows every command of that category
 *   .menuall           -> shows every category + every command
 */
const config = require('../config');
const path = require('path');
const fs = require('fs');
const { getJSON, formatDuration } = require('../lib/helpers');
const { msgStore, aiCache } = require('../lib/cache');
const fonts = require('./fonts');

const startAt = Date.now();

/* ------------------------------ menu helpers ------------------------------ */
// SPEED: plugins load once, so the category map + menu texts are memoized
// instead of being rebuilt (956 commands) on every single message.
let _cats = null;
function categories() {
  if (_cats) return _cats;
  const map = new Map();
  for (const p of require('./_registry').all()) {
    if (p.hidden) continue;
    const cat = p.category || 'OTHER';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(...p.commands);
  }
  _cats = map;
  return map;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);

// Friendly aliases so users can type `.menu dl`, `.menu grp`, etc.
const ALIASES = {
  dl: 'download', down: 'download', media: 'media', fx: 'media',
  grp: 'group', gc: 'group', cfg: 'settings', setting: 'settings', config: 'settings',
  owner: 'owner', main: 'main', ai: 'ai', fun: 'fun', tools: 'tools',
  anime: 'anime', logo: 'logo', premium: 'premium', download: 'download',
};

/** Resolve a user query to a category display-name. */
function findCategory(query) {
  const cats = categories();
  const q = norm(ALIASES[norm(query)] || query);
  if (!q) return null;
  let best = null;
  for (const cat of cats.keys()) {
    const n = norm(cat);
    const w = words(cat);
    if (n === q || w.includes(q) || n.includes(q) || q.includes(n) || w.some((x) => x.startsWith(q) || q.startsWith(x))) {
      best = cat;
      break;
    }
  }
  return best;
}

/** A clean, modern header — fewer boxes, easier to read on a phone. */
function header() {
  let name = config.BOT_NAME;
  try { name = fonts.applyDefault(config.BOT_NAME); } catch { /* keep plain */ }
  const when = new Date().toLocaleString('en-PK', { timeZone: config.TIMEZONE, hour12: true });
  return (
    `┏━━━━━━━━━━━━━━━━━━━┓\n` +
    `┃  ✨ *${name}*  ✨\n` +
    `┗━━━━━━━━━━━━━━━━━━━┛\n` +
    `  ⚡ v${config.BOT_VERSION}   👑 ${config.OWNER_NAME}\n` +
    `  🕒 ${when}\n` +
    `  💠 Prefix: *${config.PREFIX}*`
  );
}

/** Send the menu as an image (bot pic) when it fits, else as text. */
let _picBuf = null;
async function sendMenu(ctx, text) {
  const pic = path.resolve(config.BOT_PIC);
  try {
    if (text.length <= 1000 && fs.existsSync(pic)) {
      if (!_picBuf) _picBuf = fs.readFileSync(pic); // SPEED: read the pic once
      await ctx.send(ctx.from, { image: _picBuf, caption: text }, { quoted: ctx.m });
      return;
    }
  } catch { /* fall back to text */ }
  await ctx.reply(text);
}

// SPEED: menu texts change only when the date (in the header) rolls over.
const _menuCache = new Map();
const _today = () => new Date().toISOString().slice(0, 10);
function cached(key, build) {
  const k = _today() + '|' + key;
  if (!_menuCache.has(k)) _menuCache.set(k, build());
  return _menuCache.get(k);
}

function categoriesText() {
  return cached('cats', () => {
    const cats = categories();
    const total = [...cats.values()].reduce((n, c) => n + c.length, 0);
    let txt = `${header()}\n\n`;
    txt += `╭─「 📂 *CATEGORIES* 」\n`;
    let i = 1;
    for (const [cat, cmds] of cats.entries()) {
      txt += `│ ${String(i).padStart(2, '0')}. *${cat}*\n`;
      txt += `│      ╰─ ${cmds.length} commands\n`;
      i++;
    }
    txt += `╰───────────────────\n\n`;
    txt += `📊 *Total:* ${total} commands\n\n`;
    txt += `╭─「 💡 *USE KAISE KAREIN* 」\n`;
    txt += `│ ▸ ${config.PREFIX}menu <category>\n│      ╰─ category ki commands\n`;
    txt += `│ ▸ ${config.PREFIX}menuall\n│      ╰─ saari commands\n`;
    txt += `╰───────────────────\n\n`;
    txt += `_✨ ${config.BOT_NAME} — by ${config.OWNER_NAME}_`;
    return txt;
  });
}

function categoryText(cat) {
  return cached('cat|' + cat, () => {
    const cmds = categories().get(cat) || [];
    let txt = `${header()}\n\n`;
    txt += `╭─「 *${cat}* 」\n`;
    txt += `│ 📦 ${cmds.length} commands\n`;
    txt += `╰───────────────────\n\n`;
    // two commands per line when they are short, so the list is half as long
    const p = config.PREFIX;
    const rows = [];
    for (let i = 0; i < cmds.length; i += 2) {
      const a = `▸ ${p}${cmds[i]}`;
      const b = cmds[i + 1] ? `▸ ${p}${cmds[i + 1]}` : '';
      rows.push(b ? `${a.padEnd(26)}${b}` : a);
    }
    txt += rows.join('\n');
    txt += `\n\n╭─「 💡 」\n`;
    txt += `│ ${p}menu — categories\n│ ${p}menuall — saari commands\n`;
    txt += `╰───────────────────`;
    return txt;
  });
}

function allText() {
  return cached('all', () => {
    const cats = categories();
    let txt = `${header()}\n\n`;
    for (const [cat, cmds] of cats.entries()) {
      txt += `┌─「 *${cat}* 」\n`;
      txt += cmds.map((c) => `│ ▹ ${config.PREFIX}${c}`).join('\n');
      txt += `\n└────────────────\n\n`;
    }
    txt += `_*${config.BOT_NAME} — Powered by ${config.OWNER_NAME}*_`;
    return txt;
  });
}

/* -------------------------------- handler -------------------------------- */
const handler = async (ctx) => {
  const { command, reply } = ctx;
  switch (command) {
    case 'menu':
    case 'help': {
      const q = ctx.arg ? ctx.arg.trim() : '';
      if (!q) return sendMenu(ctx, categoriesText());
      const cat = findCategory(q);
      if (!cat) {
        return reply(`❌ Category *"${q}"* nahi mili.\n\n${config.PREFIX}menu likho taake saari categories dekho.`);
      }
      return sendMenu(ctx, categoryText(cat));
    }
    case 'menuall': {
      await reply(allText());
      break;
    }
    case 'ping': {
      const t0 = Date.now();
      await reply('🏓 Pong!');
      const latency = Date.now() - t0;
      await reply(`🏓 *Pong!*\n⚡ Speed: *${latency}ms*\n⏱️ Uptime: ${formatDuration(Date.now() - startAt)}`);
      break;
    }
    case 'alive':
      await reply(`✅ *${config.BOT_NAME}* ZINDA hy! 🔥\n⏱️ Uptime: ${formatDuration(Date.now() - startAt)}\n👑 Owner: ${config.OWNER_NAME}\n\nType ${config.PREFIX}menu for commands.`);
      break;
    case 'uptime':
      await reply(`⏱️ Bot *${formatDuration(Date.now() - startAt)}* se chal raha hy.`);
      break;
    case 'owner': {
      if (!config.OWNER_NUMBER) return reply('❌ Owner number set nahi hy.');
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${config.OWNER_NAME}\nTEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}\nEND:VCARD`;
      await ctx.send(ctx.from, { contacts: { displayName: config.OWNER_NAME, contacts: [{ vcard }] } }, { quoted: ctx.m });
      break;
    }
    case 'id': {
      const who = ctx.quoted ? (ctx.quoted.key.participant || ctx.quoted.key.remoteJid) : ctx.sender;
      await reply(`🆔 *ID:* ${who}\n👤 *Number:* +${(who || '').split('@')[0].split(':')[0]}`);
      break;
    }
    case 'getpp': {
      const who = ctx.arg ? ctx.arg.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : (ctx.quoted?.key.participant || ctx.sender);
      try {
        const pp = await ctx.sock.profilePictureUrl(who, 'image');
        await ctx.send(ctx.from, { image: { url: pp }, caption: '🖼️ Profile Picture' }, { quoted: ctx.m });
      } catch { await reply('❌ DP nahi mili ya private hy.'); }
      break;
    }
    case 'githubstalk': {
      if (!ctx.arg) return reply(`❌ Username do. Example: ${config.PREFIX}githubstalk sadsaqib11-boop`);
      try {
        const r = await getJSON(`https://api.github.com/users/${encodeURIComponent(ctx.arg)}`);
        if (r.message) return reply('❌ User nahi mila.');
        await reply(`👤 *${r.name || r.login}*\n🔹 Username: ${r.login}\n📝 Bio: ${r.bio || '-'}\n📦 Public repos: ${r.public_repos}\n👥 Followers: ${r.followers}\n➡️ Following: ${r.following}\n📍 Location: ${r.location || '-'}\n🔗 ${r.html_url}`);
      } catch { await reply('❌ GitHub API error.'); }
      break;
    }
    case 'define': {
      if (!ctx.arg) return reply(`❌ Word do. Example: ${config.PREFIX}define hello`);
      const word = ctx.arg.trim().split(/\s+/)[0];
      try {
        const r = await getJSON(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=d&max=1`);
        const defs = (r?.[0]?.defs || []).map((d) => d.replace(/^[a-z]\t/, ''));
        if (!defs.length) {
          const u = await getJSON(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(word)}`).catch(() => null);
          const ud = u?.list?.[0]?.definition;
          if (ud) return reply(`📖 *${word}* (slang)\n\n✳️ ${ud.replace(/[[\]]/g, '').slice(0, 700)}`);
          return reply('❌ Meaning nahi mila.');
        }
        await reply(`📖 *${word}*\n\n${defs.slice(0, 3).map((d, i) => `${i + 1}. ${d}`).join('\n\n')}`);
      } catch { await reply('❌ Meaning nahi mila.'); }
      break;
    }
    case 'yts':
      if (!ctx.arg) return reply(`❌ Search likho. Example: ${config.PREFIX}yts naye song`);
      await reply(`🔎 *YouTube Search:* ${ctx.arg}\n\n🔗 https://youtube.com/results?search_query=${encodeURIComponent(ctx.arg)}`);
      break;
    case 'praytime': {
      if (!ctx.arg) return reply(`❌ City likho. Example: ${config.PREFIX}praytime Layyah`);
      try {
        const r = await getJSON(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(ctx.arg)}&country=Pakistan&method=1`);
        if (r.code !== 200) return reply('❌ City nahi mili.');
        const t = r.data.timings;
        await reply(`🕌 *Prayer Times — ${ctx.arg}*\n\n🌅 Fajr: ${t.Fajr}\n☀️ Dhuhr: ${t.Dhuhr}\n🌤️ Asr: ${t.Asr}\n🌇 Maghrib: ${t.Maghrib}\n🌃 Isha: ${t.Isha}`);
      } catch { await reply('❌ Prayer API error.'); }
      break;
    }
    case 'runtime':
      await reply(`⏱️ *Runtime:* ${formatDuration(Date.now() - startAt)}\n🟢 Node ${process.version}\n💾 RAM: ${(process.memoryUsage().rss / 1048576).toFixed(1)} MB`);
      break;
    case 'repo':
      await reply(`📦 *${config.BOT_NAME}* — WhatsApp Bot\n🔗 https://github.com/sadsaqib11-boop/SAQIB-MD`);
      break;
    case 'clear': {
      const before = msgStore.size;
      msgStore.clear();
      aiCache.clear();
      await reply(`🧹 *Clear done!*\n\n🗑️ ${before} stored messages hata diye.\n🧠 AI cache bhi clear ho gaya.`);
      break;
    }
    // ---- .clearcommand : wipe MY OWN inbox (my chat with myself) ------------
    // She asked for exactly this: clear the messages in "yourself" — the user's
    // own self-chat — not the current group or DM. Works by deleting our own
    // outgoing messages from that chat, newest first, with a short gap so
    // WhatsApp accepts each revoke.
    case 'clearcommand':
    case 'clearinbox':
    case 'clearall': {
      const target = `${ctx.senderNum}@s.whatsapp.net`;   // "yourself" = own number
      const n = Number(ctx.arg) || 30;                     // how many to try
      await reply(`🧹 *Aap ka inbox (yourself) saaf kar raha hoon…*\n_${n} messages tak_`);
      let done = 0;
      try {
        // fetch the most recent messages in that chat, then delete our own ones
        const store = await ctx.sock.fetchMessageHistory?.(n, ctx.m.key, 0).catch(() => null);
        const msgs = (store?.messages || []).filter((x) => x?.key?.remoteJid === target && x.key.fromMe);
        for (const mk of msgs) {
          try {
            await ctx.sock.sendMessage(target, { delete: mk.key });
            done += 1;
            await new Promise((r) => setTimeout(r, 350));  // be gentle, avoid rate limits
          } catch { /* skip this one */ }
        }
      } catch { /* ignore */ }
      await reply(
        done
          ? `✅ *Inbox saaf!*\n\n🗑️ ${done} messages hata diye.`
          : `ℹ️ Kuch nahi hata saka.\n\n_Note: WhatsApp sirf apne bheje hue messages delete karne deta hy, aur history fetch har device par kaam nahi karta._`
      );
      break;
    }
    default:
      await reply('❓ Unknown main command');
  }
};

module.exports = {
  commands: ['menu', 'help', 'menuall', 'ping', 'alive', 'uptime', 'owner', 'id', 'getpp', 'githubstalk', 'define', 'yts', 'praytime', 'runtime', 'repo', 'clear', 'clearcommand', 'clearinbox', 'clearall'],
  category: '🔎 MAIN',
  handler,
};
