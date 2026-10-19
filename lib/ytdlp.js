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
const debug = require('./debug');

const TMP = path.join(process.env.TMP_DIR || os.tmpdir(), 'saqib-dl');

// How many parallel fragment connections yt-dlp may use. YouTube serves DASH
// streams in fragments; pulling several at once is a big, bandwidth-neutral
// speed-up (same bytes, more connections). Overridable via env.
const FRAGMENTS = Math.max(1, parseInt(process.env.YTDLP_FRAGMENTS || '16', 10));
// When a movie download is still going after this long we start a mirror
// download in PARALLEL and take whichever finishes first (hedged request).
// 8s (was 20s, then 12s): the mirror lane is cheap, so we launch it almost
// immediately and let the two lanes race for the whole download.
const MOVIE_HEDGE_MS = parseInt(process.env.MOVIE_HEDGE_MS || '8000', 10);

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

// SPEED: aria2c downloads with 16 parallel connections where installed (the
// Docker image ships it). Fallback = yt-dlp's native single-thread downloader.
let _ariaChecked = false;
let _aria = false;
function ariaArgs() {
  if (!_ariaChecked) { _aria = !!which('aria2c'); _ariaChecked = true; }
  return _aria ? ['--downloader', 'aria2c', '--downloader-args', 'aria2c:-x 16 -s 16 -k 4M --max-connection-per-server=16 --max-overall-download-limit=0 --file-allocation=none'] : [];
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

/** Fast multi-result search (flat playlist) — returns [{title, url, channel}]. */
async function search(input, n = 5) {
  const token = isUrl(input) ? input : `ytsearch${n}:${String(input).trim()}`;
  const out = await run([...commonArgs(), '--skip-download', '--no-warnings', '--flat-playlist', '--print', '%(title)s\t%(webpage_url)s\t%(duration)s\t%(view_count)s\t%(channel)s', token], 60000);
  const num = (s) => { const v = Number(s); return Number.isFinite(v) && v > 0 ? v : null; };
  return out.trim().split('\n').filter(Boolean).map((line) => {
    const p = line.split('\t');
    return { title: p[0] || '', url: p[1] || '', duration: num(p[2]), views: num(p[3]), channel: p[4] || '' };
  }).filter((r) => r.url);
}

/**
 * RELEVANCE SCORING — YouTube's own order is good but not perfect: a cover,
 * a "slowed + reverb" edit or a random reaction can outrank the real track.
 * This scores each result against the typed query so the CORRECT item lands at
 * the top of the `.song` list. Word matches in the title weigh most, the
 * channel name a little, noise words (cover / remix / trailer / recap …) are
 * penalised unless the user actually asked for them, and view count breaks
 * ties (log-scaled, so a 1B-view hit doesn't bury everything else).
 */
function relevanceScore(query, r) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(query);
  const words = q.split(' ').filter((w) => w.length >= 2);
  const title = norm(r.title);
  const chan = norm(r.channel);
  const phrase = q;
  let score = 0;
  for (const w of words) {
    if (title.includes(w)) score += 12;
    if (chan.includes(w)) score += 4;
  }
  if (phrase && title.includes(phrase)) score += 30;          // exact phrase
  if (title.startsWith(phrase)) score += 10;                   // title begins with query
  if (/(topic|official|vevo|records|music|t-series|sony|zee|tips)/.test(chan)) score += 8;
  if (/\b(audio|lyrical|lyrics|official|full)\b/.test(title)) score += 4;
  const noise = ['cover', 'remix', 'slowed', 'reverb', '8d', 'mashup', 'instrumental', 'karaoke',
    'ringtone', 'reaction', 'teaser', 'trailer', 'recap', 'behind the scenes', 'interview', 'making',
    'dance', 'shorts', 'status', 'whatsapp status', 'loop'];
  for (const n of noise) {
    if (title.includes(n) && !phrase.includes(n)) score -= 18;
  }
  if (r.views) score += Math.log10(r.views + 1) * 1.5;
  return score;
}

/** Search, then re-rank by RELEVANCE (best match first). */
async function searchRanked(query, n = 6) {
  const raw = await search(query, Math.max(n, 10));
  return raw.slice().sort((a, b) => relevanceScore(query, b) - relevanceScore(query, a)).slice(0, n);
}

