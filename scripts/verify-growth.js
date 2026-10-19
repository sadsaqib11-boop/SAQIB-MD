/**
 * Growth-package verification harness (no network, no bot boot).
 *   node scripts/verify-growth.js
 *
 * 1) Loads every plugin exactly like index.js and asserts the GROWTH commands
 *    are registered (share/redeem/toprefer/...).
 * 2) Exercises lib/referrals.js end-to-end against a throwaway session dir:
 *    code creation, one-credit-per-joiner, auto-premium at goal, leaderboard.
 * 3) Asserts the MENU always attaches the bot picture (the reported bug: the
 *    categories menu is >1024 chars, so it used to fall back to text-only).
 * 4) Asserts the landing page + index.js routes.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

// Use a throwaway data dir so we never touch the real /data volume.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'saqib-verify-'));
process.env.SESSION_DIR = path.join(TMP, 'session');
process.env.REFERRAL_GOAL = '3';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  \u2713 ' + name); } else { fail++; console.log('  \u2717 ' + name); } };

console.log('\n[1] Plugin registry');
const registry = require('../plugins/_registry');
const pluginsDir = path.join(__dirname, '..', 'plugins');
const plugins = [];
for (const f of fs.readdirSync(pluginsDir).filter((x) => x.endsWith('.js') && !x.startsWith('_'))) {
  try {
    const plug = require(path.join(pluginsDir, f));
    if (plug && Array.isArray(plug.commands) && typeof plug.handler === 'function') {
      plugins.push({ file: f, ...plug });
    }
  } catch (e) { console.log('  ! skipped ' + f + ': ' + e.message); }
}
registry.set(plugins);

const growth = plugins.find((p) => p.file === 'growth.js');
ok('growth.js loaded', !!growth);
ok('growth has onMessage hook', growth && typeof growth.onMessage === 'function');
['share', 'referral', 'refer', 'myrefer', 'redeem', 'refjoin', 'use', 'toprefer', 'topinvite']
  .forEach((c) => ok('command registered: ' + c, registry.find(c) === growth));
ok('no command-name collisions with group.js', registry.find('invite') !== growth && registry.find('join') !== growth);

console.log('\n[2] Referral store');
const ref = require('../lib/referrals');
ref.load();
ok('GOAL honours REFERRAL_GOAL env', ref.GOAL === 3);

const A = '923000000001', B = '923000000002', C = '923000000003', D = '923000000004', E = '923000000005';
const codeA = ref.getCode(A);
ok('getCode returns 6-char code', /^[A-Z0-9]{6}$/.test(codeA));
ok('getCode is stable', ref.getCode(A) === codeA);
ok('codeToNum resolves', ref.codeToNum(codeA) === A);
ok('codeToNum is case-insensitive', ref.codeToNum(codeA.toLowerCase()) === A);
ok('codeToNum unknown -> ""', ref.codeToNum('ZZZZZZ') === '');

ok('cannot credit own code', ref.credit(codeA, A) === null);
const r1 = ref.credit(codeA, B);
ok('credit B -> inviter A, 1 invite', r1 && r1.inviter === A && r1.invites === 1 && !r1.premium);
ok('duplicate joiner not re-credited', ref.credit(codeA, B).already === true);
const r2 = ref.credit(codeA, C);
ok('credit C -> 2 invites, not premium yet', r2 && r2.invites === 2 && !r2.premium);
const r3 = ref.credit(codeA, D);
ok('credit D -> 3 invites hits goal', r3 && r3.invites === 3 && r3.premium === true && r3.justPremium === true);
ok('isPremium(A) true', ref.isPremium(A) === true);
ok('stats(A) reflects 3/3 premium', (() => { const s = ref.stats(A); return s.invites === 3 && s.premium === true && s.goal === 3; })());

ref.getCode(E); ref.credit(ref.getCode(E), B); // B already redeemed -> no credit
ok('one credit per joiner across referrers', ref.stats(E).invites === 0);

const lb = ref.leaderboard(10);
ok('leaderboard top is A with 3', lb.length >= 1 && lb[0].num === A && lb[0].invites === 3);

ok('markSeen first-time true', ref.markSeen('923111111111') === true);
ok('markSeen second-time false', ref.markSeen('923111111111') === false);

ok('count() returns numbers', (() => { const c = ref.count(); return typeof c.referrers === 'number' && typeof c.joins === 'number' && typeof c.users === 'number'; })());

ok('setPremium toggles', ref.setPremium('923222222222', true) === true && ref.isPremium('923222222222') === true);

console.log('\n[3] Persistence');
const saved = JSON.parse(fs.readFileSync(ref.FILE, 'utf8'));
ok('file written next to session dir', fs.existsSync(ref.FILE));
ok('persisted referrers + joins', Object.keys(saved.users).length >= 3 && Object.keys(saved.redeemed).length >= 3);
ok('persisted seen map', Object.keys(saved.seen || {}).length >= 1);

console.log('\n[4] Landing page');
const landing = fs.readFileSync(path.join(__dirname, '..', 'public', 'landing.html'), 'utf8');
ok('landing.html exists & non-trivial', landing.length > 8000);
ok('landing fetches /api/public', landing.includes('/api/public'));
ok('landing links to /portal', landing.includes('/portal'));
ok('landing builds wa.me link', landing.includes('wa.me'));
ok('landing has QR', landing.includes('qrserver') || landing.includes('qr'));

const mainPlugin = plugins.find((p) => p.file === 'main.js');
async function runMenu(command, arg) {
  const cap = [];
  const ctx = {
    command, arg: arg || '', args: arg ? arg.split(' ') : [], text: '.' + command,
    from: '923106762478@s.whatsapp.net', isGroup: false,
    sender: '923106762478@s.whatsapp.net', senderNum: '923106762478',
    pushname: 'V', prefix: '.', isOwner: true, m: { key: {} }, quoted: null,
    reply: () => { cap.push({ kind: 'text' }); return Promise.resolve(); },
    send: (j, c) => { cap.push({ kind: 'send', image: !!c.image, buf: Buffer.isBuffer(c.image) }); return Promise.resolve(); },
    sendSticker: () => Promise.resolve(), react: () => Promise.resolve(),
  };
  await mainPlugin.handler(ctx);
  return cap;
}

(async () => {
  console.log('\n[5] Menu photo (bot picture must ALWAYS be sent)');
  const cats = await runMenu('menu');
  ok('.menu sends the bot PICTURE (was text-only bug)', cats.some((c) => c.kind === 'send' && c.image && c.buf));
  const cat = await runMenu('menu', 'download');
  ok('.menu <category> sends the picture', cat.some((c) => c.kind === 'send' && c.image));
  const all = await runMenu('menuall');
  ok('.menuall sends the picture', all.some((c) => c.kind === 'send' && c.image));
  ok('menu picture file is the bundled bot.jpg', fs.existsSync(path.join(__dirname, '..', 'assets', 'bot.jpg')));

  console.log('\n[6] index.js routes');
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  ok("serves landing at '/'", /app\.get\('\/',[^\n]*landing\.html/.test(idx));
  ok("serves portal at '/portal'", idx.includes("app.get('/portal'"));
  ok('exposes /api/public', idx.includes("app.get('/api/public'"));
  ok('boots referrals store', idx.includes("require('./lib/referrals').load()"));

  // cleanup
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

  console.log('\n========================================');
  console.log(`  RESULT: ${pass} passed, ${fail} failed`);
  console.log('========================================\n');
  process.exit(fail ? 1 : 0);
})();
