/**
 * Offline test harness — exercises plugin handlers with mock contexts.
 * No WhatsApp connection required. Run: node scripts/test-fixes.js
 */
const contacts = require('../lib/contacts');
const interactions = require('../lib/interactions');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

/** Build a mock ctx that records outgoing sends. */
function mockCtx({ command, arg = '', quotedParticipant = null, senderNum = '923001234567', isGroup = true, text = '' } = {}) {
  const sent = [];
  const ctx = {
    command, arg, args: arg ? arg.split(' ') : [],
    from: isGroup ? '12345@g.us' : '923001234567@s.whatsapp.net',
    isGroup,
    sender: `${senderNum}@s.whatsapp.net`,
    senderNum,
    pushname: 'Tester',
    text: text || `!${command} ${arg}`.trim(),
    m: { key: { remoteJid: isGroup ? '12345@g.us' : '923001234567@s.whatsapp.net', id: 'MOCK', fromMe: false } },
    quoted: quotedParticipant
      ? { key: { remoteJid: '12345@g.us', id: 'Q1', participant: quotedParticipant }, message: { conversation: 'hi' } }
      : null,
    isOwner: false,
    reply: (txt, extra = {}) => { sent.push({ type: 'reply', text: String(txt), ...extra }); return Promise.resolve(); },
    send: (jid, content, opts = {}) => { sent.push({ type: 'send', jid, content, opts }); return Promise.resolve(); },
    react: () => Promise.resolve(),
  };
  ctx._sent = sent;
  return ctx;
}

const characters = require('../plugins/characters');
const fun = require('../plugins/fun');

