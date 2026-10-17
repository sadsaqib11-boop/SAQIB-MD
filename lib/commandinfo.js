/**
 * SAQIB-MD — command metadata (powers `.details` and `.findcmd`)
 * -------------------------------------------------------------
 * `.details <command>`  -> a full card: category, plugin, what it does, usage.
 * `.findcmd <keyword>`  -> search every command by name / description / category
 *                          ("does the bot have a command that unlocks view-once?"
 *                           -> `.findcmd view once` returns `.vv`).
 *
 * Descriptions are curated for the popular commands; everything else falls back
 * to a helpful, category-aware sentence so EVERY one of the ~1000 commands has
 * a real answer instead of "unknown".
 */
const registry = require('../plugins/_registry');

/* ----------------------------- curated details ----------------------------- */
// command -> { what, usage }
const DESCRIPTIONS = {
  // ---- main ----
  menu: { what: 'Shows the full command menu, grouped by category.', usage: '.menu   |   .menu <category>   |   .menuall' },
  help: { what: 'Alias of .menu — shows the command menu.', usage: '.help' },
  menuall: { what: 'Lists EVERY category with EVERY command.', usage: '.menuall' },
  menustyle: { what: 'Choose one of 10 menu designs — every user can pick their OWN. The owner can set the bot-wide default.', usage: '.menustyle   |   .menustyle 1-10   |   .menustyle reset' },
  ping: { what: 'Checks the bot is alive and shows the reply speed in ms.', usage: '.ping' },
  alive: { what: 'Shows the bot uptime and owner — a quick "I am online".', usage: '.alive' },
  uptime: { what: 'Shows how long the bot has been running.', usage: '.uptime' },
  runtime: { what: 'Shows runtime stats (Node version, RAM usage, uptime).', usage: '.runtime' },
  owner: { what: 'Sends the owner\'s contact card.', usage: '.owner' },
  id: { what: 'Shows the WhatsApp ID / number of you or the replied-to user.', usage: '.id   |   reply + .id' },
  getpp: { what: 'Fetches the profile picture of a user.', usage: '.getpp <number>   |   reply + .getpp' },
  repo: { what: 'Shows the bot\'s GitHub repository link.', usage: '.repo' },
  details: { what: 'Shows full details (what it does + how to use) for any command.', usage: '.details <command>' },
  findcmd: { what: 'Searches all commands by keyword — e.g. find a view-once unlocker.', usage: '.findcmd <keyword>' },
  clear: { what: 'Clears messages in this chat. First asks whether to also clear starred messages.', usage: '.clear   |   .clear yes   |   .clear no' },
  define: { what: 'Gives the dictionary meaning of a word.', usage: '.define <word>' },
  yts: { what: 'Builds a YouTube search link for your query.', usage: '.yts <query>' },
  praytime: { what: 'Shows prayer times for a city.', usage: '.praytime <city>' },

  // ---- view-once ----
  vv: { what: 'Unlocks a view-once photo/video and reveals it in THIS chat. Reply to the view-once media.', usage: '.vv (reply to view-once)' },
  vv2: { what: 'Unlocks a view-once photo/video and saves it to your OWN chat (yourself).', usage: '.vv2 (reply to view-once)' },
  vv3: { what: 'Same as .vv2 — unlocks view-once media to your own chat.', usage: '.vv3 (reply to view-once)' },
  autoviewonce: { what: 'Auto-saves every view-once media you receive to your own chat.', usage: '.autoviewonce on|off' },
  antiviewonce: { what: 'Alias of .autoviewonce — auto-save view-once media.', usage: '.antiviewonce on|off' },

  // ---- settings / toggles ----
  mode: { what: 'Switches the bot between public (everyone) and private (owner only).', usage: '.mode public|private' },
  prefix: { what: 'Shows or changes YOUR OWN command prefix.', usage: '.prefix   |   .setprefix !' },
  setprefix: { what: 'Sets your own command prefix (1-2 characters).', usage: '.setprefix !   |   .setprefix reset' },
  botname: { what: 'Shows or changes the bot\'s display name.', usage: '.botname <name>' },
  ownername: { what: 'Changes the owner name shown in the menu.', usage: '.ownername <name>' },
  ownernumber: { what: 'Changes the owner WhatsApp number.', usage: '.ownernumber 92xxxxxxxxxx' },
  autoread: { what: 'Auto-marks incoming messages as read (blue ticks). OFF by default.', usage: '.autoread on|off' },
  autotyping: { what: 'Shows the "typing…" indicator while replying.', usage: '.autotyping on|off' },
  recording: { what: 'Shows the "recording audio…" presence while replying.', usage: '.recording on|off' },
  online: { what: 'Keeps the bot permanently ONLINE (always-online). ON by default.', usage: '.online on|off' },
  setonline: { what: 'Alias of .online — always-online presence.', usage: '.setonline on|off' },
  antidelete: { what: 'Catches deleted messages and resends them (to your inbox or the chat).', usage: '.antidelete on|off   |   .antidelete inbox|chat' },
  antideleteinbox: { what: 'Sends caught deleted messages to your OWN chat (yourself).', usage: '.antideleteinbox' },
  antiedit: { what: 'Catches EDITED messages and shows the old + new text.', usage: '.antiedit on|off' },
  antilink: { what: 'Deletes link messages in groups (non-admins).', usage: '.antilink on|off' },
  antispam: { what: 'Rate-limits users who spam messages.', usage: '.antispam on|off' },
  anticall: { what: 'Rejects incoming calls (optionally with a custom message).', usage: '.anticall on|off   |   .anticall message <text>' },
  autoreact: { what: 'Auto-reacts to incoming messages with emojis.', usage: '.autoreact on|off   |   .autoreact group|chat' },
  setreact: { what: 'Sets YOUR OWN auto-react emojis.', usage: '.setreact 🔥 ❤️ 🎉' },
  autostatus: { what: 'Automatically views incoming statuses.', usage: '.autostatus on|off' },
  autoreadstatus: { what: 'Auto-marks statuses as viewed.', usage: '.autoreadstatus on|off' },
  autosavestatus: { what: 'When you reply to a status, auto-saves it to your own chat. ON by default.', usage: '.autosavestatus on|off' },
  autobio: { what: 'Auto-updates the bot\'s WhatsApp bio on connect.', usage: '.autobio on|off' },
  chatbot: { what: 'AI auto-replies to private messages when the bot is not commanded.', usage: '.chatbot on|off' },
  antimention: { what: 'When ON, the bot IGNORES any message that mentions it — nobody can summon it by tagging.', usage: '.antimention on|off' },
  mentionreply: { what: 'Replies automatically when the bot is mentioned.', usage: '.mentionreply on|off' },
  welcome: { what: 'Greets new group members.', usage: '.welcome on|off' },
  goodbye: { what: 'Says goodbye when a member leaves a group.', usage: '.goodbye on|off' },
  setwelcome: { what: 'Sets the welcome message (supports @user and @group).', usage: '.setwelcome Welcome @user' },
  setgoodbye: { what: 'Sets the goodbye message (supports @user and @group).', usage: '.setgoodbye Bye @user' },
  settings: { what: 'Shows the current on/off state of the main features.', usage: '.settings' },
  reset: { what: 'Resets one setting (or all) back to its default.', usage: '.reset all   |   .reset AUTO_READ' },
  sudo: { what: 'Adds a trusted user who can run owner-level commands.', usage: '.sudo 92xxxxxxxxxx' },
  delsudo: { what: 'Removes a sudo (trusted) user.', usage: '.delsudo 92xxxxxxxxxx' },
  listsudo: { what: 'Lists all sudo users.', usage: '.listsudo' },
  setfont: { what: 'Sets the default fancy font used for the bot name.', usage: '.setfont <name>' },
  botdp: { what: 'Shows the bot\'s profile picture.', usage: '.botdp' },
  botlanguage: { what: 'Sets the reply language (100+ languages).', usage: '.botlanguage <code>   |   .botlanguage list' },
  lang: { what: 'Alias of .botlanguage.', usage: '.lang ur' },
  premium: { what: 'Shows the premium feature status board.', usage: '.premium' },

  // ---- owner ----
  pair: { what: 'Generates a pairing code to link a NEW WhatsApp number.', usage: '.pair 92xxxxxxxxxx' },
  broadcast: { what: 'Sends a message to every group the bot is in.', usage: '.broadcast <message>' },
  ban: { what: 'Bans + blocks a user; the bot ignores them completely.', usage: '.ban <number>   |   reply + .ban' },
  unban: { what: 'Lifts a ban, or shows a platform\'s own appeal route.', usage: '.unban <number>   |   .unban instagram appeal' },
  banlist: { what: 'Lists every banned number.', usage: '.banlist' },
  block: { what: 'Blocks a user on WhatsApp.', usage: '.block <number>   |   reply + .block' },
  unblock: { what: 'Unblocks a user on WhatsApp.', usage: '.unblock <number>' },
  blocklist: { what: 'Lists everyone blocked by the bot.', usage: '.blocklist' },
  restart: { what: 'Restarts the bot process.', usage: '.restart' },
  forward: { what: 'Forwards the replied-to message to a number.', usage: '.forward 92xxxxxxxxxx (reply)' },
  delete: { what: 'Deletes the replied-to message.', usage: '.delete (reply)' },
  leave: { what: 'Makes the bot leave the current group.', usage: '.leave' },
  setpp: { what: 'Sets the bot\'s profile picture from a replied photo.', usage: '.setpp (reply to a photo)' },
  fullpp: { what: 'Alias of .setpp — set the bot profile picture.', usage: '.fullpp (reply to a photo)' },
  status: { what: 'Posts a text or media status.', usage: '.status <text>   |   reply + .status' },
  getbio: { what: 'Fetches a user\'s WhatsApp bio/about.', usage: '.getbio <number>' },
  updatebio: { what: 'Updates the bot\'s own bio.', usage: '.updatebio <text>' },
  setname: { what: 'Updates the bot\'s own profile name.', usage: '.setname <name>' },

  // ---- media / tools ----
  sticker: { what: 'Turns an image/video into a WhatsApp sticker.', usage: '.sticker (reply to media)' },
  toimg: { what: 'Converts a sticker back into an image.', usage: '.toimg (reply to sticker)' },
  tourl: { what: 'Uploads an image and returns a public URL.', usage: '.tourl (reply to image)' },
  ss: { what: 'Takes a screenshot of a website.', usage: '.ss <url>' },
  carbon: { what: 'Turns code into a beautiful image.', usage: '.carbon <code>' },
  emojimix: { what: 'Mixes two emojis into a combined sticker/image.', usage: '.emojimix 😂 🥰' },
  say: { what: 'Converts text to a voice note.', usage: '.say <text>' },
  vcf: { what: 'Sends a contact card for a number.', usage: '.vcf 92xxxxxxxxxx' },
  readmore: { what: 'Hides text behind a "Read more" break.', usage: '.readmore <text>' },
  translate: { what: 'Translates text to another language.', usage: '.translate <lang> <text>' },
  weather: { what: 'Shows the weather for a city.', usage: '.weather <city>' },
  qr: { what: 'Generates a QR code.', usage: '.qr <text/url>' },
  shorturl: { what: 'Shortens a long URL.', usage: '.shorturl <url>' },
  calc: { what: 'Evaluates a math expression.', usage: '.calc 2+2*10' },
};

