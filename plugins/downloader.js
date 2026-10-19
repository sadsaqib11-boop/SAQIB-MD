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
const { saavnBest } = require('../lib/saavn');
const { ttCache, srcCache, ttBufCache, TT_BUF_CACHE_MAX_BYTES } = require('../lib/cache');
const debug = require('../lib/debug');

const isUrl = (s) => /^https?:\/\//i.test(s || '');
/** Extract the 11-char YouTube video id from any watch/short/embed URL. */
const extractVideoId = (u) => {
  const m = String(u || '').match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
};
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
  // GUARD: an undefined/missing file used to crash with "path argument must be
  // of type string" — report it in words instead.
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('the file was missing after download — please try again');
  }
  const stat = fs.statSync(filePath);
  const buf = fs.readFileSync(filePath);
  try {
    if (asAudio) {
      const seconds = await probeDuration(filePath);
      // Native m4a (AAC) must go out as audio/mp4 — sending it as audio/mpeg
      // makes WhatsApp re-wrap it and can break playback. mp3 stays audio/mpeg.
      const mime = /\.m4a$/i.test(filePath) ? 'audio/mp4' : 'audio/mpeg';
      await ctx.send(ctx.from, { audio: buf, mimetype: mime, ptt: false, seconds }, { quoted: ctx.m });
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
  if (!ytdlp.available()) return ctx.reply('❌ The downloader engine (yt-dlp) is not available.');
  const input = String(query).trim();
  // Only fetch metadata when we already have a URL (avoids a slow blocked YT search).
  const meta = isUrl(input) ? await ytdlp.info(input).catch(() => ({ title: '' })) : { title: query };
  if (asAudio) {
    // ULTRA-FAST LANE (user rule: "doosra bot 2 second my audio deta hy"):
    // JioSaavn's free API serves 320kbps audio from its own CDN — ~2 seconds
    // total vs ~40s from YouTube on a datacenter IP. Search by the TITLE we
    // already have (auto-pick passes a URL). YouTube stays as the full
    // fallback, so nothing breaks when this API is down.
    try {
      const name = (meta.title || input).replace(/\s*[-|]\s*(full\s*)?(song|video|lyrical|official.*|audio).*$/i, '').trim();
      if (name) {
        const hit = await saavnBest(name);
        if (hit && hit.file) {
          await sendMedia(ctx, hit.file, `🎵 *${hit.title}*\n👑 ${config.BOT_NAME}`, true);
          return;
        }
      }
    } catch { /* fall through to the YouTube path */ }
  }
  await ctx.reply(`⬇️ *${meta.title || query}*\n_${asAudio ? '🎵 Audio' : '🎬 Video'} download started…\n⏱️ small files take 1-3 min, big videos 10-30 min. Once fetched, repeats are *instant*._`);
  if (asAudio) {
    // FAST NATIVE PATH: grab the m4a/AAC stream directly — NO mp3 re-encode
    // (that ffmpeg pass added several seconds per song for no quality gain).
    // downloadAudioNativeSmart also re-ranks a plain query so the RIGHT track
    // wins. If YouTube refuses (datacenter-IP block) it falls back through the
    // TikTok lane and then the full multi-lane smart path.
    const audioViaTiktok = async () => {
      const urls = await tiktokSearch(String(input).trim(), 3);
      for (const u of urls) {
        try { return await ytdlp.downloadAudioByUrl(u); } catch { /* next clip */ }
      }
      throw new Error('tiktok lane came up empty');
    };
    const file = await ytdlp.downloadAudioNativeSmart(input, [audioViaTiktok]);
    await sendMedia(ctx, file, `🎵 *${meta.title || query}*\n👑 ${config.BOT_NAME}`, true);
    return;
  }
  // VIDEO: she asked for video, so never silently hand back an audio file.
  // If YouTube is blocked we try the alternate routes first, and only then
  // tell her honestly instead of sending a surprise MP3. TikTok is an extra
  // lane here (same scraper as .tts) — short clips land even when YouTube
  // and Dailymotion both refuse.
  const videoViaTiktok = async () => {
    const urls = await tiktokSearch(String(input).trim(), 3);
    for (const u of urls) {
      try { return await ytdlp.downloadVideoByUrl(u, { maxHeight: 720 }); } catch { /* next clip */ }
    }
    throw new Error('tiktok video lane came up empty');
  };
  const { file, audio } = await ytdlp.downloadVideoSmart(input, {}, [videoViaTiktok]);
  if (audio) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
    return ctx.reply(
      '❌ Could not get the *video* (YouTube blocked it).\n' +
      '🎵 Audio may work — try `' + config.PREFIX + 'song ' + query + '`.'
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
  // LONG VIDEOS need real time: a 1GB+ film at container bandwidth can run
  // 10-25 minutes — the old 5-minute cap was killing every long video with
  // "download bohat dair se chal raha tha". Audio is light; video now gets 30.
  const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label || 'the download was taking too long')), ms)),
  ]);
  interactions.set(ctx.from, ctx.sender, 'choice', {
    options: [
      { run: (c) => withTimeout(ytSearchDownload(c, query, true), 600000).catch((e) => c.reply('❌ Audio failed: ' + (e.message || 'download failed.') + '\n_Try a different name, or use .tts/.video._')) },
      { run: (c) => withTimeout(ytSearchDownload(c, query, false), 1800000, 'the video is very LARGE and the download needs time — please be patient, or request a smaller video').catch((e) => c.reply('❌ Video failed: ' + (e.message || 'download failed.') + '\n_Try a different name, or use .tts/.song._')) },
    ],
  });
  return ctx.reply(`🎬 *${query}*\n\n1️⃣ 🎵 Audio (MP3)\n2️⃣ 🎬 Video (MP4)\n\n_Reply with *1* or *2*!_`);
}

