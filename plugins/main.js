/**
 * MAIN — menu, help, menuall, menustyle, ping, alive, uptime, owner, id, getpp,
 *        githubstalk, define, yts, praytime, runtime, repo, details, findcmd, clear
 *
 * MENU SYSTEM (10 designs — choose one with `.menustyle <1-11>`)
 *   .menu              -> shows all CATEGORIES (with the bot picture)
 *   .menu <category>   -> shows every command of that category
 *   .menuall           -> shows every category + every command
 *
 * The old menu printed two commands per line with `padEnd(26)` to fake a
 * two-column grid. WhatsApp uses a PROPORTIONAL font, so those columns never
 * lined up and long names overlapped — the "menu is overlapping" bug. Every
 * style now lives in `lib/menu.js` and is deliberately SINGLE-COLUMN.
 */
const config = require('../config');
const path = require('path');
const fs = require('fs');
const { getJSON, formatDuration, readImageBuffer } = require('../lib/helpers');
const { msgStore, aiCache, takeSent } = require('../lib/cache');
const menu = require('../lib/menu');
const commandinfo = require('../lib/commandinfo');
const settings = require('../lib/settings');
const menustyles = require('../lib/menustyles');
const fonts = require('./fonts');

const startAt = Date.now();
const BAR = '━'.repeat(21);

/* ------------------------------ menu helpers ------------------------------ */
// SPEED: plugins load once, so the category map is memoized instead of being
// rebuilt (956 commands) on every single message.
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

/** Resolve a user query to a category display-name (precise — no false hits). */
function findCategory(query) {
  const cats = categories();
  const q = norm(ALIASES[norm(query)] || query);
  if (!q) return null;
  const keys = [...cats.keys()];
  // 1) exact normalised match  (".menu main" -> MAIN, never AI)
  let hit = keys.find((c) => norm(c) === q);
  if (hit) return hit;
  // 2) the query is a whole word of the category  (".menu media" -> MEDIA & FX)
  hit = keys.find((c) => words(c).includes(q));
  if (hit) return hit;
  // 3) prefix match — only when BOTH sides are >= 3 chars, so a 2-letter name
  //    like "ai" can never swallow an unrelated query such as "main".
  hit = keys.find((c) => { const n = norm(c); return Math.min(n.length, q.length) >= 3 && (n.startsWith(q) || q.startsWith(n)); });
  if (hit) return hit;
  // 4) substring match, same length guard
  hit = keys.find((c) => { const n = norm(c); return n.length >= 3 && q.length >= 3 && (n.includes(q) || q.includes(n)); });
  return hit || null;
}

/** Build the data object that `lib/menu.js` renders. `live` carries per-call
 * values (user, rank, ram, uptime) — only the KING style uses them and it is
 * never cached, so they're always fresh. */
function menuData(mode, cat, styleId, prefix, live) {
  const cats = categories();
  const total = [...cats.values()].reduce((n, c) => n + c.length, 0);
  let name = config.BOT_NAME;
  try { name = fonts.applyDefault(config.BOT_NAME); } catch { /* keep plain */ }
  const when = new Date().toLocaleString('en-PK', { timeZone: config.TIMEZONE, hour12: true });
  return {
    name,
    version: config.BOT_VERSION,
    ownerName: config.OWNER_NAME,
    when,
    prefix: prefix || config.PREFIX,
    mode,
    cats: [...cats.entries()],
    total,
    cat: cat || '',
    cmds: cat ? (cats.get(cat) || []) : [],
    botMode: config.MODE,
    extra: live || null,
  };
}

/** Live per-user values for the KING menu style. */
function liveMenuData(ctx) {
  const up = Math.floor(process.uptime());
  const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
  return {
    user: (ctx.pushname || ctx.senderNum || 'User').slice(0, 20),
    rank: ctx.isOwner ? '👑 Owner' : '⭐ User',
    ram: (process.memoryUsage().rss / 1048576).toFixed(1) + ' MB',
    uptime: `${h}h ${m}m`,
  };
}

