/**
 * SAQIB-MD — Premium WhatsApp Bot
 * Single process: web pairing portal + WhatsApp bot.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
// Load persisted runtime overrides (toggles survive restarts/redeploys).
require('./lib/settings').load();
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

// Downloader engine + periodic temp cleanup
const ytdlp = require('./lib/ytdlp');
console.log(`[YTDLP] ${ytdlp.available() ? 'available ✅' : 'NOT found ❌'}`);
setInterval(() => ytdlp.cleanup(), 15 * 60 * 1000).unref?.();

// ---------------------------------------------------------------------------
// Web server (pairing portal + health)
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS — lets the Vercel pairing site call this backend directly.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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

// SSE pairing stream — used by the pairing portal for live status
// (starting → code → linking → paired / error).
app.post('/api/pair/stream', async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  let codeSentToClient = false;
  const send = (obj) => { if (!closed) { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* ignore */ } } };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    bot.events.off('code', onCode);
    bot.events.off('linking', onLinking);
    bot.events.off('paired', onPaired);
    bot.events.off('error', onError);
    try { res.end(); } catch { /* ignore */ }
  };
  const onCode = (code) => { codeSentToClient = true; send({ status: 'code', code }); };
  const onLinking = () => send({ status: 'linking', message: 'Code accepted — finishing the link...' });
  const onPaired = (num) => { send({ status: 'paired', number: num }); setTimeout(cleanup, 1500); };
  const onError = (msg) => { send({ status: 'error', error: msg }); cleanup(); };

  // NOTE: use res 'close' (client disconnect), NOT req 'close' — in modern
  // Node, req 'close' fires as soon as the request body is fully read, which
  // would tear the stream down before the pairing code is generated.
  res.on('close', cleanup);
  bot.events.on('code', onCode);
  bot.events.on('linking', onLinking);
  bot.events.on('paired', onPaired);
  bot.events.on('error', onError);

  send({ status: 'starting', message: 'Connecting to WhatsApp...' });
  try {
    const code = await bot.requestPair(req.body?.number);
    if (!codeSentToClient) send({ status: 'code', code }); // fallback if the event was missed
  } catch (e) {
    onError(e?.message || 'Pairing fail ho gaya.');
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
