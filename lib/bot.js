/**
 * SAQIB-MD — bot lifecycle (multi-session: connect, pair, reconnect, events)
 * ---------------------------------------------------------------------------
 * MULTI-SESSION
 *   Up to config.MAX_SESSIONS (default 50) different WhatsApp numbers can be
 *   linked at the same time. Each number gets its own auth folder
 *   (SESSION_DIR/<number>) and its own socket. The number that links a session
 *   becomes that session's OWNER.
 *
 * THE "could not link device" FIX
 *   When the user types the pairing code, WhatsApp sends a `pair-success`
 *   stanza and then IMMEDIATELY closes the socket with stream:error 515
 *   ("restart required"). That is NOT an error — reopen the connection using
 *   the freshly-issued credentials. We persist creds to disk and, on ANY
 *   non-fatal close while linking, reconnect IMMEDIATELY (no backoff).
 *
 * SPEED
 *   cachedGroupMetadata, shouldIgnoreJid, syncFullHistory:false,
 *   emitOwnEvents:false, low retry delay, cached Baileys version, and
 *   fire-and-forget presence so commands reply instantly.
 */
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('../config');
const { handleMessage } = require('./handler');
const { cleanNumber, formatDuration } = require('./helpers');

const logger = pino({ level: 'silent' });

// Live pairing events (consumed by the SSE endpoint in index.js).
// Every payload includes `number` so the portal can filter per session.
const events = new EventEmitter();
events.setMaxListeners(0);

const MAX_RESTARTS = 10;
const RESTART_DELAY_MS = 200;

const startedAt = Date.now();

// number -> session
const sessions = new Map();

// ---- Baileys version cache (skip the network round-trip on restarts) ----
let cachedVersion = null;
let versionFetched = false;
async function getVersion() {
  if (versionFetched) return cachedVersion;
  try { ({ version: cachedVersion } = await fetchLatestBaileysVersion()); } catch { cachedVersion = undefined; }
  versionFetched = true;
  return cachedVersion;
}

function sessionDir(number) {
  return path.join(path.resolve(config.SESSION_DIR), String(number));
}

function newSession(number) {
  return {
    number: String(number),
    sock: null,
    status: 'unpaired', // unpaired | pairing | connecting | connected | error
    code: null,
    lastError: null,
    since: null,
    me: null,
    startedAt: Date.now(),
    // pairing bookkeeping
    codeSent: false,
    restarts: 0,
    everOpened: false,
    restarting: false,
    reconnectAttempts: 0,
    pairNumber: null,
    pairResolve: null,
    pairReject: null,
    startPromise: null,
    ownerNumber: String(number), // the number that linked this session owns it
  };
}

// ---- group metadata cache (speed) ----
const groupCache = new Map();
async function cachedGroupMetadata(jid) {
  const hit = groupCache.get(jid);
  if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.v;
  const s = getSock();
  if (!s) throw new Error('no socket');
  const v = await s.groupMetadata(jid);
  groupCache.set(jid, { v, t: Date.now() });
  return v;
}

function resetSessionDir(number) {
  try { fs.rmSync(sessionDir(number), { recursive: true, force: true }); } catch { /* ignore */ }
  groupCache.clear();
}

function failPair(session, err) {
  if (session.pairReject) {
    const r = session.pairReject;
    session.pairResolve = null;
    session.pairReject = null;
    r(err);
  }
}

/** Create a fresh socket for a session and attach every listener */
async function createSocket(session) {
  const dir = sessionDir(session.number);
  fs.mkdirSync(dir, { recursive: true });

  const { state: auth, saveCreds } = await useMultiFileAuthState(dir);
  const version = await getVersion();

  if (auth.creds.registered && auth.creds.me?.id) {
    const n = cleanNumber(auth.creds.me.id.split(':')[0].split('@')[0]);
    if (n) { session.number = n; session.ownerNumber = n; }
  }

  const s = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
    markOnlineOnConnect: !!config.ONLINE,
    syncFullHistory: false,
    emitOwnEvents: false,
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 20000,
    defaultQueryTimeoutMs: 30000,
    retryRequestDelayMs: 500,
    generateHighQualityLinkPreview: false,
    cachedGroupMetadata,
    shouldIgnoreJid: (jid) => typeof jid === 'string' && (
      (jid === 'status@broadcast' && !config.AUTOSTATUS) || jid.endsWith('@newsletter')
    ),
    getMessage: async () => undefined,
  });

  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', (u) => onConnectionUpdate(session, s, u));
  s.ev.on('messages.upsert', (u) => onMessagesUpsert(session, s, u));
  s.ev.on('group-participants.update', (u) => onGroupUpdate(session, s, u));
  s.ev.on('call', (u) => onCall(session, s, u));
  return s;
}

/** Start (or restart) one session's socket — idempotent */
async function startSession(session) {
  if (session.startPromise) return session.startPromise;
  session.startPromise = (async () => {
    try {
      if (session.sock) { try { session.sock.end(undefined); } catch { /* ignore */ } session.sock = null; }
      session.sock = await createSocket(session);
      const reg = session.sock.authState?.creds?.registered;
      if (session.status !== 'pairing') session.status = reg ? 'connecting' : 'unpaired';
    } catch (e) {
      session.status = 'error';
      session.lastError = e?.message || String(e);
      console.error(`[BOT:${session.number}] start fail:`, e?.message || e);
    } finally {
      session.startPromise = null;
    }
  })();
  return session.startPromise;
}