/**
 * SONG with RELATED SEARCH (premium upgrade):
 * `.song <query>` first runs ONE fast flat search and shows the TOP related
 * results as a numbered list. The user replies with a number — `3` delivers
 * 🎵 audio, `3v` (ya `3 video`) delivers 🎬 video. The picked URL goes STRAIGHT
 * into the download lanes, so there is no second search: one search, one
 * reply, one download. Falls back to the old audio/video prompt when the
 * search comes up empty or the input is a direct link.
 */
/** Small pretty formatters for the premium lists. */
const fmtViews = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || ''));
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

async function askSongSearch(ctx, query) {
  const q = String(query).trim();
  if (isUrl(q)) return askDownload(ctx, q);
  // Search CACHE (1h): repeat `.song` of the same query = INSTANT result.
  const ckey = `songq|${q.toLowerCase()}`;
  let list = srcCache.get(ckey);
  if (!list) {
    // searchRankedRace: HTTP search (~0.5s) races yt-dlp search (~1s); the
    // winner is relevance-ranked so the real track beats covers/remixes.
    try { list = (await ytdlp.searchRankedRace(q, 5)).slice(0, 5); } catch { /* ignore */ }
    if (list && list.length) srcCache.set(ckey, list);
  }
  if (!list || !list.length) return askDownload(ctx, q);
  // AUTO-PICK (user rule, 2026-10-19): NO option wall. The bot itself picks
  // the best-ranked hit — the flow that made .tts feel instant. A query that
  // starts with "video"/"v " sends video instead of audio.
  const wantVideo = /^(v|video)\b/i.test(q);
  const best = list[0];
  try {
    await ytSearchDownload(ctx, best.url, !wantVideo);
  } catch (e) {
    // best failed? try the runner-up once instead of dying
    const alt = list.find((r) => r.url !== best.url);
    if (!alt) return ctx.reply('\u274c ' + (e.message || 'Download fail.'));
    try { await ytSearchDownload(ctx, alt.url, !wantVideo); }
    catch (e2) { await ctx.reply('\u274c ' + (e2.message || 'Download fail.')); }
  }
}

/* --------------------------- TikTok search helpers --------------------------- */
/** Memory pressure check — yt-dlp child processes are big; when RSS is this
 * high, spawning more will OOM-kill the container (verified live twice:
 * concurrent .tts runs killed the bot 2026-10-17). Threshold sits well under
 * Railway trial limits so a queued download never tips the cgroup. */
