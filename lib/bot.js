/**
 * SAQIB-MD — bot lifecycle (connect, pair, reconnect, events)
 * ----------------------------------------------------------
 * THE "could not link device" FIX
 * -------------------------------
 * When the user types the pairing code on their phone, WhatsApp sends a
 * `pair-success` stanza and then IMMEDIATELY closes the socket with
 * stream:error code 515 ("restart required"). This is NOT an error — it
 * means: reopen the connection using the freshly-issued credentials.
 *
 * The old code treated that close as a dead-end, so the phone kept
 * spinning on "logging in…" and finally showed "Could not link device".
 *
 * THE FIX (implemented here):
 *   1. Persist credentials to disk (useMultiFileAuthState) so the paired
 *      creds survive the restart.
 *   2. Request the pairing code on the `qr` event (never on a fixed timer),
 *      and only when `sock.authState.creds.registered === false`.
 *   3. On ANY non-fatal close while linking (515 / 428 / 408 / …) reconnect
 *      IMMEDIATELY (no backoff) and re-read the saved creds — this is what
 *      actually completes the link.
 *   4. Detect `isNewLogin` to know the phone accepted the code.
 *   5. Self-heal on 401/loggedOut (reset session, come back unpaired).
 *
 * SPEED
 * -----
 *   cachedGroupMetadata, shouldIgnoreJid (skip status/broadcast),
 *   syncFullHistory:false, emitOwnEvents:false, low retry delay, and a
 *   singleton socket so we never run two connections at once.
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

// Live pairing events (consumed by the SSE endpoint in index.js)
const events = new EventEmitter();
events.setMaxListeners(0);

const MAX_RESTARTS = 10;         // cap on 515-style restarts while linking
const RESTART_DELAY_MS = 200;    // immediate, but let the old socket die first

let sock = null;
let startPromise = null;
let startedAt = Date.now();
let reconnectAttempts = 0;

// ---- pairing / restart bookkeeping ----
let codeSent = false;      // a pairing code has been issued for this attempt
let pairNumber = null;     // number waiting for a pairing code
let pairResolve = null;    // resolve() of the pending requestPair promise
let pairReject = null;     // reject()  of the pending requestPair promise
let restarts = 0;          // 515-style restarts since the code was issued
let restarting = false;    // guard against a double reconnect
let everOpened = false;    // reached 'open' at least once since pairing began

// ---- Baileys version cache (speed: skip the network round-trip on restarts) ----
let cachedVersion = null;
let versionFetched = false;
async function getVersion() {
  if (versionFetched) return cachedVersion;
  try { ({ version: cachedVersion } = await fetchLatestBaileysVersion()); } catch { cachedVersion = undefined; }
  versionFetched = true;
  return cachedVersion;
}

const state = {
  status: 'idle', // idle | unpaired | pairing | connecting | connected | error
  number: null,
  code: null,
  me: null,
  lastError: null,
  since: null,
};

function getStatus() {
  return {
    ...state,
    connected: state.status === 'connected',
    uptime: formatDuration(Date.now() - startedAt),
    botName: config.BOT_NAME,
    owner: config.OWNER_NAME,
  };
}

// ---- group metadata cache (speed: avoids a network round-trip per message) ----
const groupCache = new Map();
async function cachedGroupMetadata(jid) {
  const hit = groupCache.get(jid);
  if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.v;
  const v = await sock.groupMetadata(jid);
  groupCache.set(jid, { v, t: Date.now() });
  return v;
}

function resetSession() {
  try { fs.rmSync(path.resolve(config.SESSION_DIR), { recursive: true, force: true }); } catch { /* ignore */ }
  groupCache.clear();
}

function failPair(err) {
  if (pairReject) { const r = pairReject; pairResolve = null; pairReject = null; r(err); }
}

