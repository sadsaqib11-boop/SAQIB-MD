/**
 * MYTH — legendary creatures, natural disasters & mystic roles.
 * Each command generates a themed image (keyless, pollinations) + a fun caption.
 */
const config = require('../config');

const MYTHS = {
  earthquake: 'massive earthquake cracking the ground, city collapsing, dramatic',
  tsunami: 'giant tsunami wave crashing over a coastal city, epic',
  volcano: 'erupting volcano with lava and ash, apocalyptic sky',
  tornado: 'giant tornado ripping through a field, stormy sky',
  hurricane: 'category 5 hurricane seen from space, swirling clouds',
  alieninvasion: 'alien invasion, UFO fleet over a city, sci-fi',
  zombie: 'zombie horde walking through a foggy street, horror',
  vampire: 'elegant vampire in a dark gothic castle, moonlight',
  werewolf: 'werewolf howling at a full moon, dark forest',
  wizardmagic: 'wizard casting powerful magic spell, glowing runes',
  fairy: 'tiny glowing fairy in an enchanted forest, magical',
  mermaid: 'beautiful mermaid underwater with coral reef, fantasy',
  dragonfire: 'giant dragon breathing fire over a castle, epic fantasy',
  phoenix: 'phoenix rising from flames, majestic, glowing',
  pegasus: 'white winged pegasus flying above the clouds',
  centaur: 'centaur warrior on an ancient battlefield, fantasy',
  griffin: 'griffin guardian on a mountain peak, epic',
  cyborg: 'futuristic cyborg warrior, neon cyberpunk city',
  ninja: 'stealth ninja on a rooftop at night, moonlit',
  samurai: 'samurai warrior with katana, cherry blossoms',
  viking: 'viking warrior with axe on a longship, stormy sea',
  pirate: 'pirate captain on a ship with treasure map',
  knight: 'armored knight with sword and shield, castle',
  gladiator: 'gladiator in a colosseum arena, epic crowd',
  spartan: 'spartan warrior with spear and shield, 300 style',
  pharaoh: 'ancient egyptian pharaoh, golden mask, pyramids',
  mayan: 'mayan temple in the jungle, ancient ruins',
  atlantis: 'sunken city of atlantis underwater, glowing',
  olympus: 'mount olympus with greek gods, clouds and light',
  valhalla: 'viking valhalla hall of heroes, golden',
  shaman: 'tribal shaman with mask and fire, mystical',
  witchspell: 'witch brewing a glowing potion, cauldron',
  necromancer: 'necromancer raising skeletons, dark magic',
  alchemist: 'alchemist laboratory with potions, ancient',
  monk: 'peaceful monk meditating in a temple',
  yogi: 'yogi meditating on a mountain top, serene',
  guru: 'wise guru teaching disciples, spiritual',
  sage: 'ancient sage with long beard reading scrolls',
  mystic: 'mystic with glowing aura, cosmic energy',
  oracle: 'oracle seeing the future in a crystal ball',
  sorcerer: 'powerful sorcerer with staff, lightning',
  enchanter: 'enchanter enchanting a glowing sword',
  conjurer: 'conjurer summoning spirits, magical circle',
  illusionist: 'illusionist performing magic on a stage',
  diviner: 'diviner reading tarot cards by candlelight',
  seer: 'seer gazing into a glowing orb, prophecy',
  prophet: 'ancient prophet in the desert, divine light',
  astral: 'astral projection, soul floating in space',
  medium: 'spiritual medium contacting spirits, seance',
  telepath: 'telepath with glowing mind, psychic energy',
};

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;
  const flavour = MYTHS[command];
  if (!flavour) return reply('\u2753 Unknown myth command');
  const prompt = `${flavour}, highly detailed digital art, epic cinematic lighting, 4k`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
  try {
    await ctx.send(ctx.from, {
      image: { url },
      caption: `\u2728 *${command.toUpperCase()}*${arg ? ` \u2014 ${arg}` : ''}\n\ud83d\uddbc\ufe0f ${flavour}\n\ud83d\udc51 ${config.BOT_NAME}`,
    }, { quoted: ctx.m });
  } catch { await reply('\u274c Image banane me error aaya.'); }
};

module.exports = {
  commands: Object.keys(MYTHS),
  category: '\ud83d\udc09 MYTH & LEGENDS',
  handler,
};