function scheduleReconnect(session, immediate = false) {
  if (session.restarting) return;
  session.restarting = true;
  session.reconnectAttempts += 1;
  const delay = immediate ? RESTART_DELAY_MS : Math.min(30000, 1500 * session.reconnectAttempts);
  setTimeout(() => { session.restarting = false; startSession(session).catch(() => {}); }, delay);
}

function onConnectionUpdate(session, s, upd) {
  if (s !== session.sock) return; // stale socket guard

  const { connection, lastDisconnect, qr, isNewLogin } = upd;

  if (isNewLogin) {
    session.status = 'pairing';
    session.lastError = null;
    events.emit('linking', { number: session.number });
    return;
  }

  // first QR (also fires in pairing-code mode): request the code
  if (qr && session.pairNumber && !session.codeSent && !(s.authState?.creds?.registered)) {
    session.codeSent = true;
    s.requestPairingCode(session.pairNumber)
      .then((code) => {
        session.code = code;
        session.number = session.pairNumber;
        session.status = 'pairing';
        events.emit('code', { number: session.number, code });
        if (session.pairResolve) { const r = session.pairResolve; session.pairResolve = null; session.pairReject = null; r(code); }
      })
      .catch((err) => {
        session.codeSent = false;
        session.lastError = err?.message || String(err);
        events.emit('error', { number: session.number, error: session.lastError });
        failPair(session, err);
      });
    return;
  }

  if (connection === 'connecting') {
    if (session.status !== 'pairing') session.status = 'connecting';
    return;
  }

  if (connection === 'open') {
    session.everOpened = true;
    session.status = 'connected';
    session.since = Date.now();
    session.code = null;
    session.lastError = null;
    session.reconnectAttempts = 0;
    session.restarts = 0;
    session.restarting = false;
    session.pairNumber = null;
    session.codeSent = false;
    const me = s.user?.id?.split(':')[0]?.split('@')[0];
    if (me) { session.number = cleanNumber(me); session.ownerNumber = cleanNumber(me); }
    session.me = s.user?.id || null;

    // First linked number becomes the global owner if none is set.
    if (!config.OWNER_NUMBER) {
      config.OWNER_NUMBER = session.ownerNumber;
      try { require('./settings').save(); } catch { /* ignore */ }
    }

    console.log(`✅ ${config.BOT_NAME} session connected as ${session.number} (owner: ${session.ownerNumber})`);
    events.emit('paired', { number: session.number });
    s.sendMessage(`${session.number}@s.whatsapp.net`, {
      text: `🤖 *${config.BOT_NAME}* online hy!\nType *${config.PREFIX}menu* for all commands.`,
    }).catch(() => {});
    if (config.AUTOBIO) {
      s.updateProfileStatus(`${config.BOT_NAME} | ${config.OWNER_NAME}`).catch(() => {});
    }
    return;
  }

  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

    if (loggedOut) {
      console.log(`⚠️ [${session.number}] logged out / 401 — session reset`);
      resetSessionDir(session.number);
      session.sock = null;
      session.codeSent = false;
      session.everOpened = false;
      session.status = 'unpaired';
      session.me = null;
      session.code = null;
      session.lastError = null;
      scheduleReconnect(session, false);
      return;
    }

    const registered = s.authState?.creds?.registered;
    if (!session.everOpened && (session.codeSent || registered)) {
      if (session.restarting) return;
      session.restarts += 1;
      if (session.restarts > MAX_RESTARTS) {
        session.status = 'error';
        session.lastError = 'Could not complete linking. Please try again.';
        events.emit('error', { number: session.number, error: session.lastError });
        failPair(session, new Error('Could not complete linking. Please try again.'));
        resetSessionDir(session.number);
        session.codeSent = false;
        scheduleReconnect(session, false);
        return;
      }
      console.log(`🔁 [${session.number}] restartRequired (${statusCode}) — reconnect ${session.restarts}/${MAX_RESTARTS}`);
      session.restarting = true;
      try { s.end(undefined); } catch { /* ignore */ }
      setTimeout(() => { session.restarting = false; startSession(session).catch(() => {}); }, RESTART_DELAY_MS);
      return;
    }

    session.status = 'connecting';
    console.log(`🔄 [${session.number}] reconnecting... (${statusCode})`);
    scheduleReconnect(session, false);
  }
}

async function onMessagesUpsert(session, s, { messages, type }) {
  if (type !== 'notify') return;
  for (const m of messages) {
    const jid = m.key?.remoteJid || '';
    if (jid === 'status@broadcast' && !config.AUTOSTATUS) continue;
    if (jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) continue;
    handleMessage(s, m, session).catch((e) => console.error('[MSG]', e?.message || e));
  }
}

