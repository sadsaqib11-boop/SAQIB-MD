/**
 * SAQIB-MD — bot lifecycle (connect, pair, reconnect, events)
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
const config = require('../config');
const { handleMessage } = require('./handler');
const { cleanNumber, formatDuration } = require('./helpers');

const logger = pino({ level: 'silent' });

let sock = null;
let starting = false;
let socketReady = false; // true once the socket emits its first qr / connecting
let startedAt = Date.now();
let reconnectAttempts = 0; // for exponential backoff + self-healing

const state = {
  status: 'idle', // idle | starting | unpaired | pairing | connecting | connected | logged_out | error
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

/** Wait until the socket is ready to accept a pairing-code request */
function waitReady(timeoutMs = 40000) {
  return new Promise((resolve, reject) => {
    if (socketReady) return resolve();
    const s = sock;
    if (!s) return reject(new Error('Socket start nahi hua.'));
    const t = setTimeout(() => {
      s.ev?.off?.('connection.update', onUpd);
      reject(new Error('Socket ready nahi hua (timeout). Dobara try karo.'));
    }, timeoutMs);
    const onUpd = (u) => {
      if (u.qr || u.connection === 'connecting' || u.connection === 'open') {
        clearTimeout(t);
        s.ev?.off?.('connection.update', onUpd);
        resolve();
      }
    };
    s.ev.on('connection.update', onUpd);
  });
}

/** Request an 8-char pairing code for a phone number */
async function requestPair(rawNumber) {
  const number = cleanNumber(rawNumber);
  if (!number || number.length < 8 || number.length > 15) {
    throw new Error('Valid WhatsApp number do country code ke sath (e.g. 923001234567).');
  }
  if (state.status === 'connected') throw new Error('Bot already linked hai ✅');

  const attempt = async () => {
    if (!sock) await startBot();
    await waitReady(40000);
    if (sock.authState?.creds?.registered) {
      throw new Error('Ye session already registered hai. Naya pair karne ke liye session delete karo.');
    }
    return sock.requestPairingCode(number);
  };

  let code;
  try {
    code = await attempt();
  } catch (e) {
    // One retry with a fresh socket (handles stale/dead sockets).
    console.log('pair retry:', e?.message || e);
    sock = null;
    socketReady = false;
    try { fs.rmSync(path.resolve(config.SESSION_DIR), { recursive: true, force: true }); } catch { /* ignore */ }
    await startBot();
    code = await attempt();
  }
  state.code = code;
  state.number = number;
  state.status = 'pairing';
  return code;
}

/** Start (or restart) the WhatsApp socket */
async function startBot() {
  if (starting) return;
  starting = true;
  socketReady = false;
  try {
    const sessionDir = path.resolve(config.SESSION_DIR);
    fs.mkdirSync(sessionDir, { recursive: true });

    const { state: auth, saveCreds } = await useMultiFileAuthState(sessionDir);
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }

    state.status = auth.creds.registered ? 'connecting' : 'unpaired';
    if (auth.creds.registered && auth.creds.me?.id) {
      state.number = cleanNumber(auth.creds.me.id.split(':')[0].split('@')[0]);
    }

    sock = makeWASocket({
      version,
      auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
      logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      defaultQueryTimeoutMs: 60000,
      retryRequestDelayMs: 2000,
      generateHighQualityLinkPreview: false,
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', onConnectionUpdate);
    sock.ev.on('messages.upsert', onMessagesUpsert);
    sock.ev.on('group-participants.update', onGroupUpdate);
    sock.ev.on('call', onCall);
  } catch (e) {
    state.status = 'error';
    state.lastError = e?.message || String(e);
    console.error('[BOT] start fail:', e?.message || e);
  } finally {
    starting = false;
  }
}

function onConnectionUpdate(upd) {
  const { connection, lastDisconnect, qr } = upd;
  if (qr) socketReady = true;

  if (connection === 'connecting') {
    socketReady = true;
    if (state.status !== 'pairing') state.status = 'connecting';
  }

  if (connection === 'open') {
    state.status = 'connected';
    state.since = Date.now();
    state.code = null;
    state.lastError = null;
    reconnectAttempts = 0;
    const me = sock.user?.id?.split(':')[0]?.split('@')[0];
    if (me) state.number = cleanNumber(me);
    state.me = sock.user?.id || null;
    console.log(`✅ ${config.BOT_NAME} connected as ${state.number}`);
    if (config.OWNER_NUMBER) {
      sock.sendMessage(`${config.OWNER_NUMBER}@s.whatsapp.net`, {
        text: `🤖 *${config.BOT_NAME}* online hy!\nType *${config.PREFIX}menu* for all commands.`,
      }).catch(() => {});
    }
  }

  if (connection === 'close') {
    const code = lastDisconnect?.error?.output?.statusCode;
    // 401 = loggedOut. This also happens on a fresh/unpaired socket after an
    // unused or expired pairing code, so we must ALWAYS self-heal: reset any
    // partial session and come back so the user can pair again.
    if (code === DisconnectReason.loggedOut || code === 401) {
      console.log('⚠️ Logged out / 401 — session reset, reconnecting...');
      try { fs.rmSync(path.resolve(config.SESSION_DIR), { recursive: true, force: true }); } catch { /* ignore */ }
      sock = null;
      socketReady = false;
      state.status = 'unpaired';
      state.number = null;
      state.me = null;
      state.code = null;
      state.lastError = null;
      reconnectAttempts += 1;
      const delay = Math.min(30000, 2500 * reconnectAttempts);
      setTimeout(() => startBot().catch(() => {}), delay);
      return;
    }
    state.status = 'connecting';
    reconnectAttempts += 1;
    const delay = Math.min(30000, 2500 * reconnectAttempts);
    console.log(`🔄 Reconnecting... (${code}) in ${delay}ms`);
    setTimeout(() => startBot().catch(() => {}), delay);
  }
}

async function onMessagesUpsert({ messages, type }) {
  if (type !== 'notify') return;
  for (const m of messages) {
    await handleMessage(sock, m).catch((e) => console.error('[MSG]', e?.message || e));
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
  } catch (e) { /* ignore */ }
}

async function onCall() {
  // auto-reject calls if configured (kept simple / safe)
}

function getSock() { return sock; }

module.exports = { startBot, requestPair, getStatus, getSock };
