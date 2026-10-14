/**
 * CHARACTERS — role/character commands + DP commands + rating commands
 */
const config = require('../config');
const { getJSON, pick, randInt } = require('../lib/helpers');

// role -> { emoji, line }
const ROLES = {
  dad: ['👨', 'tumhara *BAAP* hy! 😎'],
  mom: ['👩', 'tumhari *AMMI* hy! 🥰'],
  son: ['👦', 'tumhara *BETA* hy! 😄'],
  daughter: ['👧', 'tumhari *BETI* hy! 🌸'],
  boyfriend: ['💑', 'tumhara *BOYFRIEND* hy! 😍'],
  girlfriend: ['💏', 'tumhari *GIRLFRIEND* hy! 🥰'],
  twin: ['👯', 'tumhara *JUDAWA* hy! 😲'],
  partner: ['🤝', 'tumhara *PARTNER* hy! 💪'],
  bodyguard: ['🛡️', 'tumhara *BODYGUARD* hy! 🥷'],
  boss: ['💼', 'tumhara *BOSS* hy! 😎'],
  employee: ['🧑‍💼', 'tumhara *EMPLOYEE* hy! 📋'],
  pet: ['🐾', 'tumhara *PALtoo* hy! 🐶'],
  servant: ['🧹', 'tumhara *NAUKAR* hy! 😅'],
  idol: ['🌟', 'tumhara *IDOL* hy! 🤩'],
  fan: ['📣', 'tumhara *FAN* hy! 🥳'],
  ghost: ['👻', 'tumhara *BHOOT* hy! 😱'],
  angel: ['😇', 'tumhara *FARISHTA* hy! ✨'],
  devil: ['😈', 'tumhara *SHAITAN* hy! 🔥'],
  king: ['👑', 'tumhara *KING* hy! 🤴'],
  queen: ['👸', 'tumhari *QUEEN* hy! 💃'],
  slave: ['⛓️', 'tumhara *GULAM* hy! 😆'],
  master: ['🧙', 'tumhara *MASTER* hy! 🔮'],
  fool: ['🤡', 'tumhara *PAGAL* hy! 😂'],
  rich: ['💰', 'tumhara *AMEER* dost hy! 🤑'],
  poor: ['🪙', 'tumhara *GAREEB* dost hy! 😢'],
  bhai: ['🤝', 'tumhara *BHAI* hy! 💪'],
  bahan: ['👧', 'tumhari *BEHN* hy! 🌸'],
  wife: ['👰', 'tumhari *BIWI* hy! 💍'],
  husband: ['🤵', 'tumhara *SHOHAR* hy! 💍'],
  chacha: ['🧔', 'tumhara *CHACHA* hy! 😎'],
  chachi: ['👩', 'tumhari *CHACHI* hy! 😄'],
  nana: ['👴', 'tumhara *NANA* hy! 👑'],
  nani: ['👵', 'tumhari *NANI* hy! 🥰'],
  mama: ['🧑', 'tumhara *MAMA* hy! 😁'],
  mami: ['👩', 'tumhari *MAMI* hy! 😊'],
  bestfriend: ['🫂', 'tumhara *BEST FRIEND* hy! 💯'],
  enemy: ['⚔️', 'tumhara *DUSHMAN* hy! 😠'],
  crush: ['💘', 'tumhara *CRUSH* hy! 😳'],
  teacher: ['👨‍🏫', 'tumhara *USTAD* hy! 📚'],
  student: ['🎒', 'tumhara *STUDENT* hy! ✏️'],
  rival: ['🥊', 'tumhara *RIVAL* hy! 🔥'],
  runmureed: ['🕋', 'tumhara *ROOHANI MUREED* hy! 🤲'],
  cosplay: ['🎭', 'tumhara *COSPLAY* partner hy! ✨'],
};

// rating-style commands
const RATINGS = {
  chad: ['🗿', 'CHAD level'],
  npc: ['🤖', 'NPC energy'],
  maincharacter: ['🌟', 'Main Character energy'],
  delulu: ['🫠', 'DELULU level'],
  redflag: ['🚩', 'RED FLAG count'],
  greenflag: ['💚', 'GREEN FLAG count'],
  simp: ['🥺', 'SIMP level'],
  vibe: ['🎶', 'VIBE level'],
  muth: ['🤣', 'MUTH level'],
  cake: ['🎂', 'CAKE level'],
  pickup: ['😏', 'PICKUP line skill'],
  tecnologia: ['💻', 'TECH knowledge'],
  taroun: ['🔮', 'TAROT luck'],
  horoscope: ['♈', 'Horoscope luck'],
};

async function nekoImg(cat) {
  const r = await getJSON(`https://nekos.best/api/v2/${cat}`);
  return r?.results?.[0]?.url || null;
}

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;
  const who = ctx.quoted ? (ctx.quoted.key.participant || '').split('@')[0] : null;
  const tag = who ? `@${who}` : (arg || 'tum');
  const mentions = who ? [who + '@@s.whatsapp.net'.replace('@@', '@')] : [];

  // ---- role commands ----
  if (ROLES[command]) {
    const [emoji, line] = ROLES[command];
    return ctx.send(ctx.from, { text: `${emoji} ${tag} ${line}`, mentions }, { quoted: ctx.m });
  }

  // ---- rating commands ----
  if (RATINGS[command]) {
    const [emoji, label] = RATINGS[command];
    const pct = randInt(40, 100);
    return ctx.send(ctx.from, { text: `${emoji} *${label}* for ${tag}: *${pct}%*`, mentions }, { quoted: ctx.m });
  }

  // ---- DP commands (boydp1..22 / girldp1..22) ----
  if (/^(boy|girl)dp\d+$/.test(command)) {
    const isGirl = command.startsWith('girl');
    try {
      const url = await nekoImg(isGirl ? 'waifu' : 'husbando');
      if (!url) throw new Error('no img');
      await ctx.send(ctx.from, { image: { url }, caption: `${isGirl ? '👧' : '👦'} *${command}* DP\n👑 ${config.BOT_NAME}` }, { quoted: ctx.m });
    } catch { await reply('❌ DP nahi mili, dobara try karo.'); }
    return;
  }

  await reply('❓ Unknown character command');
};

const commands = [
  ...Object.keys(ROLES), ...Object.keys(RATINGS),
  ...Array.from({ length: 22 }, (_, i) => `boydp${i + 1}`),
  ...Array.from({ length: 22 }, (_, i) => `girldp${i + 1}`),
];

module.exports = { commands, category: '🎎 CHARACTERS', handler };
