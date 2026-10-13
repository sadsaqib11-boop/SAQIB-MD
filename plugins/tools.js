/**
 * TOOLS — premium utility commands (weather, translate, qr, wiki, calc, etc.)
 */
const config = require('../config');
const { getJSON, getText, pick } = require('../lib/helpers');
const crypto = require('crypto');

/** Safe arithmetic evaluator (no eval) */
function safeCalc(expr) {
  const clean = String(expr).replace(/[^0-9+\-*/%().^ ]/g, '');
  if (!clean.trim()) throw new Error('Sahi expression likho');
  // tokenize + shunting-yard
  const tokens = clean.match(/(\d+\.?\d*|[+\-*/%^()])/g) || [];
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
  const out = [], ops = [];
  for (const t of tokens) {
    if (/^\d/.test(t)) out.push(parseFloat(t));
    else if (t === '(') ops.push(t);
    else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()); ops.pop(); }
    else { while (ops.length && prec[ops[ops.length - 1]] >= prec[t]) out.push(ops.pop()); ops.push(t); }
  }
  while (ops.length) out.push(ops.pop());
  const st = [];
  for (const t of out) {
    if (typeof t === 'number') st.push(t);
    else { const b = st.pop(), a = st.pop(); st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '/' ? a / b : t === '%' ? a % b : Math.pow(a, b)); }
  }
  const r = st.pop();
  if (!isFinite(r)) throw new Error('Result infinite');
  return r;
}

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;

  switch (command) {
    case 'weather': {
      if (!arg) return reply(`❌ City do. Example: ${config.PREFIX}weather Lahore`);
      try {
        const r = await getJSON(`https://wttr.in/${encodeURIComponent(arg)}?format=j1`);
        const c = r.current_condition[0];
        await reply(`🌤️ *Weather — ${arg}*\n\n🌡️ Temp: ${c.temp_C}°C (feels ${c.FeelsLikeC}°C)\n☁️ ${c.weatherDesc[0].value}\n💧 Humidity: ${c.humidity}%\n💨 Wind: ${c.windspeedKmph} km/h\n👁️ Visibility: ${c.visibility} km`);
      } catch { await reply('❌ City nahi mili.'); }
      break;
    }
    case 'translate': case 'tr': {
      const parts = arg.split('|').map((s) => s.trim());
      const [text, lang] = parts.length > 1 ? [parts[0], parts[1]] : [arg, 'ur'];
      if (!text) return reply(`❌ Format: ${config.PREFIX}translate Hello | ur`);
      try {
        const r = await getJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${encodeURIComponent(lang)}`);
        await reply(`🌐 *Translation (${lang}):*\n\n${r.responseData?.translatedText || '❌ fail'}`);
      } catch { await reply('❌ Translation fail.'); }
      break;
    }
    case 'qr': {
      if (!arg) return reply(`❌ Text do. Example: ${config.PREFIX}qr https://example.com`);
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(arg)}`;
      await ctx.send(ctx.from, { image: { url }, caption: `📱 *QR Code*\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
      break;
    }
    case 'shorturl': case 'short': {
      if (!arg || !/^https?:/.test(arg)) return reply('❌ Valid URL do.');
      try {
        const r = await getText(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(arg)}`);
        await reply(`🔗 *Short URL:*\n${r}`);
      } catch { await reply('❌ Shorten fail.'); }
      break;
    }
    case 'calc': {
      if (!arg) return reply(`❌ Expression do. Example: ${config.PREFIX}calc 5*8+2`);
      try { await reply(`🧮 *${arg}* = *${safeCalc(arg)}*`); }
      catch (e) { await reply('❌ ' + e.message); }
      break;
    }
    case 'wiki': {
      if (!arg) return reply(`❌ Topic do. Example: ${config.PREFIX}wiki Pakistan`);
      try {
        const r = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(arg)}`);
        if (r.type === 'disambiguation' || !r.extract) return reply('❌ Topic nahi mila.');
        await reply(`📚 *${r.title}*\n\n${r.extract.slice(0, 900)}`);
      } catch { await reply('❌ Wikipedia fail.'); }
      break;
    }
    case 'time': {
      const tz = arg || config.TIMEZONE;
      try {
        const r = await getJSON(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`);
        await reply(`🕐 *Time — ${tz}*\n${new Date(r.datetime).toLocaleString()}`);
      } catch { await reply(`🕐 ${new Date().toLocaleString('en-PK', { timeZone: config.TIMEZONE })}`); }
      break;
    }
    case 'ip': {
      const target = arg || '';
      try {
        const r = await getJSON(`http://ip-api.com/json/${encodeURIComponent(target)}`);
        if (r.status !== 'success') return reply('❌ IP info nahi mili.');
        await reply(`🌐 *IP Info*\n\nIP: ${r.query}\n🌍 Country: ${r.country}\n🏙️ City: ${r.city}\n📡 ISP: ${r.isp}\n🕐 Timezone: ${r.timezone}`);
      } catch { await reply('❌ IP lookup fail.'); }
      break;
    }
    case 'base64': {
      const [mode, ...rest] = arg.split(' ');
      const text = rest.join(' ');
      if (!text) return reply(`❌ Format: ${config.PREFIX}base64 encode hello`);
      if (mode === 'encode') await reply(`🔐 ${Buffer.from(text).toString('base64')}`);
      else if (mode === 'decode') { try { await reply(`🔓 ${Buffer.from(text, 'base64').toString('utf8')}`); } catch { await reply('❌ Invalid base64.'); } }
      else await reply('❌ Mode: encode | decode');
      break;
    }
    case 'hash': {
      if (!arg) return reply(`❌ Text do. Example: ${config.PREFIX}hash hello`);
      await reply(`🔒 *Hashes*\n\nMD5: ${crypto.createHash('md5').update(arg).digest('hex')}\nSHA1: ${crypto.createHash('sha1').update(arg).digest('hex')}\nSHA256: ${crypto.createHash('sha256').update(arg).digest('hex').slice(0, 40)}...`);
      break;
    }
    case 'password': {
      const len = Math.min(64, Math.max(8, parseInt(arg) || 16));
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
      let pw = '';
      for (let i = 0; i < len; i++) pw += chars[crypto.randomInt(chars.length)];
      await reply(`🔑 *Generated Password (${len}):*\n\n\`${pw}\``);
      break;
    }
    case 'currency': case 'rate': {
      const [amount, from, to] = arg.split(' ');
      if (!from || !to) return reply(`❌ Format: ${config.PREFIX}currency 100 USD PKR`);
      try {
        const r = await getJSON(`https://api.exchangerate-api.com/v4/latest/${from.toUpperCase()}`);
        const rate = r.rates[to.toUpperCase()];
        if (!rate) return reply('❌ Currency nahi mili.');
        await reply(`💱 *${amount || 1} ${from.toUpperCase()} = ${((parseFloat(amount) || 1) * rate).toFixed(2)} ${to.toUpperCase()}*`);
      } catch { await reply('❌ Currency API fail.'); }
      break;
    }
    case 'news': {
      try {
        const r = await getJSON('https://inshorts.deta.dev/news?category=world').catch(() => null);
        const items = r?.data?.slice(0, 5) || [];
        if (!items.length) return reply('❌ News API fail — thori dair baad try karo.');
        await reply(`📰 *Top News*\n\n${items.map((n, i) => `${i + 1}. ${n.title}`).join('\n\n')}`);
      } catch { await reply('❌ News fail.'); }
      break;
    }
    case 'joke2': {
      try {
        const r = await getJSON('https://official-joke-api.appspot.com/random_joke');
        await reply(`😂 ${r.setup}\n\n${r.punchline}`);
      } catch { await reply('❌ Joke fail.'); }
      break;
    }
    case 'quote2': {
      try {
        const r = await getJSON('https://api.quotable.io/random');
        await reply(`💬 *${r.content}*\n— ${r.author}`);
      } catch { await reply('❌ Quote fail.'); }
      break;
    }
    default: await reply('❓ Unknown tool command');
  }
};

module.exports = {
  commands: ['weather', 'translate', 'tr', 'qr', 'shorturl', 'short', 'calc', 'wiki', 'time', 'ip', 'base64', 'hash', 'password', 'currency', 'news', 'joke2', 'quote2'],
  category: '🧰 TOOLS',
  handler,
};
