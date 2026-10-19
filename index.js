/**
 * SAQIB-MD — Premium WhatsApp Bot
 * Single process: web pairing portal + WhatsApp bot (multi-session).
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const QRCode = require('qrcode');
// Load persisted runtime overrides (toggles survive restarts/redeploys).
require('./lib/settings').load();
require('./lib/prefixes').load();
require('./lib/menustyles').load();
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
const dlcache = require('./lib/dlcache');
console.log(`[YTDLP] ${ytdlp.available() ? 'available ✅' : 'NOT found ❌'}`);
// Enforce the download-cache TTL + size cap at boot and every 15 min.
try { dlcache.sweep(); } catch { /* ignore */ }
console.log(`[CACHE] dir=${dlcache.DIR} ${JSON.stringify(dlcache.stats())}`);
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

// ---------------------------------------------------------------------------
// .movie DOWNLOAD LINK  —  GET /dl/:id
// ---------------------------------------------------------------------------
// The `.movie` command only SEARCHES (fast) and hands back this link. Clicking
// it streams the full 720p film THROUGH this server: yt-dlp resolves the real
// googlevideo URLs here (satisfying YouTube's datacenter-IP lock, which is why
// a raw YouTube link 403s on a phone) and ffmpeg muxes them into ONE
// fragmented MP4 that flows straight to the user. Nothing is buffered on disk,
// so even a 3 GB film needs no disk and starts in a couple of seconds.
// `?q=` only sets the download filename.
const { spawn } = require('child_process');
const _dlActive = { n: 0 };
app.get('/dl/:id', async (req, res) => {
  const id = String(req.params.id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return res.status(400).send('bad id');
  const name = (String(req.query.q || 'movie').replace(/[^\w.\- ]+/g, '').trim().slice(0, 60) || 'movie') + '.mp4';
  // Concurrency guard: cap simultaneous streams so a burst can't OOM/CPU-starve
  // the container (each stream is one ffmpeg + one yt-dlp process).
  if (_dlActive.n >= 6) return res.status(503).send('Server busy \u2014 please try again in a moment.');
  _dlActive.n++;
  let ff = null;
  let done = false;
  const cleanup = () => {
    if (done) return; done = true;
    if (ff) { try { ff.kill('SIGKILL'); } catch { /* ignore */ } ff = null; }
    _dlActive.n = Math.max(0, _dlActive.n - 1);
  };
  try {
    const urls = await ytdlp.getStreamUrls(`https://www.youtube.com/watch?v=${id}`, 720);
    if (!urls.length) { cleanup(); return res.status(404).send('No stream found for this video.'); }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    const args = ['-hide_banner', '-loglevel', 'error'];
    for (const u of urls) args.push('-i', u);
    // -c copy = NO re-encode (fast, full quality). Fragmented MP4 so it can be
    // downloaded progressively without knowing the total size up front.
    args.push('-c', 'copy', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1');
    ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    ff.stdout.pipe(res);
    ff.on('error', () => { try { res.end(); } catch { /* ignore */ } cleanup(); });
    ff.on('close', () => { try { res.end(); } catch { /* ignore */ } cleanup(); });
    req.on('close', cleanup);
  } catch (e) {
    cleanup();
    if (!res.headersSent) res.status(500).send('Stream failed: ' + (e?.message || e));
    else { try { res.end(); } catch { /* ignore */ } }
  }
});

// Groups diagnostic — for every CONNECTED session, list every group the
// account is in: member count, announce-only flag, and whether the BOT is an
// admin there. This is how we prove WHY a "1k+ member group" looks dead: an
// announce-only group silently rejects every reply from a non-admin bot.
app.get('/api/groups', async (req, res) => {
  try {
    const out = [];
    for (const s of bot.listSessions()) {
      if (s.status !== 'connected') continue;
      const sock = bot.getSock(s.number);
      if (!sock) continue;
      let groups = [];
      try { groups = await sock.groupFetchAllParticipating(); } catch (e) { out.push({ session: s.number, error: e?.message || String(e) }); continue; }
      const meId = String(sock.user?.id || '').split(':')[0].split('@')[0];
      for (const [jid, meta] of Object.entries(groups || {})) {
        const me = (meta.participants || []).find((p) => String(p.id || '').split('@')[0].split(':')[0] === meId);
        out.push({
          session: s.number, jid, name: meta.subject || '', size: (meta.participants || []).length,
          announceOnly: !!meta.announce, botAdmin: !!(me && (me.admin === 'admin' || me.admin === 'superadmin')),
        });
      }
    }
    out.sort((a, b) => (b.size || 0) - (a.size || 0));
    res.json({ ok: true, count: out.length, groups: out });
  } catch (e) {
    res.json({ ok: false, error: e?.message || String(e) });
  }
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

// ---- Owner-only guard ------------------------------------------------------
// Connected numbers are private: only the owner (who knows ADMIN_TOKEN) may
// list them or remove a session. Everyone else only sees the count.
const ADMIN_TOKEN = String(config.ADMIN_TOKEN || '');
// Password that protects the whole portal (lock screen). "off"/"none"/"0"
// disables the lock screen entirely.
const PORTAL_PASSWORD_RAW = String(config.PORTAL_PASSWORD || '').trim();
const PORTAL_LOCKED = !!PORTAL_PASSWORD_RAW && !['off', 'none', '0', 'false', 'disable', 'disabled'].includes(PORTAL_PASSWORD_RAW.toLowerCase());
const PORTAL_PASSWORD = PORTAL_LOCKED ? PORTAL_PASSWORD_RAW : '';
function tokenOk(t) {
  const v = String(t || '').trim();
  if (!v) return false;
  return (!!ADMIN_TOKEN && v === ADMIN_TOKEN) || (!!PORTAL_PASSWORD && v === PORTAL_PASSWORD);
}
function isAdmin(req) {
  return tokenOk(req.query?.token || req.headers['x-admin-token'] || req.body?.token);
}

// Portal metadata — tells the frontend whether to show the lock screen.
app.get('/api/portal', (req, res) => {
  res.json({ ok: true, locked: PORTAL_LOCKED, name: config.BOT_NAME, version: config.BOT_VERSION });
});

// Validate the portal password (used by the lock screen).
app.post('/api/auth', (req, res) => {
  if (!PORTAL_LOCKED) return res.json({ ok: true, locked: false });
  res.json({ ok: tokenOk(req.body?.token), locked: true });
});

app.get('/api/sessions', (req, res) => {
  const all = bot.listSessions();
  if (!isAdmin(req)) {
    // Locked view: expose only the count, never the numbers/owners.
    return res.json({ ok: true, locked: true, count: all.length, sessions: [], max: config.MAX_SESSIONS });
  }
  res.json({ ok: true, locked: false, count: all.length, sessions: all, max: config.MAX_SESSIONS });
});

app.post('/api/session/remove', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Unauthorized — owner token required.' });
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
    bot.events.off('qr', onQr);
    bot.events.off('linking', onLinking);
    bot.events.off('paired', onPaired);
    bot.events.off('error', onError);
    try { res.end(); } catch { /* ignore */ }
  };
  const mine = (num) => !want || !num || String(num) === want;
  const onCode = (e) => { if (!mine(e.number)) return; codeSentToClient = true; send({ status: 'code', code: e.code, number: e.number }); };
  // QR mode: render the pairing QR locally (qrcode package) so the user can
  // scan it in WhatsApp → Linked Devices → Link a Device. The raw QR string is
  // a WhatsApp pairing secret, so it is converted to an image HERE and the
  // image (data URL) is what travels to the portal.
  const onQr = async (e) => {
    if (!mine(e.number) || !e.qr) return;
    try { send({ status: 'qr', image: await QRCode.toDataURL(e.qr, { width: 280, margin: 1 }), number: e.number }); }
    catch { /* QR render fail — code mode still works */ }
  };
  const onLinking = (e) => { if (!mine(e.number)) return; send({ status: 'linking', number: e.number, message: 'Code accepted — finishing the link...' }); };
  const onPaired = (e) => { if (!mine(e.number)) return; send({ status: 'paired', number: e.number }); setTimeout(cleanup, 1500); };
  const onError = (e) => { if (!mine(e.number)) return; send({ status: 'error', error: e.error, number: e.number }); cleanup(); };

  res.on('close', cleanup);
  bot.events.on('code', onCode);
  bot.events.on('qr', onQr);
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
  const mem = process.memoryUsage();
  res.json({
    ok: true, prefix: config.PREFIX, mode: config.MODE, owner: config.OWNER_NUMBER,
    events: debug.recent(n),
    latency: debug.latencySummary(),
    memory_mb: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
    uptime_s: Math.round(process.uptime()),
  });
});
app.post('/api/debug/clear', (req, res) => { debug.clear(); res.json({ ok: true }); });

// Force-reconnect every session (self-heal button for the portal / ops).
app.post('/api/reconnect', async (req, res) => {
  try { const n = await bot.reconnectAll(); res.json({ ok: true, restarted: n }); }
  catch (e) { res.status(500).json({ ok: false, error: e?.message || String(e) }); }
});

// Owner-only: send a REAL WhatsApp message from the bot to a number. This is
// the end-to-end proof that the live pipeline works (not a mock). Defaults to
// the owner number.
app.post('/api/test-send', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Unauthorized — owner token required.' });
  const to = String(req.body?.number || config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
  const text = String(req.body?.text || `✅ *${config.BOT_NAME}* live test — bot kaam kar raha hy!\n💠 Prefix: ${config.PREFIX}\n🕒 ${new Date().toISOString()}`);
  if (!to) return res.status(400).json({ ok: false, error: 'number required' });
  try {
    const sock = bot.getSock();
    if (!sock) return res.status(503).json({ ok: false, error: 'no connected session' });
    const jid = `${to}@s.whatsapp.net`;
    const sent = await sock.sendMessage(jid, { text });
    res.json({ ok: true, to: jid, id: sent?.key?.id || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ---------------------------------------------------------------------------
// Owner-only test runner: executes a REAL command through the REAL handler as
// if the owner had typed it in his own chat — every reply lands in the owner's
// WhatsApp inbox. Iris uses this to test every command end-to-end without a
// second phone. quoteMedia: 'image' | 'video' | 'audio' | 'sticker' attaches a
// REAL (uploaded) media for the command to act on, like a user's reply.
// ---------------------------------------------------------------------------
const { execFile } = require('child_process');
async function genTestFile(kind) {
  const f = `/tmp/iris-test-${kind}`;
  if (fs.existsSync(f)) return f;
  const map = {
    image: ['-f', 'lavfi', '-i', 'color=c=red:s=640x640', '-frames:v', '1', '-f', 'image2', '-vcodec', 'png', f],
    video: ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15', '-pix_fmt', 'yuv420p', '-f', 'mp4', f],
    audio: ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-q:a', '9', '-f', 'mp3', f],
  };
  const args = map[kind] || map.image;
  await new Promise((res2, rej2) => execFile('ffmpeg', args, { timeout: 60000 }, (e, so, se) => (e ? rej2(new Error((se || e.message).slice(0, 200))) : res2())));
  return f;
}
async function makeTestMedia(kind, sock) {
  const { prepareWAMessageMedia } = require('@whiskeysockets/baileys');
  const real = kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image';
  const file = await genTestFile(real);
  const prepared = await prepareWAMessageMedia({ [real]: fs.readFileSync(file) }, { upload: sock.waUploadToServer });
  const proto = prepared[`${real}Message`];
  const quoted = kind === 'sticker'
    ? { stickerMessage: { ...proto, mimetype: 'image/webp' } }
    : { [`${real}Message`]: proto };
  return { quoted };
}
app.post('/api/run-command', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Unauthorized — owner token required.' });
  const text = String(req.body?.command || '').trim();
  const quoteMedia = String(req.body?.quoteMedia || '').trim();
  // Optional `to` (group JID or any chat) — defaults to the owner DM. Lets the
  // live-verification battery run GROUP commands in a real group.
  const toJid = String(req.body?.to || '').trim() || `${config.OWNER_NUMBER}@s.whatsapp.net`;
  if (!text) return res.status(400).json({ ok: false, error: 'command required' });
  try {
    const sock = bot.getSock();
    if (!sock) return res.status(503).json({ ok: false, error: 'no connected session' });
    const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
    // HARNESS: fromMe=true mirrors how real owner input arrives (the bot is a
    // linked device). The remoteJid is already the owner DM, so isOwner() would
    // pass on the number too — but setting fromMe keeps the harness faithful and
    // means a future MODE=private switch can never silently zero out these tests.
    const m = { key: { remoteJid: toJid, fromMe: true, participant: ownerJid, id: 'IRISTEST' + Date.now().toString(36).toUpperCase() }, pushName: 'IrisTest', message: {} };
    if (quoteMedia) {
      const media = await makeTestMedia(quoteMedia, sock);
      m.message = { extendedTextMessage: { text, contextInfo: { quotedMessage: media.quoted, participant: ownerJid, remoteJid: toJid, stanzaId: 'IRISQ' + Date.now().toString(36).toUpperCase() } } };
    } else {
      m.message = { conversation: text };
    }
    let sent = 0;
    const sentLog = [];
    const describe = (c) => {
      if (!c || typeof c !== 'object') return '[?]';
      if (typeof c.text === 'string') return c.text;
      if (typeof c.caption === 'string') return c.caption;
      if (c.poll) return `[poll] ${c.poll.name} | ${c.poll.values.join(' / ')}`;
      if (c.audio) return '[audio]';
      if (c.document) return `[document] ${c.document.fileName || ''}`;
      if (c.image) return '[image]';
      if (c.video) return '[video]';
      if (c.sticker) return '[sticker]';
      if (c.react) return `[react ${c.react.text}]`;
      if (c.delete) return '[delete]';
      return '[other]';
    };
    const sockProxy = new Proxy(sock, {
      get(t, p) {
        if (p === 'sendMessage') return async (jid, content, opts) => { const r = await t.sendMessage(jid, content, opts); sent++; sentLog.push({ jid, text: describe(content).slice(0, 400) }); return r; };
        const v = t[p];
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, p, v) { t[p] = v; return true; },
    });
    await require('./lib/handler').handleMessage(sockProxy, m, { number: config.OWNER_NUMBER, ownerNumber: config.OWNER_NUMBER });
    res.json({ ok: true, ran: text, to: toJid, quoteMedia: quoteMedia || null, replies: sent, texts: sentLog.map((s) => s.text) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
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
    // HARNESS: the fake message must carry fromMe=true. The bot runs as a linked
    // device of the owner, so real owner input always arrives that way — and
    // isOwner() returns true on fromMe before any number matching. Without it the
    // fake sender '0@s.whatsapp.net' resolves to the number "0", which is truthy,
    // so isOwner() bails at its `if (!num)` guard and every test is reported as a
    // failure — logged misleadingly as "private mode: non-owner blocked".
    const m = { key: { remoteJid: '0@s.whatsapp.net', fromMe: true, id: 'T' + Math.random().toString(36).slice(2, 9) }, message: { conversation: t }, pushName: 'SelfTest' };
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
// Self-healing: give the error reporter a way to reach the owner on WhatsApp.
// It messages the owner ONLY when a command throws, deduped to one report per
// 10 minutes per distinct error, so it can never spam.
// ---------------------------------------------------------------------------
const selfheal = require('./lib/selfheal');
selfheal.setNotifier(async (text) => {
  const num = config.OWNER_NUMBER;
  if (!num) return;
  const sock = bot.getSock();
  if (!sock) return;
  await sock.sendMessage(`${num}@s.whatsapp.net`, { text });
});

// ---------------------------------------------------------------------------
// Start the bot (restores every saved session)
// ---------------------------------------------------------------------------
bot.startBot().catch((e) => console.error('bot start fail:', e?.message || e));

// 24/7: ping ourselves so the host never idles the container out. Cheap (one
// localhost request a minute), no external traffic, no cost.
const SELF_PING_MS = Number(process.env.SELF_PING_MS || 60 * 1000);
if (SELF_PING_MS > 0) {
  const ping = setInterval(() => {
    const req = require('http').get({ host: '127.0.0.1', port: config.PORT, path: '/health' }, (r) => r.resume());
    req.on('error', () => {});
  }, SELF_PING_MS);
  if (ping.unref) ping.unref();
}

// SPEED: warm external connections in the background (DNS + TLS pre-connect)
require('./lib/helpers').warmupHosts().catch(() => {});
// SPEED: pre-generate the myth images in the background so the first user to
// type 💋earthquake / 💋dragonfire gets an instant cached image instead of
// waiting ~10s. Fully optional — failures are ignored, and WARM_IMAGES=0
// switches it off.
try { require('./scripts/warm-images'); } catch { /* ignore */ }

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.message || e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e?.message || e));
