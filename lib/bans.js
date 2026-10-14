/**
 * SAQIB-MD — banned-user store
 * ---------------------------
 * Persisted next to the session dir (volume-backed on Railway) so bans
 * survive restarts / redeploys. Banned users are silently ignored by the
 * handler (except the owner).
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(path.dirname(path.resolve(config.SESSION_DIR)), 'saqib-bans.json');

let list = [];

const clean = (n) => String(n || '').replace(/[^0-9]/g, '');

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) list = arr.map(clean).filter(Boolean);
  } catch { list = []; }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
  } catch { /* ignore */ }
}

function has(n) { const c = clean(n); return !!c && list.includes(c); }
function add(n) { const c = clean(n); if (c && !list.includes(c)) { list.push(c); save(); } return c; }
function remove(n) { const c = clean(n); const before = list.length; list = list.filter((x) => x !== c); if (list.length !== before) save(); return c; }
function all() { return [...list]; }

module.exports = { load, save, has, add, remove, all, FILE };
