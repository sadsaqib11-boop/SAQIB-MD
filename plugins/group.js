/**
 * GROUP — group management (admin commands)
 */
const config = require('../config');
const { isGroupAdmin } = require('../lib/handler');

const warns = new Map(); // jid -> Map(user -> count)

const handler = async (ctx) => {
  const { sock, command, reply, from, arg, quoted } = ctx;

  const needAdmin = ['kick', 'promote', 'demote', 'mute', 'unmute', 'tagall', 'everyone', 'add', 'revoke', 'updategcname', 'updategcdesc', 'link', 'del', 'hidetag', 'poll', 'warn', 'resetwarn'];
  if (needAdmin.includes(command)) {
    if (!(await isGroupAdmin(sock, from, ctx.sender))) return reply('❌ Ye command sirf *group admins* ke liye hai.');
  }

  const target = quoted ? (quoted.key.participant || quoted.key.remoteJid) : (arg ? arg.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);

  switch (command) {
    case 'tagall': case 'everyone': {
      const meta = await sock.groupMetadata(from);
      const txt = arg ? `📢 *${arg}*\n\n` : '📢 *Attention Everyone*\n\n';
      const mentions = meta.participants.map((p) => p.id);
      await ctx.send(from, { text: txt + mentions.map((m, i) => `${i + 1}. @${m.split('@')[0]}`).join('\n'), mentions }, { quoted: ctx.m });
      break;
    }
    case 'tag': case 'hidetag': {
      const meta = await sock.groupMetadata(from);
      const mentions = meta.participants.map((p) => p.id);
      await ctx.send(from, { text: arg || '📢', mentions }, { quoted: ctx.m });
      break;
    }
    case 'kick': {
      if (!target) return reply('❌ Kisi member ko reply karo ya number do.');
      await sock.groupParticipantsUpdate(from, [target], 'remove');
      await reply(`👢 @${target.split('@')[0]} ko nikal diya gaya.`, { mentions: [target] });
      break;
    }
    case 'promote': {
      if (!target) return reply('❌ Kisi member ko reply karo ya number do.');
      await sock.groupParticipantsUpdate(from, [target], 'promote');
      await reply(`👑 @${target.split('@')[0]} ab *ADMIN* hy!`, { mentions: [target] });
      break;
    }
    case 'demote': {
      if (!target) return reply('❌ Kisi member ko reply karo ya number do.');
      await sock.groupParticipantsUpdate(from, [target], 'demote');
      await reply(`⬇️ @${target.split('@')[0]} ab normal member hy.`, { mentions: [target] });
      break;
    }
    case 'mute': case 'unmute': {
      await sock.groupSettingUpdate(from, command === 'mute' ? 'announcement' : 'not_announcement');
      await reply(command === 'mute' ? '🔇 Group *sirf admins* ke messages ke liye.' : '🔊 Sab members message kar sakte hain.');
      break;
    }
    case 'link': {
      const code = await sock.groupInviteCode(from);
      await reply(`🔗 *Group Link:*\nhttps://chat.whatsapp.com/${code}`);
      break;
    }
    case 'revoke': {
      await sock.groupRevokeInvite(from);
      await reply('♻️ Purana link khatam, naya link ban gaya.');
      break;
    }
    case 'ginfo': {
      const meta = await sock.groupMetadata(from);
      await reply(`👥 *${meta.subject}*\n\n🔹 Members: ${meta.participants.length}\n🔹 Created: ${new Date(meta.creation * 1000).toLocaleDateString()}\n🔹 Owner: @${(meta.owner || '').split('@')[0]}\n🔹 Description: ${meta.desc || '-'}`, { mentions: meta.owner ? [meta.owner] : [] });
      break;
    }
    case 'updategcname':
      if (!arg) return reply('❌ Naya naam do.');
      await sock.groupUpdateSubject(from, arg);
      await reply('✅ Group name update ho gaya.');
      break;
    case 'updategcdesc':
      if (!arg) return reply('❌ Nayi description do.');
      await sock.groupUpdateDescription(from, arg);
      await reply('✅ Description update ho gayi.');
      break;
    case 'poll': {
      if (!arg.includes(',')) return reply(`❌ Format: ${config.PREFIX}poll sawal?, option1, option2`);
      const [q, ...opts] = arg.split(',').map((s) => s.trim());
      await ctx.send(from, { poll: { name: q, values: opts, selectableCount: 1 } }, { quoted: ctx.m });
      break;
    }
    case 'del':
      if (!quoted) return reply('❌ Kisi message ko reply karo.');
      await sock.sendMessage(from, { delete: quoted.key });
      break;
    case 'add': {
      const num = arg.replace(/[^0-9]/g, '');
      if (!num) return reply('❌ Number do.');
      await sock.groupParticipantsUpdate(from, [num + '@s.whatsapp.net'], 'add');
      await reply(`✅ +${num} ko group me add kar diya.`);
      break;
    }
    case 'warn': {
      if (!target) return reply('❌ Kisi member ko reply karo ya number do.');
      const g = warns.get(from) || new Map();
      const c = (g.get(target) || 0) + 1;
      g.set(target, c);
      warns.set(from, g);
      await reply(`⚠️ @${target.split('@')[0]} ko warning *${c}/3*.\n${c >= 3 ? '🚫 3 warnings — admin kick kar sakta hy!' : ''}`, { mentions: [target] });
      break;
    }
    case 'resetwarn': {
      if (!target) return reply('❌ Kisi member ko reply karo ya number do.');
      const g = warns.get(from) || new Map();
      g.set(target, 0);
      warns.set(from, g);
      await reply(`✅ @${target.split('@')[0]} ki warnings reset ho gayi.`, { mentions: [target] });
      break;
    }
    case 'warnings': {
      const g = warns.get(from) || new Map();
      const t = target || ctx.sender;
      await reply(`⚠️ @${t.split('@')[0]} ki warnings: *${g.get(t) || 0}/3*`, { mentions: [t] });
      break;
    }
    case 'listadmins': {
      const meta = await sock.groupMetadata(from);
      const admins = meta.participants.filter((p) => p.admin);
      await reply(`👑 *Admins (${admins.length}):*\n\n${admins.map((a) => `• @${a.id.split('@')[0]}`).join('\n')}`, { mentions: admins.map((a) => a.id) });
      break;
    }
    default: await reply('❓ Unknown group command');
  }
};

module.exports = {
  commands: ['tagall', 'everyone', 'tag', 'hidetag', 'kick', 'promote', 'demote', 'mute', 'unmute', 'link', 'revoke', 'ginfo', 'updategcname', 'updategcdesc', 'poll', 'del', 'add', 'warn', 'resetwarn', 'warnings', 'listadmins'],
  category: '👥 GROUP',
  groupOnly: true,
  handler,
};
