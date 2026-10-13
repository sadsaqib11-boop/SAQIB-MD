/**
 * DOWNLOADER — powered by yt-dlp
 * YouTube, Instagram, Facebook, Twitter/X, TikTok, Pinterest (1000+ sites).
 * TikTok also has a fast direct-URL path via tikwm.
 */
const config = require('../config');
const fs = require('fs');
const { getJSON, getText } = require('../lib/helpers');
const ytdlp = require('../lib/ytdlp');

const isUrl = (s) => /^https?:\/\//i.test(s || '');
const MAX_BYTES = 64 * 1024 * 1024; // WhatsApp media cap (~64 MB)

async function sendMedia(ctx, filePath, caption, asAudio) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BYTES) { try { fs.unlinkSync(filePath); } catch { /* ignore */ } throw new Error('File 64MB se bara hy — chhoti video try karo.'); }
  const buf = fs.readFileSync(filePath);
  try {
    if (asAudio) await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.m });
    else await ctx.send(ctx.from, { video: buf, caption, mimetype: 'video/mp4' }, { quoted: ctx.m });
  } finally { try { fs.unlinkSync(filePath); } catch { /* ignore */ } }
}

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;

  // ---- YouTube: play / song / music / ytaudio / ytmp3 / ytmp4 / ytvideo ----
  if (['play', 'song', 'music', 'ytaudio', 'ytmp3', 'ytmp4', 'ytvideo'].includes(command)) {
    if (!arg) return reply(`❌ Song/query do. Example: ${config.PREFIX}${command} Tum Hi Ho`);
    if (!ytdlp.available()) return reply('❌ Downloader engine (yt-dlp) available nahi hy.');
    const asAudio = ['play', 'song', 'music', 'ytaudio', 'ytmp3'].includes(command);
    try {
      let url = arg;
      if (!isUrl(arg)) {
        const html = await getText(`https://www.youtube.com/results?search_query=${encodeURIComponent(arg)}`);
        const m = html.match(/"videoId":"(.{11})"/);
        if (!m) return reply('❌ Song nahi mila.');
        url = `https://www.youtube.com/watch?v=${m[1]}`;
      }
      const meta = await ytdlp.info(url).catch(() => ({ title: arg }));
      await reply(`⏬ *${meta.title || arg}*\n_${asAudio ? '🎵 Audio' : '🎬 Video'} download ho raha hy…_`);
      const file = asAudio ? await ytdlp.downloadAudio(url) : await ytdlp.downloadVideo(url);
      await sendMedia(ctx, file, `🎬 *${meta.title || ''}*\n👑 ${config.BOT_NAME}`, asAudio);
    } catch (e) { await reply('❌ ' + (e.message || 'Download fail.')); }
    return;
  }

  if (!isUrl(arg)) return reply(`❌ Link do. Example: ${config.PREFIX}${command} <link>`);

  switch (command) {
    case 'tiktok': case 'tt': case 'ttmp3': {
      // Fast path: tikwm (direct URL, no download)
      try {
        const r = await getJSON(`https://tikwm.com/api/?url=${encodeURIComponent(arg)}`);
        if (r?.data?.play) {
          if (command === 'ttmp3') return ctx.send(ctx.from, { audio: { url: r.data.music }, mimetype: 'audio/mpeg' }, { quoted: ctx.m });
          return ctx.send(ctx.from, { video: { url: r.data.play }, caption: `⬇️ *TikTok*\n🎬 ${r.data.title || ''}\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
        }
      } catch { /* fall through to yt-dlp */ }
      try {
        const file = command === 'ttmp3' ? await ytdlp.downloadAudio(arg) : await ytdlp.downloadVideo(arg);
        await sendMedia(ctx, file, `⬇️ *TikTok*\n👑 ${config.BOT_NAME}`, command === 'ttmp3');
      } catch { await reply('❌ TikTok download fail.'); }
      break;
    }
    case 'instagram': case 'ig': case 'igdl': case 'reels':
    case 'facebook': case 'fb':
    case 'twitter': case 'x':
    case 'pinterest': case 'pin': {
      if (!ytdlp.available()) return reply('❌ Downloader engine (yt-dlp) available nahi hy.');
      const label = {
        instagram: 'Instagram', ig: 'Instagram', igdl: 'Instagram', reels: 'Reels',
        facebook: 'Facebook', fb: 'Facebook', twitter: 'Twitter/X', x: 'Twitter/X',
        pinterest: 'Pinterest', pin: 'Pinterest',
      }[command] || 'Media';
      try {
        const file = await ytdlp.downloadVideo(arg);
        await sendMedia(ctx, file, `⬇️ *${label}*\n👑 ${config.BOT_NAME}`, false);
      } catch { await reply('❌ Download fail — link public ho ya baad me try karo.'); }
      break;
    }
    case 'apk': {
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