const memTight = () => process.memoryUsage().rss > 280 * 1048576;

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
  // PAKISTAN-FIRST + RELEVANCE-FIRST (user rule: sirf Urdu/Hindi/Punjabi
  // content — "angreezi" clips nahi). Two tricks make that real:
  //   1. VARIANT ORDER IS THE RANK: PK-flavored queries come FIRST and every
  //      URL remembers which variant found it, so Pakistani-biased results
  //      always outrank generic global ones downstream.
  //   2. The PK flavor lives in the QUERY WORDS (which work on plain pages),
  //      NOT in Bing's cc=PK params — those page variants serve zero links
  //      to a plain fetcher (verified live: 0 urls).
  const variants = [
    `${query} tiktok pakistan`,
    `${query} tiktok urdu`,
    `${query} tiktok punjabi`,
    `${query} site:tiktok.com`,
    `${query} tiktok`,
    `${query} tiktok video`,
  ];
  const found = []; // [{ url, rank }] — rank = variant index (lower = PK-er)
  const collect = (html0, rank) => {
    // Unescape HTML entities first — Bing buries its TikTok urls inside
    // JSON blobs full of &quot; / &amp;, which the old raw-regex missed.
    const html = html0
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
    for (const u of extractTiktokUrls(html)) {
      if (!found.some((f) => f.url === u)) found.push({ url: u, rank });
      if (found.length >= limit * 4) break;
    }
  };
  // SPEED + YIELD: every engine x variant fires AT ONCE (Promise.allSettled)
  // — wall time is the slowest single fetch (~12s cap), not the sum. Four
  // lanes per variant: Bing videos, BRAVE (best yield of all — real TikTok
  // video URLs, tested live), DDG html (PK region), DDG lite. Bing gets a
  // small stagger because a 6-wide burst makes it throttle to 2-3 urls
  // (verified live 17:23 UTC: parallel burst -> 2 urls, staggered -> 9+).
  const jobs = variants.map((v, i) => {
    const q = encodeURIComponent(v);
    return [
      { rank: i, delay: i * 250, url: `https://www.bing.com/videos/search?q=${q}`, h: { 'User-Agent': UA, 'Accept-Language': 'ur-PK,ur;q=0.9,en;q=0.8' } },
      { rank: i, delay: 0, url: `https://search.brave.com/search?q=${q}`, h: { 'User-Agent': UA, 'Accept-Language': 'ur-PK,ur;q=0.9,en;q=0.8' } },
      { rank: i, delay: 0, url: `https://html.duckduckgo.com/html/?q=${q}&kl=pk-en`, h: { 'User-Agent': UA, 'Accept': 'text/plain' } },
      { rank: i, delay: 0, url: `https://lite.duckduckgo.com/lite/?q=${q}&kl=pk-en`, h: { 'User-Agent': UA, 'Accept': 'text/plain' } },
      { rank: i, delay: 0, url: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${q}&kl=pk-en`, h: { 'User-Agent': UA, 'Accept': 'text/plain' } },
    ];
  }).flat();
  const results = await Promise.allSettled(jobs.map((j) =>
    new Promise((r) => setTimeout(r, j.delay))
      .then(() => getText(j.url, { headers: j.h }, 12000))
      .then((html) => ({ html, rank: j.rank }))));
  for (const r of results) {
    if (r.status === 'fulfilled') collect(r.value.html, r.value.rank);
  }
  // THIN-YIELD RETRY: a throttled round can come back with almost nothing
  // (live: 2 urls). Re-run once with reworded variants before giving up.
  if (found.length < limit * 2) {
    await sleep(800);
    const retryJobs = ['tiktok viral', 'tiktok new', 'tiktok best'].flatMap((suffix, i) => {
      const q = encodeURIComponent(`${query} ${suffix}`);
      return [
        { rank: 3 + i, url: `https://search.brave.com/search?q=${q}`, h: { 'User-Agent': UA } },
        { rank: 3 + i, url: `https://html.duckduckgo.com/html/?q=${q}&kl=pk-en`, h: { 'User-Agent': UA, 'Accept': 'text/plain' } },
      ];
    });
    const retry = await Promise.allSettled(retryJobs.map((j) =>
      getText(j.url, { headers: j.h }, 12000).then((html) => ({ html, rank: j.rank }))));
    for (const r of retry) {
      if (r.status === 'fulfilled') collect(r.value.html, r.value.rank);
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  return found.slice(0, limit * 4).map((f) => f.url);
}

/**
 * REAL TikTok search (region=PK) via the tikwm feed/search mirror — same
 * results, same order as the TikTok app. One HTTP call, so when the mirror is
 * up (it is Cloudflare-blocked from Railway sometimes) this both outranks and
 * outruns the search-engine scraper. Also returns the app's RELATED SEARCH
 * keywords when the response carries them. */
async function tikwmSearch(query, limit = 10) {
  const empty = { urls: [], related: [], items: [] };
  try {
    const count = Math.min(Math.max(limit, 5), 20);
    // TRAILING SLASH IS REQUIRED: Cloudflare's WAF blocks the exact path
    // "/api/feed/search" (403 "Just a moment...") but lets "/api/feed/search/"
    // through \u2014 verified live 2026-10-19. This is the REAL TikTok search:
    // the same results, in the same order, as the app (region=PK), and every
    // item already carries a direct `play` URL + real title/plays/author, so
    // the separate resolve round-trip is skipped entirely (faster + accurate).
    const r = await getJSON(
      `https://tikwm.com/api/feed/search/?keywords=${encodeURIComponent(query)}&count=${count}&region=PK`,
      { 'User-Agent': UA, 'Referer': 'https://tikwm.com/' },
      9000,
    );
    const vids = Array.isArray(r?.data?.videos) ? r.data.videos : [];
    const items = vids.map((v) => ({
      url: v && v.video_id && v.author?.unique_id ? `https://www.tiktok.com/@${v.author.unique_id}/video/${v.video_id}` : '',
      play: (v && v.play) || '',
      title: (v && (v.title || v.content_desc)) || '',
      author: (v && v.author?.unique_id) || '',
      plays: Number(v && v.play_count) || 0,
      duration: Number(v && v.duration) || 0,
      region: (v && v.region) || '',
      cover: (v && v.cover) || '',
    })).filter((v) => v.url);
    let rel = Array.isArray(r?.data?.relatedKeywords) ? r.data.relatedKeywords.map(String) : [];
    // tikwm doesn't always return relatedKeywords, so rebuild the TikTok-style
    // related row from the real clips we just got (always populated, on-topic).
    if (!rel.length) rel = deriveRelated(query, items.map((i) => i.title));
    return { urls: items.map((i) => i.url), related: rel, items };
  } catch { return empty; }
}

/** RELATED SEARCHES, TikTok-style: real TikTok anchors every suggestion on the
 *  query you typed and appends a modifier ("saraiki song" -> "saraiki songs",
 *  "saraiki song status", ...). This rebuilds that row by keeping only the
 *  modifiers that actually recur in the returned clips (so it stays on-topic
 *  and Pakistan-relevant), then topping up with the common TikTok modifiers so
 *  the row is never empty. */
const TT_MODS = [
  ['new', /\bnew\b/], ['status', /\bstatus\b/], ['sharif', /\bsharif\b/], ['pak', /\bpak\b/],
  ['dj', /\bdj\b/], ['remix', /\bremix\b/], ['lyrics', /\blyric/], ['naat', /\bnaat\b/],
  ['trending', /\btrending\b/], ['best', /\bbest\b/], ['full', /\bfull\b/], ['live', /\blive\b/],
  ['cover', /\bcover\b/], ['punjabi', /\bpunjabi\b/], ['urdu', /\burdu\b/], ['saraiki', /\bsaraiki\b/],
  ['pashto', /\bpashto\b/], ['sindhi', /\bsindhi\b/], ['hindi', /\bhindi\b/], ['mashup', /\bmashup\b/],
  ['whatsapp status', /\bwhatsapp\b/], ['ringtone', /\bringtone\b/], ['slow reverb', /\bslow/],
];
function deriveRelated(query, titles) {
  const q = String(query).toLowerCase().trim().replace(/\s+/g, ' ');
  if (!q) return [];
  const qw = new Set(q.split(' '));
  const text = titles
    .map((t) => String(t).toLowerCase().replace(/#[^\s#]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' '))
    .join(' ');
  const has = (re) => re.test(text);
  const out = [];
  const add = (s) => { s = s.trim().replace(/\s+/g, ' '); if (s && s !== q && !out.includes(s)) out.push(s); };
  // 1) plural / natural variant of the query itself
  if (/\bsong\b/.test(q)) add(q.replace(/\bsong\b/, 'songs'));
  else add(q + ' song');
  // 2) query + modifiers that actually appear in the results (on-topic, PK-biased)
  for (const [m, re] of TT_MODS) {
    if (out.length >= 4) break;
    if (m.split(' ').every((w) => qw.has(w))) continue;
    if (has(re)) add(q + ' ' + m);
  }
  // 3) top up with the common TikTok modifiers so the row is never empty
  for (const m of ['new', 'status', 'best', 'trending', 'lyrics', 'dj', 'remix', 'full']) {
    if (out.length >= 4) break;
    if (m.split(' ').every((w) => qw.has(w))) continue;
    add(q + ' ' + m);
  }
  return out.slice(0, 4);
}

/** Resolve a TikTok URL to a playable mp4 (tikwm fast path). */
async function tiktokResolve(url) {
  try {
    const r = await getJSON(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`, {}, 15000);
    if (r?.data?.play) {
      return {
        video: r.data.play,
        title: r.data.title || '',
        music: r.data.music || '',
        plays: Number(r.data.play_count) || 0,
        duration: Number(r.data.duration) || 0,
      };
    }
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
  if (!ytdlp.available()) return ctx.reply('❌ The downloader engine (yt-dlp) is not available.');
  const ckey = `tt3|${String(query).trim().toLowerCase()}|${limit}`;
  let picks = ttCache.get(ckey);
  let related = []; // TikTok-app style related searches (sent with the row)
  if (picks && picks.length) {
    // Repeat query within the TTL -> fully instant (no search, no resolve).
    await ctx.reply(`⚡ *TikTok Search:* ${query}\n_results are already cached — sending instantly…_`);
  } else {
    await ctx.reply(`🔎 *TikTok Search:* ${query}\n_${limit} videos dhoond raha hoon…_`);
    // Search is the slow part (Bing/DDG scraping) — cache the page URLs for 1h.
    // Wider net: limit*4 candidates so that after dead links and the relevance
    // filter there are STILL enough survivors to deliver the full 5 (the old
    // net was too small — searches often delivered just 1 video).
    const skey = `tt2|${String(query).trim().toLowerCase()}`;
    let urls = srcCache.get(skey);
    let tikItems = srcCache.get(skey + '|items');   // tikwm items (carry play URLs)
    if (!urls) {
      const tSearch = Date.now();
      urls = [];
      // LANE 0 - REAL TikTok search (tikwm, region=PK, TRAILING-SLASH path):
      // jo app pe aata hai yahan bhi wahi, wahi order me. Items already carry
      // direct play URLs + real titles/plays, so the resolve step is skipped.
      if (!memTight()) {
        const wm = await tikwmSearch(query, Math.max(limit * 2, 10));
        if (wm.items.length) {
          tikItems = wm.items;
          urls = wm.urls;
          related = wm.related;
          debug.info('[TTS] tikwm lane won', { urls: urls.length, related: related.length });
        }
      }
      if (!urls.length) {
        try { urls = await tiktokSearch(query, limit * 4); } catch { /* ignore */ }
      }
      if (urls.length) {
        srcCache.set(skey, urls);
        if (tikItems && tikItems.length) srcCache.set(skey + '|items', tikItems);
      }
      debug.info('[TTS] search done', { seconds: Math.round((Date.now() - tSearch) / 1000), urls: urls.length, tik: (tikItems || []).length });
    }
    // Resolve to direct play URLs in parallel (fast, no 800ms drip).
    // KEEP THE SOURCE PAGE URL — tikwm (the resolver) is Cloudflare-blocked
    // from Railway most of the time (live proof: 9 urls -> 1 clip), so the
    // yt-dlp clip-download fallback needs the original TikTok URL to work
    // from. Both travel with every pick now.
    const tResolve = Date.now();
    // If tikwm already returned play URLs + metadata, use them straight away
    // (no resolve round-trip - faster, and the titles are the REAL ones).
    let resolved;
    if (tikItems && tikItems.length) {
      resolved = tikItems.map((it) => ({ src: it.url, url: it.play || '', title: it.title || '', plays: it.plays || 0, author: it.author || '', region: it.region || '' }));
    } else {
      resolved = (await Promise.all(urls.map(async (u) => {
        try { const f = await tiktokResolve(u); if (f?.video) return { src: u, url: f.video, title: f.title || '', plays: f.plays || 0 }; } catch { /* ignore */ }
        // Resolver refused - still a candidate, yt-dlp lane will fetch it.
        return { src: u, url: '', title: '' };
      }))).filter((v) => v.src);
    }
    debug.info('[TTS] resolve done', { seconds: Math.round((Date.now() - tResolve) / 1000), clips: resolved.filter((v) => v.url).length, candidates: resolved.length });
    // RELEVANCE GATE: zero-score (off-topic) clips only fill the row when
    // genuinely relevant ones can't — no more "2 ajeeb videos" when enough
    // matching clips exist.
    const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    // PAKISTAN-ONLY gate: real TikTok search already returns region=PK, but the
    // scraper fallback can leak global clips. This scores the DESI/PK signal so
    // Pakistani content always outranks generic English clips, and popularity
    // (play count) breaks ties \u2014 exactly like the TikTok app's own ranking.
    const DESI = /(urdu|pakistan|punjabi|saraiki|sindhi|pashto|balochi|hindi|desi|bollywood|lollywood|naat|qawwali|ghazal|kalam|mushaira)/i;
    const score = (v) => {
      const t = String(v.title || '').toLowerCase();
      const a = String(v.author || '').toLowerCase();
      let s = words.reduce((n, w) => n + (t.includes(w) ? 2 : 0) + (a.includes(w) ? 1 : 0), 0);
      if (DESI.test(t)) s += 3;
      if (v.region && /PK/i.test(v.region)) s += 3;      // tikwm told us it is PK
      if (v.plays) s += Math.log10(v.plays + 1);          // popular tiebreak
      return s;
    };
    const ranked = [...resolved].sort((a, b) => score(b) - score(a));
    const relevant = ranked.filter((v) => score(v) > 0);
    picks = (relevant.length >= limit ? relevant : ranked).slice(0, limit);
    if (picks.length) ttCache.set(ckey, picks);
  }
  if (!picks.length) {
    // Search engines gave NOTHING (Bing serves empty pages to Urdu queries
    // sometimes). Never collapse to ONE video — mirror-search pulls a full
    // RELEVANT row from YouTube and the same album code delivers it.
    // Skipped when memory is tight — the yt-dlp downloads it spawns are what
    // OOM-killed the container when several .tts ran at once.
    if (!memTight()) try {
      const yt = await ytdlp.searchViaMirror(query, limit);
      const picked = yt.map((v) => ({ src: '', url: '', title: String(v.title || '').slice(0, 120), file: v.file })).filter((v) => v.file && fs.existsSync(v.file));
      if (picked.length >= 2) {
        debug.info('[TTS] mirror-row fallback', { count: picked.length });
        try {
          const parent = await ctx.send(ctx.from, { album: { expectedVideoCount: picked.length } }, { quoted: ctx.m });
          const parentKey = { id: parent?.key?.id, remoteJid: ctx.from, fromMe: true };
          for (const v of picked) {
            try {
              await ctx.send(ctx.from, { video: fs.readFileSync(v.file), caption: v.title ? `🎬 *${v.title}*` : undefined }, { albumParentKey: parentKey });
            } catch { await ctx.send(ctx.from, { video: fs.readFileSync(v.file) }); }
          }
        } catch { for (const v of picked) { try { await ctx.send(ctx.from, { video: fs.readFileSync(v.file) }); } catch { /* skip */ } } }
        return;
      }
    } catch { /* fall through to single video */ }
    try { await ytSearchDownload(ctx, query, false); }
    catch { await ctx.reply('❌ Nothing found — try a different keyword.'); }
    return;
  }
  // ALBUM MODE + DEAD-CLIP BACKFILL + PARALLEL FETCH — merged from both sides:
  //  - ALBUM: the videos arrive as ONE WhatsApp album (grid/row — exactly the
  //    "_________________________________" row she asked for), not 5 vertical
  //    messages. The album parent is a tiny metadata message; each video
  //    references it via albumParentKey so WhatsApp groups them together.
  //  - PARALLEL: all candidate buffers are fetched SIMULTANEOUSLY
  //    (Promise.allSettled) — total wait is the slowest clip, not the sum.
  //  - BACKFILL: buffers are fetched with a wider candidate pool and the loop
  //    keeps going until `limit` clips are actually collected — dead links can
  //    never shrink the row below what she asked for.
  let delivered = 0;
  // Buffer CACHE + DUAL-LANE fetch per clip:
  //   lane 1 (fast): tikwm play URL -> direct CDN fetch (no yt-dlp).
  //   lane 2 (fallback): tikwm is Cloudflare-blocked from Railway (live
  //     proof 9 urls -> 1 clip) — yt-dlp downloads the TikTok clip itself.
  // yt-dlp lane only for the TOP candidates (already relevance-ranked) and
  // staggered 2s apart so 5 yt-dlp spawns don't stampede a trial CPU.
  const tFetch = Date.now();
  let ytdlpLane = 0;
  // MEMORY GUARD: yt-dlp child processes run ~60-100MB each — many at once
  // OOM-killed the container (verified live: two concurrent .tts runs
  // restarted the bot 2026-10-17 ~17:31 UTC). Clip downloads are capped at
  // 2 concurrent, shared across ALL .tts calls via globalThis, and skipped
  // entirely when RSS is already tight.
  const YTDLP_MAX = 1;
  const ytdlpState = (globalThis.__ttsYtdlp = globalThis.__ttsYtdlp || { n: 0, q: [] });
  const ytdlpSlot = () => new Promise((res) => {
    const go = () => { if (ytdlpState.n < YTDLP_MAX) { ytdlpState.n++; res(); } else ytdlpState.q.push(go); };
    go();
  });
  const ytdlpFree = () => { ytdlpState.n--; (ytdlpState.q.shift() || (() => {}))(); };
  const results = await Promise.allSettled(picks.map((p, i) => {
    const cacheKey = 'b|' + (p.url || p.src);
    const hit = ttBufCache.get(cacheKey);
    if (hit) return Promise.resolve(hit);
    const viaPlay = p.url
      ? fetchVideoBuffer(p.url).then((buf) => {
        // Cache only clips small enough that a full cache stays memory-bounded
        // (see TT_BUF_CACHE_MAX_BYTES). Bigger clips still send — just not kept.
        if (buf && buf.length <= TT_BUF_CACHE_MAX_BYTES) ttBufCache.set(cacheKey, buf);
        return buf;
      })
      : Promise.reject(new Error('no play url (tikwm refused)'));
    const canYtdlp = !p.url && p.src && i < limit;
    return viaPlay.catch(() => {
      if (!canYtdlp || memTight()) throw new Error('no source');
      const stagger = (ytdlpLane++) * 2500;
      return new Promise((r) => setTimeout(r, stagger))
        .then(() => ytdlpSlot())
        .then(() => ytdlp.downloadVideoByUrl(p.src, { maxHeight: 720, timeoutMs: 120000 }))
        .finally(ytdlpFree)
        .then((file) => {
          const buf = fs.readFileSync(file);
          try { fs.unlinkSync(file); } catch { /* ignore */ }
          if (buf && buf.length <= TT_BUF_CACHE_MAX_BYTES) ttBufCache.set(cacheKey, buf);
          return buf;
        });
    });
  }));
  debug.info('[TTS] buffers done', { seconds: Math.round((Date.now() - tFetch) / 1000), attempts: picks.length });
  const bufs = [];
  for (let i = 0; i < results.length && bufs.length < limit; i++) {
    if (results[i].status === 'fulfilled') {
      bufs.push({ buf: results[i].value, title: (picks[i].title || '').slice(0, 120), plays: picks[i].plays || 0 });
    } // dead clip — skip
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
    await ctx.reply('❌ TikTok blocked the send (server IP block). Try again in a little while — or search with .video.');
    return;
  }
  // RELATED SEARCHES — real TikTok app ki tarah row ke neeche "related" query
  // suggestions: `.tts <word>` se turant agla search.
  const rel = (related.length ? related : deriveRelated(query, picks.map((p) => p.title)))
    .slice(0, 4).map((s) => `• ${s}`);
  if (rel.length) {
    await ctx.reply(`🔗 *Related searches:*\n${rel.join('\n')}\n_Jaise: ${config.PREFIX}tts <word>_`).catch(() => {});
  }
  try {
    const parent = await ctx.send(ctx.from, { album: { expectedVideoCount: bufs.length } }, { quoted: ctx.m });
    const parentKey = { id: parent?.key?.id, remoteJid: ctx.from, fromMe: true };
    for (let i = 0; i < bufs.length; i++) {
      const v = bufs[i];
      await ctx.send(ctx.from, {
        video: v.buf,
        caption: i === 0
          ? `🎬 *TikTok* — ${query} (${bufs.length} videos)\n📝 ${v.title}${v.plays ? `\n▶️ ${fmtViews(v.plays)} plays` : ''}\n👑 ${config.BOT_NAME}`
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
    await ctx.reply('❌ TikTok blocked the send (server IP block). Try again in a little while — or search with .video.');
  }
  debug.info('[TTS] delivered', { count: delivered, wanted: limit });
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

  // ---- YouTube: play / song / music (RELATED-RESULTS PICKER) ----
  // Premium flow: ek fast search, numbered related results, `2` = audio,
  // `2v` = video. ytaudio/ytmp3/ytmp4/ytvideo stay DIRECT (user ne pehle hi
  // audio ya video chun liya hai — sirf download chahiye).
  if (['play', 'song', 'music'].includes(command)) {
    if (!arg) return reply(`❌ Song/query do. Example: ${config.PREFIX}${command} Tum Hi Ho`);
    try { await askSongSearch(ctx, arg); }
    catch (e) { await reply('❌ ' + (e.message || 'Download fail.')); }
    return;
  }
  // ---- YouTube direct: ytaudio / ytmp3 / ytmp4 / ytvideo ----
  // These offer an Audio ⇄ Video choice before downloading.
  if (['ytaudio', 'ytmp3', 'ytmp4', 'ytvideo'].includes(command)) {
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

  // ---- movie: INSTANT 720p LINK + background full file (fastest path) ----
  // `.movie <name>`        -> instant 720p download link (~1s) + the full file
  //                           is fetched in the BACKGROUND and sent as a document.
  // `.movie link <name>`   -> link only (fastest; no download).
  // `.movie file <name>`   -> document only (the old, slow default).
  if (command === 'movie') {
    if (!arg) return reply(`❌ Movie naam do. Example: ${config.PREFIX}movie Interstellar`);

    // MODES (default = INSTANT). `.movie <name>` now returns the 720p download
    // LINK in ~1s AND quietly fetches the full file in the background, so the
    // user gets something IMMEDIATELY (the link streams the whole film) and the
    // document follows. `.movie link <name>` = link only (fastest),
    // `.movie file <name>` = document only (the old, slow default).
    let mode = 'both';
    let query = String(arg).trim();
    if (/^(link|url)\b/i.test(query)) { mode = 'link'; query = query.replace(/^(link|url)\b/i, '').trim(); }
    else if (/^(file|doc|document|download)\b/i.test(query)) { mode = 'file'; query = query.replace(/^(file|doc|document|download)\b/i, '').trim(); }
    if (!query) return reply(`❌ Naam do. Example: ${config.PREFIX}movie Interstellar`);
    if (!ytdlp.available()) return reply('❌ The downloader engine (yt-dlp) is not available.');

    // ---- fast target resolution (HTTP-raced search, cached 6h) ----
    const resolveTarget = async () => {
      if (isUrl(query)) {
        const videoId = extractVideoId(query);
        const meta = await ytdlp.info(query).catch(() => null);
        return { videoId, title: (meta && meta.title) || query };
      }
      const mkey = `movieq|${query.toLowerCase()}`;
      let list = srcCache.get(mkey);
      if (!list) {
        list = await ytdlp.searchRankedRace(`${query} full movie`, 6);
        if (list && list.length) srcCache.set(mkey, list);
      }
      if (!list || !list.length) return null;
      const pick = list[0];
      return { videoId: extractVideoId(pick.url), title: pick.title || query };
    };

    const base = String(config.PUBLIC_URL || '').replace(/\/+$/, '');
    const wantLink = (mode === 'link' || mode === 'both') && !!base;
    const wantFile = (mode === 'file' || mode === 'both') || !base;

    // ---- 1) INSTANT LINK (single message, ~1s) ----
    if (wantLink) {
      try {
        const t = await resolveTarget();
        if (!t || !t.videoId) {
          await reply(`❌ *${query}* not found — check the name or send a direct link.`);
          return;
        }
        const link = `${base}/dl/${t.videoId}?q=${encodeURIComponent(t.title.slice(0, 50))}`;
        await reply(
          `🎬 *${t.title}*\n\n` +
          `📥 *720p download link:*\n${link}\n\n` +
          `_Tap to download — full size (any GB), 720p. Streams from our own server._` +
          (wantFile ? `\n_⏬ Full file bhi background me bhej raha hoon…_` : ''),
        );
      } catch (e) {
        await reply(`❌ *${query}* not found (${String(e.message || e).slice(0, 60)}) — check the name or send a direct link.`);
        return;
      }
    }

    // ---- 2) FULL FILE (background when the link was already sent) ----
    if (wantFile) {
      const fetchFile = async () => {
        const cached = dlcache.get('movie', `${query}@1080`);
        if (cached) { await sendMovieDoc(ctx, cached, query, false); return; }
        if (!wantLink) await reply(`🎬 *${query}* — downloading the full movie to send you…\n⏳ _Big film = thoda wait._`);
        try {
          const file = await Promise.race([
            ytdlp.downloadMovie(query, { maxHeight: 1080 }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('download timeout (30min)')), 1800000)),
          ]);
          await sendMovieDoc(ctx, file, query, false);
        } catch (e) {
          await reply(`❌ *${query}* file fail (${String(e.message || e).slice(0, 60)}) — try ${config.PREFIX}movie link ${query}`);
        }
      };
      if (wantLink) { fetchFile().catch(() => {}); }  // link is already out → don't block
      else { await fetchFile(); }
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
          await c.reply('❌ Surah audio failed — please try again.');
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
    return reply(`📖 *Surah ${n} — ${name}*\n\n1️⃣ 🎵 Audio (MP3)\n2️⃣ 🎬 Video (MP4)\n\n_Reply with *1* or *2*!_`);
  }

  // ---- npm package info ----
  if (command === 'dlnpm') {
    if (!arg) return reply(`❌ Package naam do. Example: ${config.PREFIX}dlnpm express`);
    try {
      const r = await getJSON(`https://registry.npmjs.org/${encodeURIComponent(arg.trim())}`);
      if (r.error) return reply('❌ Package not found.');
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
      if (!res.ok) return reply('❌ Repo not found (it must be public with a main/master branch).');
      const buf = Buffer.from(await res.arrayBuffer());
      await sendDoc(ctx, buf, `${repo.split('/')[1]}.zip`, 'application/zip');
    } catch (e) { await reply('❌ ' + (e.message || 'Clone fail.')); }
    return;
  }

  // ---- Google Drive direct download ----
  if (command === 'gdrive') {
    if (!isUrl(arg)) return reply(`❌ Drive link do. Example: ${config.PREFIX}gdrive https://drive.google.com/file/d/<id>/view`);
    const id = (arg.match(/[-\w]{25,}/) || [])[0];
    if (!id) return reply('❌ File ID not found.');
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
    if (!app) return reply(`❌ *${q}* not found — check the name or send a direct link.`);
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
    if (!ytdlp.available()) return reply('❌ The downloader engine (yt-dlp) is not available.');
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
      if (!ytdlp.available()) return reply('❌ The downloader engine (yt-dlp) is not available.');
      const label = {
        instagram: 'Instagram', ig: 'Instagram', igdl: 'Instagram', igdl2: 'Instagram', igdl3: 'Instagram', reels: 'Reels',
        facebook: 'Facebook', fb: 'Facebook', twitter: 'Twitter/X', x: 'Twitter/X',
        pinterest: 'Pinterest', pin: 'Pinterest', capcut: 'CapCut', mediafire: 'MediaFire',
        megadl: 'Mega', ytpost: 'YouTube Post', download: 'Download',
      }[command] || 'Media';
      try {
        const file = await ytdlp.downloadVideo(arg);
        await sendMedia(ctx, file, `⬇️ *${label}*\n👑 ${config.BOT_NAME}`, false);
      } catch { await reply('❌ Download failed — make the link public or try again later.'); }
      break;
    }
    case 'igmp3': {
      if (!ytdlp.available()) return reply('❌ The downloader engine (yt-dlp) is not available.');
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
    // GUARD: an undefined/missing file used to crash mid-send with a cryptic
    // "Cannot read properties of undefined" — say what actually happened.
    if (!file || !fs.existsSync(file)) {
      console.error('[MOVIE] send fail: file missing', { file });
      await ctx.reply(`❌ The movie downloaded but the file is missing (${file || 'unknown path'}) — please try again.`);
      return;
    }
    const size = fs.statSync(file).size;
    const mb = (size / 1048576).toFixed(1);
    // STREAM the file instead of reading it all into RAM: a 2-hour 720p film can
    // be 1.5-2.5 GB, which would OOM a small container if buffered. NO hard
    // 2GB rejection — WhatsApp server often accepts bigger documents, so we
    // TRY the send; if WhatsApp itself rejects, the catch below tells the user.
    if (size > MAX_DOC_BYTES) console.log(`[MOVIE] oversized attempt: ${mb} MB`);
    const safeTitle = String(title || 'movie').replace(/[^\w.-]+/g, '_');
    // Baileys getStream needs { url: <path> } for a file — a raw ReadStream has
    // neither 'url' nor 'stream' key, so prepare crashed with
    // "Cannot read properties of undefined (reading 'toString')".
    await ctx.send(ctx.from, {
      document: { url: file },
      mimetype: audio ? 'audio/mpeg' : 'video/mp4',
      fileName: `${safeTitle}.${audio ? 'mp3' : 'mp4'}`,
      caption: `🎬 *${title}*\n📏 ${mb} MB\n📄 Full movie (document)\n👑 ${config.BOT_NAME}`,
    }, { quoted: ctx.m });
  } catch (e) {
    // Log the FULL stack to the bot log (visible in /api/debug) — the next
    // "file bhejne me masla" report then comes with a fixable answer, not a
    // one-line mystery.
    console.error('[MOVIE] send fail:', e?.stack || e?.message || e);
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