/* -------------------- FAST HTTP YouTube search (no yt-dlp spawn) -------------------- */
// Spawning yt-dlp for every search costs ~1s of process start-up + network.
// YouTube's own results page carries the SAME data in embedded JSON, so ONE
// HTTP GET (~0.5s) answers a search. Used to make `.movie` / `.song` snappy;
// the yt-dlp flat search stays as the reliability fallback (raced, first wins).
const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** Pull every top-level JSON object that follows `"key":` in an HTML blob. */
function extractJsonObjects(html, key) {
  const out = [];
  const marker = `"${key}":`;
  let idx = 0;
  while (out.length < 60) {
    const at = html.indexOf(marker, idx);
    if (at < 0) break;
    let i = at + marker.length;
    while (i < html.length && html[i] !== '{') i++;
    if (i >= html.length) break;
    let depth = 0, inStr = false, esc = false;
    const start = i;
    for (; i < html.length; i++) {
      const c = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    try { out.push(JSON.parse(html.slice(start, i))); } catch { /* skip malformed */ }
    idx = i;
  }
  return out;
}

const parseDurText = (s) => {
  const p = String(s || '').split(':').map((x) => parseInt(x, 10) || 0);
  if (!p.length) return null;
  return p.reduce((a, b) => a * 60 + b, 0) || null;
};
const parseViewsText = (s) => {
  const m = String(s || '').replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[String(m[2] || '').toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult) || null;
};

/** Fast YouTube search via the results page (no yt-dlp). Returns [{title,url,videoId,channel,duration,views}]. */
async function httpSearch(query, n = 10) {
  const s = String(query || '').trim();
  if (!s) return [];
  // sp=EgIQAQ%3D%3D -> "video" filter (drops channels/playlists from the list)
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(s)}&sp=EgIQAQ%253D%253D&hl=en`;
  const res = await fetch(url, { headers: { 'User-Agent': YT_UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error('search HTTP ' + res.status);
  const html = await res.text();
  const out = [];
  for (const vr of extractJsonObjects(html, 'videoRenderer')) {
    const videoId = vr.videoId;
    if (!videoId) continue;
    out.push({
      title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || '',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      channel: vr.ownerText?.runs?.[0]?.text || vr.longBylineText?.runs?.[0]?.text || '',
      duration: parseDurText(vr.lengthText?.simpleText),
      views: parseViewsText(vr.viewCountText?.simpleText),
    });
    if (out.length >= n) break;
  }
  return out;
}

/** Fast search + relevance ranking. */
async function searchRankedFast(query, n = 6) {
  const raw = await httpSearch(query, Math.max(n, 10));
  return raw.slice().sort((a, b) => relevanceScore(query, b) - relevanceScore(query, a)).slice(0, n);
}

/**
 * FAST + RELIABLE search: race the HTTP search (fast) against the yt-dlp flat
 * search (reliable). The first NON-EMPTY list wins, then it is relevance-ranked.
 * If one path errors, the other still answers \u2014 so a YouTube page change can
 * never leave `.song`/`.movie` with nothing.
 */
async function searchRankedRace(query, n = 6) {
  const want = Math.max(n, 10);
  const rank = (raw) => raw.slice().sort((a, b) => relevanceScore(query, b) - relevanceScore(query, a)).slice(0, n);
  const httpP = httpSearch(query, want).then((r) => { if (!r.length) throw new Error('http empty'); return r; });
  const ytP = () => search(query, want).then((r) => { if (!r.length) throw new Error('yt empty'); return r; });
  try {
    // HEDGED: the HTTP search normally answers in ~0.5s, so the yt-dlp process
    // is only spawned if the HTTP path is slow (>1.5s) or fails \u2014 no wasted CPU.
    return rank(await hedgedFirst(httpP, ytP, 1500));
  } catch {
    return [];
  }
}

/** Download audio as MP3, return file path. Accepts URL or search query. */
async function downloadAudio(input) {
  const base = newBase();
  await run([...commonArgs(), '--no-playlist', ...ariaArgs(), '-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', `${base}.%(ext)s`, asInput(input)], 180000);
  // GUARD: findFile() returning null used to flow straight into fs.statSync()
  // downstream ("path argument must be of type string received null"). Fail
  // HERE, with a message the race can act on, instead of crashing the sender.
  const f = findFile(base);
  if (!f) throw new Error('audio file missing after download (source blocked?)');
  return f;
}

/**
 * Download audio as a NATIVE m4a (AAC) — NO mp3 re-encode.
 * The old `.song` path ran every track through ffmpeg's libmp3lame encoder
 * (`-x --audio-format mp3`), which added several seconds per song for zero
 * quality gain. YouTube already serves AAC-in-m4a, so we grab that container
 * directly and hand it to WhatsApp as-is (mimetype audio/mp4). Only if the
 * source is a non-AAC container (webm/opus) do we remux/convert to m4a.
 * Accepts a URL or a plain search query.
 */
async function downloadAudioNative(input) {
  const base = newBase();
  // Prefer the m4a audio-only stream; fall back to any audio-only, then best.
  await run([...commonArgs(), '--no-playlist', ...ariaArgs(), '-f', 'ba[ext=m4a]/ba[ext=mp4]/ba/b', '-o', `${base}.%(ext)s`, asInput(input)], 180000);
  let f = findFile(base);
  if (!f) throw new Error('audio file missing after download (source blocked?)');
  if (!/\.m4a$/i.test(f)) {
    // Not already m4a (webm/opus) — convert ONCE so WhatsApp plays it.
    const out = f.replace(/\.[^.]+$/, '') + '.m4a';
    if (await ffmpeg(['-y', '-i', f, '-vn', '-c:a', 'aac', '-b:a', '128k', out], 180000)) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
      f = out;
    }
  }
  return f;
}

/**
 * FAST + RELEVANT audio for `.song`: resolve a plain query to the TOP-RANKED
 * YouTube result (so the right track wins), then download it as native m4a.
 * If YouTube refuses (datacenter-IP block), fall back to the multi-lane smart
 * path so the user still gets audio. Cached, so a repeat is instant.
 */
async function downloadAudioNativeSmart(input, extraLanes = []) {
  const key = String(input).trim();
  const ck = key + '|m4a';
  const hit = dlcache.get('audio', ck);
  if (hit) return hit;
  return dlcache.dedupe('audio-m4a:' + key.toLowerCase(), async () => {
    const again = dlcache.get('audio', ck);
    if (again) return again;
    let target = key;
    if (!isUrl(key) && !/^(ytsearch|scsearch)\d*:/i.test(key)) {
      try {
        const list = await searchRanked(key, 5);
        if (list[0] && list[0].url) target = list[0].url;
      } catch { /* fall back to a plain ytsearch */ }
    }
    try {
      const f = await downloadAudioNative(target);
      if (f && fs.existsSync(f)) return dlcache.put('audio', ck, f);
    } catch { /* fall through to the alternate lanes */ }
    // Native m4a refused (YouTube datacenter-IP block) → try the extra lanes
    // (e.g. TikTok) natively, then the full multi-lane smart path.
    for (const lane of extraLanes) {
      try {
        const f = await lane();
        if (f && fs.existsSync(f)) return dlcache.put('audio', ck, f);
      } catch { /* next lane */ }
    }
    return downloadAudioSmart(input, extraLanes);
  });
}

/**
 * DIRECT stream URLs for the best format at or below `maxHeight`.
 * Returns 1 URL (a muxed video+audio stream) or 2 URLs (separate video and
 * audio streams that the caller muxes). Used by the `.movie` download-link
 * endpoint: yt-dlp resolves the googlevideo URLs on the SERVER (so YouTube's
 * datacenter-IP lock is satisfied) and ffmpeg then pipes the bytes to the user.
 */
async function getStreamUrls(input, maxHeight = 720) {
  const h = Number(maxHeight) > 0 ? Number(maxHeight) : 720;
  const fmt = `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}][ext=mp4]/b[height<=${h}]/bv*[height<=${h}]+ba/b[height<=${h}]/b`;
  const out = await run([...commonArgs(), '--no-playlist', '--no-warnings', '-f', fmt, '-g', asInput(input)], 60000);
  return out.trim().split('\n').map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
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
      await run([...commonArgs(), '--no-playlist', ...extra, ...ariaArgs(), '--merge-output-format', 'mp4', '-o', `${base}.%(ext)s`, src], opts.timeoutMs || 900000);
      const f = findFile(base);
      if (!f) throw new Error('video file missing after download');
      return await toPlayableMp4(f);
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

/** Convert any audio/video file to MP3 (for lanes that deliver raw streams —
 * mirror audio, JioSaavn m4a). Returns the mp3 path, or the original on fail. */
async function toMp3(srcFile) {
  try {
    if (!srcFile || !fs.existsSync(srcFile)) return srcFile;
    if (/\.mp3$/i.test(srcFile)) return srcFile;
    const out = srcFile.replace(/\.[^.]+$/, '') + '.mp3';
    if (await ffmpeg(['-y', '-i', srcFile, '-vn', '-c:a', 'libmp3lame', '-q:a', '5', out], 120000)) {
      try { fs.unlinkSync(srcFile); } catch { /* ignore */ }
      return out;
    }
    return srcFile;
  } catch { return srcFile; }
}

/** AUDIO lane: YouTube search + stream fetch through a public Invidious/Piped
 * mirror — the mirror's IP does the fetching, so YouTube's datacenter-IP block
 * ("Sign in to confirm you're not a bot") never applies. Returns mp3 or null. */
async function downloadAudioViaMirror(query) {
  try {
    const s = String(query || '').trim();
    if (isUrl(s) || /^(ytsearch|scsearch)\d*:/i.test(s)) return null;
    for (const base of MIRRORS) {
      const r = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(s)}&type=video`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      for (const it of (Array.isArray(j) ? j : []).slice(0, 3)) {
        const vid = it?.videoId || String(it?.url || '').replace(/^\/watch\?v=/, '');
        if (!vid) continue;
        try {
          const streams = await fetch(`${base}/api/v1/videos/${vid}`, { signal: AbortSignal.timeout(10000) });
          if (!streams.ok) continue;
          const info = await streams.json();
          // Piped exposes audioStreams; Invidious exposes adaptiveFormats with
          // audio-only entries — accept both shapes.
          const aud = [...(info.audioStreams || []), ...((info.adaptiveFormats || []).filter((f) => String(f?.type || f?.mimeType || '').startsWith('audio')))]
            .filter((f) => f && f.url && !f.url.includes(' Range:'))
            .sort((a, b) => (parseInt(b.bitrate, 10) || 0) - (parseInt(a.bitrate, 10) || 0))[0];
          if (!aud) continue;
          const dl = await fetch(aud.url, { signal: AbortSignal.timeout(180000) });
          if (!dl.ok) continue;
          const buf = Buffer.from(await dl.arrayBuffer());
          if (buf.length < 20000) continue; // too small = not a real track
          const file = path.join(TMP, `mir-${vid}.m4a`);
          fs.mkdirSync(TMP, { recursive: true });
          fs.writeFileSync(file, buf);
          const mp3 = await toMp3(file);
          if (mp3 && /\.mp3$/i.test(mp3)) return mp3;
        } catch { /* next candidate */ }
      }
    }
    return null;
  } catch { return null; }
}

