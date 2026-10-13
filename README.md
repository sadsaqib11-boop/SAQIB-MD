# 🤖 SAQIB-MD — Premium WhatsApp Bot

> A premium, fully-featured WhatsApp bot built with [Baileys](https://github.com/WhiskeySockets/Baileys).
> **266+ commands**, 60+ AI models, media downloaders, group management, audio effects, and a built-in web pairing portal.

![status](https://img.shields.io/badge/status-online-22c55e) ![commands](https://img.shields.io/badge/commands-266+-7c5cff) ![node](https://img.shields.io/badge/node-%3E%3D20-339933)

---

## ✨ Features

- 🔗 **Pairing-code login** (no QR scan) via a beautiful web portal
- 🤖 **60+ AI models** (GPT, Gemini, Claude, Grok, DeepSeek, Llama…) routed through a single engine
- 🎨 **AI image generation** (`.imagine`) — no API key required
- 📥 **Downloaders**: TikTok, Instagram, Facebook, Twitter/X, Pinterest, YouTube, APK
- 🎵 **Media tools**: stickers, to-image, to-mp3, to-ptt + **16 audio effects**
- 👥 **Full group management**: tagall, kick, promote, mute, antilink, warnings, polls
- 🧰 **Premium tools**: weather, translate, QR, calculator, wiki, IP lookup, currency, hashing
- 🛡️ **Owner controls**: view-once unlocker, broadcast, block, status, profile editing
- ⚙️ **Live settings** to change mode/prefix/etc. without restarting

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
   The `railway.json` also installs **ffmpeg** (needed for stickers/audio effects).

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
| `OWNER_NUMBER` | — | Owner WhatsApp number (digits only) |
| `GEMINI_API_KEY` | — | Google Gemini API key (for AI commands) |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model id |
| `MODE` | `public` | `public` or `private` |
| `AUTO_READ` | `true` | Auto mark messages as read |
| `AUTO_TYPING` | `true` | Show "typing…" presence |
| `WELCOME` / `GOODBYE` | `true` | Group join/leave messages |
| `ANTILINK` | `false` | Delete links in groups |
| `TIMEZONE` | `Asia/Karachi` | Timezone for time commands |
| `PORT` | `3000` | Web server port |
| `SESSION_DIR` | `./session` | Auth state folder |
| `SUDO` | — | Comma-separated extra owners |

> Get a free Gemini key at <https://aistudio.google.com/app/apikey>.

---

## 📜 Commands (266+)

### 🔎 MAIN (14)
`.menu` `.help` `.ping` `.alive` `.uptime` `.owner` `.id` `.getpp` `.githubstalk` `.define` `.yts` `.praytime` `.runtime` `.repo`

### 🤖 AI (57)
`.ai` `.bot` `.gpt` `.gpt3` `.gpt4` `.gpt4o` `.gpt4mini` `.gpt4vision` `.gpt5` `.gpt5mini` `.chatgpt` `.chatgpt4` `.chatgpt4o` `.o1` `.o3` `.o4` `.copilot` `.deepseek` `.deepseekv3` `.deepseekcoder` `.gemini` `.geminipro` `.gemini15` `.gemini20` `.gemini25` `.bard` `.palm` `.grok` `.grok2` `.grok3` `.grok4` `.claude` `.claude3` `.claude35` `.claude37` `.claude4` `.qwen` `.qwen2` `.qwen25` `.llama` `.llama3` `.mistral` `.mixtral` `.kimi` `.perplexity` `.mathgpt` `.brain` `.elite` `.assistant` `.smart` `.genius` `.nova` `.apex` `.vertex` `.imagine` `.image` `.img`

### 🎨 ANIME & LOGO (12)
`.waifu` `.neko` `.shinobu` `.megumin` `.awoo` `.maid` `.anime` `.animegirl` `.husbando` `.dog` `.cat` `.logo`

### 📥 DOWNLOAD (21)
`.tiktok` `.tt` `.ttmp3` `.instagram` `.ig` `.igdl` `.reels` `.facebook` `.fb` `.twitter` `.x` `.pinterest` `.pin` `.play` `.song` `.music` `.ytaudio` `.ytmp3` `.ytmp4` `.ytvideo` `.apk`

### 😂 FUN (69)
`.roast` `.compliment` `.quote` `.shayari` `.joke` `.bacha` `.fact` `.meme` `.8ball` `.lovetest` `.ship` `.aura` `.rate` `.character` `.truth` `.dare` `.wyr` `.rizz` `.sigma` `.dice` `.coinflip` `.flip` `.slot` `.font` `.reverse` `.heart` `.hug` `.kiss` `.slap` `.punch` `.pat` `.wave` `.poke` `.highfive` `.dance` `.laugh` `.cry` `.smile` `.wink` `.blush` `.angry` `.sad` `.sleep` `.stare` `.confused` `.bored` `.yawn` `.shocked` `.scared` `.shy` `.cool` `.celebrate` `.run` `.walk` `.think` `.bite` `.feed` `.cuddle` `.facepalm` `.clap` `.salute` `.thumbsup` `.yes` `.no` `.sorry` `.happy` `.nod` `.shake` `.handshake`

### 👥 GROUP (21)
`.tagall` `.everyone` `.tag` `.hidetag` `.kick` `.promote` `.demote` `.mute` `.unmute` `.link` `.revoke` `.ginfo` `.updategcname` `.updategcdesc` `.poll` `.del` `.add` `.warn` `.resetwarn` `.warnings` `.listadmins`

### 🛠️ MEDIA & FX (22)
`.sticker` `.s` `.toimg` `.toimage` `.tomp3` `.toptt` `.bass` `.deep` `.smooth` `.fat` `.tupai` `.blown` `.radio` `.robot` `.chipmunk` `.nightcore` `.earrape` `.reversefx` `.slow` `.fast` `.baby` `.demon`

### 👑 OWNER (19)
`.vv` `.vv2` `.vv3` `.forward` `.block` `.unblock` `.delete` `.leave` `.fullpp` `.setpp` `.status` `.status2` `.getbio` `.updatebio` `.setname` `.pair` `.broadcast` `.blocklist` `.restart`

### ⚙️ SETTINGS (14)
`.mode` `.prefix` `.botname` `.ownername` `.ownernumber` `.autoread` `.autotyping` `.welcome` `.goodbye` `.antilink` `.sudo` `.delsudo` `.listsudo` `.settings`

### 🧰 TOOLS (17)
`.weather` `.translate` `.tr` `.qr` `.shorturl` `.short` `.calc` `.wiki` `.time` `.ip` `.base64` `.hash` `.password` `.currency` `.news` `.joke2` `.quote2`

---

## 🏗️ Project Structure

```
saqib-md/
├── index.js              # Express server + plugin loader + bot startup
├── config.js             # Env-driven configuration
├── lib/
│   ├── bot.js            # Baileys connection, pairing, reconnect
│   ├── handler.js        # Message handler & command dispatcher
│   └── helpers.js        # Shared utilities (fetch, media, etc.)
├── plugins/
│   ├── _registry.js      # Internal command registry
│   ├── main.js           # menu, ping, alive…
│   ├── ai.js             # AI chat + imagine
│   ├── fun.js            # fun & reaction commands
│   ├── group.js          # group management
│   ├── media.js          # stickers & audio effects
│   ├── owner.js          # owner-only commands
│   ├── settings.js       # live settings
│   ├── anime.js          # anime & logo images
│   ├── downloader.js     # social media downloaders
│   └── tools.js          # utility commands
├── public/index.html     # Web pairing portal
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

## ⚠️ Disclaimer

This bot is for educational/personal use. Use responsibly and in line with
WhatsApp's Terms of Service. The authors are not responsible for misuse.

## 📄 License

MIT © Saqib
