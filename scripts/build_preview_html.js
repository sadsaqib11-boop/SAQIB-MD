/**
 * Build `preview/menu-styles.html` — a WhatsApp-style page that shows all 10
 * menu designs side by side, so the user can pick one.
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', 'preview');
const styles = JSON.parse(fs.readFileSync(path.join(dir, 'menus.json'), 'utf8'));

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Render WhatsApp markup: *bold*, _italic_, ```mono```.
function wa(text) {
  let t = esc(text);
  t = t.replace(/```([\s\S]*?)```/g, (_, m) => `<span class="mono">${m}</span>`);
  t = t.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  t = t.replace(/_([^_\n]+)_/g, '<i>$1</i>');
  return t;
}

const cards = styles
  .map(
    (s) => `
    <div class="cell">
      <div class="badge">Style ${s.id}</div>
      <div class="name">${s.name}</div>
      <div class="desc">${s.desc}</div>
      <div class="bubble"><div class="msg">${wa(s.text)}</div>
        <div class="meta"><span>3:42 PM</span><span class="tick">✓✓</span></div>
      </div>
    </div>`
  )
  .join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>SAQIB-MD — 10 Menu Styles</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 34px 28px 44px;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #0b141a;
    background-image:
      radial-gradient(1200px 700px at 12% -10%, rgba(124,92,255,.16), transparent 55%),
      radial-gradient(1000px 600px at 100% 0%, rgba(34,211,238,.12), transparent 55%);
    color: #e9edef;
  }
  h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: .3px; }
  h1 .g { background: linear-gradient(90deg,#7c5cff,#22d3ee); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { color: #8696a0; font-size: 14px; margin: 0 0 26px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 22px; }
  .cell {
    background: #111b21; border: 1px solid #222d34; border-radius: 16px;
    padding: 16px 16px 18px; position: relative;
  }
  .badge {
    position: absolute; top: -11px; left: 16px; font-size: 11px; font-weight: 700;
    background: linear-gradient(90deg,#7c5cff,#22d3ee); color: #06131a;
    padding: 3px 10px; border-radius: 999px; letter-spacing: .5px;
  }
  .name { font-size: 15px; font-weight: 700; margin: 6px 0 1px; color: #e9edef; }
  .desc { font-size: 12px; color: #8696a0; margin-bottom: 12px; }
  .bubble {
    background: #005c4b; border-radius: 10px 10px 10px 3px;
    padding: 10px 12px 6px; max-width: 100%;
    box-shadow: 0 1px 1px rgba(0,0,0,.35);
  }
  .msg {
    font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
    font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", -apple-system, sans-serif;
    color: #e9edef;
  }
  .msg .mono { font-family: "DejaVu Sans Mono", ui-monospace, Menlo, Consolas, monospace; }
  .meta { text-align: right; font-size: 10.5px; color: #a5c9c0; margin-top: 4px; }
  .tick { color: #53bdeb; margin-left: 4px; }
  .foot { margin-top: 30px; color: #8696a0; font-size: 13px; }
  .foot b { color: #e9edef; }
</style>
</head>
<body>
  <h1>SAQIB-MD <span class="g">Menu Designs</span></h1>
  <p class="sub">10 single-column menu styles — nothing can overlap. Pick one with <b>.menustyle &lt;1-10&gt;</b>.</p>
  <div class="grid">${cards}</div>
  <p class="foot">Default style is <b>1 — Classic</b>. Change anytime with <b>.menustyle &lt;number&gt;</b> (owner only).</p>
</body>
</html>`;

fs.writeFileSync(path.join(dir, 'menu-styles.html'), html);
console.log('Wrote preview/menu-styles.html');
