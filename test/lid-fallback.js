/**
 * Verifies the LID-era group send fallback:
 *   - a group whose @g.us form is rejected with `forbidden` is delivered via <id>@lid
 *   - the @lid form is remembered so later sends skip the doomed @g.us attempt
 *   - getGroupMeta falls back to @lid for metadata reads
 * Run: node test/lid-fallback.js
 */
process.env.SESSION_DIR = process.env.SESSION_DIR || './.test-session';
const handler = require('../lib/handler');

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? '\u2705' : '\u274c'} ${name}`); if (!cond) fails++; };

const GROUP = '120363431929405318@g.us';
const LID = '120363431929405318@lid';

let gus = 0, lid = 0;
const sock = {
  user: { id: '923134182952:6@s.whatsapp.net', lid: '166722476732497@lid' },
  sendMessage: async (jid) => {
    if (jid === GROUP) { gus++; throw new Error('forbidden'); }
    if (jid === LID) { lid++; return { key: { id: 'LIDOK' } }; }
    return { key: { id: 'OTHER' } };
  },
  groupMetadata: async (jid) => {
    if (jid === GROUP) throw new Error('forbidden');
    return { subject: 'G', announce: false, participants: [{ id: '166722476732497@lid', admin: 'admin' }] };
  },
  sendPresenceUpdate: async () => {},
};

(async () => {
  const m = { key: { remoteJid: GROUP, id: 'M1', participant: '923106762478@s.whatsapp.net', fromMe: true }, message: { conversation: '.ping' }, pushName: 'Owner' };
  const ctx = handler.buildContext(sock, m, { ownerNumber: '923106762478' });

  await ctx.reply('hello');
  await new Promise((r) => setTimeout(r, 50));
  ok('reply to LID group delivered via @lid fallback', lid >= 1);
  ok('@g.us attempt was made first', gus >= 1);

  const gusBefore = gus;
  await ctx.reply('again');
  await new Promise((r) => setTimeout(r, 50));
  ok('second reply skips @g.us (remembers @lid)', gus === gusBefore && lid >= 2);

  handler.clearGroupMetaCache();
  const meta = await handler.getGroupMeta(sock, GROUP);
  ok('getGroupMeta falls back to @lid for metadata', !!meta && meta.subject === 'G');

  console.log(`\n=== ${fails ? fails + ' FAILED' : 'ALL PASSED'} ===`);
  process.exit(fails ? 1 : 0);
})();
