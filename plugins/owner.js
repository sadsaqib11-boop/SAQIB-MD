/**
 * OWNER — owner-only commands
 */
const config = require('../config');
const { downloadMedia, cleanNumber } = require('../lib/helpers');

const handler = async (ctx) => {
  const { sock, command, reply, quoted } = ctx;

  switch (command) {
    case 'vv': case 'vv2': case 'vv3': {
      if (!quoted) return reply('❌ View-once media ko *reply* kar ke .vv likho.');
      const qm = quoted.message;
      const type = qm.imageMessage ? 'image' : qm.videoMessage ? 'video' : qm.audioMessage ? 'audio' : null;
      if (!type) return reply('❌ Ye view-once media nahi lag raha.');
      const msg = qm.imageMessage || qm.videoMessage || qm.audioMessage;
      const buf = await downloadMedia(msg, type);
      const cap = `🔓 *View-once unlocked*\n👑 ${config.BOT_NAME}`;
      if (type === 'image') await ctx.send(ctx.from, { image: buf, caption: cap }, { quoted: ctx.m });
      else if (type === 'video') await ctx.send(ctx.from, { video: buf, caption: cap }, { quoted: ctx.m });
      else await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg' }, { quoted: ctx.m });
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
      const num = cleanNumber(quoted ? quoted.key.participant : ctx.arg);
      if (!num) return reply('❌ Number do ya reply karo.');
      await sock.updateBlockStatus(num + '@s.whatsapp.net', command === 'block' ? 'block' : 'unblock');
      await reply(`${command === 'block' ? '🚫' : '✅'} +${num} ${command}ed.`);
      break;
    }
    case 'delete': {
      if (!quoted) return reply('❌ Kisi message ko reply karo.');
      await sock.sendMessage(ctx.from, { delete: quoted.key });
      break;
    }
    case 'leave': {
      await reply('👋 Bot ja raha hy... Allah Hafiz!');
      setTimeout(() => sock.groupLeave(ctx.from).catch(() => {}), 1500);
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
      const num = cleanNumber(quoted ? quoted.key.participant : (ctx.arg || sock.user.id.split(':')[0]));
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
        const code = await sock.requestPairingCode(num);
        await reply(`🔗 *Pairing Code for +${num}:*\n\n\`\`\`${code}\`\`\``);
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }
    case 'broadcast': {
      if (!ctx.arg) return reply(`❌ Message do. Example: ${config.PREFIX}broadcast Salam sab ko!`);
      const groups = await sock.groupFetchAllParticipating();
      let n = 0;
      for (const jid of Object.keys(groups)) {
        await sock.sendMessage(jid, { text: `📢 *${config.BOT_NAME} Broadcast*\n\n${ctx.arg}` }).catch(() => {});
        n++;
      }
      await reply(`✅ Broadcast ${n} groups me bhej diya.`);
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
  commands: ['vv', 'vv2', 'vv3', 'forward', 'block', 'unblock', 'delete', 'leave', 'fullpp', 'setpp', 'status', 'status2', 'getbio', 'updatebio', 'setname', 'pair', 'broadcast', 'blocklist', 'restart'],
  category: '👑 OWNER',
  ownerOnly: true,
  handler,
};
