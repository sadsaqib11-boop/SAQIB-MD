/**
 * SAQIB-MD — per-user menu styles
 * -------------------------------
 * All 10 menu designs are always available. Every user can pick the one THEY
 * like with `.menustyle <1-10>` — it only changes the menu for that user, never
 * for anyone else. The owner sets the bot-wide default with
 * `.menustyle default <1-10>`.
 *
 * Design (mirrors lib/prefixes.js + lib/lang.js):
 *   - The global `config.MENU_STYLE` is the DEFAULT for everyone.
 *   - A user's personal style lives in a JSON file on the volume, keyed by
 *     their phone number, so it survives restarts and redeploys.
 *   - Lookup order: user's own style -> global default.
 *   - Only the user themselves can change their own style (identified by the
 *     sender number), so one user can never alter another's.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(path.dirname(path.resolve(config.SESSION_DIR)), 'saqib-menustyles.json');

const MIN = 1;
const MAX = 10;

/** number -> style id (1-10) */
let MAP = {};

function load() {
  try {
    const obj = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (obj && typeof obj === 'object') MAP = obj;
    console.log(`[MENUSTYLE] loaded ${Object.keys(MAP).length} personal menu styles`);
  } catch { /* first run */ }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(MAP, null, 2));
  } catch (e) {
    console.error('[MENUSTYLE] save fail:', e?.message || e);
  }
}

/** Clamp an arbitrary value to a valid 1-10 style id (falls back to the default). */
function clamp(n, fallback) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < MIN || v > MAX) return fallback;
  return v;
}

/** The menu style a given user should see (their own, else the global default). */
function forUser(number) {
  const n = String(number || '').replace(/[^0-9]/g, '');
  if (n && MAP[n]) return clamp(MAP[n], config.MENU_STYLE);
  return clamp(config.MENU_STYLE, 1);
}

/** Set a user's personal style. Pass null/''/'default' to reset to the global default. */
function set(number, styleId) {
  const n = String(number || '').replace(/[^0-9]/g, '');
  if (!n) return false;
  if (styleId == null || styleId === '' || String(styleId).toLowerCase() === 'default') {
    delete MAP[n];
    save();
    return true;
  }
  const v = parseInt(styleId, 10);
  if (!Number.isFinite(v) || v < MIN || v > MAX) return false;
  MAP[n] = v;
  save();
  return true;
}

/** True when this user has their own style (not the global default). */
function has(number) {
  const n = String(number || '').replace(/[^0-9]/g, '');
  return !!(n && MAP[n]);
}

/** Everyone who has a personal style (owner diagnostics). */
function all() { return { ...MAP }; }

module.exports = { load, save, forUser, set, has, all, clamp, MIN, MAX, FILE };
