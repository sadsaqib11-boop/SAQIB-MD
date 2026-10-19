/**
 * SAQIB-MD — disk-backed download cache
 * -------------------------------------
 * Makes REPEAT downloads INSTANT. When the same song / movie / video is asked
 * for again we resend the file we already fetched instead of hitting the
 * network a second time.
 *
 * Safety:
 *  - Every entry has a TTL (default 24h) and is swept away after that.
 *  - The whole cache has a TOTAL-SIZE cap (default 2 GB). When it is exceeded
 *    the oldest files are evicted first (LRU), so the disk can never fill up.
 *  - A single file larger than the per-file cap is simply NOT cached.
 *  - In-flight de-duplication: two people asking for the same thing at the
 *    same time trigger ONE download, not two.
 *
 * No external deps.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.CACHE_DIR || path.join(process.env.TMP_DIR || os.tmpdir(), 'saqib-cache');
const TTL_MS = parseInt(process.env.DL_CACHE_TTL_MS || String(24 * 60 * 60 * 1000), 10); // 12h
const MAX_BYTES = parseInt(process.env.DL_CACHE_MB || '2048', 10) * 1024 * 1024;          // 2 GB total
const MAX_FILE_BYTES = parseInt(process.env.DL_CACHE_FILE_MB || '1536', 10) * 1024 * 1024; // 1.5 GB / file
const MIN_FILE_BYTES = 1024; // ignore empty/broken files

function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* ignore */ } }

/** Stable, filesystem-safe cache key for a (kind, input) pair. */
function keyOf(kind, input) {
  const h = crypto.createHash('sha1').update(`${kind}\u0000${String(input).trim().toLowerCase()}`).digest('hex').slice(0, 24);
  return `${kind}-${h}`;
}

function pathOf(kind, input) { return path.join(DIR, keyOf(kind, input)); }

/** Return the cached file path for (kind, input), or null when there is no live entry. */
function get(kind, input) {
  const p = pathOf(kind, input);
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size < MIN_FILE_BYTES) return null;
    if (Date.now() - st.mtimeMs > TTL_MS) { try { fs.unlinkSync(p); } catch { /* ignore */ } return null; }
    // Touch so the LRU sweeper keeps frequently-used files.
    try { const now = new Date(); fs.utimesSync(p, now, now); } catch { /* ignore */ }
    return p;
  } catch { return null; }
}

/**
 * Move a freshly-downloaded file into the cache under (kind, input) and return
 * its new (cached) path. Files that are too big/small are returned untouched so
 * the caller still works — they just are not cached.
 */
function put(kind, input, srcFile) {
  try {
    if (!srcFile || !fs.existsSync(srcFile)) return srcFile;
    const size = fs.statSync(srcFile).size;
    if (size < MIN_FILE_BYTES || size > MAX_FILE_BYTES) return srcFile; // not cacheable
    ensureDir();
    const dest = pathOf(kind, input);
    try { fs.renameSync(srcFile, dest); }
    catch { fs.copyFileSync(srcFile, dest); try { fs.unlinkSync(srcFile); } catch { /* ignore */ } }
    return dest;
  } catch { return srcFile; }
}

/** True when a path lives inside the cache dir (so callers must NOT delete it). */
function isCached(p) {
  try { return path.resolve(p).startsWith(path.resolve(DIR) + path.sep); } catch { return false; }
}

/* --------------------------- in-flight de-dupe --------------------------- */
const inflight = new Map();
/**
 * Run `fn` once per key even if called many times concurrently; every caller
 * gets the same promise/result. Prevents duplicate heavy downloads.
 */
function dedupe(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Delete expired entries and evict the oldest files until under the size cap. */
function sweep() {
  try {
    if (!fs.existsSync(DIR)) return;
    const now = Date.now();
    const files = [];
    for (const f of fs.readdirSync(DIR)) {
      const p = path.join(DIR, f);
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        if (now - st.mtimeMs > TTL_MS) { fs.unlinkSync(p); continue; }
        files.push({ p, size: st.size, mtime: st.mtimeMs });
      } catch { /* ignore */ }
    }
    let total = files.reduce((s, x) => s + x.size, 0);
    if (total <= MAX_BYTES) return;
    files.sort((a, b) => a.mtime - b.mtime); // oldest first
    for (const x of files) {
      if (total <= MAX_BYTES) break;
      try { fs.unlinkSync(x.p); total -= x.size; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

function stats() {
  try {
    let n = 0; let bytes = 0;
    if (fs.existsSync(DIR)) {
      for (const f of fs.readdirSync(DIR)) {
        try { const st = fs.statSync(path.join(DIR, f)); if (st.isFile()) { n++; bytes += st.size; } } catch { /* ignore */ }
      }
    }
    return { dir: DIR, files: n, bytes, maxBytes: MAX_BYTES, ttlMs: TTL_MS };
  } catch { return { dir: DIR, files: 0, bytes: 0, maxBytes: MAX_BYTES, ttlMs: TTL_MS }; }
}

module.exports = { get, put, isCached, dedupe, sweep, stats, keyOf, DIR };
