/**
 * Verify the ".menuall splits into 2 messages" fix.
 * Run: node test/menu-single.js
 *
 * Rule (user, 2026-10-19): a menu must ALWAYS go out as ONE message — never an
 * image+caption PLUS a second "rest" reply.
 */
process.env.SESSION_DIR = process.env.SESSION_DIR || './.test-session';
const fs = require('fs');
const path = require('path');
const registry = require('../plugins/_registry');

// populate the registry exactly like index.js does
const pluginsDir = path.join(__dirname, '..', 'plugins');
const plugins = [];
for (const f of fs.readdirSync(pluginsDir).filter((x) => x.endsWith('.js') && !x.startsWith('_'))) {
  try {
    const p = require(path.join(pluginsDir, f));
    if (Array.isArray(p.commands) && typeof p.handler === 'function') plugins.push({ file: f, ...p });
  } catch { /* skip */ }
}
registry.set(plugins);

const main = require('../plugins/main.js');

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) fails++; };

function mockCtx() {
  const sends = [];
  const ctx = {
    command: 'menuall', arg: '', args: [], prefix: '.', from: '123@s.whatsapp.net',
    senderNum: '923106762478', pushname: 'Tester', isOwner: true, m: { key: {} },
    reply: async (txt) => { sends.push({ kind: 'text', len: String(txt).length }); return { key: { id: 'x' } }; },
    send: async (jid, content) => { sends.push({ kind: content.image ? 'image' : content.text ? 'text' : 'other', len: (content.caption || content.text || '').length }); return { key: { id: 'x' } }; },
  };
  return { ctx, sends };
}

(async () => {
  // 1) .menuall -> exactly ONE message
  {
    const { ctx, sends } = mockCtx();
    await main.handler(ctx);
    ok('.menuall sends exactly ONE message', sends.length === 1);
    ok('.menuall message is a text (long list, not a caption)', sends[0] && sends[0].kind === 'text');
    ok('.menuall carries the full list (>10k chars)', sends[0] && sends[0].len > 10000);
  }

  // 2) .menu (categories) -> ONE message (image+caption, fits)
  {
    const { ctx, sends } = mockCtx();
    ctx.command = 'menu';
    await main.handler(ctx);
    ok('.menu sends exactly ONE message', sends.length === 1);
  }

  // 3) .menu <category> -> ONE message (never split), even for a big category
  {
    const { ctx, sends } = mockCtx();
    ctx.command = 'menu';
    ctx.arg = 'media';
    await main.handler(ctx);
    ok('.menu <category> sends exactly ONE message', sends.length === 1);
  }

  console.log(fails ? `\n${fails} FAILED` : '\n=== ALL PASSED ===');
  process.exit(fails ? 1 : 0);
})();
