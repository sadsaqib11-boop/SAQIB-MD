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

/** Unwrap view-once / ephemeral wrappers into the inner media message.
 * RECURSIVE on purpose: WhatsApp sometimes wraps view-once inside
 * ephemeralMessage (disappearing-mode chats) or nests the wrappers, and the
 * old single-level unwrap missed those — the exact ".vv kam nahi kar raha". */
function unwrapViewOnce(qm) {
  let m = qm;
  for (let i = 0; m && i < 6; i++) {
    const next =
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.ephemeralMessage?.message ||
      null;
    if (!next) break;
    m = next;
  }
  return m || qm || null;
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
  // Send WITHOUT quoting the command message. Quoting a view-once-quoted
  // message makes WhatsApp reject the send on some clients (the .vv "does
  // nothing" bug) — .vv2, which never quoted, always worked.
  if (type === 'image') await ctx.send(ctx.from, { image: buf, caption: cap }, {});
  else if (type === 'video') await ctx.send(ctx.from, { video: buf, caption: cap }, {});
  else await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg' }, {});
};

module.exports = {
  commands: ['vv'],
  category: '🔓 VIEW-ONCE',
  handler,
};
