/**
 * SAQIB-MD — MENU ENGINE (10 styles)
 * ----------------------------------
 * The old menu printed two commands per line using `padEnd(26)` to fake a
 * two-column grid. WhatsApp renders text in a PROPORTIONAL font, so the columns
 * never lined up and long command names overlapped — the "menu is overlapping"
 * bug. Every style below is deliberately SINGLE-COLUMN and uses only separators
 * that look identical in any font, so nothing can ever overlap.
 *
 * 10 styles are available. Pick one with `.menustyle <1-10>`; the choice is
 * persisted. Style 1 is the default.
 *
 * Each style exposes `render(data)` where data is:
 *   { name, version, ownerName, when, prefix, mode, cats, total, cat, cmds }
 * and mode is 'categories' | 'category' | 'all'.
 */

const LINE = '━━━━━━━━━━━━━━━━━━━━━'; // 21 heavy dashes — a safe divider
const THIN = '─────────────────────';

/** Right-pad a short number so counts read cleanly (numbers are font-safe). */
const num = (n) => String(n).padStart(2, '0');

/* ============================== STYLE 1 — CLASSIC ============================== */
function classic(d) {
  let t = '';
  t += `╭${LINE}╮\n`;
  t += `┃   ✦  *${d.name}*  ✦\n`;
  t += `╰${LINE}╯\n`;
  t += `  ⚡ *v${d.version}*  •  👑 ${d.ownerName}  •  🕒 ${d.when}\n`;
  t += `  💠 Prefix: *${d.prefix}*\n\n`;
  if (d.mode === 'categories') {
    t += `📂 *CATEGORIES*   ›   ${d.total} commands\n${LINE}\n`;
    d.cats.forEach(([cat, cmds], i) => { t += ` ${num(i + 1)} ▸ ${cat}  ›  ${cmds.length}\n`; });
    t += `${LINE}\n`;
    t += `💡 ${d.prefix}menu <category>   •   ${d.prefix}menuall\n`;
  } else if (d.mode === 'category') {
    t += `╭─❖ ${d.cat}\n`;
    t += `│ 📦 *${d.cmds.length} commands*\n`;
    t += `╰${LINE}\n\n`;
    d.cmds.forEach((c) => { t += `▸ ${d.prefix}${c}\n`; });
    t += `\n${LINE}\n`;
    t += `💡 ${d.prefix}menu  •  ${d.prefix}menuall\n`;
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `╭─❖ *${cat}*  ›  ${cmds.length}\n`;
      cmds.forEach((c) => { t += `│ ▸ ${d.prefix}${c}\n`; });
      t += `╰${LINE}\n\n`;
    });
  }
  t += `✨ _${d.name} — by ${d.ownerName}_`;
  return t;
}

/* ============================== STYLE 2 — MINIMAL ============================== */
function minimal(d) {
  let t = `*${d.name}*\n`;
  t += `v${d.version} · ${d.ownerName} · prefix ${d.prefix}\n\n`;
  if (d.mode === 'categories') {
    t += `CATEGORIES (${d.total})\n`;
    d.cats.forEach(([cat, cmds]) => { t += `· ${cat} — ${cmds.length}\n`; });
    t += `\n${d.prefix}menu <cat> / ${d.prefix}menuall`;
  } else if (d.mode === 'category') {
    t += `${d.cat} (${d.cmds.length})\n`;
    d.cmds.forEach((c) => { t += `· ${d.prefix}${c}\n`; });
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `${cat} (${cmds.length})\n`;
      cmds.forEach((c) => { t += `· ${d.prefix}${c}\n`; });
      t += `\n`;
    });
  }
  return t.trimEnd();
}

/* ============================== STYLE 3 — NEON ============================== */
function neon(d) {
  let t = `⚡⚡⚡ *${d.name}* ⚡⚡⚡\n`;
  t += `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n`;
  t += `⚙️ v${d.version}  ·  👑 ${d.ownerName}\n`;
  t += `🔑 prefix ${d.prefix}  ·  🕒 ${d.when}\n\n`;
  if (d.mode === 'categories') {
    t += `▓▓ *CATEGORIES* ▓▓ ${d.total}\n`;
    d.cats.forEach(([cat, cmds]) => { t += `🔹 ${cat} ⋯ ${cmds.length}\n`; });
    t += `\n${d.prefix}menu <cat> ⋯ ${d.prefix}menuall`;
  } else if (d.mode === 'category') {
    t += `▓▓ *${d.cat}* ▓▓ ${d.cmds.length}\n`;
    d.cmds.forEach((c) => { t += `⚡ ${d.prefix}${c}\n`; });
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `▓▓ *${cat}* ▓▓ ${cmds.length}\n`;
      cmds.forEach((c) => { t += `⚡ ${d.prefix}${c}\n`; });
      t += `\n`;
    });
  }
  return t.trimEnd();
}

