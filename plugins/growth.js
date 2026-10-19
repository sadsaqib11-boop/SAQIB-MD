/**
 * GROWTH — invite / referral system + share card
 * ----------------------------------------------
 * The viral loop that turns every user into a marketer:
 *
 *   .share / .invite / .referral  -> a forwardable card with the bot's wa.me
 *                                    link + the user's invite code
 *   .redeem <CODE>                -> a NEW user joins with someone's code;
 *                                    the inviter earns an invite (notified)
 *   .toprefer / .topinvite        -> leaderboard of top inviters
 *
 * At REFERRAL_GOAL invites (default 10) the inviter is auto-upgraded to
 * PREMIUM (see lib/referrals.js). One credit per joiner, ever — no farming.
 *
 * The onMessage hook also (a) welcomes a brand-new user the first time they
 * greet the bot, and (b) auto-credits a code if a new user pastes it.
 */
const config = require('../config');
const ref = require('../lib/referrals');

const P = config.PREFIX;

/** The bot's own wa.me add-link, pre-filled with the joiner's redeem command. */
function botLink(session, code) {
  const num = String((session && session.number) || config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
  if (!num) return '';
  const text = code ? `?text=${encodeURIComponent(`${P}redeem ${code}`)}` : '';
  return `https://wa.me/${num}${text}`;
}

/** Progress bar, e.g. ▰▰▰▱▱▱▱▱▱▱ */
function bar(done, goal) {
  const n = 10;
  const filled = Math.max(0, Math.min(n, Math.round((done / goal) * n)));
  return '▰'.repeat(filled) + '▱'.repeat(n - filled);
}

function shareCard(ctx) {
  const st = ref.stats(ctx.senderNum);
  const link = botLink(ctx.session, st.code);
  const need = Math.max(0, st.goal - st.invites);
  const status = st.premium
    ? '👑 *PREMIUM* — unlocked!'
    : `${bar(st.invites, st.goal)}  *${st.invites}/${st.goal}*\n_${need} aur invite → FREE PREMIUM_`;
  return (
    `🚀 *${config.BOT_NAME}* — Pakistan ka sabse fast WhatsApp bot!\n` +
    `🎬 Movies · 🎵 Songs · 📥 TikTok · 🤖 AI · 🎨 Stickers · 📚 Islamic\n\n` +
    `👉 *Add karo (1 tap):*\n${link}\n\n` +
    `🎁 *Mera invite code:* \`${st.code}\`\n` +
    `${status}\n\n` +
    `_Ye message dost/group me forward karo. Har naye user pe aap ko invite milega — 10 pe FREE PREMIUM!_`
  );
}

const handler = async (ctx) => {
  const { command, reply, arg, session, senderNum } = ctx;

  switch (command) {
    case 'share':
    case 'referral':
    case 'refer':
    case 'myrefer': {
      await reply(shareCard(ctx));
      break;
    }

    case 'redeem':
    case 'refjoin':
    case 'use': {
      const code = String(arg || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!code) return reply(`❌ Code do. Example: *${P}redeem ABC123*`);
      if (ref.codeToNum(code) === senderNum) return reply('😄 Apna hi code use nahi kar sakte — dost ko bhejo!');
      const r = ref.credit(code, senderNum);
      if (!r) return reply('❌ Ye code sahi nahi hai. Check karke dobara try karo.');
      if (r.already) return reply('ℹ️ Aap pehle hi ek code se join kar chuke ho. Ab maze karo! 🎉');
      await reply(
        `✅ *Join ho gaya!* Welcome to *${config.BOT_NAME}* 🎉\n\n` +
        `📜 *${P}menu* likho — saare commands dekho.\n` +
        `🎁 Apna code bhi lo: *${P}share* (10 invites = FREE PREMIUM)`,
      );
      // Notify the inviter (best-effort).
      try {
        const invJid = `${r.inviter}@s.whatsapp.net`;
        await ctx.send(invJid, {
          text:
            `🎉 *Naya invite!* Kisi ne aap ka code use kiya.\n` +
            `👥 Ab aap ke *${r.invites}/${r.goal}* invites hain.` +
            (r.justPremium ? `\n\n👑 *MUBARAK! Aap ab PREMIUM ho!*` : ''),
        });
      } catch { /* ignore */ }
      break;
    }

    case 'toprefer':
    case 'topinvite': {
      const lb = ref.leaderboard(10);
      if (!lb.length) return reply(`🏆 Abhi tak koi invite nahi. Pehla bano!\n\nApna code: *${P}share*`);
      const medals = ['🥇', '🥈', '🥉'];
      const lines = lb
        .map((u, i) => `${medals[i] || `${i + 1}.`} +${u.num} — *${u.invites}* invites${u.premium ? ' 👑' : ''}`)
        .join('\n');
      await reply(`🏆 *Top Inviters — ${config.BOT_NAME}*\n\n${lines}\n\n_Apna code: *${P}share* — 10 invites = FREE PREMIUM_`);
      break;
    }

    default:
      break;
  }
};

/** First-contact welcome + auto-credit of a pasted code. */
const GREET = /^(hi+|hey+|hello+|salam+|assalam|asalam|aoa|start|menu|help|hlo|hy)\b/i;
const onMessage = async (ctx) => {
  if (!ctx || ctx.isGroup) return;
  const num = ctx.senderNum;
  if (!num) return;
  const first = ref.markSeen(num);
  if (!first) return; // returning user — nothing to do

  // A brand-new user pasted a referral code somewhere in their first message?
  const m = String(ctx.text || '').toUpperCase().match(/\b([A-Z0-9]{6})\b/);
  if (m && ref.codeToNum(m[1]) && ref.codeToNum(m[1]) !== num) {
    const r = ref.credit(m[1], num);
    if (r && !r.already) {
      try {
        await ctx.send(`${r.inviter}@s.whatsapp.net`, {
          text: `🎉 *Naya invite!* Kisi ne aap ka code use kiya.\n👥 Ab aap ke *${r.invites}/${r.goal}* invites hain.` + (r.justPremium ? `\n\n👑 *MUBARAK! Aap ab PREMIUM ho!*` : ''),
        });
      } catch { /* ignore */ }
      return; // join confirmation comes from the .redeem path or here
    }
  }

  // Friendly welcome for a brand-new user who just greets the bot.
  if (!ctx.command && GREET.test(String(ctx.text || '').trim())) {
    try {
      await ctx.reply(
        `👋 *Welcome to ${config.BOT_NAME}!*\n\n` +
        `🎬 Movies · 🎵 Songs · 📥 TikTok · 🤖 AI — sab kuch ek jagah!\n\n` +
        `📜 *${P}menu* likho saare commands ke liye.\n` +
        `🎁 Apna invite code + FREE PREMIUM: *${P}share*`,
      );
    } catch { /* ignore */ }
  }
};

module.exports = {
  commands: ['share', 'referral', 'refer', 'myrefer', 'redeem', 'refjoin', 'use', 'toprefer', 'topinvite'],
  category: '🎁 GROWTH',
  handler,
  onMessage,
};
