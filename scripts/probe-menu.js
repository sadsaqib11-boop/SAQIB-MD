// Faithful probe: register all plugins (like index.js boot), then check what
// .menu / .menu <category> / .menuall actually send.
process.env.SESSION_DIR = '/tmp/saqib-probe-session';
const fs = require('fs');
const path = require('path');

// --- boot the registry exactly like index.js ---
const registry = require('../plugins/_registry');
const pluginsDir = path.join(__dirname, '..', 'plugins');
const plugins = [];
for (const f of fs.readdirSync(pluginsDir).filter((x) => x.endsWith('.js') && !x.startsWith('_'))) {
  try { const p = require(path.join(pluginsDir, f)); if (p && Array.isArray(p.commands) && typeof p.handler === 'function') plugins.push({ file: f, ...p }); } catch {}
}
registry.set(plugins);

const main = require('../plugins/main');
const config = require('../config');

async function run(command, arg) {
  const captured = [];
  const ctx = {
    command, arg: arg || '', args: arg ? arg.split(' ') : [], text: '.' + command,
    from: '923106762478@s.whatsapp.net', isGroup: false,
    sender: '923106762478@s.whatsapp.net', senderNum: '923106762478',
    pushname: 'Probe', prefix: '.', isOwner: true, m: { key: {} }, quoted: null,
    reply: (t) => { captured.push({ kind: 'text', len: String(t).length }); return Promise.resolve(); },
    send: (j, c) => { captured.push({ kind: 'send', hasImage: !!c.image, isBuffer: Buffer.isBuffer(c.image), captionLen: (c.caption || '').length }); return Promise.resolve(); },
    sendSticker: () => Promise.resolve(), react: () => Promise.resolve(),
  };
  await main.handler(ctx);
  const s = captured.map((c) => c.kind === 'send' ? `SEND(image=${c.hasImage},buf=${c.isBuffer},cap=${c.captionLen})` : `TEXT(len=${c.len})`).join(' + ');
  console.log(`.${command}${arg ? ' ' + arg : ''}  ->  ${s}`);
}

(async () => {
  console.log('BOT_PIC =', config.BOT_PIC, '| exists =', fs.existsSync(path.resolve(config.BOT_PIC)));
  await run('menu');
  await run('menu', 'download');
  await run('menu', 'group');
  await run('menuall');
})();
