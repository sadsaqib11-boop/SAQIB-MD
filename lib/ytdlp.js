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

const TMP = path.join(process.env.TMP_DIR || os.tmpdir(), 'saqib-dl');

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
    let text = raw;
    if (!text.includes('\n')) {
      text = text
        .replace(/\s+(#\s*(?:Netscape|https?))/g, '\n$1')
        .replace(/([^\n])\s+(?=\.?[\w.-]+\.(?:youtube|google|googlevideo|vellum)[\w.]*\t)/g, '$1\n');
    }
    // Drop junk lines that are not real cookie records — a malformed line makes
    // yt-dlp abort the whole download.
    const lines = text.split('\n').filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (t.startsWith('#')) return true;
      const parts = t.split('\t');
      if (parts.length < 7) return false;
      return !/vellum/i.test(t);
    });
    const cookies = lines.filter((l) => l && !l.trim().startsWith('#'));
    if (cookies.length < 1) return null;   // nothing usable — fall back to no cookies
    fs.writeFileSync(COOKIE_FILE, lines.join('\n') + '\n');
    return COOKIE_FILE;
  } catch { return null; }
}

/** yt-dlp args that apply to every call (cookies + a sane user agent). */
function commonArgs() {
  const out = ['--no-warnings'];
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

/** Download audio as MP3, return file path. Accepts URL or search query. */
async function downloadAudio(input) {
  const base = newBase();
  await run([...commonArgs(), '--no-playlist', '-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', `${base}.%(ext)s`, asInput(input)], 180000);
  return findFile(base);
}

/** Download video as MP4. Tries several player clients before giving up. */
async function downloadVideo(input) {
  const base = newBase();
  const src = asInput(input);
  // YouTube increasingly blocks datacenter IPs. Different player clients behave
  // differently, so we try a few before declaring failure. Cookies (when
  // present) are added by commonArgs().
  const attempts = [
    ['-f', 'bv*[height<=480]+ba/b[height<=480]/b'],
    ['-f', 'b[height<=720]/b', '--extractor-args', 'youtube:player_client=android'],
    ['-f', 'b[height<=720]/b', '--extractor-args', 'youtube:player_client=ios'],
    ['-f', 'b', '--extractor-args', 'youtube:player_client=web_safari'],
    ['-f', 'b', '--extractor-args', 'youtube:player_client=tv'],
    ['-f', 'b', '--extractor-args', 'youtube:player_client=mweb'],
    // Newer yt-dlp builds need the JS runtime flag for the tv/web clients.
    ['-f', 'b', '--extractor-args', 'youtube:player_client=web_embedded'],
  ];
  let lastErr = null;
  for (const extra of attempts) {
    try {
      await run([...commonArgs(), '--no-playlist', ...extra, '--merge-output-format', 'mp4', '-o', `${base}.%(ext)s`, src], 240000);
      return findFile(base);
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

/**
 * Audio download with a SoundCloud fallback.
 * YouTube blocks many datacenter IPs ("Sign in to confirm you're not a bot"),
 * so when a plain query fails on YouTube we retry it on SoundCloud.
 */
async function downloadAudioSmart(input) {
  try {
    return await downloadAudio(input);
  } catch (e) {
    if (!isUrl(input)) {
      try { return await downloadAudio(`scsearch1:${String(input).trim()}`); } catch { /* fall through */ }
    }
    throw e;
  }
}

/**
 * Video download. YouTube blocks many datacenter IPs ("Sign in to confirm
 * you're not a bot") — the cookies in config.YT_COOKIES fix most of that.
 * If YouTube still refuses, we report `audio: true` so the caller can be
 * honest with the user instead of silently sending an MP3 when they asked for
 * a video.
 */
async function downloadVideoSmart(input) {
  try {
    return { file: await downloadVideo(input), audio: false };
  } catch (e) {
    // YouTube blocks datacenter IPs even with cookies sometimes. Before giving
    // up, retry through a public Invidious/Piped mirror — those serve the same
    // video from their own IPs, so the block does not apply to us. Free, no key.
    const mirrored = await downloadViaMirror(input);
    if (mirrored) return { file: mirrored, audio: false };
    // Last resort for a plain query: SoundCloud audio (flagged as audio).
    if (!isUrl(input)) {
      try { return { file: await downloadAudio(`scsearch1:${String(input).trim()}`), audio: true }; } catch { /* fall through */ }
    }
    throw e;
  }
}

/**
 * Try public YouTube front-ends (Invidious / Piped) when YouTube itself refuses
 * our IP. These are free community mirrors — no API key, no cost.
 * Returns a local file path, or null when nothing worked.
 */
const MIRRORS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.f5.si',
  'https://pipedapi.kavin.rocks',
];

async function downloadViaMirror(input) {
  let videoId = null;
  const s = String(input).trim();
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  if (m) videoId = m[1];
  // Resolve a plain search query to a video id via the first mirror that answers.
  for (const base of MIRRORS) {
    try {
      if (!videoId) {
        const r = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(s)}&type=video`, { signal: AbortSignal.timeout(12000) });
        if (!r.ok) continue;
        const j = await r.json();
        const first = Array.isArray(j) ? j.find((x) => x && (x.videoId || x.url)) : null;
        if (!first) continue;
        videoId = first.videoId || String(first.url || '').replace(/^\/watch\?v=/, '');
      }
      if (!videoId) continue;
      const streams = await fetch(`${base}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(15000) });
      if (!streams.ok) continue;
      const info = await streams.json();
      const fmt = (info.formatStreams || []).filter((f) => f && f.url).pop();
      if (!fmt || !fmt.url) continue;
      const file = path.join(TMP, `${videoId}.mp4`);
      const dl = await fetch(fmt.url, { signal: AbortSignal.timeout(90000) });
      if (!dl.ok) continue;
      const buf = Buffer.from(await dl.arrayBuffer());
      if (buf.length < 20000) continue;           // too small = not a real video
      fs.mkdirSync(TMP, { recursive: true });
      fs.writeFileSync(file, buf);
      return file;
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
}

module.exports = { available: () => !!ytdlpPath(), info, downloadAudio, downloadVideo, downloadAudioSmart, downloadVideoSmart, resolveUrl, isUrl, cleanup };