/** Create a fresh socket and attach every listener */
async function createSocket() {
  const sessionDir = path.resolve(config.SESSION_DIR);
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state: auth, saveCreds } = await useMultiFileAuthState(sessionDir);
  const version = await getVersion();

  if (auth.creds.registered && auth.creds.me?.id) {
    state.number = cleanNumber(auth.creds.me.id.split(':')[0].split('@')[0]);
  }

  const s = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
    markOnlineOnConnect: true,
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
  s.ev.on('connection.update', (u) => onConnectionUpdate(s, u));
  s.ev.on('messages.upsert', onMessagesUpsert);
  s.ev.on('group-participants.update', onGroupUpdate);
  s.ev.on('call', onCall);
  return s;
}

/** Start (or restart) the WhatsApp socket — idempotent / singleton */
async function startBot() {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    try {
      if (sock) { try { sock.end(undefined); } catch { /* ignore */ } sock = null; }
      sock = await createSocket();
      const reg = sock.authState?.creds?.registered;
      if (state.status !== 'pairing') state.status = reg ? 'connecting' : 'unpaired';
    } catch (e) {
      state.status = 'error';
      state.lastError = e?.message || String(e);
      console.error('[BOT] start fail:', e?.message || e);
    } finally {
      startPromise = null;
    }
  })();
  return startPromise;
}

function scheduleReconnect(immediate = false) {
  if (restarting) return;
  restarting = true;
  reconnectAttempts += 1;
  const delay = immediate ? RESTART_DELAY_MS : Math.min(30000, 1500 * reconnectAttempts);
  setTimeout(() => { restarting = false; startBot().catch(() => {}); }, delay);
}

function onConnectionUpdate(s, upd) {
  // Ignore events from a socket that has already been replaced/ended —
  // otherwise a stale close would race and kill the live pairing socket.
  if (s !== sock) return;

  const { connection, lastDisconnect, qr, isNewLogin } = upd;

  // ---- the phone accepted the code; a restart is on its way ----
  if (isNewLogin) {
    state.status = 'pairing';
    state.lastError = null;
    events.emit('linking');
    return;
  }

  // ---- first QR (also fires in pairing-code mode): request the code ----
  if (qr && pairNumber && !codeSent && !(s.authState?.creds?.registered)) {
    codeSent = true;
    s.requestPairingCode(pairNumber)
      .then((code) => {
        state.code = code;
        state.number = pairNumber;
        state.status = 'pairing';
        events.emit('code', code);
        if (pairResolve) { const r = pairResolve; pairResolve = null; pairReject = null; r(code); }
      })
      .catch((err) => {
        codeSent = false;
        state.lastError = err?.message || String(err);
        events.emit('error', state.lastError);
        failPair(err);
      });
    return;
  }

  if (connection === 'connecting') {
    if (state.status !== 'pairing') state.status = 'connecting';
    return;
  }

  if (connection === 'open') {
    everOpened = true;
    state.status = 'connected';
    state.since = Date.now();
    state.code = null;
    state.lastError = null;
    reconnectAttempts = 0;
    restarts = 0;
    restarting = false;
    pairNumber = null;
    codeSent = false;
    const me = s.user?.id?.split(':')[0]?.split('@')[0];
    if (me) state.number = cleanNumber(me);
    state.me = s.user?.id || null;
    console.log(`✅ ${config.BOT_NAME} connected as ${state.number}`);
    events.emit('paired', state.number);
    if (config.OWNER_NUMBER) {
      s.sendMessage(`${config.OWNER_NUMBER}@s.whatsapp.net`, {
        text: `🤖 *${config.BOT_NAME}* online hy!\nType *${config.PREFIX}menu* for all commands.`,
      }).catch(() => {});
    }
    return;
  }

  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

    // ---- truly logged out / unlinked: reset & self-heal ----
    if (loggedOut) {
      console.log('⚠️ Logged out / 401 — session reset, reconnecting...');
      resetSession();
      sock = null;
      codeSent = false;
      everOpened = false;
      state.status = 'unpaired';
      state.number = null;
      state.me = null;
      state.code = null;
      state.lastError = null;
      scheduleReconnect(false);
      return;
    }

    // ---- 515 restartRequired (and every transient close) while linking ----
    // THIS is the fix for "could not link device": reconnect IMMEDIATELY
    // with the freshly-saved credentials so the link completes.
    const registered = s.authState?.creds?.registered;
    if (!everOpened && (codeSent || registered)) {
      if (restarting) return;
      restarts += 1;
      if (restarts > MAX_RESTARTS) {
        console.log('❌ Linking failed after max restarts.');
        state.status = 'error';
        state.lastError = 'Could not complete linking. Please try again.';
        events.emit('error', state.lastError);
        failPair(new Error('Could not complete linking. Please try again.'));
        resetSession();
        codeSent = false;
        scheduleReconnect(false);
        return;
      }
      console.log(`🔁 restartRequired (${statusCode}) — immediate reconnect ${restarts}/${MAX_RESTARTS}`);
      restarting = true;
      try { s.end(undefined); } catch { /* ignore */ }
      setTimeout(() => { restarting = false; startBot().catch(() => {}); }, RESTART_DELAY_MS);
      return;
    }

    // ---- normal drop after being connected: backoff reconnect ----
    state.status = 'connecting';
    console.log(`🔄 Reconnecting... (${statusCode})`);
    scheduleReconnect(false);
  }
}

