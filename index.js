/**
 * SAQIB-MD — Premium WhatsApp Bot
 * Single process: web pairing portal + WhatsApp bot.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const registry = require('./plugins/_registry');
const bot = require('./lib/bot');

// ---------------------------------------------------------------------------
// Load plugins
// ---------------------------------------------------------------------------
const pluginsDir = path.join(__dirname, 'plugins');
const plugins = [];
for (const f of fs.readdirSync(pluginsDir).filter((x) => x.endsWith('.js') && !x.startsWith('_'))) {
  try {
    const plug = require(path.join(pluginsDir, f));
    if (Array.isArray(plug.commands) && typeof plug.handler === 'function') {
      plugins.push({ file: f, ...plug });
    }
  } catch (e) {
    console.error('plugin load fail:', f, e.message);
  }
}
registry.set(plugins);
const totalCmds = plugins.reduce((n, p) => n + p.commands.length, 0);
console.log(`${config.BOT_NAME}: ${plugins.length} plugin files, ${totalCmds} commands`);

// ---------------------------------------------------------------------------
// Web server (pairing portal + health)
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  const s = bot.getStatus();
  res.json({ ok: true, bot: config.BOT_NAME, version: config.BOT_VERSION, status: s.status, connected: s.connected, uptime: s.uptime });
});

app.get('/api/status', (req, res) => {
  res.json({ ok: true, ...bot.getStatus() });
});

app.post('/api/pair', async (req, res) => {
  try {
    const code = await bot.requestPair(req.body?.number);
    res.json({ ok: true, code, number: String(req.body?.number || '').replace(/[^0-9]/g, '') });
  } catch (e) {
    res.status(400).json({ ok: false, error: e?.message || 'Pairing fail ho gaya.' });
  }
});

app.get('/api/commands', (req, res) => {
  const cats = {};
  for (const p of plugins) {
    if (p.hidden) continue;
    cats[p.category || 'OTHER'] = cats[p.category || 'OTHER'] || [];
    cats[p.category || 'OTHER'].push(...p.commands);
  }
  res.json({ ok: true, prefix: config.PREFIX, total: totalCmds, categories: cats });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(config.PORT, () => {
  console.log(`${config.BOT_NAME} web portal: http://localhost:${config.PORT}`);
});

// ---------------------------------------------------------------------------
// Start the bot
// ---------------------------------------------------------------------------
bot.startBot().catch((e) => console.error('bot start fail:', e?.message || e));

// keep the process alive / friendly shutdown
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.message || e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e?.message || e));
