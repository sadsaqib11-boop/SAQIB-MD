/**
 * SETTINGS — bot behaviour (owner only, live config update)
 */
const config = require('../config');
const fs = require('fs');
const path = require('path');

function saveEnv(key, val) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    let lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n').filter(Boolean) : [];
    lines = lines.filter((l) => !l.startsWith(key + '='));
    lines.push(`${key}=${val}`);
    fs.writeFileSync(envPath, lines.join('\n'));
  } catch { /* ignore */ }
}

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;

  switch (command) {
    case 'mode': {
      if (!['public', 'private'].includes(arg)) return reply(`ℹ️ Abhi: *${config.MODE}*\n❓ ${config.PREFIX}mode public  ya  ${config.PREFIX}mode private`);
      config.MODE = arg; saveEnv('MODE', arg);
      await reply(`✅ Bot ab *${arg.toUpperCase()}* mode me hy.${arg === 'private' ? '\n(Owner ke ilawa koi command nahi chala sakta)' : ''}`);
      break;
    }
    case 'prefix': {
      if (!arg || arg.length > 2) return reply(`ℹ️ Abhi: "${config.PREFIX}"\n❓ Example: ${config.PREFIX}prefix !`);
      config.PREFIX = arg; saveEnv('PREFIX', arg);
      await reply(`✅ Prefix ab "${arg}" hy.`);
      break;
    }
    case 'botname':
      if (!arg) return reply(`ℹ️ Abhi: ${config.BOT_NAME}`);
      config.BOT_NAME = arg; saveEnv('BOT_NAME', arg);
      await reply(`✅ Bot ka naam: *${arg}*`);
      break;
    case 'ownername':
      if (!arg) return reply('❌ Naya naam do.');
      config.OWNER_NAME = arg; saveEnv('OWNER_NAME', arg);
      await reply(`✅ Owner ka naam: *${arg}*`);
      break;
    case 'ownernumber': {
      const num = arg.replace(/[^0-9]/g, '');
      if (!num) return reply('❌ Number do (92xxxxxxxxxx).');
      config.OWNER_NUMBER = num; saveEnv('OWNER_NUMBER', num);
      await reply(`✅ Owner number: +${num}`);
      break;
    }
    case 'autoread':
      config.AUTO_READ = !config.AUTO_READ; saveEnv('AUTO_READ', config.AUTO_READ);
      await reply(`✅ Auto-read: *${config.AUTO_READ ? 'ON' : 'OFF'}*`);
      break;
    case 'autotyping':
      config.AUTO_TYPING = !config.AUTO_TYPING; saveEnv('AUTO_TYPING', config.AUTO_TYPING);
      await reply(`✅ Auto-typing: *${config.AUTO_TYPING ? 'ON' : 'OFF'}*`);
      break;
    case 'welcome':
      config.WELCOME = !config.WELCOME; saveEnv('WELCOME', config.WELCOME);
      await reply(`✅ Welcome system: *${config.WELCOME ? 'ON' : 'OFF'}*`);
      break;
    case 'goodbye':
      config.GOODBYE = !config.GOODBYE; saveEnv('GOODBYE', config.GOODBYE);
      await reply(`✅ Goodbye system: *${config.GOODBYE ? 'ON' : 'OFF'}*`);
      break;
    case 'antilink':
      config.ANTILINK = !config.ANTILINK; saveEnv('ANTILINK', config.ANTILINK);
      await reply(`✅ Anti-link: *${config.ANTILINK ? 'ON' : 'OFF'}*`);
      break;
    case 'sudo': {
      const num = arg.replace(/[^0-9]/g, '');
      if (!num) return reply('❌ Number do.');
      if (!config.SUDO.includes(num)) config.SUDO.push(num);
      await reply(`✅ +${num} ab *SUDO* (trusted user) hy.`);
      break;
    }
    case 'delsudo': {
      const num = arg.replace(/[^0-9]/g, '');
      config.SUDO = config.SUDO.filter((n) => n !== num);
      await reply(`✅ +${num} ka sudo hat gaya.`);
      break;
    }
    case 'listsudo':
      await reply(`👑 *Sudo users:*\n${config.SUDO.length ? config.SUDO.map((n) => `+${n}`).join('\n') : '(koi nahi)'}`);
      break;
    case 'settings':
      await reply(`⚙️ *${config.BOT_NAME} Settings*\n\n▪️ Mode: ${config.MODE}\n▪️ Prefix: "${config.PREFIX}"\n▪️ Auto-read: ${config.AUTO_READ ? 'ON' : 'OFF'}\n▪️ Auto-typing: ${config.AUTO_TYPING ? 'ON' : 'OFF'}\n▪️ Welcome: ${config.WELCOME ? 'ON' : 'OFF'}\n▪️ Goodbye: ${config.GOODBYE ? 'ON' : 'OFF'}\n▪️ Anti-link: ${config.ANTILINK ? 'ON' : 'OFF'}`);
      break;
    default: await reply('❓ Unknown setting');
  }
};

module.exports = {
  commands: ['mode', 'prefix', 'botname', 'ownername', 'ownernumber', 'autoread', 'autotyping', 'welcome', 'goodbye', 'antilink', 'sudo', 'delsudo', 'listsudo', 'settings'],
  category: '⚙️ SETTINGS',
  ownerOnly: true,
  handler,
};
