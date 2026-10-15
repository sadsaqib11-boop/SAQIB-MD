/**
 * SAQIB-MD — Bot Configuration
 * All values are env-driven (see .env.example) with sensible defaults.
 *
 * NOTE: every auto/anti feature defaults to OFF. The owner turns them ON
 * live with a toggle command (e.g. `.autoreact`, `.antidelete`) and the
 * choice is persisted to disk (survives restarts / redeploys).
 */
require('dotenv').config();

const bool = (v, d = false) => (v === undefined ? d : String(v).toLowerCase() === 'true');

const config = {
  // ---- identity ----
  BOT_NAME: process.env.BOT_NAME || 'SAQIB-MD',
  BOT_VERSION: '3.0.0',
  PREFIX: process.env.PREFIX || '.',
  OWNER_NAME: process.env.OWNER_NAME || 'Saqib',
  OWNER_NUMBER: (process.env.OWNER_NUMBER || '923106762478').replace(/[^0-9]/g, ''),
  OWNER_EMAIL: process.env.OWNER_EMAIL || '',

  // ---- AI ----
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  // YouTube cookies (Netscape cookies.txt) — fixes "Sign in to confirm you're not a bot".
  YT_COOKIES: process.env.YT_COOKIES || '',
  GEMINI_IMAGE_MODEL: process.env.GEMINI_IMAGE_MODEL || 'imagen-4.0-generate-001',
  // Keyed pollinations — removes the per-IP 402 limit on image generation.
  POLLINATIONS_API_KEY: process.env.POLLINATIONS_API_KEY || '',
  // FREE models (no pollen cost) — these are what make image generation work
  // without a paid budget. flux-2-dev-free is the best quality of the free set.
  POLLINATIONS_IMAGE_MODEL: process.env.POLLINATIONS_IMAGE_MODEL || 'community/scriptsnsenses-sys/flux-2-dev-free',
  POLLINATIONS_IMAGE_FALLBACK: process.env.POLLINATIONS_IMAGE_FALLBACK || 'community/scriptsnsenses-sys/sdxl-lightning-free',

  // ---- behaviour (ALL OFF BY DEFAULT) ----
  MODE: process.env.MODE || 'public', // public | private
  AUTO_READ: bool(process.env.AUTO_READ, false),
  AUTO_TYPING: bool(process.env.AUTO_TYPING, false),
  AUTO_REACT: bool(process.env.AUTO_REACT, false),
  // Auto-react scope (only meaningful when AUTO_REACT is ON).
  AUTO_REACT_GROUP: bool(process.env.AUTO_REACT_GROUP, true),
  AUTO_REACT_CHAT: bool(process.env.AUTO_REACT_CHAT, true),
  WELCOME: bool(process.env.WELCOME, false),
  GOODBYE: bool(process.env.GOODBYE, false),
  ANTILINK: bool(process.env.ANTILINK, false),
  ANTIDELETE: bool(process.env.ANTIDELETE, false),
  ANTIDELETE_INBOX: bool(process.env.ANTIDELETE_INBOX, false),
  ANTISPAM: bool(process.env.ANTISPAM, false),
  ANTICALL: bool(process.env.ANTICALL, false),
  AUTOSTATUS: bool(process.env.AUTOSTATUS, false),
  AUTOSAVESTATUS: bool(process.env.AUTOSAVESTATUS, true),
  AUTOVIEWONCE: bool(process.env.AUTOVIEWONCE, false),
  AUTOBIO: bool(process.env.AUTOBIO, false),
  CHATBOT: bool(process.env.CHATBOT, false),
  AUTOREAD_STATUS: bool(process.env.AUTOREAD_STATUS, false),
  ONLINE: bool(process.env.ONLINE, false),
  RECORDING: bool(process.env.RECORDING, false),
  STATUSVIEW: bool(process.env.STATUSVIEW, false),
  ADMINISTRATION: bool(process.env.ADMINISTRATION, false),
  MENTION_REPLY: bool(process.env.MENTION_REPLY, false),
  // Send an unsolicited "I'm online" greeting to the owner on every connect?
  // OFF by default (the user asked for NO automatic/unwanted messages).
  AUTOGREET: bool(process.env.AUTOGREET, false),

  // ---- customisable content (persisted) ----
  WELCOME_MSG: process.env.WELCOME_MSG || '👋 Welcome @user to @group!',
  GOODBYE_MSG: process.env.GOODBYE_MSG || '🕊️ @user left @group. Allah Hafiz!',
  STATUS_EMOJI: process.env.STATUS_EMOJI || '🔥',
  DESCRIPTION: process.env.DESCRIPTION || 'SAQIB-MD — Premium WhatsApp Bot',
  STICKER_NAME: process.env.STICKER_NAME || 'SAQIB-MD',
  PRIVACY: process.env.PRIVACY || 'default',
  GROUP_PRIVACY: process.env.GROUP_PRIVACY || 'default',

  TIMEZONE: process.env.TIMEZONE || 'Asia/Karachi',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // ---- fonts ----
  // Default font style used when a font command is called WITHOUT a style index
  // (e.g. `.font hello`). "mono" = monospace Unicode (the requested default).
  DEFAULT_FONT: (process.env.DEFAULT_FONT || 'mono').toLowerCase(),

  // ---- session / multi-session ----
  SESSION_DIR: process.env.SESSION_DIR || './session',
  SESSION_ID: process.env.SESSION_ID || '',
  MAX_SESSIONS: parseInt(process.env.MAX_SESSIONS || '50', 10),

  // ---- runtime flags ----
  SUDO: (process.env.SUDO || '').split(',').map((s) => s.replace(/[^0-9]/g, '')).filter(Boolean),
};