async function onMessagesUpsert({ messages, type }) {
  if (type !== 'notify') return;
  for (const m of messages) {
    const jid = m.key?.remoteJid || '';
    // status@broadcast is only processed when auto-status is enabled
    if (jid === 'status@broadcast' && !config.AUTOSTATUS) continue;
    if (jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) continue;
    // dispatch without awaiting → messages in a burst are handled in parallel (speed)
    handleMessage(sock, m).catch((e) => console.error('[MSG]', e?.message || e));
  }
}

async function onGroupUpdate(upd) {
  if (!config.WELCOME && !config.GOODBYE) return;
  try {
    const meta = await sock.groupMetadata(upd.id);
    const name = meta.subject;
    for (const jid of upd.participants) {
      const num = cleanNumber(jid.split('@')[0]);
      if (upd.action === 'add' && config.WELCOME) {
        await sock.sendMessage(upd.id, {
          text: `👋 Welcome *+${num}* to *${name}*!\n\nType ${config.PREFIX}menu to see what I can do 🔥`,
        }).catch(() => {});
      }
      if (upd.action === 'remove' && config.GOODBYE) {
        await sock.sendMessage(upd.id, {
          text: `🕊️ *+${num}* left *${name}*. Allah Hafiz!`,
        }).catch(() => {});
      }
    }
  } catch { /* ignore */ }
}

async function onCall() {
  // calls are ignored (kept simple / safe)
}

/** Request an 8-char pairing code for a phone number */
async function requestPair(rawNumber) {
  const number = cleanNumber(rawNumber);
  if (!number || number.length < 8 || number.length > 15) {
    throw new Error('Valid WhatsApp number do country code ke sath (e.g. 923001234567).');
  }
  if (state.status === 'connected') throw new Error('Bot already linked hai ✅');

  // If another pairing request is still pending, supersede it so it never hangs.
  if (pairReject) { const r = pairReject; pairResolve = null; pairReject = null; r(new Error('Superseded by a new pairing request.')); }

  // reset pairing bookkeeping
  codeSent = false;
  restarts = 0;
  everOpened = false;
  state.code = null;
  state.lastError = null;
  pairNumber = number;

  // If a registered session exists, clear it so we can pair fresh.
  if (sock?.authState?.creds?.registered) { resetSession(); sock = null; }

  // Always start a fresh socket so a QR (the pairing trigger) is emitted promptly.
  if (sock) { try { sock.end(undefined); } catch { /* ignore */ } sock = null; }
  await startBot();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pairResolve = null; pairReject = null;
      reject(new Error('Pairing code nahi bana (timeout). Dobara try karo.'));
    }, 45000);
    pairResolve = (code) => { clearTimeout(timer); resolve(code); };
    pairReject = (err) => { clearTimeout(timer); reject(err); };
  });
}

function getSock() { return sock; }

module.exports = { startBot, requestPair, getStatus, getSock, events };
