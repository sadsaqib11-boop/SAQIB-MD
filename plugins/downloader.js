/**
 * DOWNLOADER — powered by yt-dlp
 * YouTube, Instagram, Facebook, Twitter/X, TikTok, Pinterest, CapCut,
 * MediaFire, Google Drive, Git repos, npm, Quran (audio + video) (1000+ sites).
 * TikTok also has a fast direct-URL path via tikwm.
 * `.tts` -> TikTok video search (Pakistani videos; up to 5).
 * `.apk <app>` -> searches Aptoide and sends the APK (large files supported).
 *
 * Fixes (P3):
 *  - `.ytvideo` / `.song` / `.play` / … now offer an Audio ⇄ Video choice.
 *  - `.apk` no longer refuses files > 95 MB (raises the cap, falls back to link).
 *  - `.surah` offers audio OR video (video via yt-dlp recitation search).
 *  - `.tts` returns up to 5 Pakistani videos.
 *  - `.movie` uses a dedicated "full movie" search.
 */
const config = require('../config');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { getJSON, getText, sleep } = require('../lib/helpers');
const interactions = require('../lib/interactions');
const ytdlp = require('../lib/ytdlp');

const isUrl = (s) => /^https?:\/\//i.test(s || '');
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;   // WhatsApp audio/video cap (~64 MB)
const MAX_DOC_BYTES = 2 * 1024 * 1024 * 1024; // WhatsApp document cap (~2 GB)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const tmp = (ext) => path.join(os.tmpdir(), `saqibdl_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 120000, maxBuffer: 1024 * 1024 * 50 }, (e, so, se) => (e ? rej(new Error((se || e.message).slice(0, 200))) : res())));

async function sendMedia(ctx, filePath, caption, asAudio) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_MEDIA_BYTES) { try { fs.unlinkSync(filePath); } catch { /* ignore */ } throw new Error('File 64MB se bara hy — chhoti video try karo.'); }
  const buf = fs.readFileSync(filePath);
  try {
    if (asAudio) await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.m });
    else await ctx.send(ctx.from, { video: buf, caption, mimetype: 'video/mp4' }, { quoted: ctx.m });
  } finally { try { fs.unlinkSync(filePath); } catch { /* ignore */ } }
}

async function sendDoc(ctx, buf, fileName, mimetype) {
  if (buf.length > MAX_DOC_BYTES) throw new Error('File 2GB se bara hy.');
  await ctx.send(ctx.from, { document: buf, mimetype: mimetype || 'application/octet-stream', fileName }, { quoted: ctx.m });
}

/** Download the first result (audio or video) with a SoundCloud fallback. */
async function ytSearchDownload(ctx, query, asAudio) {
  if (!ytdlp.available()) return ctx.reply('❌ Downloader engine (yt-dlp) available nahi hy.');
  const input = String(query).trim();
  // Only fetch metadata when we already have a URL (avoids a slow blocked YT search).
  const meta = isUrl(input) ? await ytdlp.info(input).catch(() => ({ title: '' })) : { title: query };
  await ctx.reply(`⬇️ *${meta.title || query}*\n_${asAudio ? '🎵 Audio' : '🎬 Video'} download ho raha hy…_`);
  if (asAudio) {
    const file = await ytdlp.downloadAudioSmart(input);
    await sendMedia(ctx, file, `🎵 *${meta.title || query}*\n👑 ${config.BOT_NAME}`, true);
  } else {
    const { file, audio } = await ytdlp.downloadVideoSmart(input);
    await sendMedia(ctx, file, `🎬 *${meta.title || query}*\n👑 ${config.BOT_NAME}`, audio);
  }
}

/**
 * Ask the user whether they want audio or video, then download the chosen one.
 * Uses the interactive-reply system (they answer 1 / 2).
 */
async function askDownload(ctx, query) {
  interactions.set(ctx.from, ctx.sender, 'choice', {
    options: [
      { run: (c) => ytSearchDownload(c, query, true).catch((e) => c.reply('❌ ' + (e.message || 'Audio download fail.'))) },
      { run: (c) => ytSearchDownload(c, query, false).catch((e) => c.reply('❌ ' + (e.message || 'Video download fail.'))) },
    ],
  });
  return ctx.reply(`🎬 *${query}*\n\n1️⃣ 🎵 Audio (MP3)\n2️⃣ 🎬 Video (MP4)\n\n_Reply *1* ya *2* karo!_`);
}

