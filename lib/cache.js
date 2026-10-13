/**
 * SAQIB-MD — tiny in-memory cache + message store (speed + antidelete)
 * No external deps. LRU-ish with TTL. Keeps the bot fast and memory-bounded.
 */

class TTLCache {
  constructor(max = 500, ttlMs = 10 * 60 * 1000) {
    this.max = max;
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.exp) { this.map.delete(key); return undefined; }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.v;
  }
  set(key, val, ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { v: val, exp: Date.now() + (ttlMs || this.ttl) });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
  has(key) { return this.get(key) !== undefined; }
  del(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

// AI response cache — makes repeated questions instant.
const aiCache = new TTLCache(300, 30 * 60 * 1000);

// Recent-message store — powers anti-delete (keyed by message id).
const msgStore = new TTLCache(800, 15 * 60 * 1000);

module.exports = { TTLCache, aiCache, msgStore };
