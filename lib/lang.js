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
  const c = String(code || '').toLowerCase().trim();
  if (!LANGS[c]) return null;
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
  return Object.entries(LANGS).filter(([c, [en, nat]]) =>
    c.includes(s) || en.toLowerCase().includes(s) || nat.toLowerCase().includes(s));
}

module.exports = { LANGS, DEFAULT, FILE, load, save, forUser, infoFor, set, reset, has, all, search };
