/**
 * SAAVN FAST LANE — free, no-key JioSaavn API (saavn.dev).
 * A 320kbps song downloads from JioSaavn's CDN in 1-3 seconds, versus ~40s
 * from YouTube on a datacenter IP (Google throttles it). `.song` tries THIS
 * first; YouTube remains the fallback so nothing breaks if the API is down.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOSTS = [process.env.SAAVN_API, 'https://saavn.sumit.co', 'https://saavn.dev'].filter(Boolean);

/** Search + download the best-matching song. Returns { file, title } or null. */
async function saavnBest(query, tmpDir) {
  for (const host of HOSTS) {
    try {
      const r = await fetch(`${host}/api/search/songs?query=${encodeURIComponent(query)}&limit=1`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = await r.json();
      const song = j && j.data && Array.isArray(j.data.results) ? j.data.results[0] : null;
      if (!song) continue;
      const urls = Array.isArray(song.downloadUrl) ? song.downloadUrl : [];
      // last entry = highest quality (320kbps)
      const best = urls[urls.length - 1] || null;
      const url = best ? (best.url || best.link) : null;
      if (!url) continue;
      const dr = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!dr.ok) continue;
      const buf = Buffer.from(await dr.arrayBuffer());
      if (buf.length < 200000) continue; // too small to be a real song
      const title = String(song.name || query).slice(0, 70);
      const safe = title.replace(/[^\w .()-]/g, '').trim() || 'song';
      const dir = tmpDir || os.tmpdir();
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `saavn_${Date.now()}_${safe}.m4a`);
      fs.writeFileSync(file, buf);
      return { file, title, size: buf.length };
    } catch { /* next host, then null */ }
  }
  return null;
}

module.exports = { saavnBest };
