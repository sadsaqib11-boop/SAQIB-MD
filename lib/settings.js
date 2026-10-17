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

// Bump this whenever the DEFAULT set changes in a way that should reset the
// persisted overrides ONCE. The owner asked for "everything OFF by default
// except always-online + antiviewonce" — a stale volume file (with AUTO_READ
// etc. left ON from earlier testing) would otherwise silently keep them on.
// When the stored schema is older, we ignore the file, start from the fresh
// config.js defaults, and re-save with the new schema.
//   schema 2 -> 3: reset the stale "everything ON" overrides, add ANTIMENTION,
//   MENU_STYLE, FAST_MODE and the corrected AUTOSAVESTATUS default.
const SCHEMA = 3;

// Keys that may be overridden at runtime (and persisted).
const KEYS = [
  'MODE', 'PREFIX', 'BOT_NAME', 'OWNER_NAME', 'OWNER_NUMBER',
  'AUTO_READ', 'AUTO_TYPING', 'AUTO_REACT', 'AUTO_REACT_GROUP', 'AUTO_REACT_CHAT', 'WELCOME', 'GOODBYE',
  'ANTILINK', 'ANTIDELETE', 'ANTIDELETE_INBOX', 'ANTIDELETE_TO_CHAT', 'ANTICALL_MSG', 'ANTIEDIT', 'ANTISPAM', 'ANTICALL',
  'AUTOSTATUS', 'AUTOSAVESTATUS', 'AUTOVIEWONCE', 'AUTOBIO', 'CHATBOT', 'AUTOREAD_STATUS',
  'ONLINE', 'SUDO', 'RECORDING', 'STATUSVIEW', 'ADMINISTRATION', 'MENTION_REPLY', 'ANTIMENTION',
  'WELCOME_MSG', 'GOODBYE_MSG', 'STATUS_EMOJI', 'DESCRIPTION', 'STICKER_NAME',
  'PRIVACY', 'GROUP_PRIVACY', 'BOT_PIC', 'MENU_STYLE', 'DEFAULT_FONT', 'FAST_MODE',
];

/**
 * Is a key EXPLICITLY set in the environment (Railway / .env)?
 * An explicit env var is treated as authoritative: it always beats a stale
 * value left behind on the /data volume from an earlier deploy. This is what
 * fixes the "prefix stayed 💋 even though PREFIX=." bug — the volume file had
 * an old override and it silently won. Now: if you set it in env, env wins.
 */
function envSet(key) {
  const v = process.env[key];
  return v !== undefined && String(v) !== '';
}

/** Load persisted overrides into the live config (called once at boot). */
function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const obj = JSON.parse(raw);
    // Schema migration: an older file predates the current default set, so we
    // discard its overrides (fresh config.js defaults win) and re-save.
    if (obj._schema !== SCHEMA) {
      console.log(`[SETTINGS] schema ${obj._schema || 'legacy'} -> ${SCHEMA}: resetting to defaults`);
      save();
      return;
    }
    let applied = 0, skipped = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (!KEYS.includes(k)) continue;
      if (envSet(k)) { skipped++; continue; } // env is authoritative
      config[k] = v; applied++;
    }
    console.log(`[SETTINGS] loaded ${applied} overrides (${skipped} skipped — env wins) from ${FILE}`);
  } catch { /* first run — nothing to load */ }
}

/** Persist the current values of all overridable keys. */
function save() {
  try {
    const obj = { _schema: SCHEMA };
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

module.exports = { load, save, reset, FILE, KEYS, DEFAULTS, SCHEMA };
