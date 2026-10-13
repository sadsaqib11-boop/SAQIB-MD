/**
 * ANIME & LOGO — image / GIF APIs
 * Uses nekos.best (reliable, keyless) — waifu.pics is dead.
 */
const config = require('../config');
const { getJSON } = require('../lib/helpers');

// Image categories -> nekos.best endpoint
const NEKO = {
  waifu: 'waifu',
  neko: 'neko',
  shinobu: 'neko',
  megumin: 'neko',
  awoo: 'kitsune',
  maid: 'waifu',
  anime: 'waifu',
  animegirl: 'waifu',
  husbando: 'husbando',
  kitsune: 'kitsune',
};

// Action GIF categories (nekos.best) — premium reactions
const GIFS = [
  'hug', 'pat', 'kiss', 'slap', 'cuddle', 'wink', 'smile', 'dance', 'bite', 'bonk',
  'highfive', 'handhold', 'poke', 'wave', 'blush', 'smug', 'happy', 'think', 'feed',
  'tickle', 'laugh', 'baka', 'nod', 'nom', 'nope', 'pout', 'shrug', 'sleep', 'stare',
  'thumbsup', 'wag', 'punch', 'kick', 'lurk', 'yeet',
];

async function nekoImage(cat) {
  const r = await getJSON(`https://nekos.best/api/v2/${cat}`);
  return r?.results?.[0]?.url || null;
}

const LOGO_STYLES = ['neon', 'glow', 'galaxy', 'fire', 'ice', 'gold', '3d', 'graffiti', 'royal', 'horror'];

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;

  if (command === 'dog') {
    try {
      const r = await getJSON('https://dog.ceo/api/breeds/image/random');
      await ctx.send(ctx.from, { image: { url: r.message }, caption: `🐶 ${config.BOT_NAME}` }, { quoted: ctx.m });
    } catch { await reply('❌ Image nahi mili.'); }
    return;
  }
  if (command === 'cat') {
    try {
      const r = await getJSON('https://api.thecatapi.com/v1/images/search');
      await ctx.send(ctx.from, { image: { url: r[0].url }, caption: `🐱 ${config.BOT_NAME}` }, { quoted: ctx.m });
    } catch { await reply('❌ Image nahi mili.'); }
    return;
  }

  if (NEKO[command]) {
    try {
      const url = await nekoImage(NEKO[command]);
      if (!url) throw new Error('no image');
      await ctx.send(ctx.from, { image: { url }, caption: `🌸 ${config.BOT_NAME}` }, { quoted: ctx.m });
    } catch (e) { await reply('❌ Image nahi mili.'); }
    return;
  }

  // ---- action GIFs (hug, pat, kiss, …) ----
  if (GIFS.includes(command)) {
    try {
      const url = await nekoImage(command);
      if (!url) throw new Error('no gif');
      await ctx.send(ctx.from, { video: { url }, gifPlayback: true, caption: `✨ ${config.BOT_NAME}` }, { quoted: ctx.m });
    } catch { await reply('❌ GIF nahi mili.'); }
    return;
  }

  if (command === 'logo') {
    if (!arg) return reply(`❌ Text do. Example: ${config.PREFIX}logo SAQIB-MD`);
    const style = LOGO_STYLES[Math.floor(Math.random() * LOGO_STYLES.length)];
    const prompt = `${arg} text logo, ${style} style, high quality, dark background, typography`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    await ctx.send(ctx.from, { image: { url }, caption: `🎨 *${arg}* — ${style} logo\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
    return;
  }
};

module.exports = {
  commands: [...Object.keys(NEKO), ...GIFS, 'dog', 'cat', 'logo'],
  category: '🎌 ANIME & 🎨 LOGO',
  handler,
};
