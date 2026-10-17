/**
 * SETTINGS — bot configuration (live, persisted)
 */
const config = require('../config');
const settings = require('../lib/settings');
const prefixes = require('../lib/prefixes');

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
      if (!['public', 'private'].includes(arg)) return reply(`ℹ️ Current: *${config.MODE}*\n❓ ${config.PREFIX}mode public  or  ${config.PREFIX}mode private`);
      config.MODE = arg; settings.save();
      await reply(`✅ The bot is now in *${arg.toUpperCase()}* mode.${arg === 'private' ? '\n(Only the owner can run commands)' : '\n(Everyone can use commands)'}`);
      break;
    }
    case 'prefix': case 'setprefix': {
      // PER-USER: this only ever changes the CALLER's own prefix. Another
      // user's prefix is untouched.
      if (!arg) {
        const own = prefixes.has(ctx.senderNum);
        return reply(
          `ℹ️ *Your prefix:* "${ctx.prefix}"\n` +
          (own ? `_(your own — applies only to you)_\n` : `_(default — applies to everyone)_\n`) +
          `❓ ${ctx.prefix}setprefix !   → change your prefix\n` +
          `❓ ${ctx.prefix}setprefix reset → back to default`
        );
      }
      if (arg.toLowerCase() === 'reset') {
        prefixes.set(ctx.senderNum, null);
        await reply(`✅ Your prefix is back to the default: "${config.PREFIX}"`);
        break;
      }
      if (arg.length > 2) return reply(`❌ The prefix must be 1-2 characters. Example: ${ctx.prefix}setprefix !`);
      prefixes.set(ctx.senderNum, arg);
      await reply(`✅ *Your* prefix is now "${arg}".\n_Other users keep their own prefix — this does not affect them._`);
      break;
    }
    case 'botname':
      if (!arg) return reply(`ℹ️ Current: ${config.BOT_NAME}`);
      config.BOT_NAME = arg; settings.save();
      await reply(`✅ Bot name: *${arg}*`);
      break;
    case 'ownername':
      if (!arg) return reply('❌ Give the new name.');
      config.OWNER_NAME = arg; settings.save();
      await reply(`✅ Owner name: *${arg}*`);
      break;
    case 'ownernumber': {
      const num = (arg || '').replace(/[^0-9]/g, '');
      if (!num) return reply('❌ Give a number (92xxxxxxxxxx).');
      config.OWNER_NUMBER = num; settings.save();
      await reply(`✅ Owner number: +${num}`);
      break;
    }
    case 'description':
      if (!arg) return reply(`ℹ️ Current: ${config.DESCRIPTION}`);
      config.DESCRIPTION = arg; settings.save();
      await reply(`✅ Description set: *${arg}*`);
      break;
    case 'stickername':
      if (!arg) return reply(`ℹ️ Current: ${config.STICKER_NAME}`);
      config.STICKER_NAME = arg; settings.save();
      await reply(`✅ Sticker pack name: *${arg}*`);
      break;
    case 'setwelcome':
      if (!arg) return reply(`❌ Give some text. Variables: @user @group\nExample: ${config.PREFIX}setwelcome Welcome @user`);
      config.WELCOME_MSG = arg; settings.save();
      await reply('✅ Welcome message set.');
      break;
    case 'setgoodbye':
      if (!arg) return reply(`❌ Give some text. Variables: @user @group\nExample: ${config.PREFIX}setgoodbye Bye @user`);
      config.GOODBYE_MSG = arg; settings.save();
      await reply('✅ Goodbye message set.');
      break;
    case 'statusemoji':
      if (!arg) return reply(`ℹ️ Current: ${config.STATUS_EMOJI}`);
      config.STATUS_EMOJI = arg; settings.save();
      await reply(`✅ Status emoji: ${arg}`);
      break;
    case 'reactemojis':
      await reply(`✅ Auto-react emojis: ${config.REACT_EMOJIS.join(' ')}`);
      break;
    case 'owneremojis':
      await reply('👑 Owner emojis: 👑 🔥 💯 ⚡');
      break;
    case 'delpath':
      await reply('🗑️ Auto-delete downloads: *ON* (temp files are deleted after every download).');
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
      // Show the bot's profile picture. profilePictureUrl() throws for the
      // bot's OWN id on some accounts (and the id may be a LID), so we try the
      // session number too and finally fall back to the bundled asset — the
      // command now ALWAYS returns a picture instead of an error.
      const fs = require('fs');
      const path = require('path');
      const candidates = [];
      try { if (ctx.sock.user?.id) candidates.push(ctx.sock.user.id); } catch { /* ignore */ }
      try { if (ctx.session?.number) candidates.push(`${ctx.session.number}@s.whatsapp.net`); } catch { /* ignore */ }
      let pp = null;
      const { cachedProfilePic } = require('../lib/cache');
      for (const c of candidates) {
        try { pp = await cachedProfilePic(ctx.sock, c, 'image'); if (pp) break; } catch { /* try next */ }
      }
      const cap = `🤖 *${config.BOT_NAME}* DP`;
      if (pp) {
        await ctx.send(ctx.from, { image: { url: pp }, caption: cap }, { quoted: ctx.m });
      } else {
        const pic = path.resolve(config.BOT_PIC);
        if (fs.existsSync(pic)) await ctx.send(ctx.from, { image: fs.readFileSync(pic), caption: cap }, { quoted: ctx.m });
        else await reply('❌ No bot picture found (neither on WhatsApp nor as a local asset).');
      }
      break;
    }
    case 'privacy': case 'getprivacy':
      await reply(`🔒 *Privacy*\n▪️ Bot privacy: ${config.PRIVACY}\n▪️ Group privacy: ${config.GROUP_PRIVACY}\n\n_Change: ${config.PREFIX}groupsprivacy <all|contacts|none>_`);
      break;
    case 'groupsprivacy': {
      if (!arg) return reply(`ℹ️ Current: ${config.GROUP_PRIVACY}\n❓ ${config.PREFIX}groupsprivacy all|contacts|none`);
      config.GROUP_PRIVACY = arg; settings.save();
      await reply(`✅ Group privacy: *${arg}*`);
      break;
    }
    case 'sudo': {
      const num = (arg || '').replace(/[^0-9]/g, '');
      if (!num) return reply('❌ Give a number.');
      if (!config.SUDO.includes(num)) config.SUDO.push(num);
      settings.save();
      await reply(`✅ +${num} is now a *SUDO* (trusted user).`);
      break;
    }
    case 'delsudo': {
      const num = (arg || '').replace(/[^0-9]/g, '');
      config.SUDO = config.SUDO.filter((n) => n !== num);
      settings.save();
      await reply(`✅ Removed sudo from +${num}.`);
      break;
    }
    case 'listsudo':
      await reply(`👑 *Sudo users:*\n${config.SUDO.length ? config.SUDO.map((n) => `+${n}`).join('\n') : '(none)'}`);
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
      await reply(`✅ Default font is now *${key}*.\nPreview: ${fonts.applyDefault('SAQIB-MD')}`);
      break;
    }
    case 'reset': {
      if (!ctx.isOwner) return reply('🔒 This command is for the *owner* only.');
      const what = String(arg || '').trim();
      if (!what) {
        return reply(`♻️ *Reset*\n\n▪️ ${config.PREFIX}reset all — reset every setting to default\n▪️ ${config.PREFIX}reset <key> — reset one setting\n\n_Keys:_ ${settings.KEYS.join(', ')}`);
      }
      if (what.toLowerCase() === 'all') {
        settings.reset();
        await reply('♻️ All settings have been reset to default.');
        return;
      }
      const key = what.toUpperCase();
      if (!settings.KEYS.includes(key)) return reply(`❌ Unknown setting "${what}".\n_Keys:_ ${settings.KEYS.join(', ')}`);
      settings.reset(key);
      await reply(`♻️ *${key}* has been reset to default.`);
      break;
    }
    case 'settings':
      await reply(
        `⚙️ *${config.BOT_NAME} Settings*\n\n` +
        `▪️ Mode: ${config.MODE}\n▪️ Prefix: "${config.PREFIX}"\n` +
        `▪️ Auto-read: ${config.AUTO_READ ? 'ON' : 'OFF'}\n▪️ Auto-typing: ${config.AUTO_TYPING ? 'ON' : 'OFF'}\n` +
        `▪️ Welcome: ${config.WELCOME ? 'ON' : 'OFF'}\n▪️ Goodbye: ${config.GOODBYE ? 'ON' : 'OFF'}\n` +
        `▪️ Anti-link: ${config.ANTILINK ? 'ON' : 'OFF'}\n▪️ Anti-mention: ${config.ANTIMENTION ? 'ON' : 'OFF'}\n` +
        `▪️ Auto-status: ${config.AUTOSTATUS ? 'ON' : 'OFF'}\n▪️ Auto-view-once: ${config.AUTOVIEWONCE ? 'ON' : 'OFF'}\n` +
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