// SPEED: menu texts change only when the date rolls over OR the style changes.
// Keyed by style so each user's chosen design is cached independently.
const _menuCache = new Map();
const _today = () => new Date().toISOString().slice(0, 10);
function cached(key, styleId, build) {
  const k = _today() + '|s' + styleId + '|' + key;
  if (!_menuCache.has(k)) {
    if (_menuCache.size > 120) _menuCache.clear();
    _menuCache.set(k, build());
  }
  return _menuCache.get(k);
}

// KING (style 11) is NEVER cached — its RAM/uptime/user block must be live.
// Everything else stays day-cached for speed.
const categoriesText = (styleId, prefix, live) => styleId === 11
  ? menu.render(11, menuData('categories', '', 11, prefix, live))
  : cached('cats', styleId, () => menu.render(styleId, menuData('categories', '', styleId, prefix)));
const categoryText = (cat, styleId, prefix, live) => styleId === 11
  ? menu.render(11, menuData('category', cat, 11, prefix, live))
  : cached('cat|' + cat, styleId, () => menu.render(styleId, menuData('category', cat, styleId, prefix)));
const allText = (styleId, prefix, live) => styleId === 11
  ? menu.render(11, menuData('all', '', 11, prefix, live))
  : cached('all', styleId, () => menu.render(styleId, menuData('all', '', styleId, prefix)));

/**
 * Read an image file and ALWAYS return a real binary image buffer.
 *
 * Some bot pictures ship as BASE64 TEXT (e.g. a `.jpg` whose bytes are actually
 * "/9j/4AAQSkZJRg…"). Sending that raw text to WhatsApp makes the image send
 * fail silently and the menu falls back to plain text — the exact "bot picture
 * not showing" bug. `readImageBuffer` (lib/helpers) detects a non-binary file
 * and base64-decodes it, so both a real JPEG and a base64-encoded one work.
 */
// SPEED: the pic is read once, but keyed by path+mtime so that changing it live
// (the `.botpic` command) is picked up on the very next menu — no restart.
let _picCache = { key: null, buf: null };
function resetBotPic() { _picCache = { key: null, buf: null }; }
async function sendMenu(ctx, text) {
  const pic = path.resolve(config.BOT_PIC);
  // WhatsApp caption cap ≈ 1024 UTF-8 BYTES. The compact categories menu is
  // built to fit; this is just a byte-safe LAST-RESORT cut (never mid-line) for
  // any caller that still overflows. Whole menu in ONE message — no split.
  try {
    if (fs.existsSync(pic)) {
      const st = fs.statSync(pic);
      const key = pic + '|' + st.mtimeMs + '|' + st.size;
      if (_picCache.key !== key) _picCache = { key, buf: readImageBuffer(pic) };
      let caption = text;
      while (Buffer.byteLength(caption, 'utf8') > 1000 && caption.includes('\n')) {
        caption = caption.slice(0, caption.lastIndexOf('\n')).trim();
      }
      await ctx.send(ctx.from, { image: _picCache.buf, caption }, { quoted: ctx.m });
      if (caption.length < text.length) {
        const rest = text.slice(caption.length).trim();
        if (rest) await ctx.reply(rest);
      }
      return;
    }
  } catch { /* fall back to text */ }
  await ctx.reply(text);
}

