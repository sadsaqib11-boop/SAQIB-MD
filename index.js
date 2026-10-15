/**
 * SAQIB-MD — Premium WhatsApp Bot
 * Single process: web pairing portal + WhatsApp bot (multi-session).
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
// Load persisted runtime overrides (toggles survive restarts/redeploys).
require('./lib/settings').load();
require('./lib/prefixes').load();
require('./lib/reacts').load();
require('./lib/bans').load();
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
  res.json({ ok: true, bot: config.BOT_NAME, version: config.BOT_VERSION, status: s.status, connected: s.connected, uptime: s.uptime, sessions: s.connectedCount });
});

// Build marker — lets us confirm which code is actually live (deploy check).
const BUILD = process.env.BUILD_MARKER || 'watchdog+lastUpdate+diag';
app.get('/api/version', (req, res) => {
  res.json({ ok: true, bot: config.BOT_NAME, version: config.BOT_VERSION, build: BUILD, node: process.version, pid: process.pid, uptime: bot.getStatus().uptime });
});

// Session-dir diagnostic — shows exactly what is stored on the volume so we
// can tell whether a number is linked (creds.json + registered) or not.
app.get('/api/session-dir', (req, res) => {
  const base = path.resolve(config.SESSION_DIR);
  const entries = [];
  try {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d);
      let isDir = false;
      try { isDir = fs.statSync(p).isDirectory(); } catch { /* ignore */ }
      let hasCreds = false, registered = false, me = null, files = 0;
      if (isDir) {
        try { files = fs.readdirSync(p).length; } catch { /* ignore */ }
        try {
          const c = JSON.parse(fs.readFileSync(path.join(p, 'creds.json'), 'utf8'));
          hasCreds = true; registered = !!c.registered; me = c?.me?.id || null;
        } catch { /* no creds.json */ }
      }
      entries.push({ name: d, isDir, files, hasCreds, registered, me });
    }
  } catch (e) {
    return res.json({ ok: false, dir: base, error: e?.message || String(e) });
  }
  res.json({ ok: true, dir: base, entries });
});

app.get('/api/status', (req, res) => {
  res.json({ ok: true, ...bot.getStatus() });
});

app.get('/api/sessions', (req, res) => {
  res.json({ ok: true, sessions: bot.listSessions(), max: config.MAX_SESSIONS });
});

app.post('/api/session/remove', async (req, res) => {
  try {
    const ok = await bot.removeSession(req.body?.number);
    res.json({ ok, removed: ok });
  } catch (e) {
    res.status(400).json({ ok: false, error: e?.message || 'Remove fail.' });
  }
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
  const want = String(req.body?.number || '').replace(/[^0-9]/g, '');
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
  const mine = (num) => !want || !num || String(num) === want;
  const onCode = (e) => { if (!mine(e.number)) return; codeSentToClient = true; send({ status: 'code', code: e.code, number: e.number }); };
  const onLinking = (e) => { if (!mine(e.number)) return; send({ status: 'linking', number: e.number, message: 'Code accepted — finishing the link...' }); };
  const onPaired = (e) => { if (!mine(e.number)) return; send({ status: 'paired', number: e.number }); setTimeout(cleanup, 1500); };
  const onError = (e) => { if (!mine(e.number)) return; send({ status: 'error', error: e.error, number: e.number }); cleanup(); };

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
    onError({ number: want, error: e?.message || 'Pairing fail ho gaya.' });
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

// ---- live diagnostics (no host-log access needed) ----
const debug = require('./lib/debug');
app.get('/api/debug', (req, res) => {
  const n = Math.min(200, parseInt(req.query.n || '80', 10) || 80);
  res.json({ ok: true, prefix: config.PREFIX, mode: config.MODE, owner: config.OWNER_NUMBER, events: debug.recent(n) });
});
app.post('/api/debug/clear', (req, res) => { debug.clear(); res.json({ ok: true }); });

// Force-reconnect every session (self-heal button for the portal / ops).
app.post('/api/reconnect', async (req, res) => {
  try { const n = await bot.reconnectAll(); res.json({ ok: true, restarted: n }); }
  catch (e) { res.status(500).json({ ok: false, error: e?.message || String(e) }); }
});

// In-process self-test: runs the real command engine (no WhatsApp needed).
app.get('/api/selftest', async (req, res) => {
  const results = [];
  const tests = ['.menu', '.ping', '.alive', '.help'];
  for (const t of tests) {
    const sent = [];
    const sock = {
      user: { id: '0@s.whatsapp.net' },
      sendMessage: async (jid, content) => { sent.push(content); return { key: { id: 'x' } }; },
      readMessages: async () => {}, sendPresenceUpdate: async () => {},
    };
    const m = { key: { remoteJid: '0@s.whatsapp.net', id: 'T' + Math.random().toString(36).slice(2, 9) }, message: { conversation: t }, pushName: 'SelfTest' };
    try {
      await require('./lib/handler').handleMessage(sock, m, { number: config.OWNER_NUMBER, ownerNumber: config.OWNER_NUMBER });
      await new Promise((r) => setTimeout(r, 300));
      results.push({ command: t, ok: sent.length > 0, replies: sent.length });
    } catch (e) { results.push({ command: t, ok: false, error: e?.message || String(e) }); }
  }
  res.json({ ok: results.every((r) => r.ok), results });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(config.PORT, () => {
  console.log(`${config.BOT_NAME} web portal: http://localhost:${config.PORT}`);
});

// ---------------------------------------------------------------------------
// Start the bot (restores every saved session)
// ---------------------------------------------------------------------------
bot.startBot().catch((e) => console.error('bot start fail:', e?.message || e));

// SPEED: warm external connections in the background (DNS + TLS pre-connect)
require('./lib/helpers').warmupHosts().catch(() => {});

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.message || e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e?.message || e));
