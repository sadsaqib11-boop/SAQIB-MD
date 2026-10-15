/**
 * SAQIB-MD — persistent runtime settings
 * --------------------------------------
 * Toggle commands (.autoreact, .antidelete, …) change `config` live, but a
 * plain `.env` write does NOT survive a redeploy on Railway (the container
 * filesystem is ephemeral). We therefore persist overrides to a JSON file
 * placed NEXT TO the session dir — which lives on the mounted volume
 * (/data) — so every toggle survives restarts and redeploys.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

// /data/session  ->  /data/saqib-settings.json   (volume-backed)
const FILE = path.join(path.dirname(path.resolve(config.SESSION_DIR)), 'saqib-settings.json');

// Keys that may be overridden at runtime (and persisted).
const KEYS = [
  'MODE', 'PREFIX', 'BOT_NAME', 'OWNER_NAME', 'OWNER_NUMBER',
  'AUTO_READ', 'AUTO_TYPING', 'AUTO_REACT', 'AUTO_REACT_GROUP', 'AUTO_REACT_CHAT', 'WELCOME', 'GOODBYE',
  'ANTILINK', 'ANTIDELETE', 'ANTIDELETE_INBOX', 'ANTIDELETE_TO_CHAT', 'ANTICALL_MSG', 'ANTIEDIT', 'ANTISPAM', 'ANTICALL',
  'AUTOSTATUS', 'AUTOSAVESTATUS', 'AUTOVIEWONCE', 'AUTOBIO', 'CHATBOT', 'AUTOREAD_STATUS',
  'ONLINE', 'SUDO', 'RECORDING', 'STATUSVIEW', 'ADMINISTRATION', 'MENTION_REPLY',
  'WELCOME_MSG', 'GOODBYE_MSG', 'STATUS_EMOJI', 'DESCRIPTION', 'STICKER_NAME',
  'PRIVACY', 'GROUP_PRIVACY',
];

/** Load persisted overrides into the live config (called once at boot). */
function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const obj = JSON.parse(raw);
    for (const [k, v] of Object.entries(obj)) {
      if (KEYS.includes(k)) config[k] = v;
    }
    console.log(`[SETTINGS] loaded ${Object.keys(obj).length} overrides from ${FILE}`);
  } catch { /* first run — nothing to load */ }
}

/** Persist the current values of all overridable keys. */
function save() {
  try {
    const obj = {};
    for (const k of KEYS) obj[k] = config[k];
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('[SETTINGS] save fail:', e?.message || e);
  }
}

/**
 * Snapshot of the boot-time (env) defaults, captured BEFORE load() applies any
 * persisted overrides. Powers `.reset` (restore one key or everything).
 */
const DEFAULTS = {};
for (const k of KEYS) DEFAULTS[k] = config[k];

/** Reset one key (or all when key is omitted) back to its boot default. */
function reset(key) {
  if (key) {
    if (!KEYS.includes(key)) return false;
    config[key] = DEFAULTS[key];
  } else {
    for (const k of KEYS) config[k] = DEFAULTS[k];
  }
  save();
  return true;
}

module.exports = { load, save, reset, FILE, KEYS, DEFAULTS };
