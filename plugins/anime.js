/**
 * ANIME & LOGO — image APIs
 */
const config = require('../config');
const { getJSON } = require('../lib/helpers');

const WAIFU = {
  waifu: 'https://api.waifu.pics/sfw/waifu',
  neko: 'https://api.waifu.pics/sfw/neko',
  shinobu: 'https://api.waifu.pics/sfw/shinobu',
  megumin: 'https://api.waifu.pics/sfw/megumin',
  awoo: 'https://api.waifu.pics/sfw/awoo',
  maid: 'https://api.waifu.pics/sfw/waifu',
  anime: 'https://api.waifu.pics/sfw/waifu',
  animegirl: 'https://api.waifu.pics/sfw/waifu',
  husbando: 'https://api.waifu.pics/sfw/waifu',
};

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

  if (WAIFU[command]) {
    try {
      const r = await getJSON(WAIFU[command]);
      await ctx.send(ctx.from, { image: { url: r.url }, caption: `🌸 ${config.BOT_NAME}` }, { quoted: ctx.m });
    } catch (e) { await reply('❌ Image nahi mili: ' + e.message); }
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
  commands: [...Object.keys(WAIFU), 'dog', 'cat', 'logo'],
  category: '🎌 ANIME & 🎨 LOGO',
  handler,
};
