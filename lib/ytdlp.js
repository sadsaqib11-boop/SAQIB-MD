/**
 * SAQIB-MD — yt-dlp wrapper
 * -------------------------
 * One engine for YouTube, Instagram, Facebook, Twitter/X, TikTok, Pinterest
 * and 1000+ other sites. Downloads to a temp dir and returns the file path.
 * Degrades gracefully when yt-dlp is not installed.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const dlcache = require('./dlcache');

const TMP = path.join(process.env.TMP_DIR || os.tmpdir(), 'saqib-dl');

// How many parallel fragment connections yt-dlp may use. YouTube serves DASH
// streams in fragments; pulling several at once is a big, bandwidth-neutral
// speed-up (same bytes, more connections). Overridable via env.
const FRAGMENTS = Math.max(1, parseInt(process.env.YTDLP_FRAGMENTS || '8', 10));
// When a movie download is still going after this long we start a mirror
// download in PARALLEL and take whichever finishes first (hedged request).
const MOVIE_HEDGE_MS = parseInt(process.env.MOVIE_HEDGE_MS || '20000', 10);

/* ------------------------------ cookies ------------------------------ */
/**
 * YouTube blocks datacenter IPs with "Sign in to confirm you're not a bot".
 * Passing a logged-in browser's cookies fixes it. The cookie text lives in
 * config.YT_COOKIES (a Netscape cookies.txt blob); we write it to a temp file
 * once and hand the path to yt-dlp via --cookies.
 */
const COOKIE_FILE = path.join(TMP, 'cookies.txt');

function ensureCookieFile() {
  const raw = config.YT_COOKIES;
  if (!raw || typeof raw !== 'string' || raw.length < 50) return null;
  try {
    fs.mkdirSync(TMP, { recursive: true });
    // A Netscape cookies.txt is one cookie per line. If the blob lost its
    // newlines it is USELESS to yt-dlp — it silently ignores the file and
    // YouTube answers "Sign in to confirm you're not a bot", which is exactly
    // the block she reported. Rebuild the lines from the tab-separated records.
    // Rebuild records directly: a Netscape record is 7 tab-separated fields
    // (domain, flag, path, secure, expiry, name, value). Matching on the SHAPE
    // (instead of splitting on newlines/spaces) recovers cookies even when the
    // whole file was flattened to ONE line with records space-joined — Railway
    // mangles multi-line env vars exactly like that.
    const records = raw.match(/\S+\t(?:TRUE|FALSE)\t\S+\t(?:TRUE|FALSE)\t\d+\t[^\t]+\t\S+/g) || [];
    if (records.length < 1) return null;   // nothing usable — fall back to no cookies
    const lines = ['# Netscape HTTP Cookie File', '# https://curl.haxx.se/rfc/cookie_spec.html', ...records.filter((r) => !/vellum/i.test(r))];
    if (lines.length <= 2) return null;
    fs.writeFileSync(COOKIE_FILE, lines.join('\n') + '\n');
    return COOKIE_FILE;
  } catch { return null; }
}

/** yt-dlp args that apply to every call (cookies + a sane user agent). */
function commonArgs() {
  const out = ['--no-warnings', '-N', String(FRAGMENTS)];
  const cf = ensureCookieFile();
  if (cf) out.push('--cookies', cf);
  return out;
}

function which(bin) {
  const paths = (process.env.PATH || '').split(':');
  for (const p of paths) {
    try { if (p && fs.existsSync(path.join(p, bin))) return path.join(p, bin); } catch { /* ignore */ }
  }
  return null;
}

let YTDLP = null;
let checked = false;
function ytdlpPath() {
  if (!checked) { YTDLP = which('yt-dlp') || which('yt-dlp_linux'); checked = true; }
  return YTDLP;
}

function run(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const bin = ytdlpPath();
    if (!bin) return reject(new Error('yt-dlp not installed'));
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message || '').slice(0, 300)));
      resolve(String(stdout || ''));
    });
  });
}

