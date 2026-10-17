/**
 * Render all 10 menu styles with realistic sample data and dump them to
 * `preview/menus.json` so we can build a WhatsApp-style preview page.
 */
const fs = require('fs');
const path = require('path');
const menu = require('../lib/menu');

const cats = [
  ['🔎 MAIN', ['menu', 'help', 'menuall', 'menustyle', 'ping', 'alive', 'uptime', 'owner', 'id', 'details', 'findcmd', 'clear']],
  ['⬇️ DOWNLOAD', ['play', 'song', 'video', 'ytmp3', 'ytmp4', 'tiktok', 'instagram', 'facebook', 'twitter', 'spotify']],
  ['🤖 AI', ['ai', 'gpt', 'gemini', 'imagine', 'chatbot', 'translate', 'summarize', 'code']],
  ['👥 GROUP', ['tagall', 'hidetag', 'kick', 'add', 'promote', 'demote', 'antilink', 'welcome', 'goodbye', 'mute']],
  ['🎵 MEDIA & FX', ['sticker', 'toimage', 'tomp3', 'bass', 'deep', 'nightcore', 'reverb', 'vv', 'vv2']],
  ['💎 PREMIUM', ['antidelete', 'autoreact', 'antimention', 'autoviewonce', 'premium', 'setreact', 'myreact']],
];

const data = {
  name: 'SAQIB-MD',
  version: '3.0.0',
  ownerName: 'Saqib',
  when: '10/17/2025, 3:42 PM',
  prefix: '.',
  mode: 'categories',
  cats,
  total: cats.reduce((n, [, c]) => n + c.length, 0),
  cat: '',
  cmds: [],
};

const out = menu.STYLES.map((s) => ({
  id: s.id,
  name: s.name,
  desc: s.desc,
  text: menu.render(s.id, data),
}));

const dir = path.resolve(__dirname, '..', 'preview');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'menus.json'), JSON.stringify(out, null, 2));
console.log('Wrote', out.length, 'styles to preview/menus.json');
out.forEach((o) => console.log(o.id, o.name));