// ---------------------------------------------------------------------------
// Bot picture — attached to `.menu` (send your own via BOT_PIC env var).
// ---------------------------------------------------------------------------
config.BOT_PIC = process.env.BOT_PIC || './assets/bot.jpg';

// Popular emojis — replying to a view-once with any of these auto-restores it.
config.POPULAR_EMOJIS = [
  '❤️', '❤', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖', '💗', '💓', '💞', '💕', '💘', '💝',
  '😍', '🥰', '😘', '😻', '🔥', '👍', '👏', '🙏', '😂', '🤣', '😭', '😢', '😮', '😱', '🤯', '😎',
  '✨', '⭐', '🌟', '💯', '🎉', '🎊', '👌', '💪', '🤝', '😁', '😊', '🙌', '👀',
];

// ---------------------------------------------------------------------------
// AI command aliases — every one routes to the same AI engine.
// ---------------------------------------------------------------------------
config.AI_ALIASES = [
  // generic
  'ai', 'bot', 'brain', 'assistant', 'smart', 'genius', 'proai', 'ultra', 'maxai',
  'nova', 'zenith', 'apex', 'vertex', 'pulse', 'quantum', 'neo', 'omega', 'elite',
  'elitegpt', 'mathgpt', 'grammar', 'talkai',
  // OpenAI / GPT
  'gpt', 'gpt3', 'gpt35', 'gpt35turbo', 'gpt4', 'gpt4turbo', 'gpt4o', 'gpt4omini',
  'gpt4vision', 'gpt4all', 'gpt5', 'gpt5mini', 'chatgpt', 'chatgpt35', 'chatgpt4',
  'chatgpt4o', 'chatgpt4turbo', 'chatgptplus', 'chatgptelite', 'o1', 'o1mini',
  'o1preview', 'o3', 'o3mini', 'o4',
  // Copilot
  'copilot', 'mscopilot', 'elitecopilot',
  // DeepSeek
  'deepseek', 'deepseekv2', 'deepseekv3', 'deepseekr1', 'deepseekcoder',
  'deepseekcoder2', 'deepseekmath', 'deepseekllm', 'deepseekvl', 'deepseekchat',
  // Google
  'gemini', 'geminipro', 'geminiultra', 'gemininano', 'gemini15', 'gemini15pro',
  'gemini15flash', 'gemini20', 'gemini20flash', 'gemini25', 'gemini25pro',
  'gemini25flash', 'bard', 'palm', 'palm2',
  // xAI Grok
  'grok', 'grok1', 'grok15', 'grok2', 'grok2mini', 'grok3', 'grok3mini', 'grok4',
  'grokbeta', 'grokvision',
  // Anthropic Claude
  'claude', 'claude1', 'claude2', 'claudeinstant', 'claude3', 'claude3opus',
  'claude3sonnet', 'claude3haiku', 'claude35', 'claude35sonnet', 'claude35haiku',
  'claude37', 'claude37sonnet', 'claude4', 'claude4opus', 'claude4sonnet',
  'claudeopus', 'claudesonnet', 'claudehaiku',
  // Qwen
  'qwen', 'qwen15', 'qwen2', 'qwen25', 'qwen3', 'qwencoder', 'qwenmath', 'qwenvl',
  'qwenmax', 'qwenplus', 'qwenturbo',
  // Meta / others
  'llama', 'llama2', 'llama3', 'mistral', 'mixtral', 'falcon', 'bloom', 'bloomz',
  'orca', 'vicuna', 'alpaca', 'phi2', 'wizard', 'codet5', 'codex', 'starcoder',
  'codegen', 'kimi', 'perplexity', 'yi', 'yi34b', 'command', 'jurassic', 'ai21',
  'solar', 'lumin', 'redpajama', 'dolly', 'hugging', 'openassist', 'gptneo', 'gptj',
  'flant5', 'starlin',
];

