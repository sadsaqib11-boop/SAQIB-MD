/**
 * SAAVN FAST LANE — free, no-key JioSaavn API (saavn.sumit.co).
 * A 320kbps song downloads from JioSaavn's CDN in ~1 second, versus ~40s
 * from YouTube on a datacenter IP (Google throttles it). `.song` tries THIS
 * first; YouTube remains the fallback so nothing breaks if the API is down.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOSTS = [process.env.SAAVN_API, 'https://saavn.sumit.co', 'https://saavn.dev'].filter(Boolean);

/** YouTube titles carry junk ("Song - Violin - Channel"). The REAL name is
 * usually one dash-segment — search a few candidates, first hit wins. */
function candidates(q) {
  let base = String(q).replace(/\(([^)]*)\)|\[([^\]]*)\]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = base.split(/\s*[-|·]\s*/).map((s) => s.trim()).filter(Boolean);
  const out = [base];
  if (parts[0]) out.push(parts[0]);
  if (parts[1]) out.push(parts[1]);
  return [...new Set(out)].filter(Boolean).slice(0, 3);
}

/** Search + download the best-matching song. Returns { file, title, size } or null. */
async function saavnBest(query, tmpDir) {
  const names = candidates(query);
  for (const host of HOSTS) {
    for (const name of names) {
      try {
        const r = await fetch(`${host}/api/search/songs?query=${encodeURIComponent(name)}&limit=1`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const j = await r.json();
        const song = j && j.data && Array.isArray(j.data.results) ? j.data.results[0] : null;
        if (!song || !song.name) continue;
        const urls = Array.isArray(song.downloadUrl) ? song.downloadUrl : [];
        const best = urls[urls.length - 1] || null; // last entry = 320kbps
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
      } catch { /* next candidate / host */ }
    }
  }
  return null;
}

module.exports = { saavnBest };
