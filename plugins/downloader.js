/**
 * DOWNLOADER — social media downloads (public APIs with fallbacks)
 */
const config = require('../config');
const { getJSON, getText } = require('../lib/helpers');

const isUrl = (s) => /^https?:\/\//i.test(s || '');

async function sendVideo(ctx, url, caption) {
  await ctx.send(ctx.from, { video: { url }, caption, mimetype: 'video/mp4' }, { quoted: ctx.m });
}
async function sendAudio(ctx, url, caption) {
  await ctx.send(ctx.from, { audio: { url }, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.m });
}

async function tiktok(ctx, url) {
  const r = await getJSON(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
  if (!r.data) throw new Error('Video nahi mili. Link check karo.');
  return r.data;
}

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;

  // ---- YouTube search (.play / .song / .music) ----
  if (['play', 'song', 'music', 'ytaudio', 'ytmp3', 'ytmp4', 'ytvideo'].includes(command)) {
    if (!arg) return reply(`❌ Song/query do. Example: ${config.PREFIX}${command} Tum Hi Ho`);
    try {
      const html = await getText(`https://www.youtube.com/results?search_query=${encodeURIComponent(arg)}`);
      const m = html.match(/"videoId":"(.{11})"/);
      if (!m) return reply('❌ Song nahi mila.');
      const id = m[1];
      const title = (html.match(/"title":\{"runs":\[\{"text":"([^"]{1,120})"/) || [])[1] || arg;
      if (['ytmp3', 'ytaudio'].includes(command)) {
        try {
          const api = await getJSON(`https://api.vevioz.com/api/button/mp3/${id}`);
          if (api?.url) return sendAudio(ctx, api.url, `🎵 ${title}`);
        } catch { /* fallback below */ }
      }
      await reply(`🎵 *${title}*\n\n▶️ https://youtu.be/${id}\n\n_(Direct download ke liye .ytmp3 ${id} try karo.)_`);
    } catch (e) { await reply('❌ ' + e.message); }
    return;
  }

  if (!isUrl(arg)) return reply(`❌ Link do. Example: ${config.PREFIX}${command} <link>`);

  switch (command) {
    case 'tiktok': case 'tt': case 'ttmp3': {
      try {
        const d = await tiktok(ctx, arg);
        if (command === 'ttmp3') await sendAudio(ctx, d.music, `🎵 TikTok Audio`);
        else await sendVideo(ctx, d.play, `⬇️ *TikTok*\n🎬 ${d.title || ''}\n👑 ${config.BOT_NAME}`);
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }
    case 'instagram': case 'ig': case 'igdl': case 'reels': {
      try {
        const r = await getJSON(`https://api.vevioz.com/api/button/ig?url=${encodeURIComponent(arg)}`).catch(() => null);
        if (r?.url) return sendVideo(ctx, r.url, `⬇️ *Instagram*\n👑 ${config.BOT_NAME}`);
        // fallback: cobalt
        const c = await getJSON('https://api.cobalt.tools/api/json', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ url: arg }) }).catch(() => null);
        if (c?.url) return sendVideo(ctx, c.url, `⬇️ *Instagram*\n👑 ${config.BOT_NAME}`);
        await reply('❌ Instagram download fail — link public ho ya baad me try karo.');
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }
    case 'facebook': case 'fb': {
      try {
        const c = await getJSON('https://api.cobalt.tools/api/json', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ url: arg }) }).catch(() => null);
        if (c?.url) return sendVideo(ctx, c.url, `⬇️ *Facebook*\n👑 ${config.BOT_NAME}`);
        await reply('❌ Facebook download fail.');
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }
    case 'twitter': case 'x': {
      try {
        const c = await getJSON('https://api.cobalt.tools/api/json', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ url: arg }) }).catch(() => null);
        if (c?.url) return sendVideo(ctx, c.url, `⬇️ *Twitter/X*\n👑 ${config.BOT_NAME}`);
        await reply('❌ Twitter download fail.');
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }
    case 'pinterest': case 'pin': {
      try {
        const r = await getJSON(`https://api.vevioz.com/api/button/pin?url=${encodeURIComponent(arg)}`).catch(() => null);
        if (r?.url) return ctx.send(ctx.from, { image: { url: r.url }, caption: `⬇️ *Pinterest*\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
        await reply('❌ Pinterest download fail.');
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }
    case 'apk': {
      if (!isUrl(arg)) return reply(`❌ APK download link do.`);
      await ctx.send(ctx.from, { document: { url: arg }, mimetype: 'application/vnd.android.package-archive', fileName: 'app.apk' }, { quoted: ctx.m });
      break;
    }
    default:
      await reply('❓ Unknown download command');
  }
};

module.exports = {
  commands: ['tiktok', 'tt', 'ttmp3', 'instagram', 'ig', 'igdl', 'reels', 'facebook', 'fb', 'twitter', 'x', 'pinterest', 'pin', 'play', 'song', 'music', 'ytaudio', 'ytmp3', 'ytmp4', 'ytvideo', 'apk'],
  category: '📥 DOWNLOAD',
  handler,
};