/* --------------------------- category fallbacks --------------------------- */
const CATEGORY_HELP = {
  '🤖 AI': { what: 'Asks the AI engine a question and returns the answer.', usage: '.ai <question>' },
  '🧠 AI SMART': { what: 'A smarter AI helper (analysis, writing, coding).', usage: '.ai <question>' },
  '🌸 ANIME': { what: 'Sends a random anime image.', usage: '.anime' },
  '🌎 COUNTRIES': { what: 'Looks up country information (capital, population, flag…).', usage: '.country <name>' },
  '📥 DOWNLOAD': { what: 'Downloads media from a supported site (YouTube, TikTok, Instagram…).', usage: '.dl <url/query>' },
  '🖼️ EDIT': { what: 'Applies a visual effect to an image.', usage: '.edit <effect> (reply to image)' },
  '📄 FILES': { what: 'Works with documents/data (PDF, JSON, CSV, zip…).', usage: '.files <args>' },
  '🔠 FONTS': { what: 'Converts text into a fancy Unicode font.', usage: '.font <text>' },
  '😂 FUN': { what: 'A fun/random command.', usage: '.fun' },
  '🎮 GAMES': { what: 'A game command.', usage: '.game' },
  '👥 GROUP': { what: 'A group-management command.', usage: '.group <args>' },
  '📸 IMAGE TOOLS': { what: 'An image-processing tool.', usage: '.imagetool (reply to image)' },
  '📊 INFO': { what: 'Shows information/lookup data.', usage: '.info <args>' },
  '🕌 ISLAMIC': { what: 'An Islamic reference (Quran, Hadith, names…).', usage: '.islamic <args>' },
  '🎨 LOGO': { what: 'Generates a text logo image.', usage: '.logo <text>' },
  '🔎 MAIN': { what: 'A core bot command.', usage: '.main' },
  '🛠️ MEDIA & FX': { what: 'A media or audio-effect command.', usage: '.media (reply to media)' },
  '🐉 MYTH & LEGENDS': { what: 'Generates a themed myth/legend image.', usage: '.myth' },
  '👑 OWNER': { what: 'An owner-only command.', usage: '.owner-cmd' },
  '🇵🇰 PAKISTAN': { what: 'A Pakistan-related command.', usage: '.pk <args>' },
  '💎 PREMIUM': { what: 'A premium feature or toggle.', usage: '.premium' },
  '🎭 REACTIONS': { what: 'Sends a reaction image/sticker.', usage: '.react' },
  '🩺 SYSTEM': { what: 'A system/diagnostics command.', usage: '.system' },
  '🎵 SOUNDS': { what: 'Sends a sound/audio clip.', usage: '.sound' },
  '✍️ TEXT': { what: 'A text-generation command.', usage: '.text <args>' },
  '🧰 TOOLS': { what: 'A utility tool.', usage: '.tool <args>' },
  '🔧 UTILITY': { what: 'A handy utility command.', usage: '.util <args>' },
};

