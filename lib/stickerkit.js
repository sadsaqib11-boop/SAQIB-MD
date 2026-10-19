/**
 * SAQIB-MD — sticker toolkit (sharp + SVG, no ffmpeg needed)
 *  - textSticker : colourful text sticker (.ttp) / brat style (.brat)
 *  - quoteSticker: chat-bubble quote card (.qc)
 *  - memeSticker : top/bottom meme text on an image (.smeme)
 *  - setExif     : write WhatsApp pack name / author into a webp (.take/.steal)
 */
const sharp = require('sharp');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Greedy word-wrap to roughly `max` characters per line. */
function wrap(text, max) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const chunks = w.length > max ? w.match(new RegExp(`.{1,${max}}`, 'g')) : [w];
    for (const c of chunks) {
      if (!cur) cur = c;
      else if ((cur + ' ' + c).length <= max) cur += ' ' + c;
      else { lines.push(cur); cur = c; }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function toWebp(svgOrBuf) {
  return sharp(Buffer.isBuffer(svgOrBuf) ? svgOrBuf : Buffer.from(svgOrBuf))
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 85 })
    .toBuffer();
}

async function textSticker(text, style = 'ttp') {
  const t = String(text).slice(0, 120);
  const brat = style === 'brat';
  const max = t.length > 60 ? 14 : t.length > 25 ? 10 : 7;
  const lines = wrap(brat ? t.toLowerCase() : t, max).slice(0, 8);
  const size = Math.max(40, Math.min(110, Math.floor(440 / Math.max(lines.length, 1) / 1.15)));
  const startY = 256 - ((lines.length - 1) * size * 1.15) / 2;
  const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de', '#ff2d55'];
  const body = lines.map((l, i) => {
    const y = startY + i * size * 1.15;
    if (brat) {
      return `<text x="40" y="${y}" font-size="${size}" font-family="Arial, Helvetica, sans-serif" fill="#000" dominant-baseline="middle">${esc(l)}</text>`;
    }
    return `<text x="256" y="${y}" font-size="${size}" font-weight="bold" font-family="Arial, Helvetica, sans-serif" fill="${colors[i % colors.length]}" stroke="#000" stroke-width="5" paint-order="stroke" text-anchor="middle" dominant-baseline="middle">${esc(l)}</text>`;
  }).join('');
  const bg = brat ? '<rect width="512" height="512" fill="#8ace00"/>' : '';
  const filter = brat ? '<defs><filter id="b"><feGaussianBlur stdDeviation="1.3"/></filter></defs>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${filter}${bg}<g${brat ? ' filter="url(#b)"' : ''}>${body}</g></svg>`;
  return toWebp(svg);
}

async function quoteSticker(name, text) {
  const lines = wrap(String(text).slice(0, 300), 24).slice(0, 10);
  const lh = 34;
  const h = Math.min(500, 90 + lines.length * lh);
  const y0 = (512 - h) / 2;
  const body = lines.map((l, i) => `<text x="40" y="${y0 + 82 + i * lh}" font-size="28" font-family="Arial, Helvetica, sans-serif" fill="#e9edef">${esc(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect x="16" y="${y0}" width="480" height="${h}" rx="28" fill="#202c33"/>
    <text x="40" y="${y0 + 42}" font-size="26" font-weight="bold" font-family="Arial, Helvetica, sans-serif" fill="#53bdeb">${esc(String(name).slice(0, 26))}</text>
    ${body}
  </svg>`;
  return toWebp(svg);
}

async function memeSticker(imageBuf, top, bottom) {
  const base = await sharp(imageBuf).resize(512, 512, { fit: 'cover' }).png().toBuffer();
  const line = (txt, atTop) => {
    if (!txt) return '';
    const ls = wrap(String(txt).toUpperCase().slice(0, 80), 16).slice(0, 3);
    return ls.map((l, i) => {
      const y = atTop ? 60 + i * 56 : 470 - (ls.length - 1 - i) * 56;
      return `<text x="256" y="${y}" font-size="50" font-weight="bold" font-family="Impact, Arial Black, sans-serif" fill="#fff" stroke="#000" stroke-width="6" paint-order="stroke" text-anchor="middle">${esc(l)}</text>`;
    }).join('');
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${line(top, true)}${line(bottom, false)}</svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg) }]).webp({ quality: 85 }).toBuffer();
}

/** WhatsApp sticker metadata EXIF (tag 0x5741 holds the pack JSON). */
function buildExif(pack, author) {
  const json = Buffer.from(JSON.stringify({
    'sticker-pack-id': `saqib-md-${Date.now()}`,
    'sticker-pack-name': String(pack || ''),
    'sticker-pack-publisher': String(author || ''),
    emojis: [''],
  }), 'utf8');
  const head = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
  const exif = Buffer.concat([head, json]);
  exif.writeUInt32LE(json.length, 14);
  return exif;
}

function chunk(fourcc, data) {
  const h = Buffer.alloc(8);
  h.write(fourcc, 0, 'ascii');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat(data.length % 2 ? [h, data, Buffer.alloc(1)] : [h, data]);
}

/** Inject/replace the EXIF chunk of a webp so WhatsApp shows our pack/author. */
async function setExif(webp, pack, author) {
  if (webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') {
    webp = await sharp(webp, { animated: true }).webp().toBuffer();
  }
  const chunks = [];
  for (let o = 12; o + 8 <= webp.length;) {
    const id = webp.toString('ascii', o, o + 4);
    const size = webp.readUInt32LE(o + 4);
    chunks.push({ id, data: webp.subarray(o + 8, o + 8 + size) });
    o += 8 + size + (size % 2);
  }
  const kept = chunks.filter((c) => c.id !== 'EXIF');
  let vp8x = kept.find((c) => c.id === 'VP8X');
  if (vp8x) {
    vp8x.data = Buffer.from(vp8x.data);
    vp8x.data[0] |= 0x08;
  } else {
    const meta = await sharp(webp).metadata();
    const d = Buffer.alloc(10);
    const alpha = kept.some((c) => c.id === 'ALPH' || c.id === 'VP8L');
    d[0] = 0x08 | (alpha ? 0x10 : 0);
    d.writeUIntLE((meta.width || 512) - 1, 4, 3);
    d.writeUIntLE((meta.height || 512) - 1, 7, 3);
    vp8x = { id: 'VP8X', data: d };
    kept.unshift(vp8x);
  }
  const body = Buffer.concat([...kept.map((c) => chunk(c.id, c.data)), chunk('EXIF', buildExif(pack, author))]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'ascii');
  return Buffer.concat([head, body]);
}

module.exports = { textSticker, quoteSticker, memeSticker, setExif, wrap };
