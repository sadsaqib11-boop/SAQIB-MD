/**
 * SAQIB-MD — referral / invite store
 * ----------------------------------
 * Powers the growth loop: every user gets a short invite code; when a NEW user
 * joins with that code, the inviter earns an invite. At REFERRAL_GOAL invites
 * the inviter is automatically upgraded to PREMIUM.
 *
 * Persisted next to the session dir (the mounted /data volume on Railway) so
 * codes, invite counts and premium status survive restarts and redeploys —
 * exactly like lib/bans.js and lib/prefixes.js.
 *
 *   users:    <number> -> { code, invites, premium, ts }
 *   redeemed: <joiner> -> <inviter>   (one credit per joiner, ever — no farming)
 *   seen:     <number> -> ts          (known users, for first-contact detection)
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(path.dirname(path.resolve(config.SESSION_DIR)), 'saqib-referrals.json');

// Invites needed to unlock FREE PREMIUM (owner can override with REFERRAL_GOAL).
const GOAL = Math.max(1, parseInt(process.env.REFERRAL_GOAL || '10', 10) || 10);

let DB = { _schema: 1, users: {}, redeemed: {}, seen: {} };

const clean = (n) => String(n || '').replace(/[^0-9]/g, '');
// Unambiguous alphabet (no 0/O/1/I) so codes are easy to read out loud.
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = (len = 6) => {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
};

function load() {
  try {
    const obj = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (obj && typeof obj === 'object') {
      DB = {
        _schema: 1,
        users: obj.users && typeof obj.users === 'object' ? obj.users : {},
        redeemed: obj.redeemed && typeof obj.redeemed === 'object' ? obj.redeemed : {},
        seen: obj.seen && typeof obj.seen === 'object' ? obj.seen : {},
      };
    }
    console.log(`[REFERRAL] loaded ${Object.keys(DB.users).length} referrers, ${Object.keys(DB.redeemed).length} joins, ${Object.keys(DB.seen).length} known users`);
  } catch { /* first run */ }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(DB, null, 2));
  } catch (e) {
    console.error('[REFERRAL] save fail:', e?.message || e);
  }
}

/** Resolve a code back to the inviter's number ('' if unknown). */
function codeToNum(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return '';
  for (const [num, u] of Object.entries(DB.users)) if (u && u.code === c) return num;
  return '';
}

/** Get (creating on first use) a user's invite code. */
function getCode(num) {
  const n = clean(num);
  if (!n) return '';
  if (!DB.users[n]) DB.users[n] = { code: '', invites: 0, premium: false, ts: Date.now() };
  if (!DB.users[n].code) {
    let c;
    let guard = 0;
    do { c = randCode(6); } while (codeToNum(c) && guard++ < 50);
    DB.users[n].code = c;
    save();
  }
  return DB.users[n].code;
}

/**
 * Credit an inviter for a join. One credit per joiner, ever (anti-farming).
 * Returns { inviter, invites, premium, justPremium, goal, already } or null.
 */
function credit(code, joinerNum) {
  const jn = clean(joinerNum);
  const inv = codeToNum(code);
  if (!jn || !inv || inv === jn) return null;
  if (DB.redeemed[jn]) return { already: true, inviter: DB.redeemed[jn] };
  DB.redeemed[jn] = inv;
  if (!DB.users[inv]) DB.users[inv] = { code: '', invites: 0, premium: false, ts: Date.now() };
  const u = DB.users[inv];
  u.invites = (u.invites || 0) + 1;
  let justPremium = false;
  if (!u.premium && u.invites >= GOAL) { u.premium = true; justPremium = true; }
  save();
  return { inviter: inv, invites: u.invites, premium: !!u.premium, justPremium, goal: GOAL };
}

/** A user's referral stats. */
function stats(num) {
  const n = clean(num);
  const u = DB.users[n];
  return { code: getCode(n), invites: (u && u.invites) || 0, premium: !!(u && u.premium), goal: GOAL };
}

function isPremium(num) {
  const n = clean(num);
  return !!(DB.users[n] && DB.users[n].premium);
}

/** Manually grant/revoke premium (owner command). */
function setPremium(num, on = true) {
  const n = clean(num);
  if (!n) return false;
  if (!DB.users[n]) DB.users[n] = { code: '', invites: 0, premium: false, ts: Date.now() };
  DB.users[n].premium = !!on;
  save();
  return true;
}

/** Top inviters, highest first. */
function leaderboard(k = 10) {
  return Object.entries(DB.users)
    .map(([num, u]) => ({ num, invites: (u && u.invites) || 0, premium: !!(u && u.premium) }))
    .filter((x) => x.invites > 0)
    .sort((a, b) => b.invites - a.invites)
    .slice(0, k);
}

/** Mark a user as seen. Returns TRUE the first time we ever see them. */
function markSeen(num) {
  const n = clean(num);
  if (!n) return false;
  if (DB.seen[n]) return false;
  DB.seen[n] = Date.now();
  save();
  return true;
}

function isSeen(num) { return !!DB.seen[clean(num)]; }

/** Aggregate counters (for the landing page / owner stats). */
function count() {
  return {
    referrers: Object.keys(DB.users).length,
    joins: Object.keys(DB.redeemed).length,
    users: Object.keys(DB.seen).length,
  };
}

module.exports = { load, save, getCode, codeToNum, credit, stats, isPremium, setPremium, leaderboard, markSeen, isSeen, count, GOAL, FILE };
