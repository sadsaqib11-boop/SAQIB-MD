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

const TMP = path.join(process.env.TMP_DIR || os.tmpdir(), 'saqib-dl');

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
  const out = await run(['--no-warnings', '--skip-download', '--no-playlist', '--print', '%(title)s\t%(duration)s\t%(thumbnail)s', asInput(input)], 60000);
  const [title, duration, thumbnail] = out.trim().split('\t');
  return { title: title || '', duration: Number(duration) || 0, thumbnail: thumbnail || '' };
}

/** Download audio as MP3, return file path. Accepts URL or search query. */
async function downloadAudio(input) {
  const base = newBase();
  await run(['--no-warnings', '--no-playlist', '-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', `${base}.%(ext)s`, asInput(input)], 180000);
  return findFile(base);
}

/** Download video (capped at 480p, mp4), return file path. Accepts URL or search query. */
async function downloadVideo(input) {
  const base = newBase();
  await run(['--no-warnings', '--no-playlist', '-f', 'bv*[height<=480]+ba/b[height<=480]/b', '--merge-output-format', 'mp4', '-o', `${base}.%(ext)s`, asInput(input)], 240000);
  return findFile(base);
}

/** Resolve a search query to a concrete video URL (best-effort). */
async function resolveUrl(input) {
  if (isUrl(input)) return input;
  const out = await run(['--no-warnings', '--no-playlist', '--skip-download', '--print', '%(webpage_url)s', asInput(input)], 60000);
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

/** Video download; if YouTube is blocked, fall back to SoundCloud audio. */
async function downloadVideoSmart(input) {
  try {
    return { file: await downloadVideo(input), audio: false };
  } catch (e) {
    if (!isUrl(input)) {
      try { return { file: await downloadAudio(`scsearch1:${String(input).trim()}`), audio: true }; } catch { /* fall through */ }
    }
    throw e;
  }
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
