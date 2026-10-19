/**
 * DUMMY COMMAND AUDIT — find registered commands whose name appears nowhere
 * else in their plugin file (i.e. no `case 'x'`, no includes([...]) entry,
 * no map key => frontend-only command with no backend).
 * Usage: bun scripts/audit-dummies.js
 */
const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(__dirname, '..', 'plugins');
const suspects = [];
let total = 0;

for (const f of fs.readdirSync(pluginsDir).filter((x) => x.endsWith('.js') && x !== '_registry.js')) {
  const src = fs.readFileSync(path.join(pluginsDir, f), 'utf8');
  const idx = src.indexOf('commands:');
  if (idx < 0) continue;
  // commands array usually ends at the first ']' after 'commands:'
  const end = src.indexOf(']', idx);
  const arrSrc = src.slice(idx, end + 1);
  const cmds = [...arrSrc.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  // handler body = everything EXCEPT the commands array slice
  const body = src.slice(0, idx) + src.slice(end + 1);
  total += cmds.length;
  for (const c of [...new Set(cmds)]) {
    if (!body.includes("'" + c + "'") && !body.includes('"' + c + '"') && !body.includes('`' + c + '`')) {
      suspects.push(`${f}: ${c}`);
    }
  }
}

console.log(`registered command names: ${total}`);
console.log(`SUSPECT DUMMY (no handler reference): ${suspects.length}`);
console.log(suspects.join('\n') || '(none)');
