/**
 * SAQIB-MD — bot language (i18n)
 *
 * The bot's own reply text is English by default ("pure English" — her words).
 * `.botlanguage <code>` switches the language of the bot's replies for THAT
 * user only, persisted on the /data volume next to saqib-settings.json.
 *
 * 100 languages, keyed by a short code. Only English is fully translated in
 * the UI strings; every other language still works as a real setting and is
 * used for the AI/text-generation layer (ai.js passes the language name to the
 * model), which is what actually matters for "bot speaks my language".
 */
const fs = require('fs');
const path = require('path');

const SESSION_DIR = process.env.SESSION_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(path.dirname(SESSION_DIR), 'saqib-langs.json');

/** 100 languages: code -> [English name, native name]. */
const LANGS = {
  en: ['English', 'English'], ur: ['Urdu', 'اردو'], hi: ['Hindi', 'हिन्दी'],
  ar: ['Arabic', 'العربية'], fa: ['Persian', 'فارسی'], ps: ['Pashto', 'پښتو'],
  bn: ['Bengali', 'বাংলা'], pa: ['Punjabi', 'ਪੰਜਾਬੀ'], sd: ['Sindhi', 'سنڌي'],
  bal: ['Balochi', 'بلوچی'], ne: ['Nepali', 'नेपाली'], si: ['Sinhala', 'සිංහල'],
  ta: ['Tamil', 'தமிழ்'], te: ['Telugu', 'తెలుగు'], kn: ['Kannada', 'ಕನ್ನಡ'],
  ml: ['Malayalam', 'മലയാളം'], mr: ['Marathi', 'मराठी'], gu: ['Gujarati', 'ગુજરાતી'],
  or: ['Odia', 'ଓଡ଼ିଆ'], as: ['Assamese', 'অসমীয়া'], mai: ['Maithili', 'मैथिली'],
  zh: ['Chinese (Simplified)', '中文'], zh_tw: ['Chinese (Traditional)', '繁體中文'],
  yue: ['Cantonese', '廣東話'], ja: ['Japanese', '日本語'], ko: ['Korean', '한국어'],
  th: ['Thai', 'ไทย'], vi: ['Vietnamese', 'Tiếng Việt'], id: ['Indonesian', 'Bahasa Indonesia'],
  ms: ['Malay', 'Bahasa Melayu'], tl: ['Filipino', 'Filipino'], my: ['Burmese', 'မြန်မာ'],
  km: ['Khmer', 'ខ្មែរ'], lo: ['Lao', 'ລາວ'], mn: ['Mongolian', 'Монгол'],
  kk: ['Kazakh', 'Қазақша'], ky: ['Kyrgyz', 'Кыргызча'], uz: ['Uzbek', 'Oʻzbek'],
  tg: ['Tajik', 'Тоҷикӣ'], tk: ['Turkmen', 'Türkmen'], az: ['Azerbaijani', 'Azərbaycan'],
  tr: ['Turkish', 'Türkçe'], he: ['Hebrew', 'עברית'], ku: ['Kurdish', 'Kurdî'],
  hy: ['Armenian', 'Հայերեն'], ka: ['Georgian', 'ქართული'], ru: ['Russian', 'Русский'],
  uk: ['Ukrainian', 'Українська'], be: ['Belarusian', 'Беларуская'], pl: ['Polish', 'Polski'],
  cs: ['Czech', 'Čeština'], sk: ['Slovak', 'Slovenčina'], hu: ['Hungarian', 'Magyar'],
  ro: ['Romanian', 'Română'], bg: ['Bulgarian', 'Български'], sr: ['Serbian', 'Српски'],
  hr: ['Croatian', 'Hrvatski'], sl: ['Slovenian', 'Slovenščina'], bs: ['Bosnian', 'Bosanski'],
  mk: ['Macedonian', 'Македонски'], sq: ['Albanian', 'Shqip'], el: ['Greek', 'Ελληνικά'],
  lt: ['Lithuanian', 'Lietuvių'], lv: ['Latvian', 'Latviešu'], et: ['Estonian', 'Eesti'],
  fi: ['Finnish', 'Suomi'], sv: ['Swedish', 'Svenska'], no: ['Norwegian', 'Norsk'],
  da: ['Danish', 'Dansk'], is: ['Icelandic', 'Íslenska'], nl: ['Dutch', 'Nederlands'],
  de: ['German', 'Deutsch'], fr: ['French', 'Français'], es: ['Spanish', 'Español'],
  pt: ['Portuguese', 'Português'], it: ['Italian', 'Italiano'], ca: ['Catalan', 'Català'],
  gl: ['Galician', 'Galego'], eu: ['Basque', 'Euskara'], cy: ['Welsh', 'Cymraeg'],
  ga: ['Irish', 'Gaeilge'], gd: ['Scottish Gaelic', 'Gàidhlig'], mt: ['Maltese', 'Malti'],
  af: ['Afrikaans', 'Afrikaans'], sw: ['Swahili', 'Kiswahili'], am: ['Amharic', 'አማርኛ'],
  so: ['Somali', 'Soomaali'], yo: ['Yoruba', 'Yorùbá'], ig: ['Igbo', 'Igbo'],
  ha: ['Hausa', 'Hausa'], zu: ['Zulu', 'isiZulu'], xh: ['Xhosa', 'isiXhosa'],
  st: ['Sesotho', 'Sesotho'], mg: ['Malagasy', 'Malagasy'], rw: ['Kinyarwanda', 'Kinyarwanda'],
  ny: ['Chichewa', 'Chichewa'], sn: ['Shona', 'Shona'], lb: ['Luxembourgish', 'Lëtzebuergesch'],
  fo: ['Faroese', 'Føroyskt'], la: ['Latin', 'Latina'], eo: ['Esperanto', 'Esperanto'],
};