/* ============================== STYLE 4 — ELEGANT ============================== */
function elegant(d) {
  let t = `╔═══════════════════╗\n`;
  t += `║   *${d.name}*\n`;
  t += `╚═══════════════════╝\n`;
  t += `  ✦ ${d.ownerName}  ·  v${d.version}  ·  ${d.when}\n`;
  t += `  ✦ Prefix  ${d.prefix}\n\n`;
  if (d.mode === 'categories') {
    t += `❖ *CATEGORIES*  (${d.total})\n${THIN}\n`;
    d.cats.forEach(([cat, cmds], i) => { t += `  ${num(i + 1)}. ${cat}  ·  ${cmds.length}\n`; });
    t += `${THIN}\n❖ ${d.prefix}menu <category>  ·  ${d.prefix}menuall`;
  } else if (d.mode === 'category') {
    t += `❖ *${d.cat}*  (${d.cmds.length})\n${THIN}\n`;
    d.cmds.forEach((c) => { t += `  ✦ ${d.prefix}${c}\n`; });
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `❖ *${cat}*  (${cmds.length})\n${THIN}\n`;
      cmds.forEach((c) => { t += `  ✦ ${d.prefix}${c}\n`; });
      t += `\n`;
    });
  }
  return t.trimEnd();
}

/* ============================== STYLE 5 — COMPACT ============================== */
function compact(d) {
  if (d.mode === 'categories') {
    let t = `*${d.name}* · ${d.total} cmds · prefix ${d.prefix}\n${THIN}\n`;
    d.cats.forEach(([cat, cmds]) => { t += `${cat}(${cmds.length})  `; });
    t += `\n${THIN}\n${d.prefix}menu <cat> / ${d.prefix}menuall`;
    return t;
  }
  let t = `*${d.name}* · prefix ${d.prefix}\n${THIN}\n`;
  if (d.mode === 'category') {
    t += `[${d.cat}] ${d.cmds.length}\n`;
    d.cmds.forEach((c) => { t += `${d.prefix}${c}  `; });
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `[${cat}] ${cmds.length}\n`;
      cmds.forEach((c) => { t += `${d.prefix}${c}  `; });
      t += `\n`;
    });
  }
  return t.trimEnd();
}

/* ============================== STYLE 6 — CARD ============================== */
function card(d) {
  let t = `┏━━━ *${d.name}* ━━━┓\n`;
  t += `┃ 👑 ${d.ownerName}  ·  v${d.version}\n`;
  t += `┃ 🔑 ${d.prefix}  ·  🕒 ${d.when}\n`;
  t += `┗━━━━━━━━━━━━━━━┛\n\n`;
  if (d.mode === 'categories') {
    t += `┏━ 📂 CATEGORIES (${d.total})\n`;
    d.cats.forEach(([cat, cmds]) => { t += `┃ ▸ ${cat}  ›  ${cmds.length}\n`; });
    t += `┗━ ${d.prefix}menu <cat> · ${d.prefix}menuall`;
  } else if (d.mode === 'category') {
    t += `┏━ 📦 *${d.cat}* (${d.cmds.length})\n`;
    d.cmds.forEach((c) => { t += `┃ ▸ ${d.prefix}${c}\n`; });
    t += `┗━━━━━━━━━━━━━━━`;
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `┏━ *${cat}* (${cmds.length})\n`;
      cmds.forEach((c) => { t += `┃ ▸ ${d.prefix}${c}\n`; });
      t += `┗━━━━━━━━━━━━━━━\n\n`;
    });
  }
  return t.trimEnd();
}

/* ============================== STYLE 7 — TERMINAL ============================== */
function terminal(d) {
  let t = '```\n';
  t += `${d.name} v${d.version}\n`;
  t += `owner : ${d.ownerName}\n`;
  t += `prefix: ${d.prefix}\n`;
  t += `time  : ${d.when}\n`;
  if (d.mode === 'categories') {
    t += `\n[CATEGORIES] ${d.total}\n`;
    d.cats.forEach(([cat, cmds], i) => { t += ` ${num(i + 1)}  ${cat}  ->  ${cmds.length}\n`; });
    t += `\n${d.prefix}menu <cat> | ${d.prefix}menuall\n`;
  } else if (d.mode === 'category') {
    t += `\n[${d.cat}] ${d.cmds.length}\n`;
    d.cmds.forEach((c) => { t += ` > ${d.prefix}${c}\n`; });
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `\n[${cat}] ${cmds.length}\n`;
      cmds.forEach((c) => { t += ` > ${d.prefix}${c}\n`; });
    });
  }
  t += '```';
  return t;
}

