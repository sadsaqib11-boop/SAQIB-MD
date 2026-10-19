/**
 * SAQIB-MD — small persistent JSON store for the extra plugins
 * (economy, levels, group protection settings, notes, todos, reminders).
 * Lives next to the session dir so it survives redeploys on a mounted volume.
 * Writes are debounced so a busy group never hammers the disk.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(path.dirname(path.resolve(config.SESSION_DIR || './session')), 'saqib-xstore.json');

let data = {};
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { data = {}; }

let timer = null;
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(data));
    } catch { /* disk issues must never crash the bot */ }
  }, 2000);
  if (typeof timer.unref === 'function') timer.unref();
}

/** Named top-level object (created on first use). */
function bucket(name) {
  if (!data[name] || typeof data[name] !== 'object') data[name] = {};
  return data[name];
}

/** Per-key record inside a bucket, created with `defaults` on first use. */
function record(name, key, defaults = {}) {
  const b = bucket(name);
  if (!b[key] || typeof b[key] !== 'object') b[key] = { ...defaults };
  return b[key];
}

module.exports = { bucket, record, save, FILE };