const DEFAULT = 'en';
let store = {};
try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { store = {}; }

/**
 * Common spoken names/aliases that do NOT literally appear in the language
 * record (so `.botlanguage farsi`, `.botlanguage roman urdu`, `.botlanguage
 * chinese` all work instead of silently failing). Maps alias -> real code.
 */
const ALIASES = {
  farsi: 'fa', persian: 'fa', parsi: 'fa',
  urdu: 'ur', 'roman urdu': 'ur', romanurdu: 'ur', 'roman-urdu': 'ur', rurdu: 'ur',
  hindi: 'hi', hindustani: 'hi',
  punjabi: 'pa', panjabi: 'pa', 'shahmukhi': 'pa',
  saraiki: 'pa', seraiki: 'pa', 'siraiki': 'pa',
  sindhi: 'sd', pashto: 'ps', pushto: 'ps', afghan: 'ps',
  balochi: 'bal', baluchi: 'bal', nepali: 'ne', sinhala: 'si', sinhalese: 'si',
  tamil: 'ta', telugu: 'te', kannada: 'kn', malayalam: 'ml', marathi: 'mr', gujarati: 'gu',
  bengali: 'bn', bangla: 'bn', odia: 'or', oriya: 'or', assamese: 'as', maithili: 'mai',
  chinese: 'zh', mandarin: 'zh', cantonese: 'yue', japanese: 'ja', korean: 'ko',
  thai: 'th', vietnamese: 'vi', indonesian: 'id', malay: 'ms', filipino: 'tl', tagalog: 'tl',
  burmese: 'my', khmer: 'km', lao: 'lo', mongolian: 'mn', kazakh: 'kk', kyrgyz: 'ky',
  uzbek: 'uz', tajik: 'tg', turkmen: 'tk', azerbaijani: 'az', azeri: 'az', turkish: 'tr',
  hebrew: 'he', kurdish: 'ku', armenian: 'hy', georgian: 'ka', russian: 'ru', ukrainian: 'uk',
  belarusian: 'be', polish: 'pl', czech: 'cs', slovak: 'sk', hungarian: 'hu', romanian: 'ro',
  bulgarian: 'bg', serbian: 'sr', croatian: 'hr', slovenian: 'sl', bosnian: 'bs',
  macedonian: 'mk', albanian: 'sq', greek: 'el', lithuanian: 'lt', latvian: 'lv', estonian: 'et',
  finnish: 'fi', swedish: 'sv', norwegian: 'no', danish: 'da', icelandic: 'is', dutch: 'nl',
  german: 'de', french: 'fr', spanish: 'es', portuguese: 'pt', italian: 'it', catalan: 'ca',
  galician: 'gl', basque: 'eu', welsh: 'cy', irish: 'ga', gaelic: 'gd', maltese: 'mt',
  afrikaans: 'af', swahili: 'sw', amharic: 'am', somali: 'so', yoruba: 'yo', igbo: 'ig',
  hausa: 'ha', zulu: 'zu', xhosa: 'xh', sesotho: 'st', malagasy: 'mg', kinyarwanda: 'rw',
  chichewa: 'ny', shona: 'sn', luxembourgish: 'lb', faroese: 'fo', latin: 'la', esperanto: 'eo',
  arabic: 'ar', english: 'en',
};

