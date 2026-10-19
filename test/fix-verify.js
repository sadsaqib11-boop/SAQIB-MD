/**
 * Focused verification for the "forbidden send / make me admin" fix.
 * Run: node test/fix-verify.js
 */
process.env.SESSION_DIR = process.env.SESSION_DIR || './.test-session';
const handler = require('../lib/handler');

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) fails++; };

const GROUP = '123456789-987654321@g.us'; // legacy-style group jid
const BOT_ID = '923134182952:6@s.whatsapp.net';

// --- mock socket: groupMetadata says the bot is NOT a participant; sends 403 ---
// Count ONLY sends addressed to the group (the owner-notice DM must not count).
let groupSends = 0;
const sock = {
  user: { id: BOT_ID, lid: '166722476732497@lid' },
  sendMessage: async (jid) => { if (jid === GROUP) groupSends++; throw new Error('forbidden'); },
  groupMetadata: async () => ({ subject: 'G', announce: true, participants: [{ id: '999@s.whatsapp.net', admin: 'admin' }] }),
  sendPresenceUpdate: async () => {},
};

const m = {
  key: { remoteJid: GROUP, id: 'MSG1', participant: '923106762478@s.whatsapp.net', fromMe: true },
  message: { conversation: '.ping' },
  pushName: 'Owner',
};

(async () => {
  const ctx = handler.buildContext(sock, m, { ownerNumber: '923106762478' });

  // 1) reply() must NOT throw even though the send fails with 'forbidden'
  let threw = false;
  try { await ctx.reply('hello'); } catch { threw = true; }
  ok('reply() does not throw on forbidden send', !threw);
  ok('sendMessage to group attempted once', groupSends === 1);

  // 2) onSendFail is async; give it a tick to mark the group unpostable
  await new Promise((r) => setTimeout(r, 80));

  // 3) a second reply to the same (now unpostable) group is skipped
  await ctx.reply('hello again');
  ok('second reply to unpostable group is skipped', groupSends === 1);

  // 4) botMembership: bot is not a member of this group
  const bm = await handler.botMembership(sock, GROUP);
  ok('botMembership.member === false', !!bm && bm.member === false);
  ok('botMembership.announce === true', !!bm && bm.announce === true);

  // 5) isGroupAdmin still works (LID-normalised) — fresh cache first
  handler.clearGroupMetaCache();
  const adminSock = { ...sock, groupMetadata: async () => ({ subject: 'G', participants: [{ id: '923106762478@s.whatsapp.net', admin: 'admin' }] }) };
  const isAdm = await handler.isGroupAdmin(adminSock, GROUP, '923106762478@s.whatsapp.net');
  ok('isGroupAdmin true for a listed admin', isAdm === true);

  // 5b) botMembership detects the bot as admin when listed under a LID
  handler.clearGroupMetaCache();
  const lidSock = { user: { id: '923134182952:6@s.whatsapp.net', lid: '166722476732497@lid' },
    sendMessage: async () => ({}), sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({ subject: 'G', announce: true, participants: [{ id: '166722476732497@lid', admin: 'superadmin' }] }) };
  const bm2 = await handler.botMembership(lidSock, GROUP);
  ok('botMembership.admin true when bot listed under LID', !!bm2 && bm2.admin === true && bm2.member === true);

  // 6) clearGroupMetaCache resets the unpostable set -> sends attempted again
  handler.clearGroupMetaCache();
  await ctx.reply('after reset');
  ok('after clearGroupMetaCache the group is retried', groupSends === 2);

  console.log(`\n=== ${fails ? fails + ' FAILED' : 'ALL PASSED'} ===`);
  process.exit(fails ? 1 : 0);
})();