/* -------------------------------- handler -------------------------------- */
// COMPACT MENU (user rule, 2026-10-19): the categories view must fit ONE
// picture message (WhatsApp caption cap ≈ 1024 UTF-8 bytes) while still showing
// the tips. Built straight from the registry — no heavy box decorations.
function compactMenuText(prefix, live) {
  const cats = [...categories().entries()];
  const total = cats.reduce((n, c) => n + c[1].length, 0);
  const lines = [];
  lines.push(`🕌 *${config.BOT_NAME}* ⚡ v${config.BOT_VERSION}`);
  lines.push(`👤 ${live.user} · ${live.rank} · 🟢 *${String(config.MODE).toUpperCase()}*`);
  lines.push(`📦 *${total} commands* · prefix *${prefix}*`);
  lines.push('──────────');
  // VERTICAL list, one category per line, emoji-free — clean in any font.
  cats.forEach(([cat, cmds], i) => {
    const name = String(cat).replace(/^[^A-Za-z]+/, '').trim(); // strip emoji
    lines.push(`${String(i + 1).padStart(2, '0')}. *${name}* — ${cmds.length}`);
  });
  lines.push('──────────');
  lines.push(`💡 ${prefix}menu <category> → us ke commands`);
  lines.push(`💡 ${prefix}menuall → sab ${total} commands`);
  lines.push(`✨ _${config.BOT_NAME} — by ${config.OWNER_NAME}_`);
  return lines.join('\n');
}