/** AUDIO lane: JioSaavn DIRECT (official keyless web API + the known media
 * URL decryption) — an independent music catalog that is STRONG on
 * Bollywood/Pakistani/Indian-pop songs, i.e. most of what users here ask for.
 * Returns mp3 or null. (The old saavn.dev public API is dead — DNS gone.) */
async function downloadAudioViaSaavn(query) {
  try {
    const s = String(query || '').trim();
    if (isUrl(s) || /^(ytsearch|scsearch)\d*:/i.test(s)) return null;
    const api = 'https://www.jiosaavn.com/api.php?__call=search.getResults&q=&_format=json&_marker=0&api_version=3&ctx=web6dot0&n=3';
    const r = await fetch(api.slice(0, -1) + encodeURIComponent(s), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const songs = (Array.isArray(j?.results) ? j.results : []).filter(Boolean).slice(0, 3);
    for (const song of songs) {
      try {
        // search.getResults (v3) puts fields at the top level; other endpoints
        // nest them under more_info — accept both shapes.
        const mi = song.more_info || {};
        const enc = song.encrypted_media_url || mi.encrypted_media_url;
        if (!enc) continue;
        const d = require('crypto').createDecipheriv('des-ecb', Buffer.from('38346591'), Buffer.alloc(0));
        d.setAutoPadding(true);
        let url = Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
        if (!/^https?:\/\//.test(url)) continue;
        // _96 suffix = 96kbps; upgrade to _320 when the track offers it.
        if (song['320kbps'] === 'true' || song['320kbps'] === true || mi['320kbps'] === 'true' || mi['320kbps'] === true) url = url.replace('_96.', '_320.');
        const dl = await fetch(url, { signal: AbortSignal.timeout(180000) });
        if (!dl.ok) continue;
        const buf = Buffer.from(await dl.arrayBuffer());
        if (buf.length < 20000) continue;
        const safeId = String(song.id || Date.now()).replace(/[^\w-]/g, '');
        const file = path.join(TMP, `saavn-${safeId}.m4a`);
        fs.mkdirSync(TMP, { recursive: true });
        fs.writeFileSync(file, buf);
        const mp3 = await toMp3(file);
        if (mp3 && /\.mp3$/i.test(mp3)) return mp3;
      } catch { /* next song */ }
    }
    return null;
  } catch { return null; }
}

/**
 * Audio download that does NOT depend on YouTube alone. For a plain query,
 * YouTube and SoundCloud RACE in parallel and whichever delivers first wins —
 * a YouTube CDN block can no longer stall or kill a song download.
 * Phase 3: the finished file is cached on disk, so asking for the SAME song
 * again is instant (no network at all).
 */
async function downloadAudioSmart(input, extraLanes = []) {
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
      // RACE: ALL lanes in parallel, first to deliver wins: YouTube,
      // SoundCloud, Dailymotion, Invidious/Piped mirror (audio stream straight
      // from the mirror — no YouTube block applies), JioSaavn (official API,
      // strong on desi songs), plus any caller-supplied lane (TikTok audio).
      // Every lane logs its duration to /api/debug — slowness is MEASURED.
      const timed = (label, p) => {
        const t = Date.now();
        return p.then((v) => { debug.info('[SONG] lane win/fail', { lane: label, seconds: Math.round((Date.now() - t) / 1000), ok: !!v }); return v; })
          .catch((e) => { debug.info('[SONG] lane fail', { lane: label, seconds: Math.round((Date.now() - t) / 1000) }); throw e; });
      };
      const yt = timed('youtube', downloadAudio(`ytsearch1:${key}`));
      const sc = timed('soundcloud', downloadAudio(`scsearch1:${key}`));
      // dm/mir/saavn resolve to null when a lane comes up empty — they must
      // REJECT, or firstOk() would treat the first null as victory and hand
      // back nothing while a real lane was still downloading.
      const nonNull = (p) => p.then((v) => { if (!v) throw new Error('lane came up empty'); return v; });
      const dm = timed('dailymotion', nonNull(downloadAudioViaDailymotion(key)));
      const mir = timed('mirror', nonNull(downloadAudioViaMirror(key)));
      const saavn = timed('jiosaavn', nonNull(downloadAudioViaSaavn(key)));
      const extra = (extraLanes || []).map((fn, i) => timed('extra' + i, Promise.resolve().then(fn)));
      const all = [yt, sc, dm, mir, saavn, ...extra];
      file = await firstOk(all).finally(() => { for (const p of all) p.catch(() => {}); });
    }
    if (!file || !fs.existsSync(file)) throw new Error('no source could provide the audio');
    return dlcache.put('audio', key, file);
  });
}