function newBase() {
  fs.mkdirSync(TMP, { recursive: true });
  return path.join(TMP, `s${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
}

function findFile(base) {
  const dir = path.dirname(base);
  const name = path.basename(base);
  const f = fs.readdirSync(dir).find((x) => x.startsWith(name));
  if (!f) throw new Error('download failed');
  return path.join(dir, f);
}

/**
 * Hedged request: run `primary`; if it fails OR is still running after
 * `hedgeMs`, start `secondaryFn` in parallel and resolve with whichever
 * produces a file first. This keeps the common case cheap (the secondary is
 * never started when the primary is quick) while still accelerating the slow
 * ones. Rejects only when BOTH paths fail.
 */
function hedgedFirst(primary, secondaryFn, hedgeMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    let lastErr = null;
    let pending = 1;              // primary is in flight
    let secondaryStarted = false;
    let timer = null;
    const finish = (f) => { if (!done) { done = true; if (timer) clearTimeout(timer); resolve(f); } };
    const rejectNow = () => { if (!done) { done = true; if (timer) clearTimeout(timer); reject(lastErr || new Error('download failed')); } };
    const startSecondary = () => {
      if (done || secondaryStarted) return;
      secondaryStarted = true;
      pending++;
      Promise.resolve().then(secondaryFn).then(finish).catch((e) => { lastErr = e; pending--; if (pending <= 0) rejectNow(); });
    };
    Promise.resolve(primary).then(finish).catch((e) => {
      lastErr = e;
      pending--;
      if (timer) clearTimeout(timer);
      if (secondaryStarted) { if (pending <= 0) rejectNow(); }
      else startSecondary();
    });
    timer = setTimeout(startSecondary, hedgeMs);
  });
}

/* ---------------------- WhatsApp-playable video ---------------------- */
// WhatsApp only plays MP4 (H.264 + AAC). yt-dlp happily hands back WebM
// (VP9/Opus) or HEVC files, which is exactly why a downloaded clip showed
// "something wrong with this file". We probe the codec and, when it is not
// already H.264-in-MP4, convert it with ffmpeg before sending.
function ffprobeCodec(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', file],
      { timeout: 20000 }, (err, so) => resolve(err ? '' : String(so || '').trim().toLowerCase()));
  });
}

function ffmpeg(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 16 }, (err) => resolve(!err));
  });
}

async function toPlayableMp4(file) {
  try {
    if (!file || !fs.existsSync(file)) return file;
    // Big files are sent as documents (codec does not matter) and transcoding
    // them would take minutes — skip.
    const size = fs.statSync(file).size;
    if (size > 120 * 1024 * 1024) return file;
    const isMp4 = /\.mp4$/i.test(file);
    const codec = await ffprobeCodec(file);
    const alreadyGood = isMp4 && (!codec || codec.startsWith('h264') || codec.startsWith('avc'));
    if (alreadyGood) return file;
    const out = file.replace(/\.[^.]+$/, '') + '.mp4';
    // 1) fast remux (lossless) — works when the codec is already MP4-safe.
    if (await ffmpeg(['-y', '-i', file, '-c', 'copy', '-movflags', '+faststart', out], 120000)) {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
      return out;
    }
    // 2) full re-encode for VP9/Opus/HEVC — guarantees a playable H.264/AAC MP4.
    if (await ffmpeg(['-y', '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], 600000)) {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
      return out;
    }
    return file;
  } catch { return file; }
}

const isUrl = (s) => /^https?:\/\//i.test(s || '');
/** Accept a URL, a raw yt-dlp search token (ytsearch1:/scsearch1:), or a plain query. */
const asInput = (q) => {
  const s = String(q || '').trim();
  if (isUrl(s) || /^(ytsearch|scsearch|ytsearchdate)\d*:/i.test(s)) return s;
  return `ytsearch1:${s}`;
};

/** Video metadata: title, duration (s), thumbnail. Accepts URL or search query. */
async function info(input) {
  const out = await run([...commonArgs(), '--skip-download', '--no-playlist', '--print', '%(title)s\t%(duration)s\t%(thumbnail)s', asInput(input)], 60000);
  const [title, duration, thumbnail] = out.trim().split('\t');
  return { title: title || '', duration: Number(duration) || 0, thumbnail: thumbnail || '' };
}

/** Fast multi-result search (flat playlist) — returns [{title, url}]. */
async function search(input, n = 5) {
  const token = isUrl(input) ? input : `ytsearch${n}:${String(input).trim()}`;
  const out = await run([...commonArgs(), '--skip-download', '--no-warnings', '--flat-playlist', '--print', '%(title)s\t%(webpage_url)s', token], 60000);
  return out.trim().split('\n').filter(Boolean).map((line) => {
    const idx = line.indexOf('\t');
    return idx >= 0 ? { title: line.slice(0, idx), url: line.slice(idx + 1) } : { title: line, url: '' };
  }).filter((r) => r.url);
}

/** Download audio as MP3, return file path. Accepts URL or search query. */
async function downloadAudio(input) {
  const base = newBase();
  await run([...commonArgs(), '--no-playlist', '-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', `${base}.%(ext)s`, asInput(input)], 180000);
  return findFile(base);
}

/** Download video as MP4. Tries several player clients before giving up. */
async function downloadVideo(input, opts = {}) {
  const base = newBase();
  const src = asInput(input);
  const h = Number(opts.maxHeight) > 0 ? Number(opts.maxHeight) : 480;
  // YouTube increasingly blocks datacenter IPs. Different player clients behave
  // differently, so we try a few before declaring failure. Cookies (when
  // present) are added by commonArgs(). The first attempt asks for the exact
  // height cap the caller wants (720p for movies), then we fall back to lower
  // resolutions so a download still succeeds when 720p isn't offered.
  const attempts = [
    ['-f', `bv*[ext=mp4][height<=${h}]+ba[ext=m4a]/b[ext=mp4][height<=${h}]/b[height<=${h}]/b`],
    ['-f', `b[ext=mp4][height<=${h}]/b[height<=${h}]/b`, '--extractor-args', 'youtube:player_client=android'],
    ['-f', 'b[ext=mp4][height<=480]/b[height<=480]/b', '--extractor-args', 'youtube:player_client=ios'],
    ['-f', 'b', '--extractor-args', 'youtube:player_client=web_safari'],
    ['-f', 'b', '--extractor-args', 'youtube:player_client=tv'],
    ['-f', 'b', '--extractor-args', 'youtube:player_client=mweb'],
    // Newer yt-dlp builds need the JS runtime flag for the tv/web clients.
    ['-f', 'b', '--extractor-args', 'youtube:player_client=web_embedded'],
  ];
  let lastErr = null;
  for (const extra of attempts) {
    try {
      await run([...commonArgs(), '--no-playlist', ...extra, '--merge-output-format', 'mp4', '-o', `${base}.%(ext)s`, src], opts.timeoutMs || 240000);
      return await toPlayableMp4(findFile(base));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('video download failed');
}

/** Resolve a search query to a concrete video URL (best-effort). */
async function resolveUrl(input) {
  if (isUrl(input)) return input;
  const out = await run([...commonArgs(), '--no-playlist', '--skip-download', '--print', '%(webpage_url)s', asInput(input)], 60000);
  const url = out.trim().split('\n').pop().trim();
  return url || input;
}

/** Resolve on the FIRST promise that succeeds; reject only if ALL fail.
 *  Losers are caught-and-ignored so nothing throws unhandled. */
function firstOk(promises) {
  return new Promise((resolve, reject) => {
    let pending = promises.length;
    let settled = false;
    if (!pending) return reject(new Error('no sources'));
    for (const p of promises) {
      p.then((v) => { if (!settled) { settled = true; resolve(v); } }).catch(() => {
        if (--pending === 0 && !settled) reject(new Error('all sources failed'));
      });
    }
  });
}

/**
 * Audio download that does NOT depend on YouTube alone. For a plain query,
 * YouTube and SoundCloud RACE in parallel and whichever delivers first wins —
 * a YouTube CDN block can no longer stall or kill a song download.
 * Phase 3: the finished file is cached on disk, so asking for the SAME song
 * again is instant (no network at all).
 */
async function downloadAudioSmart(input) {
  const key = String(input).trim();
  const hit = dlcache.get('audio', key);
  if (hit) return hit;
  return dlcache.dedupe('audio:' + key.toLowerCase(), async () => {
    const again = dlcache.get('audio', key);
    if (again) return again;
    let file;
    if (isUrl(key) || /^(ytsearch|scsearch)\d*:/i.test(key)) {
      // A concrete URL/token has only one true source — sequential logic.
      try {
        file = await downloadAudio(input);
      } catch (e) {
        if (isUrl(input)) throw e;
        try { file = await downloadAudio(`scsearch1:${key}`); } catch { throw e; }
      }
    } else {
      // RACE: all sources in parallel, first to deliver wins.
      // THREE lanes now: YouTube, SoundCloud, and Dailymotion (audio pulled
      // from DM's video stream). The user's rule: "jahan se bhi lo, gaana
      // milna hi chahiye" — a YouTube block can no longer starve a song.
      const yt = downloadAudio(`ytsearch1:${key}`);
      const sc = downloadAudio(`scsearch1:${key}`);
      const dm = downloadAudioViaDailymotion(key);
      file = await firstOk([yt, sc, dm]).finally(() => { yt.catch(() => {}); sc.catch(() => {}); dm.catch(() => {}); });
    }
    return dlcache.put('audio', key, file);
  });
}

/**
 * Video download. YouTube blocks many datacenter IPs ("Sign in to confirm
 * you're not a bot") — the cookies in config.YT_COOKIES fix most of that.
 * If YouTube still refuses, we report `audio: true` so the caller can be
 * honest with the user instead of silently sending an MP3 when they asked for
 * a video.
 *
 * Phase 3: cached on disk — a repeat request is instant.
 */
async function downloadVideoSmart(input, opts = {}) {
  const key = String(input).trim() + (opts.maxHeight ? `@${opts.maxHeight}` : '');
  const hit = dlcache.get('video', key);
  if (hit) return { file: hit, audio: false };
  return dlcache.dedupe('video:' + key.toLowerCase(), async () => {
    const again = dlcache.get('video', key);
    if (again) return { file: again, audio: false };
    try {
      const file = await downloadVideo(input, opts);
      return { file: dlcache.put('video', key, file), audio: false };
    } catch (e) {
      // YouTube blocks datacenter IPs even with cookies sometimes. Before
      // giving up: DAILYMOTION (a fully independent video source), then a
      // public Invidious/Piped mirror, then SoundCloud audio.
      const dm = await downloadViaDailymotion(input, opts);
      if (dm) return { file: dlcache.put('video', key, dm), audio: false };
      const mirrored = await downloadViaMirror(input, opts);
      if (mirrored) return { file: dlcache.put('video', key, mirrored), audio: false };
      // Last resort for a plain query: SoundCloud audio (flagged as audio).
      // Movies pass `allowAudio:false` so they NEVER silently get an MP3.
      if (opts.allowAudio !== false && !isUrl(input)) {
        try { return { file: await downloadAudioSmart(`scsearch1:${String(input).trim()}`), audio: true }; } catch { /* fall through */ }
      }
      throw e;
    }
  });
}

/**
 * Movie download — the FAST path for `.movie`:
 *   1) disk-cache hit  -> instant resend of an already-fetched film
 *   2) search the top candidates (a plain "ytsearch1:" often lands on a trailer)
 *   3) for the best candidate, run the direct yt-dlp download and, if it is slow
 *      or fails, a public mirror in PARALLEL — whichever finishes first wins
 *   4) cache the result so the next `.movie <same>` is instant
 * Never returns audio (movies must not silently become an MP3).
 */
async function downloadMovie(query, opts = {}) {
  const q = String(query).trim();
  const key = q + (opts.maxHeight ? `@${opts.maxHeight}` : '');
  const hit = dlcache.get('movie', key);
  if (hit) return hit;
  return dlcache.dedupe('movie:' + key.toLowerCase(), async () => {
    const again = dlcache.get('movie', key);
    if (again) return again;
    let candidates = [];
    try { candidates = (await search(`${q} full movie`, 5)).map((r) => r.url).filter(Boolean); } catch { /* ignore */ }
    candidates.push(`${q} full movie`, q);
    const list = candidates.slice(0, 4);
    // A 720p film is 0.5-2.5GB — at server bandwidth that can need 5-10 minutes.
    // The old 240s cap killed the download MID-FLIGHT, which is exactly the
    // ".movie input leta hy, output nahi aata" complaint.
    const movieOpts = { ...opts, timeoutMs: 900000 };
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      try {
        // Best candidate: race direct vs mirror (hedged). Fallbacks: direct only.
        const file = i === 0
          ? await hedgedFirst(
              downloadVideo(c, movieOpts),
              () => downloadViaMirror(c, movieOpts).then((f) => { if (!f) throw new Error('mirror failed'); return f; }),
              MOVIE_HEDGE_MS,
            )
          : await downloadVideo(c, movieOpts);
        if (file) return dlcache.put('movie', key, file);
      } catch { /* try the next candidate */ }
    }
    // Last resort: the smart path (mirror + no-audio) for a plain query.
    const alt = await downloadVideoSmart(`${q} full movie`, { ...opts, allowAudio: false }).catch(() => null);
    if (alt && alt.file && !alt.audio) return dlcache.put('movie', key, alt.file);
    throw new Error('movie download failed');
  });
}

/**
 * Song audio via Dailymotion when YouTube AND SoundCloud both refuse:
 * search DM's public JSON API, download the best video's audio as MP3.
 * Returns a local file path, or null when nothing worked.
 */
async function downloadAudioViaDailymotion(query) {
  try {
    const s = String(query || '').trim();
    if (isUrl(s) || /^(ytsearch|scsearch)\d*:/i.test(s)) return null;
    const api = await fetch(`https://api.dailymotion.com/videos?search=${encodeURIComponent(s)}&limit=3&sort=relevance&fields=id`, { signal: AbortSignal.timeout(8000) });
    if (!api.ok) return null;
    const j = await api.json();
    const ids = (j.list || []).map((v) => v && v.id).filter(Boolean);
    for (const id of ids) {
      try {
        const base = newBase();
        await run(['--no-warnings', '--no-playlist', '-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', `${base}.%(ext)s`, `https://www.dailymotion.com/video/${id}`], 180000);
        const f = findFile(base);
        if (f) return f;
      } catch { /* try the next result */ }
    }
    return null;
  } catch { return null; }
}

