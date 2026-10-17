/**
 * SAQIB-MD — in-memory debug ring buffer
 * -------------------------------------
 * Records the last N events (incoming messages, dispatched commands, errors)
 * so the live bot can be diagnosed WITHOUT access to the host's log stream.
 * Exposed read-only via GET /api/debug.
 */
const MAX = 200;

const events = [];

function push(type, data) {
  try {
    events.push({ t: Date.now(), type, data });
    if (events.length > MAX) events.splice(0, events.length - MAX);
  } catch { /* ignore */ }
}

const info = (msg, data) => push('info', { msg, ...(data || {}) });
const incoming = (data) => push('incoming', data);
const command = (data) => push('command', data);
const error = (msg, data) => push('error', { msg, ...(data || {}) });

/** Response-latency tracker: the last 500 command durations, summarised as
 *  percentiles (p50/p95/max) and per-command worst offenders. Exposed via
 *  GET /api/debug so latency is MONITORED, not guessed at. */
const _lat = [];
function latency(command, ms) {
  try {
    _lat.push({ c: String(command).slice(0, 24), ms: Number(ms) || 0 });
    if (_lat.length > 500) _lat.splice(0, _lat.length - 500);
  } catch { /* ignore */ }
}
function latencySummary() {
  if (!_lat.length) return { samples: 0 };
  const sorted = [..._lat].map((x) => x.ms).sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  // Worst slow commands (deduped by name, keep max per name).
  const worst = new Map();
  for (const { c, ms } of _lat) if (ms > 500 && ms > (worst.get(c) || 0)) worst.set(c, ms);
  return {
    samples: _lat.length,
    p50_ms: pct(0.5), p95_ms: pct(0.95), max_ms: sorted[sorted.length - 1],
    slow_commands: [...worst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([cmd, ms]) => ({ cmd, ms })),
  };
}

function recent(n = 60) {
  return events.slice(-n);
}

function clear() { events.length = 0; _lat.length = 0; }

module.exports = { push, info, incoming, command, error, latency, latencySummary, recent, clear };