/** Resolve any user input (code / alias / English name / native name) to a code. */
function resolveCode(input) {
  const s = String(input || '').toLowerCase().trim();
  if (!s) return null;
  if (LANGS[s]) return s;
  if (ALIASES[s]) return ALIASES[s];
  // exact English or native name
  const hit = Object.entries(LANGS).find(([, [en, nat]]) => en.toLowerCase() === s || nat.toLowerCase() === s);
  if (hit) return hit[0];
  return null;
}

function save() { try { fs.writeFileSync(FILE, JSON.stringify(store, null, 1)); } catch { /* ignore */ } }
function load() { try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { store = {}; } return store; }
const norm = (n) => String(n || '').replace(/\D/g, '');

/** Language code for a user (defaults to English). */
function forUser(number) { return store[norm(number)] || DEFAULT; }
/** Full record for a user. */
function infoFor(number) {
  const code = forUser(number);
  const [name, native] = LANGS[code] || LANGS[DEFAULT];
  return { code, name, native };
}
function set(number, code) {
  const c = resolveCode(code);
  if (!c) return null;
  store[norm(number)] = c;
  save();
  return c;
}
function reset(number) { delete store[norm(number)]; save(); return DEFAULT; }
function has(number) { return !!store[norm(number)]; }
function all() { return { ...store }; }
/** Search languages by code, English name or native name. */
function search(q) {
  const s = String(q || '').toLowerCase().trim();
  const out = Object.entries(LANGS).filter(([c, [en, nat]]) =>
    c.includes(s) || en.toLowerCase().includes(s) || nat.toLowerCase().includes(s));
  // Also surface languages whose common ALIAS matches (e.g. "farsi" -> fa).
  for (const [alias, code] of Object.entries(ALIASES)) {
    if (alias.includes(s) && LANGS[code] && !out.find(([c]) => c === code)) out.push([code, LANGS[code]]);
  }
  return out;
}

/* ============================ translation layer ============================ */
/**
 * Real UI translation. Before this, `.botlanguage` only changed the language
 * NAME handed to the AI — the bot's own replies (menus, confirmations, errors)
 * stayed in Roman-English, which is exactly the bug she reported ("I select
 * Sindhi but the bot is still in English"). Now every reply is translated.
 *
 * Free, key-less endpoint (Google's dict-chrome-ex). Command tokens, the bot
 * name and `backticked` spans are MASKED before translating so `.menu`,
 * `.song`, `SAQIB-MD` … come back byte-for-byte identical — the example you
 * read is always the exact command you can type.
 */
let config = null;
try { config = require('../config'); } catch { config = null; }

const TR_CACHE = new Map();
const TR_MAX = 3000;
// SPEED: bound how long a translation may hold up a reply. The old 8s timeout
// meant one slow Google response could delay a single reply by up to 8 seconds;
// 2.5s is ample for the free endpoints and fails over fast when one is down.
const TR_TIMEOUT_MS = 2500;
// SPEED: how long to wait for the primary endpoint before ALSO firing the
// secondary (a "hedged" request). Below this the common fast path makes just
// one request; above it the two race and the first success wins.
const HEDGE_MS = 450;

