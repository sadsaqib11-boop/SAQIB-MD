/**
 * SAQI-MD — Bad MAC spam fix.
 *
 * Kya hota hy: purani WhatsApp sessions (jab phone ya doosra device dobara link
 * hota hy) ek hi message ko baar baar decrypt karne ki koshish karti hain. Signal
 * ka ratchet aage barh chuka hota hy, is liye har try "Bad MAC" throw karta hy —
 * aur libsignal har failed try ka POORA stack console par print karta hy
 * (`console.error("Session error:" + e, e.stack)`).
 *
 * Nateeja: 1000+ error lines per hour, log flood, aur disk/CPU waste. Message
 * waise bhi drop hota hy (yeh recovery-able nahi hy), is liye sirf SHOR mein
 * farq parta hy: hum us noisy console.error ko throttle kar dete hain.
 *
 * Yeh script idempotent hy — dobara chalane se kuch kharab nahi hota.
 */
const fs = require('fs');
const path = require('path');

const MARK = '/* SAQI-MD bad-mac throttle */';
const targets = [
  path.join(__dirname, '..', 'node_modules', 'libsignal', 'src', 'session_cipher.js'),
];

let patched = 0;
for (const f of targets) {
  if (!fs.existsSync(f)) { console.log('[patch] skip (missing):', f); continue; }
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes(MARK)) { console.log('[patch] already patched:', f); continue; }

  const before = `        console.error("Failed to decrypt message with any known session...");
        for (const e of errs) {
            console.error("Session error:" + e, e.stack);
        }`;
  const after = `        ${MARK}
        // Sirf pehli 5 dafa poora stack, uske baad ek chhoti count line.
        global.__SAQI_BADMAC__ = (global.__SAQI_BADMAC__ || 0) + 1;
        const __n = global.__SAQI_BADMAC__;
        if (__n <= 5) {
            console.error("Failed to decrypt message with any known session... (Bad MAC #" + __n + ")");
            for (const e of errs) {
                console.error("Session error:" + e, e.message || e);
            }
        } else if (__n % 100 === 0) {
            console.error("[SAQI-MD] Bad MAC x" + __n + " (chup kiya gaya — session purana hy, dobara pair karo)");
        }`;

  if (!s.includes(before)) { console.log('[patch] pattern nahi mila (version alag ho sakta hy):', f); continue; }
  s = s.replace(before, after);
  fs.writeFileSync(f, s);
  console.log('[patch] patched:', f);
  patched++;
}
console.log('[patch] done, patched =', patched);
