/**
 * SETTINGS — bot configuration (live, persisted)
 */
const config = require('../config');
const settings = require('../lib/settings');

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;

  switch (command) {
    case 'mode': {
      if (!['public', 'private'].includes(arg)) return reply(`ℹ️ Abhi: *${config.MODE}*\n❓ ${config.PREFIX}mode public  ya  ${config.PREFIX}mode private`);
      config.MODE = arg; settings.save();
      await reply(`✅ Bot ab *${arg.toUpperCase()}* mode me hy.${arg === 'private' ? '\n(Owner ke ilawa koi command nahi chala sakta)' : '\n(Sab log commands use kar sakte hain)'}`);
      break;
    }
    case 'prefix': case 'setprefix': {
      if (!arg || arg.length > 2) return reply(`ℹ️ Abhi: "${config.PREFIX}"\n❓ Example: ${config.PREFIX}setprefix !`);
      config.PREFIX = arg; settings.save();
      await reply(`✅ Prefix ab "${arg}" hy.`);
      break;
    }
    case 'botname':
      if (!arg) return reply(`ℹ️ Abhi: ${config.BOT_NAME}`);
      config.BOT_NAME = arg; settings.save();
      await reply(`✅ Bot ka naam: *${arg}*`);
      break;
    case 'ownername':
      if (!arg) return reply('❌ Naya naam do.');
      config.OWNER_NAME = arg; settings.save();
      await reply(`✅ Owner ka naam: *${arg}*`);
      break;
    case 'ownernumber': {
      const num = (arg || '').replace(/[^0-9]/g, '');
      if (!num) return reply('❌ Number do (92xxxxxxxxxx).');
      config.OWNER_NUMBER = num; settings.save();
      await reply(`✅ Owner number: +${num}`);
      break;
    }
    case 'description':
      if (!arg) return reply(`ℹ️ Abhi: ${config.DESCRIPTION}`);
      config.DESCRIPTION = arg; settings.save();
      await reply(`✅ Description set: *${arg}*`);
      break;
    case 'stickername':
      if (!arg) return reply(`ℹ️ Abhi: ${config.STICKER_NAME}`);
      config.STICKER_NAME = arg; settings.save();
      await reply(`✅ Sticker pack name: *${arg}*`);
      break;
    case 'setwelcome':
      if (!arg) return reply(`❌ Text do. Variables: @user @group\nExample: ${config.PREFIX}setwelcome Welcome @user`);
      config.WELCOME_MSG = arg; settings.save();
      await reply(`✅ Welcome message set.`);
      break;
    case 'setgoodbye':
      if (!arg) return reply(`❌ Text do. Variables: @user @group\nExample: ${config.PREFIX}setgoodbye Bye @user`);
      config.GOODBYE_MSG = arg; settings.save();
      await reply(`✅ Goodbye message set.`);
      break;
    case 'statusemoji':
      if (!arg) return reply(`ℹ️ Abhi: ${config.STATUS_EMOJI}`);
      config.STATUS_EMOJI = arg; settings.save();
      await reply(`✅ Status emoji: ${arg}`);
      break;
    case 'reactemojis':
      await reply(`✅ Auto-react emojis: ${config.REACT_EMOJIS.join(' ')}`);
      break;
    case 'owneremojis':
      await reply(`👑 Owner emojis: 👑 🔥 💯 ⚡`);
      break;
    case 'delpath':
      await reply(`🗑️ Auto-delete downloads: *ON* (temp files har download ke baad delete hoti hain).`);
      break;
    case 'autoread':
      config.AUTO_READ = !config.AUTO_READ; settings.save();
      await reply(`✅ Auto-read: *${config.AUTO_READ ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'autotyping':
      config.AUTO_TYPING = !config.AUTO_TYPING; settings.save();
      await reply(`✅ Auto-typing: *${config.AUTO_TYPING ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'recording':
      config.RECORDING = !config.RECORDING; settings.save();
      await reply(`✅ Recording presence: *${config.RECORDING ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'statusview':
      config.STATUSVIEW = !config.STATUSVIEW; settings.save();
      await reply(`✅ Status view: *${config.STATUSVIEW ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'statuslike':
      config.AUTO_REACT = !config.AUTO_REACT; settings.save();
      await reply(`✅ Status like (auto-react): *${config.AUTO_REACT ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'administration':
      config.ADMINISTRATION = !config.ADMINISTRATION; settings.save();
      await reply(`✅ Administration: *${config.ADMINISTRATION ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'mentionreply':
      config.MENTION_REPLY = !config.MENTION_REPLY; settings.save();
      await reply(`✅ Mention reply: *${config.MENTION_REPLY ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'welcome':
      config.WELCOME = !config.WELCOME; settings.save();
      await reply(`✅ Welcome system: *${config.WELCOME ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'goodbye':
      config.GOODBYE = !config.GOODBYE; settings.save();
      await reply(`✅ Goodbye system: *${config.GOODBYE ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'antilink':
      config.ANTILINK = !config.ANTILINK; settings.save();
      await reply(`✅ Anti-link: *${config.ANTILINK ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'antistatus':
      config.AUTOSTATUS = !config.AUTOSTATUS; settings.save();
      await reply(`✅ Auto-status: *${config.AUTOSTATUS ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'setonline':
      config.ONLINE = !config.ONLINE; settings.save();
      await reply(`✅ Online presence: *${config.ONLINE ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    case 'botdp': {
      try {
        const pp = await ctx.sock.profilePictureUrl(ctx.sock.user.id, 'image');
        await ctx.send(ctx.from, { image: { url: pp }, caption: `🤖 *${config.BOT_NAME}* DP` }, { quoted: ctx.m });
      } catch { await reply('❌ Bot ki DP nahi mili.'); }
      break;
    }
    case 'privacy': case 'getprivacy':
      await reply(`🔒 *Privacy*\n▪️ Bot privacy: ${config.PRIVACY}\n▪️ Group privacy: ${config.GROUP_PRIVACY}\n\n_Change: ${config.PREFIX}groupsprivacy <all|contacts|none>_`);
      break;
    case 'groupsprivacy': {
      if (!arg) return reply(`ℹ️ Abhi: ${config.GROUP_PRIVACY}\n❓ ${config.PREFIX}groupsprivacy all|contacts|none`);
      config.GROUP_PRIVACY = arg; settings.save();
      await reply(`✅ Group privacy: *${arg}*`);
      break;
    }
    case 'sudo': {
      const num = (arg || '').replace(/[^0-9]/g, '');
      if (!num) return reply('❌ Number do.');
      if (!config.SUDO.includes(num)) config.SUDO.push(num);
      settings.save();
      await reply(`✅ +${num} ab *SUDO* (trusted user) hy.`);
      break;
    }
    case 'delsudo': {
      const num = (arg || '').replace(/[^0-9]/g, '');
      config.SUDO = config.SUDO.filter((n) => n !== num);
      settings.save();
      await reply(`✅ +${num} ka sudo hat gaya.`);
      break;
    }
    case 'listsudo':
      await reply(`👑 *Sudo users:*\n${config.SUDO.length ? config.SUDO.map((n) => `+${n}`).join('\n') : '(koi nahi)'}`);
      break;
    case 'settings':
      await reply(
        `⚙️ *${config.BOT_NAME} Settings*\n\n` +
        `▪️ Mode: ${config.MODE}\n▪️ Prefix: "${config.PREFIX}"\n` +
        `▪️ Auto-read: ${config.AUTO_READ ? 'ON' : 'OFF'}\n▪️ Auto-typing: ${config.AUTO_TYPING ? 'ON' : 'OFF'}\n` +
        `▪️ Welcome: ${config.WELCOME ? 'ON' : 'OFF'}\n▪️ Goodbye: ${config.GOODBYE ? 'ON' : 'OFF'}\n` +
        `▪️ Anti-link: ${config.ANTILINK ? 'ON' : 'OFF'}\n▪️ Auto-status: ${config.AUTOSTATUS ? 'ON' : 'OFF'}\n` +
        `▪️ Anti-delete: ${config.ANTIDELETE ? 'ON' : 'OFF'}\n▪️ Auto-react: ${config.AUTO_REACT ? 'ON' : 'OFF'}\n` +
        `▪️ Online: ${config.ONLINE ? 'ON' : 'OFF'}`
      );
      break;
    default: await reply('❓ Unknown setting');
  }
};

module.exports = {
  commands: [
    'mode', 'prefix', 'setprefix', 'botname', 'ownername', 'ownernumber', 'description', 'stickername',
    'setwelcome', 'setgoodbye', 'statusemoji', 'reactemojis', 'owneremojis', 'delpath',
    'autoread', 'autotyping', 'recording', 'statusview', 'statuslike', 'administration',
    'mentionreply', 'welcome', 'goodbye', 'antilink', 'antistatus', 'setonline',
    'botdp', 'privacy', 'getprivacy', 'groupsprivacy', 'sudo', 'delsudo', 'listsudo', 'settings',
  ],
  category: '⚙️ SETTINGS',
  handler,
};