/* --------------------------- TikTok search helpers --------------------------- */
/** Extract candidate TikTok video URLs from a search-results HTML page. */
function extractTiktokUrls(html) {
  const out = new Set();
  let m;
  const reV = /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.\-]+\/video\/\d{15,}/g;
  while ((m = reV.exec(html))) out.add(m[0].replace(/&amp;/g, '&'));
  const reU = /uddg=([^&"')]+)/g;
  while ((m = reU.exec(html))) {
    try {
      const d = decodeURIComponent(m[1]);
      if (/tiktok\.com\/@[^/]+\/video\/\d{15,}/.test(d)) out.add(d.split('?')[0]);
    } catch { /* ignore */ }
  }
  const reS = /https?:\/\/(?:vt|vm)\.tiktok\.com\/[\w-]+/g;
  while ((m = reS.exec(html))) out.add(m[0]);
  return [...out].filter((u) => /\/video\/\d{15,}/.test(u) || /(?:vt|vm)\.tiktok\.com/.test(u));
}

/**
 * Search TikTok videos for a query. Tries several backends in order and
 * returns up to `limit` video URLs (first working backend wins).
 */
async function tiktokSearch(query, limit = 5) {
  const variants = [`${query} tiktok`, `tiktok ${query}`, `${query} site:tiktok.com`];
  const found = [];
  const collect = (html) => {
    for (const u of extractTiktokUrls(html)) { if (!found.includes(u)) found.push(u); if (found.length >= limit) break; }
  };

  // Backend 1: Bing Videos
  for (const v of variants) {
    if (found.length >= limit) break;
    try {
      const html = await getText(`https://www.bing.com/videos/search?q=${encodeURIComponent(v)}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'SRCHHPGUSR=SRCHLANG=en' } }, 20000);
      collect(html);
    } catch { /* next */ }
    await sleep(400);
  }

  // Backend 2: DuckDuckGo (direct then Jina reader proxy)
  for (const v of variants) {
    if (found.length >= limit) break;
    for (const url of [
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(v)}`,
      `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encodeURIComponent(v)}`,
    ]) {
      if (found.length >= limit) break;
      try {
        const html = await getText(url, { headers: { 'User-Agent': UA, 'Accept': 'text/plain' } }, 20000);
        collect(html);
      } catch { /* next */ }
    }
  }
  return found.slice(0, limit);
}

/** Resolve a TikTok URL to a playable mp4 (tikwm fast path). */
async function tiktokResolve(url) {
  try {
    const r = await getJSON(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`, {}, 15000);
    if (r?.data?.play) return { video: r.data.play, title: r.data.title || '', music: r.data.music || '' };
  } catch { /* ignore */ }
  return null;
}

/** Send up to `limit` TikTok videos for a query (used by `.tts`). */
async function sendTiktokVideos(ctx, query, limit = 5) {
  if (!ytdlp.available()) return ctx.reply('❌ Downloader engine (yt-dlp) available nahi hy.');
  await ctx.reply(`🔎 *TikTok Search:* ${query}\n_${limit} videos dhoond raha hoon…_`);
  let urls = [];
  try { urls = await tiktokSearch(query, limit); } catch { /* ignore */ }
  if (!urls.length) {
    try { await ytSearchDownload(ctx, query, false); }
    catch { await ctx.reply('❌ Kuch nahi mila — doosra keyword try karo.'); }
    return;
  }
  let sent = 0;
  for (const u of urls) {
    try {
      const fast = await tiktokResolve(u);
      if (fast?.video) {
        await ctx.send(ctx.from, { video: { url: fast.video }, caption: `🎬 *TikTok* (${sent + 1}/${urls.length})\n📝 ${(fast.title || '').slice(0, 120)}\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
      } else {
        const file = await ytdlp.downloadVideo(u);
        await sendMedia(ctx, file, `🎬 *TikTok* (${sent + 1}/${urls.length})\n👑 ${config.BOT_NAME}`, false);
      }
      sent += 1;
    } catch { /* try next */ }
    await sleep(800);
    if (sent >= limit) break;
  }
  if (!sent) await ctx.reply('❌ Videos download nahi ho sake — doosra keyword try karo.');
}

