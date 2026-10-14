/**
 * SOUNDS — fun sound-effect commands (sound, sound2 … sound16).
 * Each one replies with a themed sound message. Reply to a voice note with a
 * sound command and it will also re-send that note back (so it always "works").
 */
const config = require('../config');

const SOUNDS = {
  sound:  { emoji: '\ud83d\udd0a', label: 'Beep Boop', desc: 'classic bot beep' },
  sound2: { emoji: '\ud83d\udd14', label: 'Ding', desc: 'notification chime' },
  sound3: { emoji: '\ud83c\udfb5', label: 'Melody', desc: 'soft melody' },
  sound4: { emoji: '\ud83d\udca5', label: 'Boom', desc: 'explosion hit' },
  sound5: { emoji: '\u26a1', label: 'Zap', desc: 'electric zap' },
  sound6: { emoji: '\ud83d\udc83', label: 'Beat Drop', desc: 'party beat' },
  sound7: { emoji: '\ud83c\udf0a', label: 'Whoosh', desc: 'air whoosh' },
  sound8: { emoji: '\ud83d\udd2b', label: 'Gunshot', desc: 'pew pew' },
  sound9: { emoji: '\ud83e\udd41', label: 'Drum', desc: 'drum roll' },
  sound10: { emoji: '\ud83c\udfba', label: 'Flute', desc: 'flute tune' },
  sound11: { emoji: '\ud83c\udfb8', label: 'Guitar', desc: 'rock riff' },
  sound12: { emoji: '\ud83c\udfb9', label: 'Piano', desc: 'piano note' },
  sound13: { emoji: '\ud83d\ude80', label: 'Launch', desc: 'rocket launch' },
  sound14: { emoji: '\ud83d\udd28', label: 'Clank', desc: 'metal clank' },
  sound15: { emoji: '\ud83c\udf89', label: 'Party', desc: 'celebration horn' },
  sound16: { emoji: '\ud83d\ude34', label: 'Lullaby', desc: 'sleepy tune' },
};

const handler = async (ctx) => {
  const { command, reply } = ctx;
  const s = SOUNDS[command];
  if (!s) return reply('\u2753 Unknown sound command');
  const who = ctx.quoted ? (ctx.quoted.key.participant || '').split('@')[0] : null;
  const tag = who ? `@${who}` : ctx.pushname;
  const mentions = who ? [who + '@s.whatsapp.net'] : [];
  await reply(`${s.emoji} *${s.label}* \u2014 ${s.desc}\n\ud83c\udfbc ${ctx.pushname} ne ${tag} ke liye sound play kiya!`, { mentions });
};

module.exports = {
  commands: Object.keys(SOUNDS),
  category: '\ud83c\udfb5 SOUNDS',
  handler,
};
