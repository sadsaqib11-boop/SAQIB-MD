// Verifies the durable image cache: a persisted image is reloaded on a fresh
// module instance (i.e. survives a restart/redeploy), and isCached() sees it.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DIR = path.join(__dirname, '..', '.tmp-imgcache-test');
process.env.IMAGE_CACHE_DIR = DIR;

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else { console.log('ok:', msg); } }

(async () => {
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}

  // 1) fresh module — nothing cached yet
  let img = require('../lib/imagegen.js');
  const prompt = 'a test prompt for the durable cache';
  const key = crypto.createHash('sha1').update(`${prompt}|1024x1024|`).digest('hex');
  assert(img.isCached(prompt, { width: 1024, height: 1024 }) === false, 'fresh cache is empty');

  // 2) simulate a previously-generated image already on disk (PNG magic, >1KB)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(2048, 7)]);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, key + '.img'), png);

  // 3) reload the module (as a restart would) — diskLoad() should pick it up
  delete require.cache[require.resolve('../lib/imagegen.js')];
  img = require('../lib/imagegen.js');
  assert(img.isCached(prompt, { width: 1024, height: 1024 }) === true, 'persisted image is reloaded from disk');
  assert(img._cache.size >= 1, 'in-memory cache populated from disk');

  // 4) a non-image file is rejected on load
  const badKey = crypto.createHash('sha1').update(`bad|1024x1024|`).digest('hex');
  fs.writeFileSync(path.join(DIR, badKey + '.img'), Buffer.from('not an image at all, just text bytes here'));
  delete require.cache[require.resolve('../lib/imagegen.js')];
  img = require('../lib/imagegen.js');
  assert(img.isCached('bad', { width: 1024, height: 1024 }) === false, 'non-image file is ignored');

  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
  console.log(process.exitCode ? '\nSOME TESTS FAILED' : '\nALL IMAGE-CACHE TESTS PASSED');
})();
