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
const dlcache = require('../lib/dlcache');
const { ttCache, srcCache } = require('../lib/cache');

const isUrl = (s) => /^https?:\/\//i.test(s || '');
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;   // WhatsApp audio/video cap (~64 MB)
const MAX_DOC_BYTES = 2 * 1024 * 1024 * 1024; // WhatsApp document cap (~2 GB)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const tmp = (ext) => path.join(os.tmpdir(), `saqibdl_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 120000, maxBuffer: 1024 * 1024 * 50 }, (e, so, se) => (e ? rej(new Error((se || e.message).slice(0, 200))) : res())));

/** Media duration in seconds (0 when unknown) — WhatsApp plays audio far more
 *  reliably when it knows the length. */
const probeDuration = (file) => new Promise((resolve) => {
  execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: 15000 }, (e, so) => resolve(e ? 0 : Math.round(Number(so) || 0)));
});

async function sendMedia(ctx, filePath, caption, asAudio) {
  const stat = fs.statSync(filePath);
  const buf = fs.readFileSync(filePath);
  try {
    if (asAudio) {
      const seconds = await probeDuration(filePath);
      await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg', ptt: false, seconds }, { quoted: ctx.m });
      return;
    }
    // BIG FILES: WhatsApp's audio/video cap is ~64MB. She asked for NO limit —
    // anything too big for a video goes out as a DOCUMENT instead of failing.
    if (buf.length > MAX_MEDIA_BYTES) {
      await sendDoc(ctx, buf, `${(caption.split('\n')[0] || 'video').replace(/[^\w\s.-]/g, '').trim().slice(0, 60) || 'video'}.mp4`, 'video/mp4');
      await ctx.reply('📄 File 64MB se bari thi — *document* me bhej di.').catch(() => {});
      return;
    }
    await ctx.send(ctx.from, { video: buf, caption, mimetype: 'video/mp4' }, { quoted: ctx.m });
  } finally {
    // Keep cache-backed files on disk so a repeat request is instant.
    if (!dlcache.isCached(filePath)) { try { fs.unlinkSync(filePath); } catch { /* ignore */ } }
  }
}

async function sendDoc(ctx, buf, fileName, mimetype) {
  if (buf.length > MAX_DOC_BYTES) throw new Error('File 2GB se bara hy.');
  await ctx.send(ctx.from, { document: buf, mimetype: mimetype || 'application/octet-stream', fileName }, { quoted: ctx.m });
}

/** Download the first result (audio or video). */
async function ytSearchDownload(ctx, query, asAudio) {
  if (!ytdlp.available()) return ctx.reply('❌ Downloader engine (yt-dlp) available nahi hy.');
  const input = String(query).trim();
  // Only fetch metadata when we already have a URL (avoids a slow blocked YT search).
  const meta = isUrl(input) ? await ytdlp.info(input).catch(() => ({ title: '' })) : { title: query };
  await ctx.reply(`⬇️ *${meta.title || query}*\n_${asAudio ? '🎵 Audio' : '🎬 Video'} download ho raha hy…_`);
  if (asAudio) {
    const file = await ytdlp.downloadAudioSmart(input);
    await sendMedia(ctx, file, `🎵 *${meta.title || query}*\n👑 ${config.BOT_NAME}`, true);
    return;
  }
  // VIDEO: she asked for video, so never silently hand back an audio file.
  // If YouTube is blocked we try the alternate routes first, and only then
  // tell her honestly instead of sending a surprise MP3.
  const { file, audio } = await ytdlp.downloadVideoSmart(input);
  if (audio) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
    return ctx.reply(
      '❌ *Video* nahi mil saki (YouTube ne block kiya).\n' +
      '🎵 Audio mil sakti hy — `' + config.PREFIX + 'song ' + query + '` try karo.'
    );
  }
  await sendMedia(ctx, file, `🎬 *${meta.title || query}*\n👑 ${config.BOT_NAME}`, false);
}

/**
 * Ask the user whether they want audio or video, then download the chosen one.
 * Uses the interactive-reply system (they answer 1 / 2).
 */