// ---------------------------------------------------------------------------
// Audio effects -> ffmpeg filter map  (`.bass`, `.nightcore`, …)
// ---------------------------------------------------------------------------
config.AUDIO_FX = {
  bass: 'equalizer=f=60:gain_type=q:gain=8',
  deep: 'equalizer=f=100:gain_type=o:gain=-6',
  smooth: 'equalizer=f=800:gain_type=o:gain=-4',
  fat: 'bass=g=6',
  tupai: 'asetrate=44100*1.3,aresample=44100,atempo=0.85',
  blown: 'volume=8,acrusher=bits=4',
  radio: 'highpass=f=500,lowpass=f=3000',
  robot: 'vibrato=f=8:d=0.8,flanger',
  chipmunk: 'asetrate=44100*1.6,aresample=44100,atempo=0.9',
  nightcore: 'asetrate=44100*1.25,aresample=44100,atempo=1.0',
  earrape: 'volume=25,acrusher=bits=2',
  reverse: 'areverse',
  slow: 'asetrate=44100*0.8,aresample=44100,atempo=1.0',
  fast: 'asetrate=44100*1.35,aresample=44100,atempo=1.0',
  baby: 'asetrate=44100*1.7,aresample=44100,atempo=0.95,lowpass=f=6000',
  demon: 'asetrate=44100*0.7,aresample=44100,atempo=1.05,bass=g=10',
  vaporwave: 'asetrate=44100*0.9,aresample=44100,atempo=0.9,aecho=0.8:0.9:40:0.4',
  echo: 'aecho=0.8:0.9:1000:0.3',
  karaoke: 'stereotools=mlev=0.03',
  '8d': 'apulsator=hz=0.09',
  tremolo: 'tremolo=f=5:d=0.7',
  vibrato: 'vibrato=f=6.5:d=0.5',
};

// Auto-react emoji pool
config.REACT_EMOJIS = ['🔥', '⚡', '❤️', '😍', '👏', '💯', '🎉', '🤩', '😎', '💫', '✨', '🙌', '🥰', '😇', '💥'];

module.exports = config;
