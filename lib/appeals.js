/**
 * SAQIB-MD — ban appeal helper
 * ----------------------------
 * Each platform gets its OWN appeal channel, because a single generic "email us"
 * line is useless — WhatsApp bans, Instagram bans, Facebook bans and Telegram
 * bans all go through different forms/addresses.
 *
 * Everything here is static text: no API calls, no cost.
 */
const config = require('../config');

/**
 * platform -> appeal info.
 * `email` is the address to write to ('' when the platform only has a form).
 * `url`   is the official appeal page.
 * `steps` are the concrete things the user should do, in order.
 */
const APPEALS = {
  whatsapp: {
    name: 'WhatsApp',
    email: 'support@whatsapp.com',
    url: 'https://faq.whatsapp.com/1280874589015236',
    steps: [
      'WhatsApp kholo → Settings → Help → Contact us',
      'Ya support@whatsapp.com par email karo',
      'Subject: "My account was banned by mistake"',
      'Apna number likho (country code ke saath, jaise +92...)',
      'State the reason: the number is genuine, no spam was sent',
    ],
    note: 'WhatsApp ka review 24-48 ghante leta hy. Form se fast hota hy.',
  },
  whatsapp_business: {
    name: 'WhatsApp Business',
    email: 'smb_web@support.whatsapp.com',
    url: 'https://www.whatsapp.com/contact/?subject=messenger',
    steps: [
      'If the business account is banned, appeal at business.whatsapp.com',
      'Email: smb_web@support.whatsapp.com',
      'Business verification documents attach karo',
    ],
    note: 'Business appeals are handled by a separate team — normal support cannot do them.',
  },
  instagram: {
    name: 'Instagram',
    email: '',
    url: 'https://help.instagram.com/contact/606967319425038',
    steps: [
      'Login screen par "Need more help?" dabao',
      'Appeal form bharo — apna username + email do',
      'Ya Settings → Help → Report a problem',
      'Photo ID maangi jaye to asli ID bhejo',
    ],
    note: 'Instagram only accepts the form, not email. A reply comes within 1 day.',
  },
  facebook: {
    name: 'Facebook',
    email: 'disabled@fb.com',
    url: 'https://www.facebook.com/help/contact/260749603972907',
    steps: [
      'facebook.com/support par login karke appeal karo',
      'Ya disabled@fb.com par email bhejo',
      'Subject: "Appeal for disabled account"',
      'Asli ID ki photo attach karo',
    ],
    note: 'Without an ID the appeal is rejected — attach a photo.',
  },
  telegram: {
    name: 'Telegram',
    email: 'recover@telegram.org',
    url: 'https://telegram.org/faq#q-my-account-was-limited-or-banned',
    steps: [
      'recover@telegram.org par email karo',
      'Apna number likho (jaise +92...)',
      'Limited/banned ka screenshot attach karo',
      'Subject: "Account limitation appeal"',
    ],
    note: 'Telegram bots ke liye spam@telegram.org alag hy.',
  },
  tiktok: {
    name: 'TikTok',
    email: '',
    url: 'https://www.tiktok.com/legal/report/appeal',
    steps: [
      'App me login karne ki koshish karo — appeal button aayega',
      'Ya tiktok.com/legal/report/appeal par jao',
      'Username + registered email do',
    ],
    note: 'TikTok only accepts the in-app form.',
  },
  twitter: {
    name: 'X (Twitter)',
    email: '',
    url: 'https://help.twitter.com/forms/restricted',
    steps: [
      'help.twitter.com/forms/restricted kholo',
      'Suspended account appeal form bharo',
      '@username do',
    ],
    note: 'Without the form, the email gets no reply.',
  },
  youtube: {
    name: 'YouTube',
    email: '',
    url: 'https://support.google.com/youtube/contact/account_appeal',
    steps: [
      'support.google.com/youtube → account appeal',
      'Channel URL do',
      'State the reason: you did not break the rules',
    ],
    note: 'Google account ban ho to accounts.google.com appeal use karo.',
  },
  discord: {
    name: 'Discord',
    email: 'support@discord.com',
    url: 'https://dis.gd/contact',
    steps: [
      'dis.gd/contact par appeal form bharo',
      'Ya support@discord.com par email karo',
      'User ID (Settings → Advanced → Developer Mode) do',
    ],
    note: 'An account ban becomes permanent after 30 days — act quickly.',
  },
  gmail: {
    name: 'Gmail / Google Account',
    email: '',
    url: 'https://support.google.com/accounts/contact/disabled2',
    steps: [
      'support.google.com/accounts → disabled account appeal',
      'Recovery email/phone se verify karo',
      'Form me wajah likho',
    ],
    note: 'Google only uses its form, not direct email.',
  },
};

const KEYWORDS = [
  ['whatsapp', 'whatsapp'], ['wa business', 'whatsapp_business'], ['whatsapp business', 'whatsapp_business'],
  ['instagram', 'instagram'], ['insta', 'instagram'], ['ig', 'instagram'],
  ['facebook', 'facebook'], ['fb', 'facebook'],
  ['telegram', 'telegram'], ['tg', 'telegram'],
  ['tiktok', 'tiktok'], ['tik tok', 'tiktok'],
  ['twitter', 'twitter'], ['x', 'twitter'],
  ['youtube', 'youtube'], ['yt', 'youtube'],
  ['discord', 'discord'],
  ['gmail', 'gmail'], ['google', 'gmail'],
];

/** Look up appeal info for a free-text platform name. */
function lookup(input) {
  const q = String(input || '').toLowerCase().trim();
  if (!q) return null;
  if (APPEALS[q]) return { key: q, ...APPEALS[q] };
  for (const [kw, key] of KEYWORDS) {
    if (q === kw || q.includes(kw)) return { key, ...APPEALS[key] };
  }
  return null;
}

/** Render one platform's appeal as WhatsApp text. */
function render(info) {
  if (!info) return null;
  const lines = [
    `📮 *${info.name} — Ban Appeal*`,
    '',
    '📋 *Steps:*',
    ...info.steps.map((s, i) => `${i + 1}. ${s}`),
  ];
  if (info.email) lines.push('', `✉️ *Email:* ${info.email}`);
  if (info.url) lines.push(`🔗 *Link:* ${info.url}`);
  if (info.note) lines.push('', `ℹ️ ${info.note}`);
  lines.push('', `_${config.BOT_NAME} — appeals must be filed yourself; the bot cannot restore any account._`);
  return lines.join('\n');
}

/** List every platform we have an appeal route for. */
function listAll() {
  return Object.keys(APPEALS).map((k) => APPEALS[k].name).join(', ');
}

module.exports = { APPEALS, lookup, render, listAll };
