/**
 * FUN — text-based fun commands (offline, always work)
 * (reaction commands live in reactions.js; roles in characters.js)
 */
const config = require('../config');
const { pick, randInt } = require('../lib/helpers');

const ROASTS = ['Tumhari tarah main bhi soch raha tha ke zindagi me kuch karna hy... phir maine sochna chhor diya. 😂', 'Wifi ka signal bhi tumse zyada strong hy. 📶', 'Tumhari profile photo dekh ke meri camera ne resign de diya. 📸', 'Tum utne slow ho ke snail bhi keh de "bhai race mat jeeto ge". 🐌', 'Brain chahiye tha tumhe, tumne WiFi router le liya. 🧠'];
const COMPLIMENTS = ['Tum wo ho jiske aane se group ki vibe theek ho jati hy ✨', 'Smile to dekho, sasta sunblock lag jata hy ☀️', 'Tumhari tarif me itni lambi list hy ke WhatsApp character limit maan gayi 💯'];
const QUOTES = ['Kaam aisa karo ke naam khud likha jaye. — Anonymous', 'Mushkilein sirf unhe milti hain jo kuch karna chahte hain. 🌱', 'Sabr phal meetha hota hy, bas waqt lambe rehte hain. ⏳', 'Khud par bharosa wo capital hy jo kabhi depreciation nahi hota. 💪'];
const SHAYARI = ['Chand ko dekh kar yeh mat samajh,\nke raat khatam ho gayi hy,\nab to bas tumhara message aana baqi hy. 🌙', 'Tere naam se shuru hota hy mera din,\naur tere "seen" hone par mukammal. 💬', 'Zindagi ki bhag-daur me ek lamha ruk jao,\njine ke liye kuch pal khud ke liye nikalo. 🌸'];
const JOKES = ['Doctor: Tension nahi lena chahiye. Patient: Main to doctor se share kar raha hoon, aap lena chhoro. 😂', 'Teacher: Kal test hy. Student: Kal se parhta hoon. Aaj mood nahi. 😅', 'WiFi ke samne baithe ho to tum bhi 5G speed se bhagte ho... khane tak. 🍽️'];
const FACTS = ['Octopus ke 3 dil hote hain 🐙', 'Shehad (honey) kabhi kharab nahi hota 🍯', 'Eiffel Tower sirf 6 mahine ke liye banai gayi thi 🏛️', 'Dolphin ek aankh khol kar soti hy 🐬', 'Pakistan me world ki sab se gehri choti K2 hy 🏔️'];
const G8 = ['Hy ✅', 'Nahi ❌', 'Kabhi nahi 🚫', 'Zaroor 💯', 'Poochhte hi raho 😒', 'Ho sakta hy 🤔', 'Mera jawab hy: HAAN! 🔥'];
const DARES = ['Apni last photo group me bhejo 😈', '5 min ke liye apna WhatsApp status "Main pagal hoon" lagao 😂', 'Kisi ajnabi ko "Salam bhai" likho aur screenshot do 😆'];
const TRUTHS = ['Sab se embarrassing message kisko bheja? 👀', 'Aakhri dafa roya kab tha? 😅', 'Aik raaz batao jo ab tak kisi ko nahi pata? 🤫'];
const RIZZ = ['Kya aap WiFi ho? Kyunke connection acha lagta hy 📶', 'Google par maine search kiya tha, aap hi mil gaye 🌐', 'Aapki smile ka screenshot mere gallery ka best photo hy 📸'];
const MEMES = ['https://i.imgflip.com/30b1gx.jpg', 'https://i.imgflip.com/1bij.jpg', 'https://i.imgflip.com/26am.jpg', 'https://i.imgflip.com/1ur9b0.jpg'];
const EMOJIS = ['😀', '😂', '🥰', '😎', '🔥', '💯', '🎉', '🤩', '😇', '🤔', '😴', '🥳', '😭', '😱', '🤯'];

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;
  const who = ctx.quoted ? (ctx.quoted.key.participant || '').split('@')[0] : null;
  const mention = (txt) => ctx.send(ctx.from, { text: txt, mentions: who ? [who + '@s.whatsapp.net'] : [] }, { quoted: ctx.m });

  switch (command) {
    case 'roast': return mention(who ? `@${who} 🔥 ${pick(ROASTS)}` : `🔥 ${pick(ROASTS)}`);
    case 'compliment': return mention(who ? `@${who} ${pick(COMPLIMENTS)}` : pick(COMPLIMENTS));
    case 'quote': return reply(`💬 *Quote:*\n\n${pick(QUOTES)}`);
    case 'shayari': return reply(`🌹 *Shayari:*\n\n${pick(SHAYARI)}`);
    case 'joke': case 'bacha': return reply(`😂 ${pick(JOKES)}`);
    case 'fact': return reply(`🧠 *Fact:* ${pick(FACTS)}`);
    case 'emoji': return reply(`🎲 ${pick(EMOJIS)}`);
    case 'meme': return ctx.send(ctx.from, { image: { url: pick(MEMES) }, caption: `😂 *${config.BOT_NAME} Meme*` }, { quoted: ctx.m });
    case '8ball': return arg ? reply(`🎱 *${arg}*\n\n${pick(G8)}`) : reply('❌ Sawal likho: .8ball kya main pass ho jaon ga?');
    case 'lovetest': case 'ship': {
      const [a, b] = arg.split(/,|&|vs|and/i).map((x) => x && x.trim()).filter(Boolean);
      if (!a || !b) return reply(`❌ Do naam do. Example: ${config.PREFIX}${command} Ali, Sana`);
      const pct = randInt(50, 100);
      const hearts = '❤️'.repeat(Math.ceil(pct / 20));
      return reply(`💕 *${a} 💘 ${b}*\n\n${hearts} *${pct}%*\n${pct > 80 ? 'Shaadi ka laddu tod lo! 🎉' : 'Achi jori hy, mashallah 😄'}`);
    }
    case 'shipname': {
      const [a, b] = arg.split(/,|&|vs|and/i).map((x) => x && x.trim()).filter(Boolean);
      if (!a || !b) return reply(`❌ Do naam do. Example: ${config.PREFIX}shipname Ali, Sana`);
      const name = (a.slice(0, Math.ceil(a.length / 2)) + b.slice(Math.floor(b.length / 2))).replace(/\s/g, '');
      return reply(`💞 *Ship Name:* ${name.charAt(0).toUpperCase() + name.slice(1)} 💘`);
    }
    case 'compatibility': {
      const [a, b] = arg.split(/,|&|vs|and/i).map((x) => x && x.trim()).filter(Boolean);
      if (!a || !b) return reply(`❌ Do naam do. Example: ${config.PREFIX}compatibility Ali, Sana`);
      const pct = randInt(30, 100);
      return reply(`🧩 *Compatibility: ${a} + ${b}*\n\n*${pct}%*\n${pct > 75 ? 'Perfect match! 💯' : 'Thodi mehnat chahiye 😅'}`);
    }
    case 'aura': {
      const aura = randInt(1000, 9999);
      return mention(`@${(who || ctx.sender).split('@')[0]} ⚡ *AURA: ${aura}*\n${aura > 7000 ? 'SIGMA level! 🗿' : 'Aur aura kamana hy to kaam karo 💪'}`);
    }
    case 'rate': case 'character': {
      const pct = randInt(60, 100);
      return mention(`@${(who || ctx.sender).split('@')[0]} ⭐ *Rate: ${pct}/100*\n${pct > 85 ? 'Top class! 🏆' : 'Solid banda hy 💯'}`);
    }
    case 'truth': return reply(`🕵️ *TRUTH:* ${pick(TRUTHS)}`);
    case 'dare': return reply(`😈 *DARE:* ${pick(DARES)}`);
    case 'wyr': return reply('🤔 *Would You Rather:*\n\n1️⃣ Ameer ho kar akela raho\n2️⃣ Gareeb ho kar sab ke sath raho\n\nReply karo kaunsa chunti ho!');
    case 'rizz': return reply(`😏 *Rizz line:*\n\n"${pick(RIZZ)}"`);
    case 'sigma': return reply(`🗿 *SIGMA CHECK*\n\nSigma level: ${randInt(60, 100)}/100\nRespect +${randInt(1, 100)} 🗿`);
    case 'dice': return reply(`🎲 Dice: *${randInt(1, 6)}*`);
    case 'coin': case 'coinflip': case 'flip': return reply(`🪙 ${pick(['HEADS', 'TAILS'])}!`);
    case 'slot': {
      const s = ['🍒', '🍋', '🍇', '💎', '7️⃣', '🔔'];
      const r = [pick(s), pick(s), pick(s)];
      const win = r[0] === r[1] && r[1] === r[2];
      return reply(`🎰 *SLOT MACHINE*\n\n[ ${r.join(' | ')} ]\n\n${win ? '🎉 JACKPOT! Tum jeet gaye!' : '😢 Try again!'}`);
    }
    case 'font': {
      if (!arg) return reply(`❌ Text do. Example: ${config.PREFIX}font SAQIB`);
      const map = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };
      return reply(arg.toLowerCase().split('').map((c) => map[c] || c).join(''));
    }
    case 'repeat': return reply(arg || '❌ Text do.');
    case 'heart': return reply('💖💖💖 *Hearts for you!* 💖💖💖');
    default: return reply('❓ Unknown fun command');
  }
};

module.exports = {
  commands: [
    'roast', 'compliment', 'quote', 'shayari', 'joke', 'bacha', 'fact', 'emoji', 'meme', '8ball',
    'lovetest', 'ship', 'shipname', 'compatibility', 'aura', 'rate', 'character', 'truth', 'dare',
    'wyr', 'rizz', 'sigma', 'dice', 'coin', 'coinflip', 'flip', 'slot', 'font', 'repeat', 'heart',
  ],
  category: '😂 FUN',
  handler,
};