/* ============================== STYLE 8 — ROYAL ============================== */
function royal(d) {
  let t = `👑 ═══ *${d.name}* ═══ 👑\n`;
  t += `     ✦ ${d.ownerName} ✦\n`;
  t += `  v${d.version}  •  ${d.prefix}  •  ${d.when}\n\n`;
  if (d.mode === 'categories') {
    t += `⚜️ *CATEGORIES*  ›  ${d.total}\n${LINE}\n`;
    d.cats.forEach(([cat, cmds], i) => { t += ` ${num(i + 1)} ✦ ${cat}  ›  ${cmds.length}\n`; });
    t += `${LINE}\n👑 ${d.prefix}menu <cat>  ·  ${d.prefix}menuall`;
  } else if (d.mode === 'category') {
    t += `⚜️ *${d.cat}*  ›  ${d.cmds.length}\n${LINE}\n`;
    d.cmds.forEach((c) => { t += `✦ ${d.prefix}${c}\n`; });
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `⚜️ *${cat}*  ›  ${cmds.length}\n${LINE}\n`;
      cmds.forEach((c) => { t += `✦ ${d.prefix}${c}\n`; });
      t += `\n`;
    });
  }
  return t.trimEnd();
}

/* ============================== STYLE 9 — PILLS ============================== */
function pills(d) {
  let t = `● *${d.name}* ●  v${d.version}\n`;
  t += `● ${d.ownerName}  ●  ${d.prefix}  ●  ${d.when}\n\n`;
  if (d.mode === 'categories') {
    t += `◈ *CATEGORIES* (${d.total})\n`;
    d.cats.forEach(([cat, cmds]) => { t += `◈ ${cat} ⋯⋯ ${cmds.length}\n`; });
    t += `\n◈ ${d.prefix}menu <cat>  ·  ${d.prefix}menuall`;
  } else if (d.mode === 'category') {
    t += `◈ *${d.cat}* (${d.cmds.length})\n`;
    d.cmds.forEach((c) => { t += `● ${d.prefix}${c}\n`; });
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `◈ *${cat}* (${cmds.length})\n`;
      cmds.forEach((c) => { t += `● ${d.prefix}${c}\n`; });
      t += `\n`;
    });
  }
  return t.trimEnd();
}

/* ============================== STYLE 10 — MODERN ============================== */
function modern(d) {
  let t = `╭─ *${d.name}* ──────────╮\n`;
  t += `│ ✦ v${d.version}  ·  👑 ${d.ownerName}\n`;
  t += `│ ✦ prefix ${d.prefix}  ·  🕒 ${d.when}\n`;
  t += `╰──────────────────────╯\n\n`;
  if (d.mode === 'categories') {
    t += `╭─ 📂 *CATEGORIES* (${d.total})\n`;
    d.cats.forEach(([cat, cmds], i) => { t += `│ ${num(i + 1)} ▸ ${cat}  ›  ${cmds.length}\n`; });
    t += `╰─ 💡 ${d.prefix}menu <cat> · ${d.prefix}menuall`;
  } else if (d.mode === 'category') {
    t += `╭─ 📦 *${d.cat}* (${d.cmds.length})\n`;
    d.cmds.forEach((c) => { t += `│ ▸ ${d.prefix}${c}\n`; });
    t += `╰──────────────────────`;
  } else {
    d.cats.forEach(([cat, cmds]) => {
      t += `╭─ *${cat}* (${cmds.length})\n`;
      cmds.forEach((c) => { t += `│ ▸ ${d.prefix}${c}\n`; });
      t += `╰──────────────────────\n\n`;
    });
  }
  return t.trimEnd();
}

const STYLES = [
  { id: 1, name: 'Classic', desc: 'Boxed header + numbered categories', render: classic },
  { id: 2, name: 'Minimal', desc: 'Clean, no borders', render: minimal },
  { id: 3, name: 'Neon', desc: 'Bold neon bars & lightning', render: neon },
  { id: 4, name: 'Elegant', desc: 'Double-line frame, refined', render: elegant },
  { id: 5, name: 'Compact', desc: 'Everything on a few lines', render: compact },
  { id: 6, name: 'Card', desc: 'Card-style panels', render: card },
  { id: 7, name: 'Terminal', desc: 'Monospace code block', render: terminal },
  { id: 8, name: 'Royal', desc: 'Crown & gold dividers', render: royal },
  { id: 9, name: 'Pills', desc: 'Dotted pill list', render: pills },
  { id: 10, name: 'Modern', desc: 'Rounded modern frame', render: modern },
];

/** Clamp an arbitrary style id to a valid 1-10 index. */
function normalize(id) {
  const n = parseInt(id, 10);
  if (!Number.isFinite(n) || n < 1 || n > STYLES.length) return 1;
  return n;
}

/** Render the menu in the given style. */
function render(styleId, data) {
  const style = STYLES[normalize(styleId) - 1];
  return style.render(data);
}

/** A short, human list of every style (used by `.menustyle`). */
function listStyles() {
  return STYLES.map((s) => `${String(s.id).padStart(2, ' ')}. *${s.name}* — ${s.desc}`).join('\n');
}

module.exports = { STYLES, normalize, render, listStyles };
