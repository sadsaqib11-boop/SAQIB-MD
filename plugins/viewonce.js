/**
 * VIEW-ONCE (public) — unlock view-once media for EVERYONE.
 * --------------------------------------------------------
 * .vv  -> reveals the replied-to view-once photo / video / audio right here in
 *         THIS chat. Anyone can use it (no owner lock).
 *
 * The owner-only variants that save to your OWN inbox live in `owner.js`:
 *   .vv2 / .vv3  -> unlock and send to "yourself" (Message yourself).
 */
const config = require('../config');
const { downloadMedia } = require('../lib/helpers');

/** Unwrap view-once wrappers into the inner media message. */
function unwrapViewOnce(qm) {
  if (!qm) return null;
  return (
    qm.viewOnceMessage?.message ||
    qm.viewOnceMessageV2?.message ||
    qm.viewOnceMessageV2Extension?.message ||
    qm
  );
}

const handler = async (ctx) => {
  const { reply, quoted } = ctx;
  if (!quoted) return reply('❌ Reply to a *view-once* photo/video with .vv');
  const qm = unwrapViewOnce(quoted.message);
  const type = qm.imageMessage ? 'image' : qm.videoMessage ? 'video' : qm.audioMessage ? 'audio' : null;
  if (!type) return reply('❌ That does not look like view-once media (reply to a photo/video).');
  const msg = qm.imageMessage || qm.videoMessage || qm.audioMessage;
  let buf;
  try { buf = await downloadMedia(msg, type); }
  catch (e) { return reply('❌ Could not download the media (it may have expired): ' + String(e.message || e).slice(0, 80)); }
  const cap = `🔓 *View-once unlocked*\n👑 ${config.BOT_NAME}`;
  if (type === 'image') await ctx.send(ctx.from, { image: buf, caption: cap }, { quoted: ctx.m });
  else if (type === 'video') await ctx.send(ctx.from, { video: buf, caption: cap }, { quoted: ctx.m });
  else await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg' }, { quoted: ctx.m });
};

module.exports = {
  commands: ['vv'],
  category: '🔓 VIEW-ONCE',
  handler,
};
