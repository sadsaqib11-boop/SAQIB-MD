/**
 * SAQIB-MD — Bot Configuration
 * All values are env-driven (see .env.example) with sensible defaults.
 */
require('dotenv').config();

const bool = (v, d = false) => (v === undefined ? d : String(v).toLowerCase() === 'true');

const config = {
  // ---- identity ----
  BOT_NAME: process.env.BOT_NAME || 'SAQIB-MD',
  BOT_VERSION: '2.0.0',
  PREFIX: process.env.PREFIX || '.',
  OWNER_NAME: process.env.OWNER_NAME || 'Saqib',
  OWNER_NUMBER: (process.env.OWNER_NUMBER || '923106762478').replace(/[^0-9]/g, ''),
  OWNER_EMAIL: process.env.OWNER_EMAIL || '',

  // ---- AI ----
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.0-flash',

  // ---- behaviour ----
  MODE: process.env.MODE || 'public', // public | private
  AUTO_READ: bool(process.env.AUTO_READ, true),
  AUTO_TYPING: bool(process.env.AUTO_TYPING, true),
  AUTO_REACT: bool(process.env.AUTO_REACT, false),
  WELCOME: bool(process.env.WELCOME, true),
  GOODBYE: bool(process.env.GOODBYE, true),
  ANTILINK: bool(process.env.ANTILINK, false),
  ANTIDELETE: bool(process.env.ANTIDELETE, false),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Karachi',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // ---- session ----
  SESSION_DIR: process.env.SESSION_DIR || './session',
  SESSION_ID: process.env.SESSION_ID || '', // base64 session (optional)

  // ---- runtime flags (mutable via settings) ----
  SUDO: (process.env.SUDO || '').split(',').map((s) => s.replace(/[^0-9]/g, '')).filter(Boolean),
};

// AI command aliases — all route to the same engine.
config.AI_ALIASES = [
  'ai', 'bot', 'gpt', 'gpt3', 'gpt4', 'gpt4o', 'gpt4mini', 'gpt4vision', 'gpt5', 'gpt5mini',
  'chatgpt', 'chatgpt4', 'chatgpt4o', 'o1', 'o3', 'o4', 'copilot', 'deepseek', 'deepseekv3',
  'deepseekcoder', 'gemini', 'geminipro', 'gemini15', 'gemini20', 'gemini25', 'bard', 'palm',
  'grok', 'grok2', 'grok3', 'grok4', 'claude', 'claude3', 'claude35', 'claude37', 'claude4',
  'qwen', 'qwen2', 'qwen25', 'llama', 'llama3', 'mistral', 'mixtral', 'kimi', 'perplexity',
  'mathgpt', 'brain', 'elite', 'assistant', 'smart', 'genius', 'nova', 'apex', 'vertex',
];

// Audio effects -> ffmpeg filter map
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
  reversefx: 'areverse',
  slow: 'asetrate=44100*0.8,aresample=44100,atempo=1.0',
  fast: 'asetrate=44100*1.35,aresample=44100,atempo=1.0',
  baby: 'asetrate=44100*1.7,aresample=44100,atempo=0.95,lowpass=f=6000',
  demon: 'asetrate=44100*0.7,aresample=44100,atempo=1.05,bass=g=10',
};

module.exports = config;