/** Resolve with the first NON-NULL value from a list of promises (else null). */
function firstNonNull(ps) {
  return new Promise((resolve) => {
    let done = false;
    let pending = ps.length;
    if (!pending) return resolve(null);
    for (const p of ps) {
      Promise.resolve(p)
        .then((v) => { if (!done && v) { done = true; resolve(v); } })
        .catch(() => {})
        .finally(() => { if (--pending === 0 && !done) { done = true; resolve(null); } });
    }
  });
}
// Google uses a few different codes than our short names.
const GOOGLE_CODE = { zh: 'zh-CN', zh_tw: 'zh-TW', he: 'iw', jv: 'jw', nb: 'no', tl: 'tl', fil: 'tl', yue: 'yue' };
const gcode = (c) => GOOGLE_CODE[c] || c;

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace command-like tokens with placeholders Google won't touch. */
function mask(text) {
  const store = [];
  const put = (m) => { store.push(m); return `\u27e6C${store.length - 1}\u27e7`; };
  let out = String(text);
  out = out.replace(/`[^`]*`/g, put);                       // `backticked` spans
  const p = escRe((config && config.PREFIX) || '.');
  out = out.replace(new RegExp(p + '[A-Za-z0-9_]+', 'g'), put); // .command tokens
  if (config && config.BOT_NAME) out = out.split(config.BOT_NAME).join(put(config.BOT_NAME));
  if (config && config.OWNER_NAME) out = out.split(config.OWNER_NAME).join(put(config.OWNER_NAME));
  return { out, store };
}
function unmask(text, store) {
  return String(text).replace(/\u27e6C(\d+)\u27e7/g, (_, i) => (store[Number(i)] != null ? store[Number(i)] : ''));
}

/**
 * Translate `text` into language `code`. Returns the original text unchanged
 * for English / unknown codes / empty input, and on any network failure — so a
 * dead endpoint can never break a reply. Results are cached.
 */
async function translate(text, code) {
  const s = String(text == null ? '' : text);
  const c = String(code || DEFAULT).toLowerCase();
  if (!s.trim() || c === DEFAULT || !LANGS[c]) return s;
  if (s.length > 4000) return s; // too long to translate safely — send as-is
  const key = c + '\u0000' + s;
  const hit = TR_CACHE.get(key);
  if (hit !== undefined) return hit;
  const { out, store } = mask(s);
  // Two independent free endpoints. If the first is down / rate-limited / returns
  // nothing, the second is tried — so a single dead endpoint can never leave a
  // reply stuck in English (the exact ".botlanguage doesn't work" complaint).
  const tl = encodeURIComponent(gcode(c));
  const q = encodeURIComponent(out);
  const attempts = [
    {
      url: `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${tl}&q=${q}`,
      pick: (d) => (Array.isArray(d) && Array.isArray(d[0]) ? d[0][0] : (Array.isArray(d) ? d[0] : null)),
    },
    {
      url: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${q}`,
      pick: (d) => (Array.isArray(d) && Array.isArray(d[0]) ? d[0].map((x) => (Array.isArray(x) ? x[0] : '')).join('') : null),
    },
  ];
  const attempt = (at) => fetch(at.url, { signal: AbortSignal.timeout(TR_TIMEOUT_MS) })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return null;
      const t = at.pick(d);
      return (typeof t === 'string' && t.trim() && t.trim() !== s.trim()) ? unmask(t, store) : null;
    })
    .catch(() => null);

  // Fire the primary immediately; hedge in the secondary only if it is slow, so
  // the common fast path makes ONE request and a slow endpoint never stalls us.
  const p1 = attempt(attempts[0]);
  const hedge = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(attempt(attempts[1])), HEDGE_MS);
    p1.then((v) => { if (v) { clearTimeout(timer); resolve(null); } });
  });
  const res = (await firstNonNull([p1, hedge])) || s;
  if (TR_CACHE.size > TR_MAX) TR_CACHE.clear();
  TR_CACHE.set(key, res);
  return res;
}

module.exports = { LANGS, ALIASES, DEFAULT, FILE, load, save, forUser, infoFor, set, reset, has, all, search, translate, resolveCode };