/* ------------------------------- Quran surahs ------------------------------- */
const SURAH_NAMES = [
  'Al-Fatihah', 'Al-Baqarah', 'Aal-Imran', 'An-Nisa', 'Al-Maidah', 'Al-Anam', 'Al-Araf', 'Al-Anfal', 'At-Tawbah', 'Yunus',
  'Hud', 'Yusuf', 'Ar-Rad', 'Ibrahim', 'Al-Hijr', 'An-Nahl', 'Al-Isra', 'Al-Kahf', 'Maryam', 'Ta-Ha',
  'Al-Anbiya', 'Al-Hajj', 'Al-Muminun', 'An-Nur', 'Al-Furqan', 'Ash-Shuara', 'An-Naml', 'Al-Qasas', 'Al-Ankabut', 'Ar-Rum',
  'Luqman', 'As-Sajdah', 'Al-Ahzab', 'Saba', 'Fatir', 'Ya-Sin', 'As-Saffat', 'Sad', 'Az-Zumar', 'Ghafir',
  'Fussilat', 'Ash-Shura', 'Az-Zukhruf', 'Ad-Dukhan', 'Al-Jathiyah', 'Al-Ahqaf', 'Muhammad', 'Al-Fath', 'Al-Hujurat', 'Qaf',
  'Adh-Dhariyat', 'At-Tur', 'An-Najm', 'Al-Qamar', 'Ar-Rahman', 'Al-Waqiah', 'Al-Hadid', 'Al-Mujadila', 'Al-Hashr', 'Al-Mumtahanah',
  'As-Saff', 'Al-Jumuah', 'Al-Munafiqun', 'At-Taghabun', 'At-Talaq', 'At-Tahrim', 'Al-Mulk', 'Al-Qalam', 'Al-Haqqah', 'Al-Maarij',
  'Nuh', 'Al-Jinn', 'Al-Muzzammil', 'Al-Muddaththir', 'Al-Qiyamah', 'Al-Insan', 'Al-Mursalat', 'An-Naba', 'An-Naziat', 'Abasa',
  'At-Takwir', 'Al-Infitar', 'Al-Mutaffifin', 'Al-Inshiqaq', 'Al-Buruj', 'At-Tariq', 'Al-Ala', 'Al-Ghashiyah', 'Al-Fajr', 'Al-Balad',
  'Ash-Shams', 'Al-Layl', 'Ad-Duha', 'Ash-Sharh', 'At-Tin', 'Al-Alaq', 'Al-Qadr', 'Al-Bayyinah', 'Az-Zalzalah', 'Al-Adiyat',
  'Al-Qariah', 'At-Takathur', 'Al-Asr', 'Al-Humazah', 'Al-Fil', 'Quraysh', 'Al-Maun', 'Al-Kawthar', 'Al-Kafirun', 'An-Nasr',
  'Al-Masad', 'Al-Ikhlas', 'Al-Falaq', 'An-Nas',
];

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;

  // ---- YouTube: play / song / music / ytaudio / ytmp3 / ytmp4 / ytvideo ----
  // These now offer an Audio ⇄ Video choice before downloading.
  if (['play', 'song', 'music', 'ytaudio', 'ytmp3', 'ytmp4', 'ytvideo'].includes(command)) {
    if (!arg) return reply(`❌ Song/query do. Example: ${config.PREFIX}${command} Tum Hi Ho`);
    try { await askDownload(ctx, arg); }
    catch (e) { await reply('❌ ' + (e.message || 'Download fail.')); }
    return;
  }

  // ---- search-based video downloads: video / drama / cartoon ----
  if (['video', 'drama', 'cartoon'].includes(command)) {
    if (!arg) return reply(`❌ Naam do. Example: ${config.PREFIX}${command} funny cats`);
    try { await ytSearchDownload(ctx, arg, false); }
    catch (e) { await reply('❌ ' + (e.message || 'Download fail.')); }
    return;
  }

  // ---- movie: dedicated "full movie" search ----
  if (command === 'movie') {
    if (!arg) return reply(`❌ Movie naam do. Example: ${config.PREFIX}movie Interstellar`);
    try { await ytSearchDownload(ctx, `${arg} full movie`, false); }
    catch (e) { await reply('❌ ' + (e.message || 'Download fail.')); }
    return;
  }

  // ---- TikTok search: .tts / .ttsearch / .tiktoksearch (up to 5 Pakistani videos) ----
  if (['tts', 'ttsearch', 'tiktoksearch'].includes(command)) {
    const q = arg ? `${arg} pakistani` : 'pakistani trending';
    await sendTiktokVideos(ctx, q, 5);
    return;
  }

  // ---- Quran surah: audio OR video ----
  if (command === 'surah') {
    const n = parseInt((arg || '').replace(/[^0-9]/g, ''), 10);
    if (!n || n < 1 || n > 114) return reply(`❌ Surah number do (1-114). Example: ${config.PREFIX}surah 1`);
    const name = SURAH_NAMES[n - 1] || `Surah ${n}`;
    interactions.set(ctx.from, ctx.sender, 'choice', {
      options: [
        { run: async (c) => {
          try { await c.send(c.from, { audio: { url: `https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/${n}.mp3` }, mimetype: 'audio/mpeg', ptt: false }, { quoted: c.m }); }
          catch { await c.reply('❌ Surah audio fail.'); }
        } },
        { run: async (c) => {
          try { await ytSearchDownload(c, `Surah ${name} Quran recitation Alafasy`, false); }
          catch (e) { await c.reply('❌ ' + (e.message || 'Surah video fail.')); }
        } },
      ],
    });
    return reply(`📖 *Surah ${n} — ${name}*\n\n1️⃣ 🎵 Audio (MP3)\n2️⃣ 🎬 Video (MP4)\n\n_Reply *1* ya *2* karo!_`);
  }

  // ---- npm package info ----
  if (command === 'dlnpm') {
    if (!arg) return reply(`❌ Package naam do. Example: ${config.PREFIX}dlnpm express`);
    try {
      const r = await getJSON(`https://registry.npmjs.org/${encodeURIComponent(arg.trim())}`);
      if (r.error) return reply('❌ Package nahi mila.');
      const latest = r['dist-tags']?.latest;
      const v = r.versions?.[latest] || {};
      await reply(`📦 *${r.name}* @ ${latest}\n\n📝 ${(r.description || '-').slice(0, 300)}\n🔗 Homepage: ${r.homepage || '-'}\n👑 Author: ${(r.author && (r.author.name || r.author)) || '-'}\n📥 Tarball: ${v.dist?.tarball || '-'}\n\n_Install: npm i ${r.name}_`);
    } catch { await reply('❌ npm lookup fail.'); }
    return;
  }

  // ---- git repo -> zip ----
  if (command === 'gitclone') {
    const repo = (arg || '').replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return reply(`❌ Format: ${config.PREFIX}gitclone user/repo`);
    try {
      let res = await fetch(`https://codeload.github.com/${repo}/zip/refs/heads/main`);
      if (!res.ok) res = await fetch(`https://codeload.github.com/${repo}/zip/refs/heads/master`);
      if (!res.ok) return reply('❌ Repo nahi mila (public ho aur main/master branch ho).');
      const buf = Buffer.from(await res.arrayBuffer());
      await sendDoc(ctx, buf, `${repo.split('/')[1]}.zip`, 'application/zip');
    } catch (e) { await reply('❌ ' + (e.message || 'Clone fail.')); }
    return;
  }

  // ---- Google Drive direct download ----
  if (command === 'gdrive') {
    if (!isUrl(arg)) return reply(`❌ Drive link do. Example: ${config.PREFIX}gdrive https://drive.google.com/file/d/<id>/view`);
    const id = (arg.match(/[-\w]{25,}/) || [])[0];
    if (!id) return reply('❌ File ID nahi mila.');
    try {
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await sendDoc(ctx, buf, `gdrive_${id}.bin`, 'application/octet-stream');
    } catch (e) { await reply('❌ ' + (e.message || 'Drive download fail.')); }
    return;
  }

  // ---- APK download: .apk <app name>  (or a direct URL) ----
  if (command === 'apk') {
    if (!arg) return reply(`❌ App naam do. Example: ${config.PREFIX}apk whatsapp`);
    if (isUrl(arg)) {
      await ctx.send(ctx.from, { document: { url: arg }, mimetype: 'application/vnd.android.package-archive', fileName: 'app.apk' }, { quoted: ctx.m });
      return;
    }
    try {
      const r = await getJSON(`https://ws75.aptoide.com/api/7/apps/search?query=${encodeURIComponent(arg.trim())}&limit=1`, {}, 20000);
      const app = r?.datalist?.list?.[0];
      if (!app) return reply('❌ App nahi mila — naam check karo.');
      const dl = app.file?.path;
      const size = Number(app.size || app.file?.filesize || 0);
      if (!dl) return reply('❌ APK link nahi mila.');
      const ver = app.file?.vername || app.file?.vercode || '';
      const mb = size ? (size / 1048576).toFixed(1) : '?';
      // Large files are now allowed (WhatsApp document cap ~2 GB). If the upload
      // fails for any reason we fall back to sending the direct link.
      try {
        await ctx.send(ctx.from, {
          document: { url: dl },
          mimetype: 'application/vnd.android.package-archive',
          fileName: `${String(app.name || 'app').replace(/[^\w.-]+/g, '_')}.apk`,
          caption: `📦 *${app.name}* ${ver}\n📏 ${mb} MB\n👑 ${config.BOT_NAME}`,
        }, { quoted: ctx.m });
      } catch {
        await reply(`📦 *${app.name}* ${ver}\n📏 ${mb} MB\n\n⚠️ Direct send fail — link se download karo:\n${dl}`);
      }
    } catch { await reply('❌ APK search fail — thodi der baad try karo.'); }
    return;
  }

  // ---- TikTok -> sticker ----
  if (command === 'tsticker') {
    if (!isUrl(arg)) return reply(`❌ TikTok link do. Example: ${config.PREFIX}tsticker https://vt.tiktok.com/...`);
    if (!ytdlp.available()) return reply('❌ Downloader engine (yt-dlp) available nahi hy.');
    try {
      const file = await ytdlp.downloadVideo(arg);
      const out = tmp('webp');
      await run('ffmpeg', ['-y', '-i', file, '-t', '10', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2,fps=12', '-an', '-c:v', 'libwebp', '-quality', '80', out]);
      await ctx.sendSticker(fs.readFileSync(out), true);
      [file, out].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
    } catch (e) { await reply('❌ ' + (e.message || 'Sticker fail.')); }
    return;
  }

  if (!isUrl(arg)) return reply(`❌ Link do. Example: ${config.PREFIX}${command} <link>`);

  switch (command) {
    case 'tiktok': case 'tt': case 'ttmp3': case 'tiktok2': case 'tiktok3': {
      const asAudio = command === 'ttmp3';
      // Fast path: tikwm (direct URL, no download)
      try {
        const r = await getJSON(`https://tikwm.com/api/?url=${encodeURIComponent(arg)}`);
        if (r?.data?.play) {
          if (asAudio) return ctx.send(ctx.from, { audio: { url: r.data.music }, mimetype: 'audio/mpeg' }, { quoted: ctx.m });
          return ctx.send(ctx.from, { video: { url: r.data.play }, caption: `⬇️ *TikTok*\n🎬 ${r.data.title || ''}\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
        }
      } catch { /* fall through to yt-dlp */ }
      try {
        const file = asAudio ? await ytdlp.downloadAudio(arg) : await ytdlp.downloadVideo(arg);
        await sendMedia(ctx, file, `⬇️ *TikTok*\n👑 ${config.BOT_NAME}`, asAudio);
      } catch { await reply('❌ TikTok download fail.'); }
      break;
    }
    case 'instagram': case 'ig': case 'igdl': case 'igdl2': case 'igdl3': case 'reels':
    case 'facebook': case 'fb':
    case 'twitter': case 'x':
    case 'pinterest': case 'pin':
    case 'capcut': case 'mediafire': case 'megadl': case 'ytpost': case 'download': {
      if (!ytdlp.available()) return reply('❌ Downloader engine (yt-dlp) available nahi hy.');
      const label = {
        instagram: 'Instagram', ig: 'Instagram', igdl: 'Instagram', igdl2: 'Instagram', igdl3: 'Instagram', reels: 'Reels',
        facebook: 'Facebook', fb: 'Facebook', twitter: 'Twitter/X', x: 'Twitter/X',
        pinterest: 'Pinterest', pin: 'Pinterest', capcut: 'CapCut', mediafire: 'MediaFire',
        megadl: 'Mega', ytpost: 'YouTube Post', download: 'Download',
      }[command] || 'Media';
      try {
        const file = await ytdlp.downloadVideo(arg);
        await sendMedia(ctx, file, `⬇️ *${label}*\n👑 ${config.BOT_NAME}`, false);
      } catch { await reply('❌ Download fail — link public ho ya baad me try karo.'); }
      break;
    }
    case 'igmp3': {
      if (!ytdlp.available()) return reply('❌ Downloader engine (yt-dlp) available nahi hy.');
      try {
        const file = await ytdlp.downloadAudio(arg);
        await sendMedia(ctx, file, `🎵 *Instagram Audio*\n👑 ${config.BOT_NAME}`, true);
      } catch { await reply('❌ Audio download fail.'); }
      break;
    }
    default:
      await reply('❓ Unknown download command');
  }
};

module.exports = {
  commands: [
    'tiktok', 'tt', 'ttmp3', 'tiktok2', 'tiktok3', 'instagram', 'ig', 'igdl', 'igdl2', 'igdl3', 'reels',
    'facebook', 'fb', 'twitter', 'x', 'pinterest', 'pin', 'play', 'song', 'music', 'ytaudio', 'ytmp3',
    'ytmp4', 'ytvideo', 'apk', 'gdrive', 'capcut', 'mediafire', 'megadl', 'igmp3', 'ytpost', 'download',
    'tsticker', 'tts', 'ttsearch', 'tiktoksearch', 'surah', 'gitclone', 'video', 'drama', 'cartoon', 'movie', 'dlnpm',
  ],
  category: '📥 DOWNLOAD',
  handler,
};
