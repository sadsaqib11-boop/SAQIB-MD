/**
 * AI — all AI aliases route to Gemini (if key set) or a keyless engine; plus .imagine (image generation)
 */
const config = require('../config');
const { downloadMedia } = require('../lib/helpers');

const STYLE_NOTES = {
  grok: 'Jawab thoda witty aur sharp style mein do.',
  claude: 'Jawab thoughtful aur clear style mein do.',
  deepseek: 'Technical/coding sawal ho to detail se jawab do.',
  mathgpt: 'Ye maths sawal hy — step by step solve karo.',
};

/** Google Gemini — try a list of models so one busy/retired model never breaks AI */
const GEMINI_MODELS = [config.GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'].filter((m, i, a) => m && a.indexOf(m) === i);

async function askGemini(prompt, imageBase64 = null) {
  const parts = [{ text: prompt }];
  if (imageBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: 900 } }),
      });
      if (!res.ok) { lastErr = new Error(`AI API error ${res.status}`); continue; }
      const data = await res.json();
      const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('');
      if (out) return out;
      lastErr = new Error('empty');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('AI API error');
}

/** Keyless fallback engine (OpenAI-compatible) — works with no API key */
async function askPollinations(prompt) {
  const res = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai',
      messages: [
        { role: 'system', content: `You are ${config.BOT_NAME}, a helpful, friendly WhatsApp assistant. Reply in the user's language (Urdu/Roman Urdu/English). Keep answers clear and useful.` },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI API error ${res.status}`);
  const data = await res.json();
  const out = data.choices?.[0]?.message?.content;
  return out ? String(out).trim() : '❌ Koi jawab nahi mila.';
}

/** Unified AI entry: Gemini if key present, else keyless fallback */
async function askAI(prompt, imageBase64 = null) {
  if (config.GEMINI_API_KEY) {
    try { return await askGemini(prompt, imageBase64); }
    catch (e) { /* fall through to keyless engine */ }
  }
  return askPollinations(prompt);
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
    const answer = await askAI(style ? `${prompt}\n(${style})` : prompt, img);
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