/**
 * Try Dailymotion when YouTube refuses us — a completely independent video
 * source, no API key, no cookies. Search goes through Dailymotion's public
 * JSON API, the download through yt-dlp's dailymotion extractor.
 * Returns a local file path, or null when nothing worked.
 */
async function downloadViaDailymotion(input, opts = {}) {
  const maxH = Number(opts.maxHeight) > 0 ? Number(opts.maxHeight) : 480;
  try {
    const s = String(input).trim();
    if (isUrl(s)) return null;                       // a YouTube URL is only on YouTube
    const api = await fetch(`https://api.dailymotion.com/videos?search=${encodeURIComponent(s)}&limit=3&sort=relevance&fields=id`, { signal: AbortSignal.timeout(8000) });
    if (!api.ok) return null;
    const j = await api.json();
    const ids = (j.list || []).map((v) => v && v.id).filter(Boolean);
    if (!ids.length) return null;
    for (const id of ids) {
      try {
        const base = newBase();
        await run(['--no-warnings', '--no-playlist', '-f', `b[height<=${maxH}]/b`, '--merge-output-format', 'mp4', '-o', `${base}.%(ext)s`, `https://www.dailymotion.com/video/${id}`], 180000);
        const f = findFile(base);
        if (f) return await toPlayableMp4(f);
      } catch { /* try the next result */ }
    }
    return null;
  } catch { return null; }
}

