/**
 * Regenerate command-inventory.json from the LIVE bot (/api/commands).
 * The old file (from scripts/inventory.js) was stale — 1076 vs the real 1857.
 * Usage: node scripts/regen-inventory.js [baseUrl]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || 'https://saqib-md-production.up.railway.app';
const raw = execSync(`curl -s -m 30 ${base}/api/commands`).toString();
const d = JSON.parse(raw);

// category -> plugin file, read from _registry.js where possible
const regSrc = fs.readFileSync(path.join(__dirname, '..', 'plugins', '_registry.js'), 'utf8');

function fileFor(cat) {
  // registry entries look like: file: 'ai.js', category: '🤖 AI' — find the file
  // whose block mentions this category.
  const re = /['"]([^'"]+\.js)['"][^{}]*?category:\s*['"]([^'"]+)['"]|category:\s*['"]([^'"]+)['"][^{}]*?file:\s*['"]([^'"]+\.js)['"]/g;
  let m;
  while ((m = re.exec(regSrc)) !== null) {
    const f = m[1] || m[4];
    const c = m[2] || m[3];
    if (f && c === cat) return f;
  }
  return cat.replace(/[^a-z0-9]/gi, '').toLowerCase() + '.js';
}

const out = { total: d.total, unique: 0, plugins: [] };
const seen = new Set();
for (const [cat, cmds] of Object.entries(d.categories)) {
  const uniq = [...new Set(cmds)];
  uniq.forEach((c) => seen.add(c));
  out.plugins.push({ file: fileFor(cat), category: cat, count: uniq.length, commands: uniq });
}
out.unique = seen.size;

fs.writeFileSync(path.join(__dirname, '..', 'command-inventory.json'), JSON.stringify(out, null, 2));
console.log(`written: total=${out.total} unique=${out.unique} plugins=${out.plugins.length}`);
