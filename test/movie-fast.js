/**
 * Verify the FAST `.movie` behaviour.
 * Run: node test/movie-fast.js
 *
 *  1. `.movie <name>`       -> INSTANT /dl/ link FIRST (single message, no wait
 *                              for the download), then the full file in the bg.
 *  2. `.movie link <name>`  -> link only, NO download triggered.
 *  3. `.movie file <name>`  -> document only (download triggered, no link).
 */
process.env.PUBLIC_URL = 'https://bot.example.test';

const path = require('path');
const fs = require('fs');
const os = require('os');

const ytdlp = require('../lib/ytdlp');
const downloader = require('../plugins/downloader');

let fails = 0;
const ok = (n, c) => { console.log(`${c ? '\u2705' : '\u274c'} ${n}`); if (!c) fails++; };

// ---- mock the download engine (no network) ----
ytdlp.available = () => true;
ytdlp.info = async () => ({ title: 'Mock' });
ytdlp.searchRankedRace = async (q) => ([
  { title: `${q} (2014) Full Movie HD`, url: 'https://www.youtube.com/watch?v=zSWdZVtXT7E' },
]);
const fakeFile = path.join(os.tmpdir(), 'saqib-fake-movie.mp4');
fs.writeFileSync(fakeFile, 'x');
let downloadCalled = 0;
ytdlp.downloadMovie = async () => { downloadCalled++; return fakeFile; };

const mkctx = (arg) => {
  const sent = [];
  return {
    sent,
    ctx: {
      command: 'movie', arg, args: arg.split(' '), prefix: '.', from: '123@s.whatsapp.net',
      senderNum: '923106762478', pushname: 'T', isOwner: true, m: { key: {} },
      reply: async (t) => { sent.push({ kind: 'reply', text: String(t) }); return { key: { id: 'x' } }; },
      send: async (jid, content) => { sent.push({ kind: 'send', content }); return { key: { id: 'x' } }; },
    },
  };
};

const isLink = (s) => s.kind === 'reply' && /\/dl\//.test(s.text);

(async () => {
  // 1) default -> instant link FIRST
  {
    const { ctx, sent } = mkctx('Interstellar');
    await downloader.handler(ctx);
    ok('.movie <name> replies with a /dl/ link', sent.some(isLink));
    ok('.movie <name> link uses PUBLIC_URL', sent.some((s) => isLink(s) && s.text.includes('https://bot.example.test/dl/')));
    ok('.movie <name> link is the FIRST message (instant)', isLink(sent[0]));
  }

  // 2) link only -> no download
  {
    downloadCalled = 0;
    const { ctx, sent } = mkctx('link Inception');
    await downloader.handler(ctx);
    ok('.movie link -> exactly one message', sent.length === 1);
    ok('.movie link -> that message is the /dl/ link', isLink(sent[0]));
    ok('.movie link -> NO download triggered', downloadCalled === 0);
  }

  // 3) file only -> document, download triggered
  {
    downloadCalled = 0;
    const { ctx, sent } = mkctx('file Tenet');
    await downloader.handler(ctx);
    ok('.movie file -> download triggered', downloadCalled >= 1);
    ok('.movie file -> sends a document', sent.some((s) => s.kind === 'send' && s.content && s.content.document));
  }

  console.log(fails ? `\n${fails} FAILED` : '\n=== ALL PASSED ===');
  process.exit(fails ? 1 : 0);
})();
