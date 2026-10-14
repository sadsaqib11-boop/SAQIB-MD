/**
 * DOWNLOADER — powered by yt-dlp
 * YouTube, Instagram, Facebook, Twitter/X, TikTok, Pinterest, CapCut,
 * MediaFire, Google Drive, Git repos, npm, Quran audio (1000+ sites).
 * TikTok also has a fast direct-URL path via tikwm.
 */
const config = require('../config');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { getJSON, getText } = require('../lib/helpers');
const ytdlp = require('../lib/ytdlp');

const isUrl = (s) => /^https?:\/\//i.test(s || '');
const MAX_BYTES = 64 * 1024 * 1024; // WhatsApp media cap (~64 MB)
const tmp = (ext) => path.join(os.tmpdir(), `saqibdl_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 120000, maxBuffer: 1024 * 1024 * 50 }, (e, so, se) => (e ? rej(new Error((se || e.message).slice(0, 200))) : res())));

async function sendMedia(ctx, filePath, caption, asAudio) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BYTES) { try { fs.unlinkSync(filePath); } catch { /* ignore */ } throw new Error('File 64MB se bara hy — chhoti video try karo.'); }
  const buf = fs.readFileSync(filePath);
  try {
    if (asAudio) await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.m });
    else await ctx.send(ctx.from, { video: buf, caption, mimetype: 'video/mp4' }, { quoted: ctx.m });
  } finally { try { fs.unlinkSync(filePath); } catch { /* ignore */ } }
}

async function sendDoc(ctx, buf, fileName, mimetype) {
  if (buf.length > MAX_BYTES) throw new Error('File 64MB se bara hy.');
  await ctx.send(ctx.from, { document: buf, mimetype: mimetype || 'application/octet-stream', fileName }, { quoted: ctx.m });
}

/** Search YouTube and return the first video URL */
async function ytFirstUrl(query) {
  const html = await getText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  const m = html.match(/"videoId":"(.{11})"/);
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null;
}

/** Download the first YouTube result (audio or video) */
async function ytSearchDownload(ctx, query, asAudio) {
  if (!ytdlp.available()) return ctx.reply('\u274c Downloader engine (yt-dlp) available nahi hy.');
  const url = isUrl(query) ? query : await ytFirstUrl(query);
  if (!url) return ctx.reply('\u274c Kuch nahi mila.');
  const meta = await ytdlp.info(url).catch(() => ({ title: query }));
  await ctx.reply(`\u23ec *${meta.title || query}*\n_${asAudio ? '\ud83c\udfb5 Audio' : '\ud83c\udfac Video'} download ho raha hy\u2026_`);
  const file = asAudio ? await ytdlp.downloadAudio(url) : await ytdlp.downloadVideo(url);
  await sendMedia(ctx, file, `\ud83c\udfac *${meta.title || ''}*\n\ud83d\udc51 ${config.BOT_NAME}`, asAudio);
}

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;

  // ---- YouTube: play / song / music / ytaudio / ytmp3 / ytmp4 / ytvideo ----
  if (['play', 'song', 'music', 'ytaudio', 'ytmp3', 'ytmp4', 'ytvideo'].includes(command)) {
    if (!arg) return reply(`\u274c Song/query do. Example: ${config.PREFIX}${command} Tum Hi Ho`);
    const asAudio = ['play', 'song', 'music', 'ytaudio', 'ytmp3'].includes(command);
    try { await ytSearchDownload(ctx, arg, asAudio); }
    catch (e) { await reply('\u274c ' + (e.message || 'Download fail.')); }
    return;
  }

  // ---- search-based video downloads: video / drama / cartoon / movie ----
  if (['video', 'drama', 'cartoon', 'movie'].includes(command)) {
    if (!arg) return reply(`\u274c Naam do. Example: ${config.PREFIX}${command} funny cats`);
    try { await ytSearchDownload(ctx, arg, false); }
    catch (e) { await reply('\u274c ' + (e.message || 'Download fail.')); }
    return;
  }

  // ---- Quran surah audio (1-114) ----
  if (command === 'surah') {
    const n = parseInt((arg || '').replace(/[^0-9]/g, ''), 10);
    if (!n || n < 1 || n > 114) return reply(`\u274c Surah number do (1-114). Example: ${config.PREFIX}surah 1`);
    try {
      const url = `https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/${n}.mp3`;
      await ctx.send(ctx.from, { audio: { url }, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.m });
    } catch { await reply('\u274c Surah audio fail.'); }
    return;
  }

  // ---- npm package info ----
  if (command === 'dlnpm') {
    if (!arg) return reply(`\u274c Package naam do. Example: ${config.PREFIX}dlnpm express`);
    try {
      const r = await getJSON(`https://registry.npmjs.org/${encodeURIComponent(arg.trim())}`);
      if (r.error) return reply('\u274c Package nahi mila.');
      const latest = r['dist-tags']?.latest;
      const v = r.versions?.[latest] || {};
      await reply(`\ud83d\udce6 *${r.name}* @ ${latest}\n\n\ud83d\udcdd ${(r.description || '-').slice(0, 300)}\n\ud83d\udd17 Homepage: ${r.homepage || '-'}\n\ud83d\udc51 Author: ${(r.author && (r.author.name || r.author)) || '-'}\n\ud83d\udce5 Tarball: ${v.dist?.tarball || '-'}\n\n_Install: npm i ${r.name}_`);
    } catch { await reply('\u274c npm lookup fail.'); }
    return;
  }

  // ---- git repo -> zip ----
  if (command === 'gitclone') {
    const repo = (arg || '').replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return reply(`\u274c Format: ${config.PREFIX}gitclone user/repo`);
    try {
      let res = await fetch(`https://codeload.github.com/${repo}/zip/refs/heads/main`);
      if (!res.ok) res = await fetch(`https://codeload.github.com/${repo}/zip/refs/heads/master`);
      if (!res.ok) return reply('\u274c Repo nahi mila (public ho aur main/master branch ho).');
      const buf = Buffer.from(await res.arrayBuffer());
      await sendDoc(ctx, buf, `${repo.split('/')[1]}.zip`, 'application/zip');
    } catch (e) { await reply('\u274c ' + (e.message || 'Clone fail.')); }
    return;
  }

  // ---- Google Drive direct download ----
  if (command === 'gdrive') {
    if (!isUrl(arg)) return reply(`\u274c Drive link do. Example: ${config.PREFIX}gdrive https://drive.google.com/file/d/<id>/view`);
    const id = (arg.match(/[-\w]{25,}/) || [])[0];
    if (!id) return reply('\u274c File ID nahi mila.');
    try {
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await sendDoc(ctx, buf, `gdrive_${id}.bin`, 'application/octet-stream');
    } catch (e) { await reply('\u274c ' + (e.message || 'Drive download fail.')); }
    return;
  }

  // ---- TikTok search ----
  if (command === 'tiktoksearch') {
    if (!arg) return reply(`\u274c Query do. Example: ${config.PREFIX}tiktoksearch funny`);
    await reply(`\ud83d\udd0e *TikTok Search:* ${arg}\n\n\ud83d\udd17 https://www.tiktok.com/search?q=${encodeURIComponent(arg)}`);
    return;
  }

  // ---- TikTok -> sticker ----
  if (command === 'tsticker') {
    if (!isUrl(arg)) return reply(`\u274c TikTok link do. Example: ${config.PREFIX}tsticker https://vt.tiktok.com/...`);
    if (!ytdlp.available()) return reply('\u274c Downloader engine (yt-dlp) available nahi hy.');
    try {
      const file = await ytdlp.downloadVideo(arg);
      const out = tmp('webp');
      await run('ffmpeg', ['-y', '-i', file, '-t', '10', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2,fps=12', '-an', '-c:v', 'libwebp', '-quality', '80', out]);
      await ctx.sendSticker(fs.readFileSync(out), true);
      [file, out].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
    } catch (e) { await reply('\u274c ' + (e.message || 'Sticker fail.')); }
    return;
  }

  if (!isUrl(arg)) return reply(`\u274c Link do. Example: ${config.PREFIX}${command} <link>`);

  switch (command) {
    case 'tiktok': case 'tt': case 'ttmp3': case 'tiktok2': case 'tiktok3': {
      const asAudio = command === 'ttmp3';
      // Fast path: tikwm (direct URL, no download)
      try {
        const r = await getJSON(`https://tikwm.com/api/?url=${encodeURIComponent(arg)}`);
        if (r?.data?.play) {
          if (asAudio) return ctx.send(ctx.from, { audio: { url: r.data.music }, mimetype: 'audio/mpeg' }, { quoted: ctx.m });
          return ctx.send(ctx.from, { video: { url: r.data.play }, caption: `\u2b07\ufe0f *TikTok*\n\ud83c\udfac ${r.data.title || ''}\n\ud83d\udc51 ${config.BOT_NAME}` }, { quoted: ctx.m });
        }
      } catch { /* fall through to yt-dlp */ }
      try {
        const file = asAudio ? await ytdlp.downloadAudio(arg) : await ytdlp.downloadVideo(arg);
        await sendMedia(ctx, file, `\u2b07\ufe0f *TikTok*\n\ud83d\udc51 ${config.BOT_NAME}`, asAudio);
      } catch { await reply('\u274c TikTok download fail.'); }
      break;
    }
    case 'instagram': case 'ig': case 'igdl': case 'igdl2': case 'igdl3': case 'reels':
    case 'facebook': case 'fb':
    case 'twitter': case 'x':
    case 'pinterest': case 'pin':
    case 'capcut': case 'mediafire': case 'megadl': case 'ytpost': case 'download': {
      if (!ytdlp.available()) return reply('\u274c Downloader engine (yt-dlp) available nahi hy.');
      const label = {
        instagram: 'Instagram', ig: 'Instagram', igdl: 'Instagram', igdl2: 'Instagram', igdl3: 'Instagram', reels: 'Reels',
        facebook: 'Facebook', fb: 'Facebook', twitter: 'Twitter/X', x: 'Twitter/X',
        pinterest: 'Pinterest', pin: 'Pinterest', capcut: 'CapCut', mediafire: 'MediaFire',
        megadl: 'Mega', ytpost: 'YouTube Post', download: 'Download',
      }[command] || 'Media';
      try {
        const file = await ytdlp.downloadVideo(arg);
        await sendMedia(ctx, file, `\u2b07\ufe0f *${label}*\n\ud83d\udc51 ${config.BOT_NAME}`, false);
      } catch { await reply('\u274c Download fail \u2014 link public ho ya baad me try karo.'); }
      break;
    }
    case 'igmp3': {
      if (!ytdlp.available()) return reply('\u274c Downloader engine (yt-dlp) available nahi hy.');
      try {
        const file = await ytdlp.downloadAudio(arg);
        await sendMedia(ctx, file, `\ud83c\udfb5 *Instagram Audio*\n\ud83d\udc51 ${config.BOT_NAME}`, true);
      } catch { await reply('\u274c Audio download fail.'); }
      break;
    }
    case 'apk': {
      await ctx.send(ctx.from, { document: { url: arg }, mimetype: 'application/vnd.android.package-archive', fileName: 'app.apk' }, { quoted: ctx.m });
      break;
    }
    default:
      await reply('\u2753 Unknown download command');
  }
};

module.exports = {
  commands: [
    'tiktok', 'tt', 'ttmp3', 'tiktok2', 'tiktok3', 'instagram', 'ig', 'igdl', 'igdl2', 'igdl3', 'reels',
    'facebook', 'fb', 'twitter', 'x', 'pinterest', 'pin', 'play', 'song', 'music', 'ytaudio', 'ytmp3',
    'ytmp4', 'ytvideo', 'apk', 'gdrive', 'capcut', 'mediafire', 'megadl', 'igmp3', 'ytpost', 'download',
    'tsticker', 'tiktoksearch', 'surah', 'gitclone', 'video', 'drama', 'cartoon', 'movie', 'dlnpm',
  ],
  category: '\ud83d\udce5 DOWNLOAD',
  handler,
};