const norm = (s) => String(s || '').toLowerCase().replace(/^[.\/!#]/, '').trim();

/** Full details for one command (or null when the bot has no such command). */
function lookup(cmd) {
  const c = norm(cmd);
  if (!c) return null;
  const plug = registry.find(c);
  if (!plug) return null;
  const category = plug.category || 'OTHER';
  const meta = DESCRIPTIONS[c] || CATEGORY_HELP[category] || { what: `A command in the *${category}* category.`, usage: `.${c}` };
  return {
    command: c,
    category,
    file: plug.file || '',
    what: meta.what,
    usage: meta.usage || `.${c}`,
    ownerOnly: !!plug.ownerOnly,
    groupOnly: !!plug.groupOnly,
    adminOnly: !!plug.adminOnly,
    aliases: Array.isArray(plug.commands) ? plug.commands : [c],
  };
}

/**
 * Search every command by keyword. Matches the name, the curated description
 * and the category. Returns the best hits first (name matches rank highest).
 */
function search(keyword, limit = 15) {
  const raw = String(keyword || '').toLowerCase().trim();
  if (!raw) return [];
  const q = raw.replace(/\s+/g, '');
  const tokens = raw.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const p of registry.all()) {
    const category = p.category || 'OTHER';
    for (const c of p.commands) {
      const what = (DESCRIPTIONS[c]?.what || CATEGORY_HELP[category]?.what || '').toLowerCase();
      const hay = `${c} ${what} ${category.toLowerCase()}`;
      let score = 0;
      if (c === q) score = 100;
      else if (c.includes(q)) score = 60;
      else if (what.includes(raw)) score = 40;
      else if (tokens.length && tokens.every((t) => hay.includes(t))) score = 25;
      else if (hay.includes(q)) score = 15;
      if (score > 0) {
        hits.push({
          command: c,
          category,
          what: DESCRIPTIONS[c]?.what || CATEGORY_HELP[category]?.what || '',
          score,
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.command.length - b.command.length);
  return hits.slice(0, limit);
}

/** Render the `.details` card for a command. */
function renderDetails(info, prefix = '.') {
  if (!info) return null;
  const flags = [
    info.ownerOnly ? '👑 owner-only' : null,
    info.groupOnly ? '👥 group-only' : null,
    info.adminOnly ? '🛡️ admin-only' : null,
  ].filter(Boolean).join('  ·  ');
  let t = `📖 *COMMAND DETAILS*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  t += `▸ *Command:*  ${prefix}${info.command}\n`;
  t += `▸ *Category:*  ${info.category}\n`;
  if (info.file) t += `▸ *Module:*  ${info.file}\n`;
  if (flags) t += `▸ *Access:*  ${flags}\n`;
  t += `━━━━━━━━━━━━━━━━━━━━━\n`;
  t += `📝 *What it does:*\n${info.what}\n\n`;
  t += `💡 *Usage:*\n${info.usage}\n`;
  t += `━━━━━━━━━━━━━━━━━━━━━\n`;
  t += `✨ _${prefix}details <command> for any command_`;
  return t;
}

module.exports = { lookup, search, renderDetails, DESCRIPTIONS, CATEGORY_HELP };