/** Download a CONCRETE URL (e.g. a TikTok clip) as MP3 — used by the
 * caller-supplied TikTok lane in the .song race. */
async function downloadAudioByUrl(url) {
  const base = newBase();
  await run([...commonArgs(), '--no-warnings', '--no-playlist', ...ariaArgs(), '-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', `${base}.%(ext)s`, String(url)], 180000);
  const f = findFile(base);
  if (!f) throw new Error('audio file missing after download');
  return f;
}

/** Download a CONCRETE URL (e.g. a TikTok clip) as a playable MP4 video. */
async function downloadVideoByUrl(url, opts = {}) {
  const base = newBase();
  await run([...commonArgs(), '--no-warnings', '--no-playlist', ...ariaArgs(), '-f', `b[height<=${Number(opts.maxHeight) > 0 ? Number(opts.maxHeight) : 480}]/b`, '--merge-output-format', 'mp4', '-o', `${base}.%(ext)s`, String(url)], opts.timeoutMs || 300000);
  const f = findFile(base);
  if (!f) throw new Error('video file missing after download');
  return toPlayableMp4(f);
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
async function downloadVideoSmart(input, opts = {}, extraLanes = []) {
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
      // giving up: caller-supplied lanes (TikTok), then DAILYMOTION (a fully
      // independent video source), then a public Invidious/Piped mirror, then
      // SoundCloud audio.
      for (const fn of (extraLanes || [])) {
        try {
          const f = await Promise.resolve().then(fn);
          if (f && fs.existsSync(f)) return { file: dlcache.put('video', key, f), audio: false };
        } catch { /* next lane */ }
      }
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
    // PK FIRST: Urdu/Hindi print variants get their own slots — a plain English
    // search often buries the actual film under recaps and trailers.
    candidates.push(`${q} full movie`, `${q} full movie hindi`, `${q} full movie urdu`, q);
    const list = candidates.slice(0, 6);
    // A 720p film is 0.5-2.5GB — at server bandwidth that can need 5-10 minutes.
    // The old 240s cap killed the download MID-FLIGHT, which is exactly the
    // ".movie input leta hy, output nahi aata" complaint. 30min now: a full
    // 1080p/5GB film on a slow lane still finishes.
    const movieOpts = { ...opts, timeoutMs: 1800000 };
    // ULTRA FAST: the TOP TWO candidates download in PARALLEL, each one hedged
    // direct-vs-mirror — four lanes race, first file wins. (Memory guard: two
    // yt-dlp children only spawn when RSS has headroom; otherwise the old
    // sequential path runs.)
    const tryCand = (c, hedge) => (hedge
      ? hedgedFirst(
          downloadVideo(c, movieOpts),
          () => downloadViaMirror(c, movieOpts).then((f) => { if (!f) throw new Error('mirror failed'); return f; }),
          MOVIE_HEDGE_MS,
        )
      : downloadVideo(c, movieOpts));
    const memOk = process.memoryUsage().rss < 280 * 1048576;
    const head = memOk ? list.slice(0, 2) : list.slice(0, 1);
    const tail = list.slice(head.length);
    try {
      const file = await firstOk(head.map((c) => tryCand(c, true)));
      if (file) return dlcache.put('movie', key, file);
    } catch { /* fall through to the remaining candidates */ }
    for (const c of tail) {
      try {
        const file = await tryCand(c, false);
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
        await run(['--no-warnings', '--no-playlist', ...ariaArgs(), '-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', `${base}.%(ext)s`, `https://www.dailymotion.com/video/${id}`], 180000);
        const f = findFile(base);
        if (f) return f;
      } catch { /* try the next result */ }
    }
    return null;
  } catch { return null; }
}