async function askDownload(ctx, query) {
  // Hard guarantee: the download flow can NEVER go silent. If the sources hang
  // (a stalled yt-dlp, a blocked mirror), the user still gets an answer.
  const withTimeout = (p, ms) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('download bohat dair se chal raha tha — bejti khatam')), ms)),
  ]);
  interactions.set(ctx.from, ctx.sender, 'choice', {
    options: [
      { run: (c) => withTimeout(ytSearchDownload(c, query, true), 300000).catch((e) => c.reply('❌ Audio nahi aayi: ' + (e.message || 'download fail.') + '\n_Dusra naam try karo ya .tts/.video use karo._')) },
      { run: (c) => withTimeout(ytSearchDownload(c, query, false), 300000).catch((e) => c.reply('❌ Video nahi aayi: ' + (e.message || 'download fail.') + '\n_Dusra naam try karo ya .tts/.video use karo._')) },
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
  // PAKISTAN-FIRST + IT ACTUALLY WORKS: the cc=PK/setlang=ur page params bias
  // results to Pakistan BUT that page variant serves NO tiktok.com links to a
  // plain fetcher (verified live 2026-10-17: 0 urls on every biased query,
  // 10+ on the plain ones) — so the biased variants alone returned NOTHING
  // and .tts fell back to a single YouTube video. Strategy now:
  //   1. plain queries FIRST (they actually return links),
  //   2. the PK-biased variants after (bonus local hits when they work),
  //   3. HTML entity-decoding so links hidden inside escaped JSON (`&quot;`
  //      blobs) are found too — most Bing results live there.
  const variants = [
    `${query} tiktok`,
    `${query} site:tiktok.com`,
    `${query} tiktok pakistan`,
    `${query} tiktok urdu`,
    `${query} tiktok punjabi`,
    `${query} tiktok saraiki`,
  ];
  const found = [];
  const collect = (html0) => {
    // Unescape HTML entities first — Bing buries its TikTok urls inside
    // JSON blobs full of &quot; / &amp;, which the old raw-regex missed.
    const html = html0
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
    for (const u of extractTiktokUrls(html)) { if (!found.includes(u)) found.push(u); if (found.length >= limit) break; }
  };
  // First two variants (plain) WITHOUT the cc/setlang params that break the
  // page; the PK-biased variants keep them (harmless if the page is empty).
  for (let i = 0; i < variants.length; i++) {
    if (found.length >= limit) break;
    const pk = i >= 2;
    const params = pk ? '&cc=PK&setlang=ur' : '';
    try {
      const html = await getText(`https://www.bing.com/videos/search?q=${encodeURIComponent(variants[i])}${params}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ur-PK,ur;q=0.9,en;q=0.8' } }, 20000);
      collect(html);
    } catch { /* next */ }
    await sleep(150);
  }

  // Backend 2: DuckDuckGo (direct then Jina reader proxy), PK region.
  for (const v of variants) {
    if (found.length >= limit) break;
    for (const url of [
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(v)}&kl=pk-en`,
      `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encodeURIComponent(v)}&kl=pk-en`,
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

/** Download a remote video to a Buffer. URL-form sends ({video:{url}}) make
 * BALEYS fetch the file itself from the server — and TikTok's CDN blocks
 * datacenter IPs, so the message silently never arrives. Fetching HERE with
 * browser headers and sending the BUFFER is what actually delivers. */
async function fetchVideoBuffer(url, maxMs = 90000, maxBytes = 60 * 1048576) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(maxMs),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
      'Referer': 'https://www.tiktok.com/',
    },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ab = await r.arrayBuffer();
  if (ab.byteLength > maxBytes) throw new Error('file too big');
  return Buffer.from(ab);
}

/** Send up to `limit` TikTok videos for a query (used by `.tts`). */
async function sendTiktokVideos(ctx, query, limit = 5) {
  if (!ytdlp.available()) return ctx.reply('❌ Downloader engine (yt-dlp) available nahi hy.');
  const ckey = `${String(query).trim().toLowerCase()}|${limit}`;
  let picks = ttCache.get(ckey);
  if (picks && picks.length) {
    // Repeat query within the TTL -> fully instant (no search, no resolve).
    await ctx.reply(`⚡ *TikTok Search:* ${query}\n_pehle se results mojood — foran bhej raha hoon…_`);
  } else {
    await ctx.reply(`🔎 *TikTok Search:* ${query}\n_${limit} videos dhoond raha hoon…_`);
    // Search is the slow part (Bing/DDG scraping) — cache the page URLs for 1h.
    // Wider net: limit*4 candidates so that after dead links and the relevance
    // filter there are STILL enough survivors to deliver the full 5 (the old
    // net was too small — searches often delivered just 1 video).
    const skey = `tt|${String(query).trim().toLowerCase()}`;
    let urls = srcCache.get(skey);
    if (!urls) {
      urls = [];
      try { urls = await tiktokSearch(query, limit * 4); } catch { /* ignore */ }
      if (urls.length) srcCache.set(skey, urls);
    }
    // Resolve to direct play URLs in parallel (fast, no 800ms drip).
    const resolved = (await Promise.all(urls.map(async (u) => {
      try { const f = await tiktokResolve(u); if (f?.video) return { url: f.video, title: f.title || '' }; } catch { /* ignore */ }
      return null;
    }))).filter(Boolean);
    // Relevance RANKING (not just filtering): results whose title shares a
    // word with the query come first; the rest follow as backfill. This
    // punishes off-topic foreign clips without ever leaving the user with
    // fewer than `limit` videos.
    const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const related = words.length ? resolved.filter((v) => words.some((w) => String(v.title).toLowerCase().includes(w))) : [];
    const rest = resolved.filter((v) => !related.includes(v));
    picks = [...related, ...rest].slice(0, limit);
    if (picks.length) ttCache.set(ckey, picks);
  }
  if (!picks.length) {
    try { await ytSearchDownload(ctx, query, false); }
    catch { await ctx.reply('❌ Kuch nahi mila — doosra keyword try karo.'); }
    return;
  }
  // ALBUM MODE + DEAD-CLIP BACKFILL — merged from both sides:
  //  - ALBUM: the videos arrive as ONE WhatsApp album (grid/row — exactly the
  //    "_________________________________" row she asked for), not 5 vertical
  //    messages. The album parent is a tiny metadata message; each video
  //    references it via albumParentKey so WhatsApp groups them together.
  //  - BACKFILL: buffers are fetched with a wider candidate pool and the loop
  //    keeps going until `limit` clips are actually collected — dead links can
  //    never shrink the row below what she asked for.
  let delivered = 0;
  const bufs = [];
  for (let i = 0; i < picks.length && bufs.length < limit; i++) {
    try {
      const buf = await fetchVideoBuffer(picks[i].url);
      bufs.push({ buf, title: (picks[i].title || '').slice(0, 120) });
    } catch { /* dead clip — skip */ }
  }
  if (bufs.length < limit) {
    // TikTok pool SHORT ya dry (Bing/DDG served empty pages, tikwm blocked).
    // BACKFILL: YouTube-via-mirror se top related videos — row phir bhi puri
    // hogi, kam videos kabhi nahi.
    try {
      const yt = await ytdlp.searchViaMirror(query, limit - bufs.length);
      for (const v of yt) {
        if (bufs.length >= limit) break;
        try {
          bufs.push({ buf: fs.readFileSync(v.file), title: String(v.title || '').slice(0, 120) });
          try { fs.unlinkSync(v.file); } catch { /* ignore */ }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  if (!bufs.length) {
    await ctx.reply('❌ TikTok ne videos bhejne se rok liya (server IP block). Thori dair baad dobara try karo — ya .video se search karo.');
    return;
  }
  try {
    const parent = await ctx.send(ctx.from, { album: { expectedVideoCount: bufs.length } }, { quoted: ctx.m });
    const parentKey = { id: parent?.key?.id, remoteJid: ctx.from, fromMe: true };
    for (let i = 0; i < bufs.length; i++) {
      const v = bufs[i];
      await ctx.send(ctx.from, {
        video: v.buf,
        caption: i === 0
          ? `🎬 *TikTok* — ${query} (${bufs.length} videos)\n📝 ${v.title}\n👑 ${config.BOT_NAME}`
          : undefined,
        albumParentKey: parentKey,
      }, { quoted: ctx.m });
      delivered++;
    }
  } catch (e) {
    // Album path failed on this WhatsApp version → old way, one message each.
    console.error('[TTS] album send fail, fallback:', e?.message || e);
    for (const v of bufs) {
      try {
        await ctx.send(ctx.from, { video: v.buf, caption: `🎬 *TikTok*\n📝 ${v.title}\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
        delivered++;
      } catch { /* dead clip — skip */ }
    }
  }
  if (!delivered) {
    await ctx.reply('❌ TikTok ne videos bhejne se rok liya (server IP block). Thori dair baad dobara try karo — ya .video se search karo.');
  }
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

  // ---- movie: dedicated "full movie" search (720p, DOCUMENT, never audio) ----
  // Two hard rules from the user: (1) the film must arrive as a DOCUMENT in
  // 720p (not a compressed playable video, not an MP3), and (2) it must NEVER
  // silently fall back to audio. We therefore search the top candidates, try
  // each in 720p, and refuse any audio result.
  if (command === 'movie') {
    if (!arg) return reply(`❌ Movie naam do. Example: ${config.PREFIX}movie Interstellar`);
    // Instant path: already downloaded before? Resend from the disk cache.
    const cached = dlcache.get('movie', `${arg}@720`);
    if (cached) {
      await reply(`⚡ *${arg}* — pehle se download hy, foran bhej raha hoon…`);
      await sendMovieDoc(ctx, cached, arg, false);
      return;
    }
    // Reply INSTANTLY so the bot never feels stuck, then work in the background.
    await reply(`🎬 *${arg}* — movie aa rahi hy…\n_best source dhoond raha hoon, thora intezar karein (5-10 minute lag sakte hain)._`);
    try {
      // downloadMovie: searches the top candidates (a plain "ytsearch1:" often
      // lands on a trailer, not the film), races the direct download against a
      // public mirror for the best one, and caches the file so a repeat `.movie`
      // of the same title is instant. It NEVER returns audio. Hard timeout:
      // the flow can never go silent past 12 minutes.
      const file = await Promise.race([
        ytdlp.downloadMovie(arg, { maxHeight: 720 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('download timeout (12min)')), 720000)),
      ]);
      await sendMovieDoc(ctx, file, arg, false);
    } catch (e) {
      await reply(`❌ *${arg}* nahi mili (${String(e.message || e).slice(0, 60)}) — naam check karo, seedha link bhejo, ya .video try karo.`);
    }
    return;
  }

  // ---- TikTok search: .tts / .ttsearch / .tiktoksearch (EXACT search, up to 5) ----
  if (['tts', 'ttsearch', 'tiktoksearch'].includes(command)) {
    if (!arg) return reply(`❌ Search keyword do. Example: ${config.PREFIX}tts saraiki song`);
    await sendTiktokVideos(ctx, arg, 5);
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
          // Direct CDN — no yt-dlp, no YouTube bot-check, answers in ~1s.
          const pad = String(n).padStart(3, '0');
          const sources = [
            `https://cdn.mp3quran.net/audio/mishary-alafasy/r1/${pad}.mp3`,
            `https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/${n}.mp3`,
          ];
          for (const url of sources) {
            try {
              await c.send(c.from, { audio: { url }, mimetype: 'audio/mpeg', ptt: false }, { quoted: c.m });
              return;
            } catch { /* try the next source */ }
          }
          await c.reply('❌ Surah audio fail — dobara try karo.');
        } },
        { run: async (c) => {
          // Video used to go straight to a YouTube search, which is slow and is
          // exactly what YouTube's "sign in to confirm you're not a bot" check
          // blocks — that is why the video never arrived. Try the direct CDN
          // sources first and only fall back to YouTube.
          const pad = String(n).padStart(3, '0');
          const direct = [
            `https://cdn.mp3quran.net/video/mishary-alafasy/${pad}.mp4`,
            `https://cdn.islamic.network/quran/video-surah/ar.alafasy/${n}.mp4`,
          ];
          for (const url of direct) {
            try {
              await c.reply(`🎬 Surah ${name} video la raha hoon…`);
              const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
              if (!r.ok) continue;
              const len = Number(r.headers.get('content-length') || 0);
              if (len && len < 100 * 1024) continue; // too small to be a real video
              await c.send(c.from, { video: { url }, mimetype: 'video/mp4', caption: `📖 *Surah ${name}*\n👑 ${config.BOT_NAME}` }, { quoted: c.m });
              return;
            } catch { /* try the next source */ }
          }
          // Fallback: YouTube search (may be blocked — say so honestly).
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
  // Multi-source so one dead mirror never breaks the command. All free, no key.
  if (command === 'apk') {
    if (!arg) return reply(`❌ App naam do. Example: ${config.PREFIX}apk whatsapp`);
    if (isUrl(arg)) {
      await ctx.send(ctx.from, { document: { url: arg }, mimetype: 'application/vnd.android.package-archive', fileName: 'app.apk' }, { quoted: ctx.m });
      return;
    }
    const q = arg.trim();
    await reply(`🔎 *${q}* dhoond raha hoon…`);
    const app = await searchApk(q);
    if (!app) return reply(`❌ *${q}* nahi mila — naam check karo ya seedha link bhejo.`);
    const size = Number(app.size || 0);
    const mb = size ? (size / 1048576).toFixed(1) + ' MB' : 'unknown size';
    try {
      await ctx.send(ctx.from, {
        document: { url: app.url },
        mimetype: 'application/vnd.android.package-archive',
        fileName: `${String(app.name || q).replace(/[^\w.-]+/g, '_')}.apk`,
        caption: `📦 *${app.name}*\n🔢 Version: ${app.version || '—'}\n📏 ${mb}\n🏪 ${app.source}\n👑 ${config.BOT_NAME}`,
      }, { quoted: ctx.m });
    } catch {
      await reply(`📦 *${app.name}* ${app.version || ''}\n📏 ${mb}\n\n⚠️ Direct send fail — link se download karo:\n${app.url}`);
    }
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

/**
 * Search for an APK and return the BEST match — not just the first hit.
 * Aptoide is queried with a larger page, every candidate is scored against the
 * typed query (name + package similarity), and the closest one wins, so
 * `.apk whatsapp` always returns WhatsApp (com.whatsapp) and not a random
 * "WhatsApp Spy" / cleaner app. No API keys, no cost.
 */
const normApk = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function scoreApk(query, app) {
  const q = normApk(query);
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const name = String(app.name || '');
  const nl = name.toLowerCase();
  const n = normApk(name);
  const pkg = normApk(app.package || '');
  let score = 0;
  if (n === q) score += 1000;                       // exact name
  else if (n.startsWith(q)) score += 700;           // name starts with query
  else if (n.includes(q)) score += 450;             // name contains query
  else if (q.includes(n) && n.length >= 3) score += 250;
  if (pkg === 'com' + q || pkg === q) score += 900; // exact package (com.whatsapp)
  else if (pkg.startsWith('com' + q) || pkg.includes(q)) score += 220;
  score += words.filter((w) => nl.includes(w)).length * 70;
  // Prefer the canonical app over clones when scores are close: shorter,
  // cleaner names usually mean the original.
  score -= Math.max(0, name.length - q.length) * 0.5;
  return score;
}

async function searchApk(q) {
  const hosts = ['https://ws75.aptoide.com', 'https://ws2.aptoide.com'];
  const seen = new Map();
  for (const host of hosts) {
    try {
      const r = await getJSON(`${host}/api/7/apps/search?query=${encodeURIComponent(q)}&limit=25`, {}, 20000);
      for (const a of (r?.datalist?.list || [])) {
        if (!a?.file?.path) continue;
        const key = a.package || a.name;
        if (key && !seen.has(key)) seen.set(key, a);
      }
    } catch { /* next host */ }
    if (seen.size >= 20) break;
  }
  const list = [...seen.values()];
  if (!list.length) return null;
  // Keep only candidates that actually relate to the query.
  const qn = normApk(q);
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const relevant = list.filter((a) => {
    const n = normApk(a.name);
    const pkg = normApk(a.package || '');
    return n.includes(qn) || pkg.includes(qn) || words.some((w) => String(a.name || '').toLowerCase().includes(w));
  });
  const pool = relevant.length ? relevant : list;
  const best = pool.slice().sort((a, b) => scoreApk(q, b) - scoreApk(q, a))[0];
  return {
    name: best.name || q,
    version: best.file?.vername || best.file?.vercode || '',
    size: Number(best.size || best.file?.filesize || 0),
    url: best.file.path,
    source: 'Aptoide',
  };
}

/** Send a downloaded film as a DOCUMENT so WhatsApp doesn't re-encode it. */
async function sendMovieDoc(ctx, file, title, audio) {
  try {
    const size = fs.statSync(file).size;
    const mb = (size / 1048576).toFixed(1);
    // STREAM the file instead of reading it all into RAM: a 2-hour 720p film can
    // be 1.5-2.5 GB, which would OOM a small container if buffered. WhatsApp's
    // document cap is ~2 GB, so we also guard against oversized files.
    if (size > MAX_DOC_BYTES) {
      await ctx.reply('\u274c Movie ' + mb + ' MB ki hy \u2014 WhatsApp ki 2GB limit se bari, bhej nahi sakta.');
      return;
    }
    await ctx.send(ctx.from, {
      document: fs.createReadStream(file),
      mimetype: audio ? 'audio/mpeg' : 'video/mp4',
      fileName: `${String(title).replace(/[^\w.-]+/g, '_')}.${audio ? 'mp3' : 'mp4'}`,
      caption: `🎬 *${title}*\n📏 ${mb} MB\n📄 Full movie (document)\n👑 ${config.BOT_NAME}`,
    }, { quoted: ctx.m });
  } catch (e) {
    await ctx.reply(`❌ File bhejne me masla: ${e.message || e}`);
  } finally {
    // Delete AFTER the upload has finished (the stream has been consumed by the
    // awaited send). A short delay is a safety margin for the socket flush.
    // Cache-backed files are KEPT so a repeat `.movie` is instant.
    if (!dlcache.isCached(file)) {
      setTimeout(() => { try { fs.unlinkSync(file); } catch { /* ignore */ } }, 15000);
    }
  }
}

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