/**
 * Try public YouTube front-ends (Invidious / Piped) when YouTube itself refuses
 * our IP. These are free community mirrors — no API key, no cost.
 * Returns a local file path, or null when nothing worked.
 */
const MIRRORS = [
  // Only mirrors whose /api/v1/videos API actually answered on Oct 17 —
  // nadeko/nerdvpn/yewtu.be/kavin.rocks all 403/401/526 now, and every dead
  // entry costs the user 12s of waiting before the SoundCloud fallback fires.
  'https://invidious.f5.si',
];

async function downloadViaMirror(input, opts = {}) {
  const maxH = Number(opts.maxHeight) > 0 ? Number(opts.maxHeight) : 480;
  let videoId = null;
  const s = String(input).trim();
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  if (m) videoId = m[1];
  // Resolve a plain search query to a video id via the first mirror that answers.
  for (const base of MIRRORS) {
    try {
      if (!videoId) {
        const r = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(s)}&type=video`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = await r.json();
        const first = Array.isArray(j) ? j.find((x) => x && (x.videoId || x.url)) : null;
        if (!first) continue;
        videoId = first.videoId || String(first.url || '').replace(/^\/watch\?v=/, '');
      }
      if (!videoId) continue;
      const streams = await fetch(`${base}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(10000) });
      if (!streams.ok) continue;
      const info = await streams.json();
      // Invidious -> formatStreams (muxed audio+video). Piped -> videoStreams.
      const list = [...(info.formatStreams || []), ...(info.videoStreams || [])].filter((f) => f && f.url);
      const heightOf = (f) => {
        const res = String(f.resolution || f.qualityLabel || f.quality || '');
        const n = parseInt(res, 10);
        return Number.isFinite(n) ? n : 0;
      };
      // Prefer the best quality that is still <= the requested cap (720p for
      // movies); fall back to the highest available if nothing fits.
      const under = list.filter((f) => heightOf(f) && heightOf(f) <= maxH).sort((a, b) => heightOf(b) - heightOf(a));
      const fmt = under[0] || list.sort((a, b) => heightOf(b) - heightOf(a))[0];
      if (!fmt || !fmt.url) continue;
      const file = path.join(TMP, `${videoId}.mp4`);
      const dl = await fetch(fmt.url, { signal: AbortSignal.timeout(180000) });
      if (!dl.ok) continue;
      const buf = Buffer.from(await dl.arrayBuffer());
      if (buf.length < 20000) continue;           // too small = not a real video
      fs.mkdirSync(TMP, { recursive: true });
      fs.writeFileSync(file, buf);
      return await toPlayableMp4(file);
    } catch { /* try the next mirror */ }
  }
  return null;
}

/** Best-effort cleanup of stale temp files. */
function cleanup(maxAgeMs = 30 * 60 * 1000) {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(TMP)) {
      const p = path.join(TMP, f);
      try { if (now - fs.statSync(p).mtimeMs > maxAgeMs) fs.unlinkSync(p); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  // Also enforce the download-cache TTL + size cap.
  try { dlcache.sweep(); } catch { /* ignore */ }
}

module.exports = { available: () => !!ytdlpPath(), info, search, downloadAudio, downloadVideo, downloadAudioSmart, downloadVideoSmart, downloadMovie, resolveUrl, isUrl, cleanup, hedgedFirst };