async function onGroupUpdate(session, s, upd) {
  if (!config.WELCOME && !config.GOODBYE) return;
  try {
    const meta = await s.groupMetadata(upd.id);
    const name = meta.subject;
    for (const jid of upd.participants) {
      const num = cleanNumber(jid.split('@')[0]);
      if (upd.action === 'add' && config.WELCOME) {
        await s.sendMessage(upd.id, {
          text: `👋 Welcome *+${num}* to *${name}*!\n\nType ${config.PREFIX}menu to see what I can do 🔥`,
        }).catch(() => {});
      }
      if (upd.action === 'remove' && config.GOODBYE) {
        await s.sendMessage(upd.id, {
          text: `🕊️ *+${num}* left *${name}*. Allah Hafiz!`,
        }).catch(() => {});
      }
    }
  } catch { /* ignore */ }
}

async function onCall(session, s, calls) {
  if (!config.ANTICALL) return;
  try {
    for (const c of calls || []) {
      if (c.status === 'offer') {
        await s.rejectCall(c.id, c.from).catch(() => {});
        await s.sendMessage(c.from, { text: `📵 *Anti-Call* on hy — call reject kar di.` }).catch(() => {});
      }
    }
  } catch { /* ignore */ }
}

/** Request an 8-char pairing code for a phone number (creates a session) */
async function requestPair(rawNumber) {
  const number = cleanNumber(rawNumber);
  if (!number || number.length < 8 || number.length > 15) {
    throw new Error('Valid WhatsApp number do country code ke sath (e.g. 923001234567).');
  }

  let session = sessions.get(number);
  if (session && session.status === 'connected') throw new Error('Ye number already linked hai ✅');

  if (!session) {
    if (sessions.size >= config.MAX_SESSIONS) {
      throw new Error(`Max ${config.MAX_SESSIONS} sessions allowed. Koi purana session hatao.`);
    }
    session = newSession(number);
    sessions.set(number, session);
  }

  // supersede any pending pairing request for this session
  if (session.pairReject) {
    const r = session.pairReject;
    session.pairResolve = null;
    session.pairReject = null;
    r(new Error('Superseded by a new pairing request.'));
  }

  session.codeSent = false;
  session.restarts = 0;
  session.everOpened = false;
  session.code = null;
  session.lastError = null;
  session.pairNumber = number;

  if (session.sock?.authState?.creds?.registered) { resetSessionDir(number); session.sock = null; }
  if (session.sock) { try { session.sock.end(undefined); } catch { /* ignore */ } session.sock = null; }
  await startSession(session);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pairResolve = null;
      session.pairReject = null;
      reject(new Error('Pairing code nahi bana (timeout). Dobara try karo.'));
    }, 45000);
    session.pairResolve = (code) => { clearTimeout(timer); resolve(code); };
    session.pairReject = (err) => { clearTimeout(timer); reject(err); };
  });
}

/** Remove a session (logout + delete creds) */
async function removeSession(number) {
  const n = cleanNumber(number);
  const session = sessions.get(n);
  if (!session) return false;
  try { await session.sock?.logout(); } catch { /* ignore */ }
  try { session.sock?.end(undefined); } catch { /* ignore */ }
  resetSessionDir(n);
  sessions.delete(n);
  return true;
}

/** Restore every session folder found on disk (survives redeploys) */
async function restoreSessions() {
  const base = path.resolve(config.SESSION_DIR);
  let dirs = [];
  try { dirs = fs.readdirSync(base).filter((d) => fs.statSync(path.join(base, d)).isDirectory()); } catch { return; }
  for (const d of dirs) {
    if (!/^[0-9]{8,15}$/.test(d)) continue; // only numeric session folders
    if (sessions.has(d)) continue;
    if (sessions.size >= config.MAX_SESSIONS) break;
    const session = newSession(d);
    sessions.set(d, session);
    startSession(session).catch(() => {});
  }
  if (dirs.length) console.log(`[BOT] restoring ${sessions.size} session(s) from disk`);
}

async function startBot() {
  await restoreSessions();
}

function getSock() {
  for (const s of sessions.values()) if (s.status === 'connected' && s.sock) return s.sock;
  for (const s of sessions.values()) if (s.sock) return s.sock;
  return null;
}

function listSessions() {
  return [...sessions.values()].map((s) => ({
    number: s.number, status: s.status, since: s.since, me: s.me, owner: s.ownerNumber,
  }));
}

function getStatus() {
  const list = [...sessions.values()];
  const connected = list.filter((s) => s.status === 'connected');
  const primary = connected[0] || list[0] || null;
  return {
    status: primary ? primary.status : 'idle',
    connected: connected.length > 0,
    number: primary ? primary.number : null,
    code: primary ? primary.code : null,
    me: primary ? primary.me : null,
    lastError: primary ? primary.lastError : null,
    since: primary ? primary.since : null,
    uptime: formatDuration(Date.now() - startedAt),
    botName: config.BOT_NAME,
    owner: config.OWNER_NAME,
    sessionCount: list.length,
    connectedCount: connected.length,
    maxSessions: config.MAX_SESSIONS,
    sessions: listSessions(),
  };
}

module.exports = { startBot, requestPair, removeSession, getStatus, getSock, listSessions, events, sessions };