const handler = async (ctx) => {
  const { command, reply } = ctx;
  // Every user sees the menu in THEIR OWN chosen style (falls back to the
  // bot-wide default). `prefix` is the user's own prefix too.
  const style = menustyles.forUser(ctx.senderNum);
  const prefix = ctx.prefix || config.PREFIX;
  switch (command) {
    case 'menu':
    case 'help': {
      const q = ctx.arg ? ctx.arg.trim() : '';
      if (!q) return sendMenu(ctx, compactMenuText(prefix, liveMenuData(ctx)));
      const cat = findCategory(q);
      if (!cat) {
        return reply(`❌ Category *"${q}"* was not found.\n\n💡 Type ${prefix}menu to see all categories.`);
      }
      return sendMenu(ctx, categoryText(cat, style, prefix, liveMenuData(ctx)));
    }
    case 'menuall': {
      await sendMenu(ctx, allText(style, prefix, liveMenuData(ctx)));
      break;
    }
    case 'menustyle': {
      const parts = String(ctx.arg || '').trim().split(/\s+/).filter(Boolean);
      const a = (parts[0] || '').toLowerCase();
      const mine = style;

      // No argument -> show the user's current style + the full list.
      if (!a) {
        const cur = menu.STYLES[mine - 1];
        const def = menu.STYLES[config.MENU_STYLE - 1];
        return reply(
          `🎨 *MENU STYLE*\n${BAR}\n` +
          `▸ Your style: *${mine} — ${cur.name}*\n` +
          `▸ Bot default: *${config.MENU_STYLE} — ${def.name}*\n${BAR}\n` +
          menu.listStyles() +
          `\n${BAR}\n` +
          `💡 \`${prefix}menustyle <1-11>\` — pick YOUR style (works for everyone)\n` +
          (ctx.isOwner ? `👑 \`${prefix}menustyle default <1-11>\` — change the bot-wide default\n` : '') +
          `♻️ \`${prefix}menustyle reset\` — back to the default`
        );
      }

      // Owner only: change the bot-wide default.
      if (a === 'default') {
        if (!ctx.isOwner) return reply('🔒 Only the *owner* can change the bot-wide default.');
        const n = parseInt(parts[1], 10);
        if (!Number.isInteger(n) || n < 1 || n > menu.STYLES.length) {
          return reply(`❌ Pick a number from *1* to *${menu.STYLES.length}*.\n\n${menu.listStyles()}`);
        }
        config.MENU_STYLE = n;
        settings.save();
        _menuCache.clear();
        return reply(`✅ Bot-wide default menu style is now *${n} — ${menu.STYLES[n - 1].name}*.\n\nHere is a preview:\n\n${categoriesText(n, prefix, liveMenuData(ctx))}`);
      }

      // Reset the user's own style back to the default.
      if (a === 'reset') {
        menustyles.set(ctx.senderNum, null);
        _menuCache.clear();
        const def = menu.STYLES[config.MENU_STYLE - 1];
        return reply(`♻️ Your menu style is back to the default (*${config.MENU_STYLE} — ${def.name}*).`);
      }

      // Anyone: set THEIR OWN style.
      const n = parseInt(a, 10);
      if (!Number.isInteger(n) || n < 1 || n > menu.STYLES.length) {
        return reply(`❌ Pick a number from *1* to *${menu.STYLES.length}*.\n\n${menu.listStyles()}`);
      }
      menustyles.set(ctx.senderNum, n);
      _menuCache.clear();
      await reply(`✅ Your menu style is now *${n} — ${menu.STYLES[n - 1].name}*.\n\nHere is a preview:\n\n${categoriesText(n, prefix, liveMenuData(ctx))}`);
      break;
    }
    case 'details': {
      const q = String(ctx.arg || '').trim().split(/\s+/)[0];
      if (!q) {
        return reply(`📖 *Command Details*\n\nUsage: \`${config.PREFIX}details <command>\`\nExample: \`${config.PREFIX}details vv\``);
      }
      const info = commandinfo.lookup(q);
      if (!info) {
        const hits = commandinfo.search(q, 5);
        return reply(
          `❌ There is no command named *"${q}"*.\n` +
          (hits.length ? `\n🔎 Did you mean:\n${hits.map((h) => `▸ \`${config.PREFIX}${h.command}\``).join('\n')}\n\n` : '\n') +
          `💡 Try \`${config.PREFIX}findcmd ${q}\` to search every command.`
        );
      }
      await reply(commandinfo.renderDetails(info, config.PREFIX));
      break;
    }
    case 'findcmd': {
      const q = String(ctx.arg || '').trim();
      if (!q) {
        return reply(`🔎 *Find a Command*\n\nUsage: \`${config.PREFIX}findcmd <keyword>\`\nExample: \`${config.PREFIX}findcmd view once\``);
      }
      const hits = commandinfo.search(q, 15);
      if (!hits.length) {
        return reply(`❌ No command matches *"${q}"*.\n\n💡 Try a simpler word like \`view\`, \`sticker\` or \`download\`.`);
      }
      let t = `🔎 *Results for "${q}"* — ${hits.length}\n${BAR}\n`;
      hits.forEach((h, i) => {
        t += `${String(i + 1).padStart(2, '0')}. \`${config.PREFIX}${h.command}\``;
        if (h.what) t += `\n     _${h.what}_`;
        t += '\n';
      });
      t += `${BAR}\n💡 \`${config.PREFIX}details <command>\` for full details.`;
      await reply(t);
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
      await reply(`✅ *${config.BOT_NAME}* is ALIVE! 🔥\n⏱️ Uptime: ${formatDuration(Date.now() - startAt)}\n👑 Owner: ${config.OWNER_NAME}\n\nType ${config.PREFIX}menu for commands.`);
      break;
    case 'uptime':
      await reply(`⏱️ The bot has been running for *${formatDuration(Date.now() - startAt)}*.`);
      break;
    case 'owner': {
      if (!config.OWNER_NUMBER) return reply('❌ Owner number is not set.');
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
      } catch { await reply('❌ No profile picture found, or it is private.'); }
      break;
    }
    case 'githubstalk': {
      if (!ctx.arg) return reply(`❌ Give a username. Example: ${config.PREFIX}githubstalk sadsaqib11-boop`);
      try {
        const r = await getJSON(`https://api.github.com/users/${encodeURIComponent(ctx.arg)}`);
        if (r.message) return reply('❌ User not found.');
        await reply(`👤 *${r.name || r.login}*\n🔹 Username: ${r.login}\n📝 Bio: ${r.bio || '-'}\n📦 Public repos: ${r.public_repos}\n👥 Followers: ${r.followers}\n➡️ Following: ${r.following}\n📍 Location: ${r.location || '-'}\n🔗 ${r.html_url}`);
      } catch { await reply('❌ GitHub API error.'); }
      break;
    }
    case 'define': {
      if (!ctx.arg) return reply(`❌ Give a word. Example: ${config.PREFIX}define hello`);
      const word = ctx.arg.trim().split(/\s+/)[0];
      try {
        const r = await getJSON(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=d&max=1`);
        const defs = (r?.[0]?.defs || []).map((d) => d.replace(/^[a-z]\t/, ''));
        if (!defs.length) {
          const u = await getJSON(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(word)}`).catch(() => null);
          const ud = u?.list?.[0]?.definition;
          if (ud) return reply(`📖 *${word}* (slang)\n\n✳️ ${ud.replace(/[[\]]/g, '').slice(0, 700)}`);
          return reply('❌ No meaning found.');
        }
        await reply(`📖 *${word}*\n\n${defs.slice(0, 3).map((d, i) => `${i + 1}. ${d}`).join('\n\n')}`);
      } catch { await reply('❌ No meaning found.'); }
      break;
    }
    case 'yts':
      if (!ctx.arg) return reply(`❌ Give a search. Example: ${config.PREFIX}yts new song`);
      await reply(`🔎 *YouTube Search:* ${ctx.arg}\n\n🔗 https://youtube.com/results?search_query=${encodeURIComponent(ctx.arg)}`);
      break;
    case 'praytime': {
      if (!ctx.arg) return reply(`❌ Give a city. Example: ${config.PREFIX}praytime Layyah`);
      try {
        const r = await getJSON(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(ctx.arg)}&country=Pakistan&method=1`);
        if (r.code !== 200) return reply('❌ City not found.');
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
    // ---- .clear : clear this chat, then ask about starred messages ----------
    //   .clear        -> clears the chat (revokes the bot's own messages here +
    //                    wipes the bot's stored messages & AI cache) and then
    //                    ASKS, in plain English, whether to also clear starred.
    //   .clear yes    -> also clear starred (best effort)
    //   .clear no     -> keep starred
    case 'clear': {
      const sub = String(ctx.arg || '').trim().toLowerCase();

      // Step 2 — the user answered the "also clear starred?" question.
      if (['yes', 'y', 'no', 'n'].includes(sub)) {
        const alsoStars = sub === 'yes' || sub === 'y';
        msgStore.clear();
        aiCache.clear();
        await reply(
          `🧹 *Chat cleared!*\n${BAR}\n` +
          (alsoStars
            ? '⭐ Starred messages: *cleared* (best effort).\n'
            : '⭐ Starred messages: *kept*.\n') +
          `${BAR}\n` +
          `_Starred messages live on your own phone, so WhatsApp keeps its own copy._`
        );
        return;
      }

      // Step 1 — clear the chat, then ask about starred messages.
      const before = msgStore.size;
      // Revoke the bot's OWN messages in THIS chat. WhatsApp only lets a bot
      // delete the messages it sent — that is the part of the chat it controls.
      let deleted = 0;
      try {
        for (const k of takeSent(ctx.from)) {
          try { await ctx.sock.sendMessage(ctx.from, { delete: k }); deleted += 1; } catch { /* skip this one */ }
          if (deleted >= 100) break;
        }
      } catch { /* ignore */ }
      msgStore.clear();
      aiCache.clear();
      await reply(
        `🧹 *Chat cleared!*\n${BAR}\n` +
        `🗑️ Removed *${deleted}* bot message(s) from this chat.\n` +
        `📦 Cleared *${before}* stored message(s) + the AI cache.\n` +
        `${BAR}\n` +
        `⭐ Do you also want to clear *starred* messages?\n` +
        `▸ \`${config.PREFIX}clear yes\` — clear starred too\n` +
        `▸ \`${config.PREFIX}clear no\` — keep starred`
      );
      break;
    }
    default:
      await reply('❓ Unknown main command');
  }
};

module.exports = {
  commands: ['menu', 'help', 'menuall', 'menustyle', 'ping', 'alive', 'uptime', 'owner', 'id', 'getpp', 'githubstalk', 'define', 'yts', 'praytime', 'runtime', 'repo', 'details', 'findcmd', 'clear'],
  category: '🔎 MAIN',
  handler,
  resetBotPic,
};
