# 🤖 SAQIB-MD — Premium WhatsApp Bot

> A premium, fully-featured WhatsApp bot built with [Baileys](https://github.com/WhiskeySockets/Baileys).
> **956 commands**, 150+ AI models, media downloaders, group management, audio effects,
> **multi-session pairing (up to 500 numbers)** and a built-in web pairing portal.

![status](https://img.shields.io/badge/status-online-22c55e) ![commands](https://img.shields.io/badge/commands-956-7c5cff) ![node](https://img.shields.io/badge/node-%3E%3D20-339933) ![sessions](https://img.shields.io/badge/sessions-500-22d3ee)

---

## 🚀 Deploy (make it LIVE 24/7)

> ### ✅ This bot is already LIVE
> **Pairing portal:** https://saqib-md-production.up.railway.app
> Hosted on Railway (`saqib-md` project) · volume mounted at `/data` for persistent sessions.

The bot needs a host that keeps a **long-running Node process** + **persistent disk** (for WhatsApp sessions). Pick one:

### Option A — Render (easiest, free tier available)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sadsaqib11-boop/SAQIB-MD)

1. Click the button → connect GitHub → **Apply** (uses `render.yaml`, 1 GB disk auto-mounted at `/app/session`).
2. Open the service URL → enter your WhatsApp number → get the 8-digit code → link it.
3. ⚠️ Free plan **sleeps after ~15 min idle**; upgrade to *Starter* for true 24/7.

### Option B — Railway
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/sadsaqib11-boop/SAQIB-MD)

1. Click → **Deploy Now** → Railway builds via `Dockerfile` (installs ffmpeg + yt-dlp).
2. **Add a Volume** mounted at `/app/session` (so logins survive redeploys).
3. Set env vars: `MODE=public`, `MAX_SESSIONS=500` (all auto/anti toggles stay `false`).
4. Open the URL → pair your number.

### Option C — Any VPS / Docker
```bash
docker build -t saqib-md .
docker run -d --name saqib-md -p 3000:3000 \
  -v $PWD/session:/app/session \
  -e MODE=public -e MAX_SESSIONS=500 \
  saqib-md
```

> ❌ **Vercel is NOT suitable** — it is serverless (no persistent process / WebSocket / disk), so a WhatsApp bot cannot run there. Use Render, Railway, Koyeb, Fly.io or a VPS.

### After deploying — pair (this part only you can do)
Open the deployed URL, enter your number with country code (e.g. `923001234567`), copy the 8-digit code, then in WhatsApp: **Settings → Linked Devices → Link a device → Link with phone number** → enter the code. Up to **500 numbers** can pair this way.

---

## ✨ Features

- 🔗 **Pairing-code login** (no QR scan) via a beautiful web portal
- 📱 **Multi-session** — up to **500 different WhatsApp numbers** can be linked at once; each number is its own owner
- 🤖 **150+ AI models** (GPT, Gemini, Claude, Grok, DeepSeek, Llama…) routed through a single engine
- 🎨 **AI image generation** (`.imagine`) & 27 logo styles — no API key required
- 📥 **Downloaders**: TikTok, Instagram, Facebook, Twitter/X, Pinterest, YouTube, CapCut, MediaFire, Google Drive, Git repos, npm, Quran audio
- 🎵 **Media tools**: stickers, to-image, to-mp3, to-ptt + **22 audio effects**
- 🐉 **Myth & legends**: 50 themed image commands (dragon, phoenix, ninja…)
- 📸 **Image tools**: upscale, enhance, unblur, remove background, remini HD, colorize
- 👥 **Full group management**: tagall, kick, promote, mute, antilink, warnings, polls, join requests
- 🛡️ **Anti features**: anti-delete (groups **and** inbox), anti-link, anti-spam, anti-call, auto-view-once
- ⚙️ **Live settings** to change mode/prefix/toggles without restarting (persisted to disk)
- 🚀 **Ultra speed**: cached metadata, O(1) command lookup, fire-and-forget presence

---

## 🚀 Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env
#   then edit .env (set OWNER_NUMBER, GEMINI_API_KEY, etc.)

# 3. Run
npm start
```

Then open **http://localhost:3000**, enter your WhatsApp number (with country code),
and type the 8-digit code in WhatsApp → *Linked Devices → Link with phone number*.

> ℹ️ **Every auto/anti feature is OFF by default.** Turn them ON live with a toggle
> command (e.g. `.antidelete`, `.autoreact`) — the choice is saved and survives restarts.

---

## ☁️ Deploy

### Railway (recommended — keeps the bot online 24/7)

1. Create a new project and connect this repo, **or** use the CLI:
   ```bash
   npm i -g @railway/cli
   railway login
   railway init
   railway up
   ```
2. Add the environment variables from `.env.example` in **Variables**.
3. Railway auto-detects Node and runs `node index.js`.
   The `railway.json` also installs **ffmpeg** + **yt-dlp** (needed for stickers/audio/downloads).

### Docker

```bash
docker build -t saqib-md .
docker run -d -p 3000:3000 --env-file .env --name saqib-md saqib-md
```

### Vercel (portal only)

The web pairing portal can also be hosted on Vercel as a static site, but the
**bot itself must run on a long-lived host** (Railway / VPS / Docker) because it
needs a persistent WebSocket connection.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BOT_NAME` | `SAQIB-MD` | Bot display name |
| `PREFIX` | `.` | Command prefix |
| `OWNER_NAME` | `Saqib` | Owner display name |
| `OWNER_NUMBER` | *(auto)* | Owner WhatsApp number (digits only). Blank → first linked number becomes owner |
| `GEMINI_API_KEY` | — | Google Gemini API key (for AI commands) |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Gemini model id |
| `MODE` | `public` | `public` (everyone) or `private` (owner only) |
| `MAX_SESSIONS` | `500` | Max numbers that can be linked at once |
| `AUTO_READ` | `false` | Auto mark messages as read |
| `AUTO_TYPING` | `false` | Show "typing…" presence |
| `AUTO_REACT` | `false` | React to messages automatically |
| `WELCOME` / `GOODBYE` | `false` | Group join/leave messages |
| `ANTILINK` | `false` | Delete links in groups |
| `ANTIDELETE` | `false` | Restore deleted messages (groups + inbox) |
| `ANTISPAM` | `false` | Rate-limit users |
| `ANTICALL` | `false` | Reject incoming calls |
| `AUTOSTATUS` | `false` | Auto view/react to statuses |
| `AUTOVIEWONCE` | `false` | Save view-once media |
| `CHATBOT` | `false` | AI auto-reply in private chats |
| `ONLINE` | `true` | Show "online" presence |
| `TIMEZONE` | `Asia/Karachi` | Timezone for time commands |
| `PORT` | `3000` | Web server port |
| `SESSION_DIR` | `./session` | Auth state folder |
| `SUDO` | — | Comma-separated extra owners |

> Get a free Gemini key at <https://aistudio.google.com/app/apikey>.

---

## 📜 Commands (943)

### 🤖 AI (152)
Every model name routes to the same AI engine. `.ai` `.bot` `.gpt` `.gpt4` `.gpt4o` `.gpt5` `.chatgpt` `.o1` `.o3` `.o4` `.copilot` `.deepseek` `.deepseekr1` `.gemini` `.geminipro` `.gemini25` `.bard` `.grok` `.grok3` `.grok4` `.claude` `.claude35` `.claude4` `.qwen` `.llama` `.mistral` `.mixtral` `.kimi` `.perplexity` `.mathgpt` `.brain` `.elite` `.assistant` `.nova` `.apex` `.imagine` `.image` `.img` … (152 total)

### 🌸 ANIME (13)
`.waifu` `.neko` `.shinobu` `.megumin` `.awoo` `.maid` `.anime` `.animegirl` `.garl` `.husbando` `.kitsune` `.dog` `.cat`

### 🎎 CHARACTERS (101)
`.dad` `.mom` `.son` `.boyfriend` `.girlfriend` `.bhai` `.bahan` `.wife` `.husband` `.chacha` `.nana` `.mama` `.bestfriend` `.crush` `.teacher` `.student` `.chad` `.npc` `.simp` `.vibe` `.horoscope` + `.boydp1-22` `.girldp1-22`

### 📥 DOWNLOAD (41)
`.tiktok` `.tt` `.ttmp3` `.tiktok2` `.tiktok3` `.instagram` `.ig` `.igdl` `.igdl2` `.igdl3` `.reels` `.facebook` `.fb` `.twitter` `.x` `.pinterest` `.pin` `.play` `.song` `.music` `.ytaudio` `.ytmp3` `.ytmp4` `.ytvideo` `.apk` `.gdrive` `.capcut` `.mediafire` `.megadl` `.igmp3` `.ytpost` `.download` `.tsticker` `.tiktoksearch` `.surah` `.gitclone` `.video` `.drama` `.cartoon` `.movie` `.dlnpm`

> `.movie <name>` → **720p download link in ~1s** + the full file fetched in the background and sent as a document; `.movie link <name>` = link only (fastest); `.movie file <name>` = document only.

### 🔠 FONTS (105)
`.font1` … `.font105` — 105 stylised text transforms

### 😂 FUN (30)
`.roast` `.compliment` `.quote` `.shayari` `.joke` `.bacha` `.fact` `.emoji` `.meme` `.8ball` `.lovetest` `.ship` `.shipname` `.compatibility` `.aura` `.rate` `.character` `.truth` `.dare` `.wyr` `.rizz` `.sigma` `.dice` `.coin` `.coinflip` `.flip` `.slot` `.font` `.repeat` `.heart`

### 👥 GROUP (36)
`.tagall` `.everyone` `.tag` `.hidetag` `.kick` `.promote` `.demote` `.mute` `.unmute` `.link` `.invite` `.revoke` `.ginfo` `.gcstatus` `.gcstatus2` `.updategcname` `.updategcdesc` `.poll` `.del` `.add` `.warn` `.resetwarn` `.warnings` `.listadmins` `.gcpp` `.out` `.end` `.newgc` `.join` `.requests` `.acceptall` `.rejectall` `.accept` `.reject` `.chreact` `.chreact2`

### 📸 IMAGE TOOLS (26)
`.upscale1` … `.upscale16` `.unblur` `.blurface` `.removebg` `.removebg2` `.remini` `.enhance1` `.enhance4` `.enhance8` `.enhance16` `.colorize`

### 🎨 LOGO (27)
`.advglow` `.amongus` `.bplogo` `.bpstyle` `.cartoontxt` `.deletetxt` `.clouds` `.flag3d` `.freecreate` `.galaxy` `.galaxywp` `.glitch` `.glow` `.gradient` `.lightfx` `.logomaker` `.luxurygold` `.neon` `.papercut` `.pixelglitch` `.royal` `.sand` `.typography` `.beach` `.underwater` `.watercolor` `.write`

### 🔎 MAIN (19)
`.menu` `.help` `.menuall` `.menustyle` `.ping` `.alive` `.uptime` `.owner` `.id` `.getpp` `.githubstalk` `.define` `.yts` `.praytime` `.runtime` `.repo` `.details` `.findcmd` `.clear`

> 🎨 **10 menu designs** — every user can pick their own with `.menustyle <1-10>` (saved per user). The owner sets the bot-wide default with `.menustyle default <1-10>`.

### 🛠️ MEDIA & FX (28)
`.sticker` `.s` `.toimg` `.toimage` `.tomp3` `.toptt` `.bass` `.deep` `.smooth` `.fat` `.tupai` `.blown` `.radio` `.robot` `.chipmunk` `.nightcore` `.earrape` `.reverse` `.slow` `.fast` `.baby` `.demon` `.vaporwave` `.echo` `.karaoke` `.8d` `.tremolo` `.vibrato`

### 🐉 MYTH & LEGENDS (50)
`.earthquake` `.tsunami` `.volcano` `.tornado` `.hurricane` `.alieninvasion` `.zombie` `.vampire` `.werewolf` `.wizardmagic` `.fairy` `.mermaid` `.dragonfire` `.phoenix` `.pegasus` `.centaur` `.griffin` `.cyborg` `.ninja` `.samurai` `.viking` `.pirate` `.knight` `.gladiator` `.spartan` `.pharaoh` `.mayan` `.atlantis` `.olympus` `.valhalla` `.shaman` `.witchspell` `.necromancer` `.alchemist` `.monk` `.yogi` `.guru` `.sage` `.mystic` `.oracle` `.sorcerer` `.enchanter` `.conjurer` `.illusionist` `.diviner` `.seer` `.astral` `.medium` `.telepath`

### 👑 OWNER (19)
`.vv` `.vv2` `.vv3` `.forward` `.block` `.unblock` `.delete` `.leave` `.fullpp` `.setpp` `.status` `.status2` `.getbio` `.updatebio` `.setname` `.pair` `.broadcast` `.blocklist` `.restart`

### 👑 PREMIUM (20)
`.antidelete` `.antideleteinbox` `.antispam` `.autoreact` `.autoviewonce` `.autobio` `.chatbot` `.anticall` `.anticallmsg` `.autoreadstatus` `.online` `.premium` `.readmore` `.vcf` `.tts` `.carbon` `.ss` `.tourl` `.emojimix` `.emix`

### 🎭 REACTIONS (83)
`.hug` `.pat` `.kiss` `.slap` `.cuddle` `.wink` `.smile` `.dance` `.bite` `.bonk` `.highfive` `.handhold` `.poke` `.wave` `.blush` `.smug` `.happy` `.think` `.feed` `.tickle` `.laugh` `.baka` `.nod` `.nom` `.nope` `.pout` `.shrug` `.sleep` `.stare` `.thumbsup` `.wag` `.punch` `.lurk` `.yeet` `.cry` `.angry` `.sad` `.confused` `.bored` `.yawn` `.shocked` `.scared` `.shy` `.cool` `.celebrate` `.run` `.walk` `.facepalm` `.clap` `.salute` `.yes` `.no` `.sorry` `.shake` `.handshake` `.peck` `.sip` `.tehee` `.bleh` `.nya` `.carry` `.kabedon` `.spin` `.blowkiss` `.tableflip` `.stop` `.surprised` `.tired` `.sigh` `.nuzzle` `.yay` `.headbang` `.nosebleed` `.bully` `.cringe` `.kill` `.glomp` `.shoot` `.marige` `.flirt` `.blush2` `.hold` `.blushhard`

### ⚙️ SETTINGS (34)
`.mode` `.prefix` `.botname` `.ownername` `.ownernumber` `.description` `.stickername` `.setwelcome` `.setgoodbye` `.statusemoji` `.reactemojis` `.owneremojis` `.delpath` `.autoread` `.autotyping` `.recording` `.statusview` `.statuslike` `.administration` `.mentionreply` `.welcome` `.goodbye` `.antilink` `.autostatus` `.antistatus` `.setonline` `.botdp` `.privacy` `.getprivacy` `.groupsprivacy` `.sudo` `.delsudo` `.listsudo` `.settings`

### 🎵 SOUNDS (16)
`.sound` `.sound2` … `.sound16`

### 🧰 TOOLS (30)
`.weather` `.wthr` `.translate` `.tr` `.qr` `.shorturl` `.short` `.calc` `.wiki` `.time` `.clock` `.ip` `.base64` `.hash` `.password` `.currency` `.news` `.joke2` `.quote2` `.moon` `.type` `.spinner` `.loading` `.cd` `.rocket` `.chumi` `.fing` `.nikal` `.nppm` `.attp`

### 🧰 UTILITY (118)
`.fetch` `.ping2` `.mee` `.srepo` `.gpass` `.getlid` `.url` `.getimage` `.raw2` `.structure` `.cpp` `.convert` `.caption` `.anime1-5` `.unban0` … `.unban99`

---

## 🔐 Modes

- **public** — everyone can run commands.
- **private** — only the owner (the number that linked the bot) can run commands.

Switch live with `.mode public` or `.mode private`.

---

## 🏗️ Project Structure

```
saqib-md/
├── index.js              # Express server + plugin loader + bot startup
├── config.js             # Env-driven configuration
├── lib/
│   ├── bot.js            # Baileys connection, multi-session, pairing, reconnect
│   ├── handler.js        # Message handler & command dispatcher
│   ├── settings.js       # Persisted runtime settings
│   ├── ytdlp.js          # yt-dlp wrapper
│   └── helpers.js        # Shared utilities (fetch, media, etc.)
├── plugins/
│   ├── _registry.js      # Internal command registry (O(1) lookup)
│   ├── main.js           # menu, ping, alive…
│   ├── ai.js             # AI chat + imagine
│   ├── fun.js            # fun commands
│   ├── characters.js     # role-play + dp commands
│   ├── reactions.js      # reaction GIFs
│   ├── fonts.js          # font1-105
│   ├── logo.js           # logo maker
│   ├── myth.js           # myth & legends
│   ├── sounds.js         # sound effects
│   ├── imagetools.js     # upscale / enhance / removebg…
│   ├── utility.js        # fetch, structure, unban…
│   ├── group.js          # group management
│   ├── media.js          # stickers & audio effects
│   ├── owner.js          # owner commands
│   ├── premium.js        # auto/anti toggles + premium tools
│   ├── settings.js       # live settings
│   ├── anime.js          # anime images
│   ├── downloader.js     # social media downloaders
│   └── tools.js          # utility commands
├── public/index.html     # Web pairing portal (multi-session)
├── scripts/
│   ├── verify.js         # command/duplicate checker
│   └── smoke.js          # live smoke test
├── Dockerfile / Procfile / railway.json
└── .env.example
```

---

## 🧩 Adding Your Own Command

Create a file in `plugins/`, e.g. `plugins/hello.js`:

```js
module.exports = {
  commands: ['hello', 'hi'],
  category: '🔎 MAIN',
  handler: async (ctx) => {
    await ctx.reply(`👋 Salam ${ctx.pushname}!`);
  },
};
```

That's it — the loader picks it up automatically and it appears in `.menu`.

---

## 🧪 Verify

```bash
node scripts/verify.js   # plugins, command count, duplicates, hooks
node scripts/smoke.js    # live-run every command with a mock context
```

---

## ⚠️ Disclaimer

This bot is for educational/personal use. Use responsibly and in line with
WhatsApp's Terms of Service. The authors are not responsible for misuse.

## 📄 License

MIT © Saqib
