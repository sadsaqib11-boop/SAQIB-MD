/**
 * MAIN — menu, help, ping, alive, uptime, owner, id, getpp, githubstalk, define, yts, praytime, repo
 */
const config = require('../config');
const { getJSON, formatDuration } = require('../lib/helpers');

const startAt = Date.now();

const handler = async (ctx) => {
  const { command, reply } = ctx;
  switch (command) {
    case 'menu':
    case 'help': {
      const cats = {};
      for (const p of require('./_registry').all()) {
        if (p.hidden) continue;
        const c = p.category || 'OTHER';
        cats[c] = cats[c] || [];
        cats[c].push(...p.commands);
      }
      let txt = `╭─❖ *${config.BOT_NAME}* ❖─╮\n`;
      txt += `│ 🤖 Bot: ${config.BOT_NAME} v${config.BOT_VERSION}\n`;
      txt += `│ 👑 Owner: ${config.OWNER_NAME}\n`;
      txt += `│ 📅 ${new Date().toLocaleString('en-PK', { timeZone: config.TIMEZONE })}\n`;
      txt += `│ 🔥 Prefix: "${config.PREFIX}"\n`;
      txt += `╰──────────────────╯\n`;
      for (const [cat, cmds] of Object.entries(cats)) {
        txt += `\n┌─「 *${cat}* 」\n`;
        txt += cmds.map((c) => `│ ▹ ${config.PREFIX}${c}`).join('\n');
        txt += '\n└────────────\n';
      }
      txt += `\n_*${config.BOT_NAME} — Powered by ${config.OWNER_NAME}*_`;
      await reply(txt);
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
      if (!ctx.arg) return reply(`❌ Username do. Example: ${config.PREFIX}githubstalk saqibiqbaltesting-ai`);
      try {
        const r = await getJSON(`https://api.github.com/users/${encodeURIComponent(ctx.arg)}`);
        if (r.message) return reply('❌ User nahi mila.');
        await reply(`👤 *${r.name || r.login}*\n🔹 Username: ${r.login}\n📝 Bio: ${r.bio || '-'}\n📦 Public repos: ${r.public_repos}\n👥 Followers: ${r.followers}\n➡️ Following: ${r.following}\n📍 Location: ${r.location || '-'}\n🔗 ${r.html_url}`);
      } catch { await reply('❌ GitHub API error.'); }
      break;
    }
    case 'define': {
      if (!ctx.arg) return reply(`❌ Word do. Example: ${config.PREFIX}define hello`);
      try {
        const r = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(ctx.arg)}`);
        if (!r[0]) return reply('❌ Meaning nahi mila.');
        const mean = r[0].meanings[0].definitions[0].definition;
        await reply(`📖 *${r[0].word}*\n\n✳️ ${mean}`);
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
    default:
      await reply('❓ Unknown main command');
  }
};

module.exports = {
  commands: ['menu', 'help', 'ping', 'alive', 'uptime', 'owner', 'id', 'getpp', 'githubstalk', 'define', 'yts', 'praytime', 'runtime', 'repo'],
  category: '🔎 MAIN',
  handler,
};