(async () => {
  console.log('\n=== LID / mention resolution ===');

  // Learn a LID -> PN mapping
  contacts.learnFromMessage({ key: { participant: '212223345675336@lid', participantPn: '923451234567@s.whatsapp.net' } });
  ok('contacts.resolve maps LID -> PN', contacts.resolve('212223345675336@lid') === '923451234567@s.whatsapp.net');

  console.log('\n=== .fool (target is the fool, real number mention) ===');
  {
    // unresolved LID target -> must NOT use @s.whatsapp.net (no fake number)
    const ctx = mockCtx({ command: 'fool', quotedParticipant: '999888777666555@lid' });
    await characters.handler(ctx);
    const s = ctx._sent[0];
    ok('fool sends a message', !!s);
    const mention = s?.content?.mentions?.[0] || '';
    ok('unresolved LID mention keeps @lid domain', mention.endsWith('@lid'), `got ${mention}`);
    ok('fool text mentions the target', /@999888777666555/.test(s?.content?.text || ''), `got ${s?.content?.text}`);
    ok('fool does NOT call the sender a fool', !/@923001234567/.test(s?.content?.text || ''));
  }
  {
    // resolved LID -> real number mention
    const ctx = mockCtx({ command: 'fool', quotedParticipant: '212223345675336@lid' });
    await characters.handler(ctx);
    const s = ctx._sent[0];
    ok('resolved LID mention uses real number', (s?.content?.mentions?.[0] || '') === '923451234567@s.whatsapp.net', `got ${s?.content?.mentions?.[0]}`);
    ok('resolved LID text shows real number', /@923451234567/.test(s?.content?.text || ''), `got ${s?.content?.text}`);
  }
  {
    // no target -> prompt, not a fake fool
    const ctx = mockCtx({ command: 'fool' });
    await characters.handler(ctx);
    ok('fool with no target prompts for a target', /reply|tag/i.test(ctx._sent[0]?.text || ''), `got ${ctx._sent[0]?.text}`);
  }

  console.log('\n=== role command mention ===');
  {
    const ctx = mockCtx({ command: 'dad', quotedParticipant: '9231112223334@s.whatsapp.net' });
    await characters.handler(ctx);
    const s = ctx._sent[0];
    ok('dad mentions target with correct jid', (s?.content?.mentions?.[0] || '') === '9231112223334@s.whatsapp.net', `got ${s?.content?.mentions?.[0]}`);
  }

  console.log('\n=== rating command (deterministic) ===');
  {
    const c1 = mockCtx({ command: 'chad', quotedParticipant: '9231112223334@s.whatsapp.net' });
    const c2 = mockCtx({ command: 'chad', quotedParticipant: '9231112223334@s.whatsapp.net' });
    await characters.handler(c1); await characters.handler(c2);
    ok('chad rating is deterministic', c1._sent[0]?.content?.text === c2._sent[0]?.content?.text, `${c1._sent[0]?.content?.text} vs ${c2._sent[0]?.content?.text}`);
    ok('chad rating mentions target', (c1._sent[0]?.content?.mentions?.[0] || '') === '9231112223334@s.whatsapp.net');
  }

  console.log('\n=== fun.js roast with LID target ===');
  {
    const ctx = mockCtx({ command: 'roast', quotedParticipant: '999888777666555@lid' });
    await fun.handler(ctx);
    const s = ctx._sent[0];
    ok('roast mention keeps @lid domain (no fake number)', (s?.content?.mentions?.[0] || '').endsWith('@lid'), `got ${s?.content?.mentions?.[0]}`);
  }

  console.log('\n=== .wyr interactive reply ===');
  {
    const ctx = mockCtx({ command: 'wyr' });
    await fun.handler(ctx);
    const s = ctx._sent[0];
    ok('wyr asks to reply 1 or 2', /reply \*1\*|1.*2/i.test(s?.text || ''), `got ${s?.text}`);
    // now simulate the user replying "1"
    const replyCtx = mockCtx({ text: '1', command: null });
    replyCtx.sender = '923001234567@s.whatsapp.net';
    replyCtx.from = '12345@g.us';
    const consumed = await interactions.handle(replyCtx);
    ok('interaction consumes the reply', consumed === true);
    ok('interaction produced a response', (replyCtx._sent[0]?.text || '').length > 0, `got ${replyCtx._sent[0]?.text}`);
  }

  console.log('\n=== .aura deterministic ===');
  {
    const a1 = mockCtx({ command: 'aura', senderNum: '923009999999' });
    const a2 = mockCtx({ command: 'aura', senderNum: '923009999999' });
    await fun.handler(a1); await fun.handler(a2);
    ok('aura is deterministic', a1._sent[0]?.content?.text === a2._sent[0]?.content?.text);
  }

  console.log('\n=== downloader: ytvideo/song audio-video choice ===');
  {
    const downloader = require('../plugins/downloader');
    const ytdlp = require('../lib/ytdlp');
    // stub the engine so we can observe which branch runs
    const calls = [];
    ytdlp.available = () => true;
    ytdlp.info = async () => ({ title: 'Test Song' });
    ytdlp.downloadAudioSmart = async (q) => { calls.push(['audio', q]); return writeTmp(); };
    ytdlp.downloadVideoSmart = async (q) => { calls.push(['video', q]); return { file: writeTmp(), audio: false }; };

    const ctx = mockCtx({ command: 'ytvideo', arg: 'Test Song' });
    await downloader.handler(ctx);
    const prompt = ctx._sent[0]?.text || '';
    ok('ytvideo prompts for 1/2 choice', /1️⃣/.test(prompt) && /2️⃣/.test(prompt), `got ${prompt}`);

    // user replies "2" -> video branch
    const replyCtx = mockCtx({ text: '2', command: null });
    replyCtx.sender = '923001234567@s.whatsapp.net';
    replyCtx.from = '12345@g.us';
    const consumed = await interactions.handle(replyCtx);
    ok('choice reply consumed', consumed === true);
    ok('video branch ran', calls.some((c) => c[0] === 'video'), JSON.stringify(calls));

    // .song -> reply "1" -> audio branch
    calls.length = 0;
    const ctx2 = mockCtx({ command: 'song', arg: 'Test Song' });
    await downloader.handler(ctx2);
    const replyCtx2 = mockCtx({ text: '1', command: null });
    replyCtx2.sender = '923001234567@s.whatsapp.net';
    replyCtx2.from = '12345@g.us';
    await interactions.handle(replyCtx2);
    ok('audio branch ran', calls.some((c) => c[0] === 'audio'), JSON.stringify(calls));
  }

  console.log('\n=== downloader: surah audio/video + apk + tts ===');
  {
    const downloader = require('../plugins/downloader');
    const c1 = mockCtx({ command: 'surah', arg: '1' });
    await downloader.handler(c1);
    ok('surah prompts audio/video', /Audio/.test(c1._sent[0]?.text || '') && /Video/.test(c1._sent[0]?.text || ''), `got ${c1._sent[0]?.text}`);
    const c2 = mockCtx({ command: 'apk' });
    await downloader.handler(c2);
    ok('apk with no arg errors', /naam do/i.test(c2._sent[0]?.text || ''), `got ${c2._sent[0]?.text}`);
    const c3 = mockCtx({ command: 'tts', arg: 'sad songs' });
    await downloader.handler(c3);
    ok('tts starts a search', /TikTok Search|engine/i.test(c3._sent[0]?.text || ''), `got ${c3._sent[0]?.text}`);
  }

  console.log('\n=== fonts (no "?" / replacement chars) ===');
  {
    const fonts = require('../plugins/fonts');
    let out = [];
    const fctx = (cmd, arg) => ({ command: cmd, arg, reply: (t) => { out.push(t); return Promise.resolve(); } });

    let allGood = true;
    for (let i = 1; i <= 105; i++) { out = []; await fonts.handler(fctx(`font${i}`, 'SAQIB Md 123')); if ((out[0] || '').includes('\uFFFD')) allGood = false; }
    ok('all 105 fonts free of replacement chars', allGood);

    out = []; await fonts.handler(fctx('font1', 'SAQIB'));
    ok('font1 renders bold S correctly', (out[0] || '').startsWith('\u{1D412}'), out[0]);

    out = []; await fonts.handler(fctx('mono', 'SAQIB'));
    ok('named "mono" font works', (out[0] || '').length > 0 && !(out[0] || '').includes('\uFFFD'), out[0]);

    ok('applyDefault() uses Mono by default', fonts.applyDefault('A') === fonts.style('A', 12));
  }

  console.log('\n=== premium: scoped anti-delete / autoreact / profile-pic ===');
  {
    const premium = require('../plugins/premium');
    const config = require('../config');

    // anti-delete chat scope
    config.ANTIDELETE_INBOX = false;
    let p = mockCtx({ command: 'antidelete', arg: 'chat on' });
    await premium.handler(p);
    ok('antidelete chat on -> ANTIDELETE_INBOX=true', config.ANTIDELETE_INBOX === true);
    ok('antidelete status text shown', /Anti-Delete/.test(p._sent[0]?.text || ''), p._sent[0]?.text);

    p = mockCtx({ command: 'antidelete', arg: 'inbox off' });
    await premium.handler(p);
    ok('antidelete inbox off -> ANTIDELETE_INBOX=false', config.ANTIDELETE_INBOX === false);

    // anti-delete all
    p = mockCtx({ command: 'antidelete', arg: 'all on' });
    await premium.handler(p);
    ok('antidelete all on -> both true', config.ANTIDELETE === true && config.ANTIDELETE_INBOX === true);

    // autoreact scopes
    config.AUTO_REACT_GROUP = true; config.AUTO_REACT_CHAT = true;
    p = mockCtx({ command: 'autoreact', arg: 'group off' });
    await premium.handler(p);
    ok('autoreact group off -> AUTO_REACT_GROUP=false', config.AUTO_REACT_GROUP === false);
    ok('autoreact chat untouched', config.AUTO_REACT_CHAT === true);

    p = mockCtx({ command: 'autoreact', arg: 'all off' });
    await premium.handler(p);
    ok('autoreact all off -> master+group+chat false', !config.AUTO_REACT && !config.AUTO_REACT_GROUP && !config.AUTO_REACT_CHAT);

    p = mockCtx({ command: 'autoreact', arg: 'status' });
    await premium.handler(p);
    ok('autoreact status shows scopes', /Group/.test(p._sent[0]?.text || '') && /Chat/.test(p._sent[0]?.text || ''), p._sent[0]?.text);

    // profile-pic command (mock sock.profilePictureUrl)
    const pp = mockCtx({ command: 'pp', senderNum: '923451234567' });
    pp.sock = { profilePictureUrl: async () => 'https://example.com/dp.jpg' };
    await premium.handler(pp);
    ok('pp sends an image', pp._sent[0]?.content?.image?.url === 'https://example.com/dp.jpg', JSON.stringify(pp._sent[0]?.content));

    const gpp = mockCtx({ command: 'gpp', isGroup: true });
    gpp.sock = { profilePictureUrl: async () => 'https://example.com/g.jpg' };
    await premium.handler(gpp);
    ok('gpp sends group image', gpp._sent[0]?.content?.image?.url === 'https://example.com/g.jpg');

    const gpp2 = mockCtx({ command: 'gpp', isGroup: false });
    gpp2.sock = { profilePictureUrl: async () => 'https://example.com/g.jpg' };
    await premium.handler(gpp2);
    ok('gpp in DM is rejected', /sirf group/i.test(gpp2._sent[0]?.text || ''), gpp2._sent[0]?.text);
  }

  console.log('\n=== owner: vv unwrap / pair / broadcast / delete ===');
  {
    const owner = require('../plugins/owner');

    // unwrapViewOnce unit tests
    ok('unwrap viewOnceMessage', !!owner.unwrapViewOnce({ viewOnceMessage: { message: { imageMessage: { a: 1 } } } }).imageMessage);
    ok('unwrap viewOnceMessageV2', !!owner.unwrapViewOnce({ viewOnceMessageV2: { message: { videoMessage: { a: 1 } } } }).videoMessage);
    ok('unwrap passes plain message through', !!owner.unwrapViewOnce({ imageMessage: { a: 1 } }).imageMessage);
    ok('unwrap view-once audio', !!owner.unwrapViewOnce({ viewOnceMessageV2Extension: { message: { audioMessage: { a: 1 } } } }).audioMessage);
    ok('unwrap null-safe', owner.unwrapViewOnce(null) === null);

    // .pair uses session manager
    const bot = require('../lib/bot');
    const origPair = bot.requestPair;
    bot.requestPair = async () => 'ABCD-1234';
    const pctx = mockCtx({ command: 'pair', arg: '923001234567' });
    await owner.handler(pctx);
    ok('pair returns a pairing code', /ABCD-1234/.test(pctx._sent[0]?.text || ''), pctx._sent[0]?.text);
    bot.requestPair = origPair;

    // .broadcast
    const bctx = mockCtx({ command: 'broadcast', arg: 'hello' });
    let sentCount = 0;
    bctx.sock = {
      groupFetchAllParticipating: async () => ({ '1@g.us': {}, '2@g.us': {} }),
      sendMessage: async () => { sentCount++; },
    };
    await owner.handler(bctx);
    ok('broadcast sends to all groups', sentCount === 2, `sent ${sentCount}`);
    ok('broadcast reports count', /2\/2/.test(bctx._sent[bctx._sent.length - 1]?.text || ''), bctx._sent[bctx._sent.length - 1]?.text);

    // .delete
    const dctx = mockCtx({ command: 'delete', quotedParticipant: '9231112223334@s.whatsapp.net' });
    let deleted = null;
    dctx.sock = { sendMessage: async (jid, content) => { if (content.delete) deleted = content.delete; } };
    await owner.handler(dctx);
    ok('delete removes the quoted message', deleted && deleted.id === 'Q1', JSON.stringify(deleted));
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})();

function writeTmp() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const p = path.join(os.tmpdir(), `test_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
  fs.writeFileSync(p, Buffer.from('test'));
  return p;
}
