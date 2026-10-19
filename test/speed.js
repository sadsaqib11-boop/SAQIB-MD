/**
 * Verify the SPEED changes.
 * Run: node test/speed.js
 *
 *  1. `.menu` sends the bot picture BY URL (so Baileys can cache the upload),
 *     not as a raw Buffer (which re-uploads the whole file every time).
 *  2. The socket options wire in `mediaCache`.
 *  3. index.js exposes the `/botpic` endpoint the URL points at.
 *  4. The command path only waits for the group-admin lookup when the plugin
 *     actually needs it (adminOnly / needsAdmin) \u2014 ordinary commands run
 *     immediately instead of paying the first-message metadata round-trip.
 */
process.env.SESSION_DIR = process.env.SESSION_DIR || './.test-session';
const fs = require('fs');
const path = require('path');
const registry = require('../plugins/_registry');

const pluginsDir = path.join(__dirname, '..', 'plugins');
const plugins = [];
for (const f of fs.readdirSync(pluginsDir).filter((x) => x.endsWith('.js') && !x.startsWith('_'))) {
  try { const p = require(path.join(pluginsDir, f)); if (Array.isArray(p.commands) && typeof p.handler === 'function') plugins.push({ file: f, ...p }); } catch { /* skip */ }
}
registry.set(plugins);
const main = require('../plugins/main.js');

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? '\u2705' : '\u274c'} ${name}`); if (!cond) fails++; };

(async () => {
  // 1) .menu sends the picture BY URL
  const sends = [];
  const ctx = {
    command: 'menu', arg: '', args: [], prefix: '.', from: '123@s.whatsapp.net',
    senderNum: '923106762478', pushname: 'T', isOwner: true, m: { key: {} },
    reply: async () => { sends.push({ kind: 'text' }); return { key: { id: 'x' } }; },
    send: async (jid, content) => {
      sends.push({ kind: content.image ? (content.image.url ? 'image-url' : 'image-buffer') : 'text', url: content.image && content.image.url });
      return { key: { id: 'x' } };
    },
  };
  await main.handler(ctx);
  ok('.menu sends the bot picture BY URL (cacheable)', sends[0] && sends[0].kind === 'image-url');
  ok('.menu picture URL is versioned (?v=) so a changed pic is never stale', sends[0] && /[?&]v=/.test(String(sends[0].url)));

  // 1b) .ping -> exactly ONE message (was two, the 2nd only after a round-trip)
  {
    const s2 = [];
    const c2 = {
      command: 'ping', arg: '', args: [], prefix: '.', from: '123@s.whatsapp.net',
      senderNum: '923106762478', pushname: 'T', isOwner: true, m: { key: {} },
      reply: async () => { s2.push('text'); return { key: { id: 'x' } }; },
      send: async () => { s2.push('send'); return { key: { id: 'x' } }; },
    };
    await main.handler(c2);
    ok('.ping sends exactly ONE message', s2.length === 1);
  }

  // 2) socket options include mediaCache
  const botsrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bot.js'), 'utf8');
  ok('socket options wire in mediaCache', /session\.mediaCache = new Map\(\)/.test(botsrc) && /^\s*mediaCache,\s*$/m.test(botsrc));

  // 3) index.js exposes /botpic
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  ok('index.js exposes the /botpic endpoint', /app\.get\('\/botpic'/.test(idx));

  // 4) handler only awaits the admin lookup for admin-gated plugins
  const hs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'handler.js'), 'utf8');
  ok('handler awaits admin ONLY for admin-gated plugins', /plug\.adminOnly \|\| plug\.needsAdmin/.test(hs));

  console.log(fails ? `\n${fails} FAILED` : '\n=== ALL PASSED ===');
  process.exit(fails ? 1 : 0);
})();
