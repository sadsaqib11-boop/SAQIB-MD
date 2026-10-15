/**
 * SAQIB-MD — image generation that actually works
 * ------------------------------------------------
 * The keyless pollinations image endpoint rate-limits hard: a burst returns
 * HTTP 402 with a 2-byte body, and the bot used to hand that 2-byte "image"
 * straight to WhatsApp — which is where "❌ Image banane me error aaya"
 * came from. Every image command (logo, myth, characters, .write, …) broke
 * the same way.
 *
 * This module fixes it properly:
 *   1. GEMINI (Imagen) is used first when a key is present — fast and reliable.
 *   2. pollinations is the fallback, but the bytes are VALIDATED (must be a
 *      real JPEG/PNG) and 402/429 is retried with backoff and a new seed.
 *   3. A tiny in-memory cache means a repeated prompt is instant.
 *   4. Failures are honest: callers get a real error, never a fake image.
 */
const config = require('../config');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/* ------------------------------ cache ------------------------------ */
const CACHE = new Map();          // hash -> Buffer
const CACHE_MAX = 60;
const CACHE_TTL = 30 * 60 * 1000; // 30 min

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { CACHE.delete(key); return null; }
  return hit.buf;
}
function cacheSet(key, buf) {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { buf, exp: Date.now() + CACHE_TTL });
}

/* --------------------------- validation ---------------------------- */
/**
 * Is this buffer a real image? pollinations returns a 2-byte body on 402 and
 * an HTML error page on some failures — both must be rejected.
 */
function isRealImage(buf) {
  if (!buf || buf.length < 1024) return false;
  // JPEG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // WEBP (RIFF....WEBP)
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
  // GIF
  if (buf.toString('ascii', 0, 3) === 'GIF') return true;
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ queue ------------------------------ */
/**
 * pollinations' free tier rate-limits to roughly one image every ~15s. Rather
 * than fail (or send a broken 2-byte "image"), we serialise requests through a
 * single queue with a minimum gap between them. Users see an honest
 * "ban rahi hai…" note instead of an error.
 */
const QUEUE = [];
let queueRunning = false;
let lastCallAt = 0;
const MIN_GAP_MS = 15000;   // free-tier safe spacing
const MAX_QUEUE = 25;       // don't let it grow without bound

function queueLength() { return QUEUE.length + (queueRunning ? 1 : 0); }

function enqueue(task) {
  if (QUEUE.length >= MAX_QUEUE) return Promise.reject(new Error('Image queue full — thori der baad try karo.'));
  return new Promise((resolve, reject) => {
    QUEUE.push({ task, resolve, reject });
    drain();
  });
}

async function drain() {
  if (queueRunning) return;
  const job = QUEUE.shift();
  if (!job) return;
  queueRunning = true;
  try {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    job.resolve(await job.task());
  } catch (e) {
    job.reject(e);
  } finally {
    queueRunning = false;
    if (QUEUE.length) setImmediate(drain);
  }
}

/* ------------------------- gemini / imagen ------------------------- */
/** Ask Google's image model. Returns a Buffer, or null when unavailable. */
async function viaGemini(prompt) {
  if (!config.GEMINI_API_KEY) return null;
  const model = config.GEMINI_IMAGE_MODEL || 'imagen-4.0-generate-001';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${config.GEMINI_API_KEY}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '1:1' },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const b64 = d?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) return null;
    const buf = Buffer.from(b64, 'base64');
    return isRealImage(buf) ? buf : null;
  } catch { return null; }
}

/* --------------------- pollinations (keyed, v1) --------------------- */
/**
 * New keyed endpoint — no per-IP limit once the key has image models allowed.
 * This is the preferred path: POST /v1/images/generations on gen.pollinations.ai.
 * Returns a Buffer, or null when the key is missing / not granted.
 */
