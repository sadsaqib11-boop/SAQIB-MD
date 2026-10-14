/**
 * SETTINGS — bot configuration (live, persisted)
 */
const config = require('../config');
const settings = require('../lib/settings');

const ON_WORDS = ['on', 'true', '1', 'enable', 'enabled', 'yes', 'haan', 'han'];
const OFF_WORDS = ['off', 'false', '0', 'disable', 'disabled', 'no', 'nahi', 'na'];
/** Parse an explicit on/off arg; returns true/false or null (=> flip). */
const parseOnOff = (a) => {
  const v = String(a || '').trim().toLowerCase();
  if (ON_WORDS.includes(v)) return true;
  if (OFF_WORDS.includes(v)) return false;
  return null;
};
/** Set a boolean config key from an optional arg (flip when arg is absent). */
const setFlag = (key, arg) => {
  const v = parseOnOff(arg);
  config[key] = v === null ? !config[key] : v;
  settings.save();
  return config[key];
};

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
    case 'autoread': {
      const v = setFlag('AUTO_READ', arg);
      await reply(`✅ Auto-read: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'autotyping': {
      const v = setFlag('AUTO_TYPING', arg);
      await reply(`✅ Auto-typing: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'recording': {
      const v = setFlag('RECORDING', arg);
      await reply(`✅ Recording presence: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'statusview': {
      const v = setFlag('STATUSVIEW', arg);
      await reply(`✅ Status view: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'statuslike': {
      const v = setFlag('AUTO_REACT', arg);
      await reply(`✅ Status like (auto-react): *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'administration': {
      const v = setFlag('ADMINISTRATION', arg);
      await reply(`✅ Administration: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'mentionreply': {
      const v = setFlag('MENTION_REPLY', arg);
      await reply(`✅ Mention reply: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'welcome': {
      const v = setFlag('WELCOME', arg);
      await reply(`✅ Welcome system: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'goodbye': {
      const v = setFlag('GOODBYE', arg);
      await reply(`✅ Goodbye system: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'antilink': {
      const v = setFlag('ANTILINK', arg);
      await reply(`✅ Anti-link: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'antistatus': {
      const v = setFlag('AUTOSTATUS', arg);
      await reply(`✅ Auto-status: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
    case 'setonline': {
      const v = setFlag('ONLINE', arg);
      await reply(`✅ Online presence: *${v ? 'ON 🟢' : 'OFF 🔴'}*`);
      break;
    }
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
    case 'setfont': {
      const fonts = require('./fonts');
      const key = String(arg || '').toLowerCase().trim();
      if (!key) {
        return reply(`ℹ️ Default font: *${config.DEFAULT_FONT}*\n❓ ${config.PREFIX}setfont <name>\nAvailable: ${Object.keys(fonts.NAMED).join(', ')}`);
      }
      if (fonts.NAMED[key] === undefined && !/^font\d+$/.test(key)) {
        return reply(`❌ Unknown font "${key}".\nAvailable: ${Object.keys(fonts.NAMED).join(', ')}`);
      }
      config.DEFAULT_FONT = key; settings.save();
      await reply(`✅ Default font ab *${key}* hy.\nPreview: ${fonts.applyDefault('SAQIB-MD')}`);
      break;
    }
    case 'reset': {
      if (!ctx.isOwner) return reply('\ud83d\udd12 Ye command sirf *owner* ke liye hai.');
      const what = String(arg || '').trim();
      if (!what) {
        return reply(`\u267b\ufe0f *Reset*\n\n\u25aa\ufe0f ${config.PREFIX}reset all \u2014 sab settings default par\n\u25aa\ufe0f ${config.PREFIX}reset <key> \u2014 ek setting reset\n\n_Keys:_ ${settings.KEYS.join(', ')}`);
      }
      if (what.toLowerCase() === 'all') {
        settings.reset();
        await reply('\u267b\ufe0f Sab settings default par reset ho gayi.');
        return;
      }
      const key = what.toUpperCase();
      if (!settings.KEYS.includes(key)) return reply(`\u274c Unknown setting "${what}".\n_Keys:_ ${settings.KEYS.join(', ')}`);
      settings.reset(key);
      await reply(`\u267b\ufe0f *${key}* default par reset ho gayi.`);
      break;
    }
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
    'botdp', 'privacy', 'getprivacy', 'groupsprivacy', 'sudo', 'delsudo', 'listsudo', 'setfont', 'reset', 'settings',
  ],
  category: '⚙️ SETTINGS',
  handler,
};
