/**
 * REACTIONS — action commands (hug, pat, kiss, slap, …)
 * -----------------------------------------------------
 * Uses nekos.best for animated GIFs where available, and falls back to a
 * fun emoji reaction for the rest. Mentions the replied-to user.
 */
const config = require('../config');
const { getJSON, pick } = require('../lib/helpers');

// Commands that have a nekos.best GIF endpoint
const GIF_ACTIONS = [
  'hug', 'pat', 'kiss', 'slap', 'cuddle', 'wink', 'smile', 'dance', 'bite', 'bonk',
  'highfive', 'handhold', 'poke', 'wave', 'blush', 'smug', 'happy', 'think', 'feed',
  'tickle', 'laugh', 'baka', 'nod', 'nom', 'nope', 'pout', 'shrug', 'sleep', 'stare',
  'thumbsup', 'wag', 'punch', 'lurk', 'yeet',
];

// Emoji-only reactions
const EMOJI = {
  cry: '😭', angry: '😠', sad: '😔', confused: '😕', bored: '🥱', yawn: '🥱',
  shocked: '😱', scared: '😨', shy: '😊', cool: '😎', celebrate: '🎉', run: '🏃',
  walk: '🚶', facepalm: '🤦', clap: '👏', salute: '🫡', yes: '✅', no: '❌',
  sorry: '🙏', shake: '🤝', handshake: '🤝', peck: '😘', sip: '☕', tehee: '😁',
  bleh: '😝', nya: '🐱', carry: '🫂', kabedon: '😳', spin: '💫', blowkiss: '😘',
  tableflip: '🤬', stop: '✋', surprised: '😲', tired: '😩', sigh: '😮‍💨',
  nuzzle: '🥰', yay: '🥳', headbang: '🤘', nosebleed: '🩸', bully: '😈',
  cringe: '😬', kill: '🔪', glomp: '🤗', shoot: '🔫', marige: '💍', flirt: '😉',
  blush2: '😊', hold: '🫂', blushhard: '😳',
};

async function nekoGif(cat) {
  const r = await getJSON(`https://nekos.best/api/v2/${cat}`);
  return r?.results?.[0]?.url || null;
}

const handler = async (ctx) => {
  const { command, reply } = ctx;
  const who = ctx.quoted ? (ctx.quoted.key.participant || '').split('@')[0] : null;
  const tag = who ? `@${who}` : 'tum';
  const mentions = who ? [who + '@s.whatsapp.net'] : [];

  if (GIF_ACTIONS.includes(command)) {
    try {
      const url = await nekoGif(command);
      if (url) {
        await ctx.send(ctx.from, {
          video: { url }, gifPlayback: true,
          caption: `✨ ${ctx.pushname} ne *${command}* kiya ${tag} ke sath!`,
          mentions,
        }, { quoted: ctx.m });
        return;
      }
    } catch { /* fall through to emoji */ }
    await ctx.send(ctx.from, { text: `${EMOJI[command] || '✨'} ${ctx.pushname} ne *${command}* kiya ${tag} ke sath!`, mentions }, { quoted: ctx.m });
    return;
  }

  if (EMOJI[command]) {
    await ctx.send(ctx.from, { text: `${EMOJI[command]} ${ctx.pushname} ne *${command}* kiya ${tag} ke sath!`, mentions }, { quoted: ctx.m });
    return;
  }

  await reply('❓ Unknown reaction');
};

module.exports = {
  commands: [...GIF_ACTIONS, ...Object.keys(EMOJI)],
  category: '🎭 REACTIONS',
  handler,
};
