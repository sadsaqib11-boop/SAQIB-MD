/**
 * AI — all AI aliases route to Gemini; plus .imagine (image generation)
 */
const config = require('../config');
const { downloadMedia } = require('../lib/helpers');

const STYLE_NOTES = {
  grok: 'Jawab thoda witty aur sharp style mein do.',
  claude: 'Jawab thoughtful aur clear style mein do.',
  deepseek: 'Technical/coding sawal ho to detail se jawab do.',
  mathgpt: 'Ye maths sawal hy — step by step solve karo.',
};

async function askGemini(prompt, imageBase64 = null) {
  if (!config.GEMINI_API_KEY) throw new Error('AI key set nahi hy (GEMINI_API_KEY).');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent?key=${config.GEMINI_API_KEY}`;
  const parts = [{ text: prompt }];
  if (imageBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: 900 } }),
  });
  if (!res.ok) throw new Error(`AI API error ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '❌ Koi jawab nahi mila.';
}

const handler = async (ctx) => {
  const { command } = ctx;

  // ---- .imagine : AI image generation (no key needed) ----
  if (command === 'imagine' || command === 'image' || command === 'img') {
    if (!ctx.arg) return ctx.reply(`❌ Prompt likho. Example: ${config.PREFIX}imagine a cyberpunk cat`);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(ctx.arg)}?width=1024&height=1024&nologo=true`;
    await ctx.send(ctx.from, { image: { url }, caption: `🎨 *${config.BOT_NAME} Imagine*\n📝 ${ctx.arg}` }, { quoted: ctx.m });
    return;
  }

  // ---- AI chat ----
  if (!config.GEMINI_API_KEY) {
    return ctx.reply('⚠️ AI key set nahi hy. Owner ko `GEMINI_API_KEY` set karni hogi.');
  }
  let prompt = ctx.arg;
  let img = null;
  try {
    const imgMsg = ctx.m.message?.imageMessage || ctx.quoted?.message?.imageMessage;
    if (imgMsg) {
      prompt = prompt || 'Is image ko describe karo.';
      img = (await downloadMedia(imgMsg, 'image')).toString('base64');
    }
  } catch { /* ignore */ }

  if (!prompt) return ctx.reply(`❌ Sawal likho. Example: ${config.PREFIX}${ctx.command} Pakistan ka capital kya hy?`);
  const style = STYLE_NOTES[ctx.command.replace(/[0-9]/g, '')] || '';
  try {
    const answer = await askGemini(style ? `${prompt}\n(${style})` : prompt, img);
    await ctx.reply(`🤖 *${config.BOT_NAME} AI*\n\n${answer}`);
  } catch (e) {
    await ctx.reply(`❌ ${e.message}`);
  }
};

module.exports = {
  commands: [...config.AI_ALIASES, 'imagine', 'image', 'img'],
  category: '🤖 AI',
  handler,
};