/**
 * YouTube search + download via the public mirrors — the .tts backfill when
 * TikTok scraping comes up short. Bypasses YouTube's datacenter-IP block
 * entirely (the mirror does the fetching). Returns [{file, title}].
 */
async function searchViaMirror(query, n = 5, opts = {}) {
  const out = [];
  for (const base of MIRRORS) {
    try {
      const r = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const items = (Array.isArray(j) ? j : []).filter((x) => x && (x.videoId || x.url)).slice(0, n * 3);
      for (const it of items) {
        if (out.length >= n) break;
        const vid = it.videoId || String(it.url || '').replace(/^\/watch\?v=/, '');
        if (!vid) continue;
        try {
          const f = await downloadViaMirror(`https://youtu.be/${vid}`, opts);
          if (f) out.push({ file: f, title: it.title || '' });
        } catch { /* next candidate */ }
      }
      if (out.length) return out;
    } catch { /* next mirror */ }
  }
  return out;
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
    const api = await fetch(`https://api.dailymotion.com/videos?search=${encodeURIComponent(s)}&limit=5&sort=relevance&fields=id`, { signal: AbortSignal.timeout(8000) });
    if (!api.ok) return null;
    const j = await api.json();
    const ids = (j.list || []).map((v) => v && v.id).filter(Boolean);
    if (!ids.length) return null;
    for (const id of ids) {
      try {
        const base = newBase();
        await run(['--no-warnings', '--no-playlist', ...ariaArgs(), '-f', `b[height<=${maxH}]/b`, '--merge-output-format', 'mp4', '-o', `${base}.%(ext)s`, `https://www.dailymotion.com/video/${id}`], 300000);
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

module.exports = { available: () => !!ytdlpPath(), info, search, searchRanked, searchRankedFast, searchRankedRace, httpSearch, relevanceScore, downloadAudio, downloadAudioNative, downloadAudioNativeSmart, downloadAudioByUrl, downloadVideo, downloadVideoByUrl, downloadAudioSmart, downloadVideoSmart, downloadMovie, resolveUrl, isUrl, getStreamUrls, cleanup, hedgedFirst, searchViaMirror };