async function viaPollinationsKey(prompt, { width, height, model }) {
  const key = config.POLLINATIONS_API_KEY;
  if (!key) return null;
  const m = model || config.POLLINATIONS_IMAGE_MODEL || 'tongyi-mai/z-image-turbo';
  try {
    const r = await fetch('https://gen.pollinations.ai/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: m, prompt, n: 1, size: `${width}x${height}`, response_format: 'b64_json' }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const b64 = d?.data?.[0]?.b64_json || d?.data?.[0]?.url;
    if (!b64) return null;
    if (String(b64).startsWith('http')) {
      const ir = await fetch(b64, { signal: AbortSignal.timeout(60000) });
      const buf = Buffer.from(await ir.arrayBuffer());
      return isRealImage(buf) ? buf : null;
    }
    const buf = Buffer.from(b64, 'base64');
    return isRealImage(buf) ? buf : null;
  } catch { return null; }
}

/* --------------------------- pollinations -------------------------- */
/** One pollinations attempt. Returns a Buffer or throws. */
async function pollinationsOnce(prompt, { width, height, seed, model }) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`
    + `?width=${width}&height=${height}&nologo=true&seed=${seed}`
    + (model ? `&model=${encodeURIComponent(model)}` : '');
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'image/*' },
    signal: AbortSignal.timeout(60000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok || !isRealImage(buf)) {
    const err = new Error(`image endpoint ne ${r.status} diya (${buf.length} bytes)`);
    err.status = r.status;
    throw err;
  }
  return buf;
}

/**
 * Generate an image. Tries Gemini first (if keyed), then pollinations with
 * backoff. Throws with a clear message when everything fails — callers should
 * show that message rather than pretending it worked.
 *
 * @returns {Promise<Buffer>}
 */
async function generateImage(prompt, opts = {}) {
  const width = opts.width || 1024;
  const height = opts.height || 1024;
  const key = crypto.createHash('sha1').update(`${prompt}|${width}x${height}|${opts.model || ''}`).digest('hex');

  const cached = cacheGet(key);
  if (cached) return cached;

  // 1) Keyed pollinations FIRST — no per-IP limit, and the FREE community models
  //    cost no pollen. This is the fast, reliable, no-cost path and it answers in
  //    ~8-14s.
  //
  //    Gemini/Imagen used to run before this and cost ~45s of dead time on every
  //    single image: the free tier reports `limit: 0` for every Google image
  //    model, so the call could never succeed — it just timed out or 429'd while
  //    the user waited. That dead wait was most of the "image tools are very
  //    slow" complaint. Gemini is now only tried when explicitly enabled AND the
  //    key is marked as billed (GEMINI_IMAGE_ENABLED=1).
  // Both free models are attempted in PARALLEL and the first real image wins.
  // They are separate community endpoints, so one being slow/busy no longer
  // makes the user wait for the other to time out first — this roughly halves
  // the worst-case wait when a model is having a bad minute.
  const models = [config.POLLINATIONS_IMAGE_MODEL, config.POLLINATIONS_IMAGE_FALLBACK].filter(Boolean);
  if (models.length) {
    const kp = await new Promise((resolve) => {
      let pending = models.length;
      let settled = false;
      for (const model of models) {
        viaPollinationsKey(prompt, { width, height, model })
          .then((buf) => {
            if (buf && !settled) { settled = true; resolve(buf); }
          })
          .catch(() => {})
          .finally(() => { if (--pending === 0 && !settled) resolve(null); });
      }
    });
    if (kp) { cacheSet(key, kp); return kp; }
  }

  // 3) Gemini / Imagen — opt-in only. Google's image models are not on the free
  //    tier at all (quota limit 0), so this is skipped unless the operator has
  //    turned it on deliberately.
  if (config.GEMINI_IMAGE_ENABLED && config.GEMINI_API_KEY) {
    const g = await viaGemini(prompt);
    if (g) { cacheSet(key, g); return g; }
  }

  // 4) Keyless pollinations, serialised through the queue with backoff. The
  //    queue is what keeps the free tier from answering 402.
  return enqueue(async () => {
    // Another request may have filled the cache while we waited in line.
    const hit = cacheGet(key);
    if (hit) return hit;

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const seed = Math.floor(Math.random() * 1e6);
        const buf = await pollinationsOnce(prompt, { width, height, seed, model: opts.model });
        cacheSet(key, buf);
        return buf;
      } catch (e) {
        lastErr = e;
        const wait = (e.status === 402 || e.status === 429) ? 8000 * (attempt + 1) : 500;
        if (attempt < 2) await sleep(wait);
      }
    }

    const hint = lastErr?.status === 402
      ? 'Image service abhi busy hai. Thori der baad dobara try karo.'
      : 'Image nahi ban saki — dobara try karo.';
    throw new Error(hint);
  });
}

/**
 * Send a generated image as the reply. Returns true on success.
 * Handles the buffer download itself so a broken URL never reaches WhatsApp.
 * Because the free image tier is rate-limited, we tell the user it's coming
 * when the queue is backed up, instead of leaving them staring at nothing.
 */
async function sendGeneratedImage(ctx, prompt, caption, opts = {}) {
  const pending = queueLength() > 1;
  if (pending) await ctx.reply('🎨 Image ban rahi hai… thora intezar karein.').catch(() => {});
  try {
    const buf = await generateImage(prompt, opts);
    await ctx.send(ctx.from, { image: buf, caption }, { quoted: ctx.m });
    return true;
  } catch (e) {
    await ctx.reply(`❌ ${e.message}`).catch(() => {});
    return false;
  }
}

module.exports = { generateImage, sendGeneratedImage, isRealImage, queueLength, _cache: CACHE };
