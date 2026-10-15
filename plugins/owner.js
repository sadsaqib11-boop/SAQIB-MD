/**
 * OWNER — owner-only commands
 *
 * .vv2  -> unlocks view-once media and sends it to the bot's OWN chat
 *          ("Message yourself"), then auto-deletes it after a few seconds.
 * .vv / .vv3 -> unlocks and sends it to the current chat (normal).
 * .ban / .unban / .banlist -> block + ignore a user's number.
 */
const config = require('../config');
const { downloadMedia, cleanNumber } = require('../lib/helpers');
const bans = require('../lib/bans');

const SELF_DELETE_MS = 10000; // .vv2 self-message auto-delete delay

/** Unwrap view-once wrappers into the inner media message. */
function unwrapViewOnce(qm) {
  if (!qm) return null;
  return (
    qm.viewOnceMessage?.message ||
    qm.viewOnceMessageV2?.message ||
    qm.viewOnceMessageV2Extension?.message ||
    qm
  );
}

const handler = async (ctx) => {
  const { sock, command, reply, quoted } = ctx;

  switch (command) {
    case 'vv': case 'vv2': case 'vv3': {
      if (!quoted) return reply('❌ View-once media ko *reply* kar ke .vv likho.');
      const qm = unwrapViewOnce(quoted.message);
      const type = qm.imageMessage ? 'image' : qm.videoMessage ? 'video' : qm.audioMessage ? 'audio' : null;
      if (!type) return reply('❌ Ye view-once media nahi lag raha.');
      const msg = qm.imageMessage || qm.videoMessage || qm.audioMessage;
      const buf = await downloadMedia(msg, type);
      const cap = `🔓 *View-once unlocked*\n👑 ${config.BOT_NAME}`;
      const toSelf = command === 'vv2';
      const selfNum = String(sock.user?.id || '').split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
      const selfJid = selfNum + '@s.whatsapp.net';
      const target = toSelf ? selfJid : ctx.from;
      const opts = toSelf ? {} : { quoted: ctx.m };

      let sent;
      if (type === 'image') sent = await ctx.send(target, { image: buf, caption: cap }, opts);
      else if (type === 'video') sent = await ctx.send(target, { video: buf, caption: cap }, opts);
      else sent = await ctx.send(target, { audio: buf, mimetype: 'audio/mpeg' }, opts);

      if (toSelf) {
        await reply(`✅ View-once tumhari *own chat (yourself)* me bhej diya.\n🕐 ${Math.round(SELF_DELETE_MS / 1000)} sec me auto-delete ho jayega.`);
        setTimeout(() => { try { sock.sendMessage(target, { delete: sent.key }); } catch { /* ignore */ } }, SELF_DELETE_MS);
      }
      break;
    }
    case 'forward': {
      if (!quoted) return reply('❌ Kisi message ko reply karo.');
      if (!ctx.arg) return reply(`❌ Number do. Example: ${config.PREFIX}forward 923xxxxxxxxxx`);
      const jid = cleanNumber(ctx.arg) + '@s.whatsapp.net';
      await sock.copyNForward(jid, quoted.message, true);
      await reply(`✅ Forward ho gaya -> +${jid.split('@')[0]}`);
      break;
    }
    case 'block': case 'unblock': {
      const num = cleanNumber(quoted ? (quoted.key.participant || quoted.key.remoteJid) : ctx.arg);
      if (!num) return reply('❌ Number do ya reply karo.');
      await sock.updateBlockStatus(num + '@s.whatsapp.net', command === 'block' ? 'block' : 'unblock');
      await reply(`${command === 'block' ? '🚫' : '✅'} +${num} ${command}ed.`);
      break;
    }
    case 'ban': {
      const num = cleanNumber(quoted ? (quoted.key.participant || quoted.key.remoteJid) : ctx.arg);
      if (!num) return reply('❌ Number do ya kisi ko reply karo.');
      bans.add(num);
      await sock.updateBlockStatus(num + '@s.whatsapp.net', 'block').catch(() => {});
      await reply(`🚫 +${num} *BAN* kar diya gaya (blocked + ignored).`);
      break;
    }
    case 'unban': {
      const num = cleanNumber(quoted ? (quoted.key.participant || quoted.key.remoteJid) : ctx.arg);
      if (!num) return reply('❌ Number do ya kisi ko reply karo.');
      bans.remove(num);
      await sock.updateBlockStatus(num + '@s.whatsapp.net', 'unblock').catch(() => {});
      await reply(`✅ +${num} *UNBAN* ho gaya.`);
      break;
    }
    case 'banlist': {
      const l = bans.all();
      await reply(`🚫 *Banlist (${l.length}):*\n\n${l.map((n) => `• +${n}`).join('\n') || '(khali)'}`);
      break;
    }
    case 'delete': {
      if (!quoted) return reply('❌ Kisi message ko reply karo.');
      await sock.sendMessage(ctx.from, { delete: quoted.key });
      break;
    }
    case 'leave': {
      await reply('👋 Bot ja raha hy... Allah Hafiz!');
      setTimeout(() => {
        try { Promise.resolve(sock.groupLeave(ctx.from)).catch(() => {}); } catch { /* ignore */ }
      }, 1500);
      break;
    }
    case 'fullpp': case 'setpp': {
      const img = quoted?.message?.imageMessage || ctx.m.message.imageMessage;
      if (!img) return reply('❌ Kisi photo par reply karo ya caption me .setpp likh ke photo bhejo.');
      const buf = await downloadMedia(img, 'image');
      await sock.updateProfilePicture(sock.user.id, buf);
      await reply('✅ Profile picture update ho gayi.');
      break;
    }
    case 'status': case 'status2': {
      const img = quoted?.message?.imageMessage || ctx.m.message.imageMessage;
      const vid = quoted?.message?.videoMessage || ctx.m.message.videoMessage;
      if (img || vid) {
        const buf = await downloadMedia(img || vid, img ? 'image' : 'video');
        await sock.sendMessage('status@broadcast', img ? { image: buf, caption: ctx.arg || '' } : { video: buf, caption: ctx.arg || '' });
        await reply('✅ Status laga diya.');
      } else if (ctx.arg) {
        await sock.sendMessage('status@broadcast', { text: ctx.arg });
        await reply('✅ Text status laga diya.');
      } else reply('❌ Text likho ya media par reply karo.');
      break;
    }
    case 'getbio': {
      const num = cleanNumber(quoted ? (quoted.key.participant || quoted.key.remoteJid) : (ctx.arg || sock.user.id.split(':')[0]));
      try {
        const s = await sock.fetchStatus(num + '@s.whatsapp.net');
        await reply(`📝 *Bio (+${num}):*\n${s[0]?.status || s?.status || '-'}`);
      } catch { await reply('❌ Bio nahi mili.'); }
      break;
    }
    case 'updatebio':
      if (!ctx.arg) return reply('❌ Nayi bio likho.');
      await sock.updateProfileStatus(ctx.arg);
      await reply('✅ Bio update ho gayi.');
      break;
    case 'setname':
      if (!ctx.arg) return reply('❌ Naya naam do.');
      await sock.updateProfileName(ctx.arg);
      await reply('✅ Naam update ho gaya.');
      break;
    case 'pair': {
      const num = cleanNumber(ctx.arg);
      if (!num) return reply(`❌ Number do. Example: ${config.PREFIX}pair 923xxxxxxxxxx`);
      try {
        // Use the session manager so this links a NEW number (not the current sock).
        const bot = require('../lib/bot');
        await reply('⏳ Code ban raha hy, 2-3 second...');
        const code = await bot.requestPair(num);
        // Send the code ALONE so it can be copied with one tap — no label, no
        // extra text wrapped around it, and never inside a code block (some
        // clients make backtick-wrapped text hard to long-press).
        await ctx.send(ctx.from, { text: code }, { quoted: ctx.m });
        await ctx.send(ctx.from, {
          text: '📲 Ye code WhatsApp me daalo:\n*Linked Devices → Link with phone number*\n\n_Code 45 second me expire ho jata hy._',
        });
      } catch (e) { await reply('❌ ' + (e?.message || e)); }
      break;
    }
    case 'broadcast': {
      if (!ctx.arg) return reply(`❌ Message do. Example: ${config.PREFIX}broadcast Salam sab ko!`);
      const groups = await sock.groupFetchAllParticipating();
      const jids = Object.keys(groups);
      await reply(`📢 Broadcast ${jids.length} groups ko bhej raha hoon...`);
      let n = 0;
      for (const jid of jids) {
        try {
          await sock.sendMessage(jid, { text: `📢 *${config.BOT_NAME} Broadcast*\n\n${ctx.arg}` });
          n++;
        } catch { /* skip unreachable */ }
        // small delay so we don't get rate-limited / flagged as spam
        await new Promise((r) => setTimeout(r, 1200));
      }
      await reply(`✅ Broadcast ${n}/${jids.length} groups me bhej diya.`);
      break;
    }
    case 'blocklist': {
      const bl = await sock.fetchBlocklist();
      await reply(`🚫 *Blocklist (${bl.length}):*\n\n${bl.map((j) => `• +${j.split('@')[0]}`).join('\n') || '(khali)'}`);
      break;
    }
    case 'restart': {
      await reply('🔄 Bot restart ho raha hy...');
      setTimeout(() => process.exit(0), 1500);
      break;
    }
    default: await reply('❓ Unknown owner command');
  }
};

module.exports = {
  commands: ['vv', 'vv2', 'vv3', 'forward', 'block', 'unblock', 'ban', 'unban', 'banlist', 'delete', 'leave', 'fullpp', 'setpp', 'status', 'status2', 'getbio', 'updatebio', 'setname', 'pair', 'broadcast', 'blocklist', 'restart'],
  category: '👑 OWNER',
  ownerOnly: true,
  handler,
  unwrapViewOnce,
};
