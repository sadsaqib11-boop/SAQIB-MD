/**
 * GAMES — mini games & group fun (state kept in memory per chat)
 */
const config = require('../config');
const { pick, randInt } = require('../lib/helpers');

const P = () => config.PREFIX;

/* ---------------- shared state ---------------- */
const scores = new Map();   // user -> points
const wallets = new Map();  // user -> coins
const games = new Map();    // chatId -> active game
const pets = new Map();     // user -> pet
const farms = new Map();    // user -> {planted, stage}

const points = (u) => scores.get(u) || 0;
const addPoints = (u, n) => { scores.set(u, points(u) + n); return scores.get(u); };
const coins = (u) => wallets.get(u) || 0;
const addCoins = (u, n) => { wallets.set(u, Math.max(0, coins(u) + n)); return wallets.get(u); };

const QUIZ = [
  ['What is the national flower of Pakistan?', ['Jasmine', 'Rose', 'Sunflower', 'Lotus'], 0],
  ['Which is the largest planet?', ['Mars', 'Jupiter', 'Saturn', 'Earth'], 1],
  ['What is the chemical formula of water?', ['CO2', 'H2O', 'O2', 'NaCl'], 1],
  ['How many surahs are in the Quran?', ['100', '110', '114', '120'], 2],
  ['Which is the fastest animal?', ['Lion', 'Cheetah', 'Horse', 'Deer'], 1],
  ['In which year did Pakistan gain independence?', ['1945', '1946', '1947', '1948'], 2],
  ['Which is the largest ocean in the world?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3],
  ['How many teeth does an adult human have?', ['28', '30', '32', '34'], 2],
];
const TRUTH = ['Who scares you the most?', 'When did you last tell a lie?', 'What is your worst habit?', 'Do you secretly like someone?', 'What is the most embarrassing photo on your phone?'];
const DARE = ['Send your worst selfie', 'Sing a song in a voice note', 'Give 3 people a compliment', 'Say the first word in your search history', 'Laugh out loud for 10 seconds'];
const NHIE = ['Never have I ever... told a lie.', 'Never have I ever... slept in class.', 'Never have I ever... ignored someone\'s message.', 'Never have I ever... cheated in an exam.', 'Never have I ever... stayed on my phone until 3 AM.'];
const PARANOIA = ['If you could be invisible for 24 hours, what would you do?', 'What rumour has spread about you?', 'What do you lie about?'];
const CAPITALS = [['Pakistan', 'Islamabad'], ['India', 'New Delhi'], ['China', 'Beijing'], ['Turkey', 'Ankara'], ['Japan', 'Tokyo'], ['Egypt', 'Cairo'], ['Iran', 'Tehran'], ['Saudi Arabia', 'Riyadh']];
const FLAGS = [['🇵🇰', 'Pakistan'], ['🇮🇳', 'India'], ['🇹🇷', 'Turkey'], ['🇯🇵', 'Japan'], ['🇨🇳', 'China'], ['🇸🇦', 'Saudi Arabia'], ['🇬🇧', 'United Kingdom'], ['🇺🇸', 'United States']];
const EMOJI_STORY = [['🚗💨😱🏥', 'Car accident'], ['👦❤️👧💍', 'Love marriage'], ['🎓📚💪🏆', 'Study success'], ['🍕😋🤤', 'Pizza craving']];
const SONGS = ['Tum Hi Ho', 'Kesariya', 'Pasoori', 'Afreen Afreen', 'Dil Dil Pakistan', 'Jee Le Zara'];

const handler = async (ctx) => {
  const { command, reply, arg, senderNum, from, isGroup, pushname } = ctx;
  const who = senderNum || pushname || 'player';
  const chat = from || 'chat';

  switch (command) {
    /* ---------------- simple fun ---------------- */
    case 'paranoia': return reply(`😳 *Paranoia*\n\n${pick(PARANOIA)}`);
    case 'nhie': return reply(`🙊 *Never Have I Ever*\n\n${pick(NHIE)}`);
    case 'couple': return reply(`💑 *Couple of the day*\n\n${isGroup ? 'Today\'s couple: *' + pick(['Ali ❤️ Ayesha', 'Hamza ❤️ Zara', 'Bilal ❤️ Hina', 'Usman ❤️ Maryam']) + '*' : 'This command is more fun in a group 😄'}`);
    case 'spinthebottle': return reply(`🍾 *The bottle spun...*\n\n👉 ${isGroup ? 'It stopped on a member! Random pick: *' + (ctx.mentioned?.[0]?.split('@')[0] || 'you') + '*' : 'Try it in a group'}`);
    case 'songguess': {
      if (!isGroup) return reply('❌ This is a group game.');
      const s = pick(SONGS);
      games.set(chat, { type: 'song', answer: s.toLowerCase(), tries: 0 });
      return reply(`🎵 *Song Guess*\n\nGuess the film/song name — you have 1 minute!\n\n_Hint: the first word is "${s.split(' ')[0]}"_\n\nSend your answer as a message.`);
    }
    case 'emojistory': return reply(`📱 *Emoji Story*\n\n${pick(EMOJI_STORY).join(' → ')}\n\n_Can you tell what the scene is?_`);
    case 'flagguess': {
      const [f, n] = pick(FLAGS);
      games.set(chat, { type: 'flag', answer: n.toLowerCase() });
      return reply(`🏳️ *Flag Guess*\n\n${f}\n\nWhich country is this? Type the name.`);
    }
    case 'movieguess': return reply(`🎬 *Movie Guess*\n\n_3 dreams, 1 magic, and a little boy_\n\nType the answer!`);
    case 'antakshari': return reply(`🎶 *Antakshari*\n\nStarting letter: *${pick(['A', 'M', 'S', 'T', 'K'])}*\n\nSing a song that starts with this letter!`);
    case 'storygame': return reply(`📖 *Story Game*\n\nFirst line: *${pick(['One night, in a dark alley...', 'A small village, a big dream...', 'It was raining, and he was alone...'])}*\n\nNow every member adds one line!`);
    case 'fmk': return reply(`😅 *FMK*\n\nFormat: ${P()}fmk Ali | Ayesha | Bilal\n\n_Give 3 names and have fun._`);
    case 'mafia': return reply(`🕵️ *Mafia*\n\nPlay in a group: everyone DMs their role, then you vote.\n\n_You need a moderator — say ${P()}start._`);
    case 'simon': return reply(`🎮 *Simon Says*\n\n🟢🔴🟡🔵\n\nMemorise the sequence: *🔴 🟡 🔴 🟢*\n\nSend it back!`);
    case 'high-low': {
      const n = randInt(1, 100);
      games.set(chat, { type: 'highlow', n });
      return reply(`📈 *High or Low*\n\nI picked a number from 1-100. Tell me: *high* (50+) or *low* (1-49)?`);
    }
    case 'scratch': {
      const win = randInt(1, 100) <= 30;
      return reply(`🎟️ *Scratch card*\n\n${win ? `🎉 *YOU WON!* +${randInt(50, 500)} coins` : '😢 Nothing this time — try again!'}`);
    }
    case 'lottery': {
      const nums = Array.from({ length: 6 }, () => randInt(1, 49)).sort((a, b) => a - b);
      return reply(`🎰 *Lottery numbers*\n\n${nums.join(' — ')}\n\n_Good luck! 😄_`);
    }
    case 'loot': case 'daily': {
      const last = wallets.get(who + '_last') || 0;
      const day = 86400000;
      if (Date.now() - last < day) {
        const left = Math.ceil((day - (Date.now() - last)) / 3600000);
        return reply(`⏳ You already took your *daily loot*.\n\nCurrent balance: *${coins(who)} coins*\nNext loot: in ~${left} hours`);
      }
      wallets.set(who + '_last', Date.now());
      const got = randInt(100, 500);
      addCoins(who, got);
      return reply(`💰 *Daily loot!*\n\n+${got} coins\n💳 Balance: *${coins(who)}*`);
    }
    case 'wallet': return reply(`👛 *Wallet*\n\n${pushname}: *${coins(who)} coins*\n\n${P()}loot — daily coins\n${P()}shop — browse items`);
    case 'shop': return reply(`🛒 *Shop*\n\n🎁 Gift — 200 coins\n🍕 Pizza — 300 coins\n💎 Diamond — 1000 coins\n👑 VIP — 5000 coins\n\n_(Wallet system is a demo — no real items.)_`);
    case 'heist': {
      const win = randInt(1, 100) <= 45;
      const amt = randInt(100, 800);
      if (win) { addCoins(who, amt); return reply(`🕵️ *Heist successful!*\n\n+${amt} coins\n💳 Balance: *${coins(who)}*`); }
      addCoins(who, -200);
      return reply(`🚨 *Heist failed!*\n\nThe police caught you — 200 coin fine.\n💳 Balance: *${coins(who)}*`);
    }
    case 'fish': return reply(`🎣 *Fishing*\n\nYou caught: *${pick(['Rohu 🐟', 'Surmai 🐠', 'Pomfret 🐡', 'An old shoe 🥾'])}*\n\n${P()}fish — try again`);
    case 'hunt': return reply(`🏹 *Hunting*\n\nYour prey: *${pick(['Rabbit 🐇', 'Partridge 🐦', 'Deer 🦌', 'Nothing 😅'])}*`);
    case 'mine': {
      const found = pick(['Coal 🪨', 'Iron ⛓️', 'Gold 🥇', 'Diamond 💎', 'Nothing 🕳️']);
      return reply(`⛏️ *Mining*\n\nYou found: *${found}*`);
    }
    case 'farm': {
      const f = farms.get(who) || { stage: 0 };
      f.stage = Math.min(5, f.stage + 1);
      farms.set(who, f);
      const stages = ['🌱 Seeds planted', '🌿 Small sprout', '🌾 Fully grown', '🌾 Ready — harvest it!', '✅ Harvested!'];
      return reply(`🌾 *Farm*\n\n${stages[Math.min(f.stage, 4)]}\n\nStage: ${f.stage}/4`);
    }
    case 'pets': {
      const p = pets.get(who) || { name: pick(['Billu', 'Sheru', 'Motu', 'Chotu']), hunger: 50, happy: 50 };
      pets.set(who, p);
      return reply(`🐾 *Your pet*\n\nName: *${p.name}*\n🍖 Hunger: ${p.hunger}%\n😊 Happiness: ${p.happy}%\n\n_${P()}pets — to see it again_`);
    }

    /* ---------------- real games ---------------- */
    case 'capitals': {
      const [country, city] = pick(CAPITALS);
      games.set(chat, { type: 'capital', answer: city.toLowerCase() });
      return reply(`🏛️ *Capital Quiz*\n\nWhat is the capital of ${country}?\n\nType the name.`);
    }
    case 'trivia': {
      const [q, opts, ans] = pick(QUIZ);
      games.set(chat, { type: 'trivia', answer: opts[ans].toLowerCase() });
      return reply(`🧠 *Trivia*\n\n❓ ${q}\n\n${opts.map((o, i) => `${'ABCD'[i]}. ${o}`).join('\n')}\n\n_Type the answer or the option letter._`);
    }
    case 'guess': {
      games.set(chat, { type: 'guess', n: randInt(1, 100), tries: 0 });
      return reply(`🔢 *Number Guess*\n\nI picked a number between 1 and 100.\nGuess it!`);
    }
    case 'hangman': {
      const words = ['biryani', 'karachi', 'cricket', 'chai', 'mango', 'pakistan', 'lahore', 'monsoon'];
      const w = pick(words);
      games.set(chat, { type: 'hangman', word: w, guessed: [], left: 6 });
      return reply(`🎯 *Hangman*\n\n${'_ '.repeat(w.length)}\n\n❤️ Lives: 6\n\nSend one letter.`);
    }
    case 'wordle': {
      const words = ['chai', 'kitaab', 'pani', 'dost', 'khush', 'mehnat', 'dunya', 'ilm'];
      const w = pick(words);
      games.set(chat, { type: 'wordle', word: w, tries: 0 });
      return reply(`🟩 *Wordle*\n\nI picked a word with ${w.length} letters. 6 tries.\n\nSend your first guess!`);
    }
    case 'wordchain': {
      const last = games.get(chat)?.last || pick(['a', 'b', 'm', 's']);
      games.set(chat, { type: 'chain', last });
      return reply(`🔗 *Word Chain*\n\nStart: *${last}*\n\nThe next word must start with: *${last.slice(-1).toUpperCase()}*`);
    }
    case 'mathsprint': {
      const a = randInt(10, 99), b = randInt(10, 99);
      games.set(chat, { type: 'math', answer: String(a + b) });
      return reply(`⚡ *Math Sprint*\n\n${a} + ${b} = ?\n\nAnswer fast!`);
    }
    case 'ttt': case 'rps': case 'chess': case 'uno': case 'connect4': case 'battleship': {
      const names = { ttt: 'Tic-Tac-Toe', rps: 'Rock Paper Scissors', chess: 'Chess', uno: 'Uno', connect4: 'Connect Four', battleship: 'Battleship' };
      if (command === 'rps') {
        const me = pick(['rock', 'paper', 'scissors']);
        const you = pick(['rock', 'paper', 'scissors']);
        const win = (me === 'rock' && you === 'scissors') || (me === 'paper' && you === 'rock') || (me === 'scissors' && you === 'paper');
        return reply(`✊ *Rock Paper Scissors*\n\n🤖 Bot: ${me}\n👤 You: ${you}\n\n${me === you ? '🤝 Draw!' : win ? '😢 The bot won!' : '🎉 You won!'}`);
      }
      return reply(`🎮 *${names[command]}*\n\nThis game is not available in text mode yet.\n\n✅ Play these: ${P()}trivia, ${P()}guess, ${P()}hangman, ${P()}wordle, ${P()}rps, ${P()}high-low`);
    }
    case 'blackjack': {
      const card = () => randInt(1, 11);
      const you = card() + card();
      const bot = card() + card();
      const win = you <= 21 && (bot > 21 || you > bot);
      return reply(`🃏 *Blackjack*\n\n👤 You: ${you}\n🤖 Bot: ${bot}\n\n${you > 21 ? '💥 Bust! You lost.' : win ? '🎉 You won!' : '😢 The bot won.'}`);
    }
    case 'memory': {
      const seq = Array.from({ length: 4 }, () => pick(['🍎', '🍌', '🍇', '🍒']));
      games.set(chat, { type: 'memory', answer: seq.join('') });
      return reply(`🧠 *Memory Game*\n\n${seq.join(' ')}\n\nMemorise it in 5 seconds, then send the same order!`);
    }
    case '2048': return reply(`🎮 *2048*\n\nNot in text mode. Play on your phone: https://play2048.co`);
    case 'sudoku': {
      const puz = [
        '5 3 . | . 7 . | . . .',
        '6 . . | 1 9 5 | . . .',
        '. 9 8 | . . . | . 6 .',
        '------+-------+------',
        '8 . . | . 6 . | . . 3',
      ];
      return reply(`🧩 *Sudoku*\n\n\`\`\`\n${puz.join('\n')}\n\`\`\`\n\n_Complete it! (Full puzzle: sudoku.com)_`);
    }
    case 'quizduel': return reply(`⚔️ *Quiz Duel*\n\nPractise with ${P()}trivia — 1v1 mode is coming soon!`);

    /* ---------------- scoreboard ---------------- */
    case 'rank': {
      const p = points(who);
      const lvl = Math.floor(p / 100) + 1;
      return reply(`🏅 *Rank*\n\n${pushname}\n⭐ Points: *${p}*\n🎖️ Level: *${lvl}*\n\n${'▰'.repeat(Math.min(10, lvl))}${'▱'.repeat(Math.max(0, 10 - lvl))}`);
    }
    case 'leaderboard': {
      const top = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (!top.length) return reply(`📊 *Leaderboard*\n\nNo points yet. Start with ${P()}trivia!`);
      return reply(`🏆 *Leaderboard*\n\n${top.map(([u, p], i) => `${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} ${u} — ${p} pts`).join('\n')}`);
    }
    default:
      return reply('❓ Unknown game');
  }
};

/** Answer-catcher: hooks into every message to resolve active games. */
async function onMessage(ctx) {
  const { text, from, senderNum, pushname } = ctx;
  if (!text || text.startsWith(config.PREFIX)) return;
  const chat = from || 'chat';
  const g = games.get(chat);
  if (!g) return;
  const t = text.trim().toLowerCase();
  const who = senderNum || pushname || 'player';

  if (g.type === 'trivia' || g.type === 'flag' || g.type === 'capital') {
    if (t === g.answer || t === g.answer[0]) {
      games.delete(chat);
      const p = addPoints(who, 10);
      await ctx.reply(`✅ *Correct answer!* ${g.answer}\n\n+10 points (total ${p})`);
    }
  } else if (g.type === 'guess') {
    const n = parseInt(t, 10);
    if (isNaN(n)) return;
    g.tries++;
    if (n === g.n) { games.delete(chat); const p = addPoints(who, 20); await ctx.reply(`🎉 *Exactly right!* The number was ${g.n}.\n+20 points (total ${p})`); }
    else if (g.tries >= 7) { games.delete(chat); await ctx.reply(`😅 7 tries used up! The number was *${g.n}*.`); }
    else await ctx.reply(n < g.n ? '⬆️ Try a bigger number' : '⬇️ Try a smaller number');
  } else if (g.type === 'math') {
    if (t === g.answer) { games.delete(chat); const p = addPoints(who, 5); await ctx.reply(`⚡ *Correct!* +5 points (total ${p})`); }
  } else if (g.type === 'highlow') {
    if (t === 'high' || t === 'low') {
      games.delete(chat);
      const isHigh = g.n >= 50;
      const win = (t === 'high') === isHigh;
      await ctx.reply(`🔢 The number was *${g.n}* — ${isHigh ? 'HIGH' : 'LOW'}\n\n${win ? '🎉 You were right!' : '😢 Wrong!'}`);
    }
  } else if (g.type === 'song') {
    if (g.answer.includes(t) || t.includes(g.answer)) { games.delete(chat); const p = addPoints(who, 15); await ctx.reply(`🎵 *Correct song!* ${g.answer}\n+15 points (total ${p})`); }
  } else if (g.type === 'wordle') {
    if (t.length !== g.word.length) return;
    g.tries++;
    if (t === g.word) { games.delete(chat); const p = addPoints(who, 25); await ctx.reply(`🟩 *Wordle solved!* ${g.word}\n+25 points (total ${p})`); }
    else {
      const hint = t.split('').map((c, i) => (c === g.word[i] ? '🟩' : g.word.includes(c) ? '🟨' : '⬜')).join('');
      if (g.tries >= 6) { games.delete(chat); await ctx.reply(`😅 Tries used up! The word was *${g.word}*.`); }
      else await ctx.reply(`${hint}\n\n_Try ${g.tries}/6_`);
    }
  } else if (g.type === 'hangman') {
    const c = t[0];
    if (!/^[a-z]$/.test(c)) return;
    if (g.guessed.includes(c)) return;
    g.guessed.push(c);
    if (!g.word.includes(c)) g.left--;
    const shown = g.word.split('').map((x) => (g.guessed.includes(x) ? x : '_')).join(' ');
    if (!shown.includes('_')) { games.delete(chat); const p = addPoints(who, 15); await ctx.reply(`🎉 *Word found:* ${g.word}\n+15 points (total ${p})`); }
    else if (g.left <= 0) { games.delete(chat); await ctx.reply(`💀 *Game over!* The word was *${g.word}*.`); }
    else await ctx.reply(`${shown}\n❤️ Lives: ${g.left}\n_Guessed: ${g.guessed.join(', ')}_`);
  } else if (g.type === 'memory') {
    if (t.replace(/\s/g, '') === g.answer.replace(/\s/g, '')) { games.delete(chat); const p = addPoints(who, 10); await ctx.reply(`🧠 *Perfect memory!* +10 points (total ${p})`); }
  } else if (g.type === 'chain') {
    if (t[0] === g.last.slice(-1)) { g.last = t; await ctx.reply(`✅ *${t}* — next word must start with *${t.slice(-1).toUpperCase()}*!`); }
  }
}

module.exports = {
  commands: [
    'paranoia', 'nhie', 'couple', 'rank', 'leaderboard', 'wallet', 'shop', 'trivia', 'guess', 'hangman',
    'lottery', 'scratch', 'loot', 'heist', 'fish', 'hunt', 'mine', 'farm', 'pets', 'mathsprint', 'wordle',
    'wordchain', 'antakshari', 'songguess', 'emojistory', 'movieguess', 'flagguess', 'capitals', 'storygame',
    'spinthebottle', 'blackjack', 'high-low', 'memory', '2048', 'sudoku', 'mafia', 'simon',
    // extras that belong in this family
    'daily', 'ttt', 'rps', 'chess', 'uno', 'connect4', 'battleship', 'quizduel', 'fmk',
  ],
  category: '🎮 GAMES',
  handler,
  onMessage,
};
