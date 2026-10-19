/**
 * Z-MEDIA — new downloaders, sticker tools and music tools
 * Loaded last (file name starts with "z") so it never overrides an older command.
 */
const config = require('../config');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { getJSON, downloadMedia } = require('../lib/helpers');
const yt = require('../lib/ytdlp');
const kit = require('../lib/stickerkit');

const P = () => config.PREFIX;
const tmp = (ext) => path.join(os.tmpdir(), `saqibz_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
const ff = (args) => new Promise((res, rej) => execFile('ffmpeg', args, { timeout: 120000, maxBuffer: 1024 * 1024 * 50 }, (e, so, se) => (e ? rej(new Error(String(se || e.message).slice(-200))) : res())));
const rm = (...files) => files.forEach((f) => { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ } });
const unwrap = (qm) => qm?.viewOnceMessage?.message || qm?.viewOnceMessageV2?.message || qm?.viewOnceMessageV2Extension?.message || qm?.ephemeralMessage?.message || qm;
const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());

const TYPE_KEY = { image: 'imageMessage', video: 'videoMessage', audio: 'audioMessage', sticker: 'stickerMessage', document: 'documentMessage' };

/** Find media of the wanted kinds in the message itself or the replied-to message. */
async function getMedia(ctx, kinds) {
  for (const src of [unwrap(ctx.m.message), unwrap(ctx.quoted?.message)]) {
    if (!src) continue;
    for (const k of kinds) {
      const node = src[TYPE_KEY[k]];
      if (node) return { kind: k, node, buf: await downloadMedia(node, k) };
    }
  }
  return null;
}

const fileOf = (r) => (typeof r === 'string' ? r : (r && (r.file || r.path)));

async function sendFileThenClean(ctx, file, kind, caption) {
  try {
    const buf = fs.readFileSync(file);
    if (kind === 'audio') await ctx.send(ctx.from, { audio: buf, mimetype: 'audio/mpeg' }, { quoted: ctx.m });
    else await ctx.send(ctx.from, { video: buf, caption, mimetype: 'video/mp4' }, { quoted: ctx.m });
  } finally { rm(file); }
}

async function urlDownloader(ctx, label, hostRe, kind = 'video') {
  const url = ctx.arg.trim();
  if (!isUrl(url) || (hostRe && !hostRe.test(url))) return ctx.reply(`❌ ${label} ka link do.\nExample: ${P()}${ctx.command} <link>`);
  if (!yt.available()) return ctx.reply('❌ Downloader engine (yt-dlp) is server par install nahi hai.');
  await ctx.react('⏳').catch(() => {});
  try {
    const file = kind === 'audio' ? await yt.downloadAudioByUrl(url) : await yt.downloadVideoByUrl(url, { maxHeight: 720 });
    await sendFileThenClean(ctx, fileOf(file), kind, `📥 *${label}*\n_${config.BOT_NAME}_`);
    await ctx.react('✅').catch(() => {});
  } catch {
    await ctx.react('❌').catch(() => {});
    return ctx.reply(`❌ ${label} se download nahi ho saka. Link public hai? Thori der baad try karo.`);
  }
}

async function audioFx(ctx, filter, label) {
  const med = await getMedia(ctx, ['audio', 'video']);
  if (!med) return ctx.reply(`❌ Kisi audio/voice note par reply karke ${P()}${ctx.command} likho.`);
  const inp = tmp(med.kind === 'video' ? 'mp4' : 'ogg');
  const out = tmp('mp3');
  fs.writeFileSync(inp, med.buf);
  try {
    await ff(['-y', '-i', inp, '-af', filter, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', out]);
    await ctx.send(ctx.from, { audio: fs.readFileSync(out), mimetype: 'audio/mpeg' }, { quoted: ctx.m });
  } catch (e) {
    return ctx.reply(`❌ ${label} effect nahi laga: ${e.message.slice(0, 80)}`);
  } finally { rm(inp, out); }
}

async function recognise(ctx) {
  const med = await getMedia(ctx, ['audio', 'video']);
  if (!med) return ctx.reply(`❌ Kisi gaane ke audio/video par reply karke ${P()}${ctx.command} likho.`);
  await ctx.react('🎧').catch(() => {});
  let sample = med.buf;
  const inp = tmp(med.kind === 'video' ? 'mp4' : 'ogg');
  const out = tmp('mp3');
  try {
    fs.writeFileSync(inp, med.buf);
    await ff(['-y', '-i', inp, '-t', '20', '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '5', out]);
    sample = fs.readFileSync(out);
  } catch { /* send the raw clip if ffmpeg is unavailable */ } finally { rm(inp, out); }
  try {
    const form = new FormData();
    if (process.env.AUDD_API_TOKEN) form.append('api_token', process.env.AUDD_API_TOKEN);
    form.append('return', 'spotify');
    form.append('file', new Blob([sample]), 'sample.mp3');
    const r = await fetch('https://api.audd.io/', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    const d = await r.json();
    const s = d?.result;
    if (!s) {
      const why = d?.error?.error_message ? `\n_${d.error.error_message}_` : '';
      return ctx.reply(`❓ Gaana pehchana nahi gaya. Saaf aur 10-20 second ka clip bhejo.${why}`);
    }
    const link = s.spotify?.external_urls?.spotify || s.song_link || '';
    return ctx.reply(`🎵 *Gaana mil gaya!*\n\n🎤 *${s.title}*\n👤 ${s.artist}\n💿 ${s.album || '-'}\n📅 ${s.release_date || '-'}${link ? `\n🔗 ${link}` : ''}\n\n_Download: ${P()}play ${s.artist} ${s.title}_`);
  } catch {
    return ctx.reply('❌ Music recognition service abhi busy hai. Thori der baad try karo.');
  }
}

const stickerMeta = (ctx) => [config.STICKER_NAME || config.BOT_NAME, ctx.pushname];

const handler = async (ctx) => {
  const { command, reply, arg } = ctx;
  switch (command) {
    /* ------------------------- downloaders ------------------------- */
    case 'spotify': {
      if (!arg) return reply(`❌ Spotify link ya gaane ka naam do.\nExample: ${P()}spotify Kahani Suno`);
      let query = arg;
      if (/open\.spotify\.com/i.test(arg)) {
        try {
          const o = await getJSON(`https://open.spotify.com/oembed?url=${encodeURIComponent(arg.trim())}`);
          query = o.title || arg;
        } catch { return reply('❌ Spotify link se gaane ka naam nahi mila. Naam likh kar try karo.'); }
      }
      if (!yt.available()) return reply('❌ Downloader engine (yt-dlp) is server par install nahi hai.');
      await ctx.react('⏳').catch(() => {});
      try {
        const file = fileOf(await yt.downloadAudioSmart(query));
        await ctx.send(ctx.from, { audio: fs.readFileSync(file), mimetype: 'audio/mpeg', fileName: `${query}.mp3` }, { quoted: ctx.m });
        return ctx.react('✅').catch(() => {});
      } catch {
        return reply(`❌ "${query}" download nahi ho saka.`);
      }
    }
    case 'soundcloud': return urlDownloader(ctx, 'SoundCloud', /soundcloud\.com|on\.soundcloud/i, 'audio');
    case 'threadsdl': return urlDownloader(ctx, 'Threads', /threads\.(net|com)/i);
    case 'snapchat': return urlDownloader(ctx, 'Snapchat', /snapchat\.com/i);
    case 'likee': return urlDownloader(ctx, 'Likee', /likee\.(video|com)|l\.likee/i);
    case 'capcutdl': return urlDownloader(ctx, 'CapCut', /capcut\.(com|net)/i);
    case 'pinterestdl': return urlDownloader(ctx, 'Pinterest', /pinterest\.|pin\.it/i);

    case 'lyrics': {
      if (!arg) return reply(`❌ Gaane ka naam do.\nExample: ${P()}lyrics tum hi ho`);
      try {
        const list = await getJSON(`https://lrclib.net/api/search?q=${encodeURIComponent(arg)}`);
        const hit = (list || []).find((x) => x.plainLyrics) || null;
        if (!hit) return reply(`❌ "${arg}" ke lyrics nahi mile.`);
        const body = hit.plainLyrics.length > 3500 ? `${hit.plainLyrics.slice(0, 3500)}\n…` : hit.plainLyrics;
        return reply(`🎼 *${hit.trackName}*\n👤 ${hit.artistName}\n\n${body}`);
      } catch { return reply('❌ Lyrics service abhi busy hai.'); }
    }
    case 'wallpaper': {
      if (!arg) return reply(`❌ Kya wallpaper chahiye?\nExample: ${P()}wallpaper mountains`);
      try {
        const d = await getJSON(`https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(arg)}&purity=100&categories=111&sorting=relevance`);
        const list = (d.data || []).slice(0, 10);
        if (!list.length) return reply(`❌ "${arg}" ka wallpaper nahi mila.`);
        const w = list[Math.floor(Math.random() * list.length)];
        return ctx.send(ctx.from, { image: { url: w.path }, caption: `🖼️ *${arg}*\n📐 ${w.resolution}\n_${config.BOT_NAME}_` }, { quoted: ctx.m });
      } catch { return reply('❌ Wallpaper service abhi busy hai.'); }
    }
    case 'podcast': {
      if (!arg) return reply(`❌ Podcast ka naam/topic do.\nExample: ${P()}podcast tech`);
      try {
        const d = await getJSON(`https://itunes.apple.com/search?media=podcast&limit=6&term=${encodeURIComponent(arg)}`);
        const r = d.results || [];
        if (!r.length) return reply(`❌ "${arg}" ka koi podcast nahi mila.`);
        return reply(`🎙️ *Podcasts: ${arg}*\n\n${r.map((p, i) => `*${i + 1}. ${p.collectionName}*\n👤 ${p.artistName}\n🏷️ ${p.primaryGenreName} • ${p.trackCount || '?'} episodes\n🔗 ${p.collectionViewUrl}`).join('\n\n')}`);
      } catch { return reply('❌ Podcast search abhi busy hai.'); }
    }

    /* ------------------------- stickers ------------------------- */
    case 'take':
    case 'steal': {
      const med = await getMedia(ctx, ['sticker']);
      if (!med) return reply(`❌ Kisi sticker par reply karo.\nExample: ${P()}${command} MyPack|MyName`);
      const [pack, author] = (arg || `${ctx.pushname}|${config.BOT_NAME}`).split('|').map((s) => s.trim());
      try {
        const out = await kit.setExif(med.buf, pack || ctx.pushname, author || config.BOT_NAME);
        return ctx.sendSticker(out, !!med.node.isAnimated);
      } catch { return reply('❌ Sticker ka pack name change nahi ho saka.'); }
    }
    case 'smeme': {
      const med = await getMedia(ctx, ['image', 'sticker']);
      if (!med || !arg) return reply(`❌ Image/sticker par reply karke text do.\nExample: ${P()}smeme upar wala|neeche wala`);
      const [top, bottom] = arg.split('|').map((s) => s.trim());
      try {
        const out = await kit.memeSticker(med.buf, top, bottom);
        return ctx.sendSticker(await kit.setExif(out, ...stickerMeta(ctx)));
      } catch { return reply('❌ Meme sticker nahi ban saka.'); }
    }
    case 'qc': {
      const q = unwrap(ctx.quoted?.message);
      const qText = q ? (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || '') : '';
      const text = arg || qText;
      if (!text) return reply(`❌ Kisi message par reply karo ya text do.\nExample: ${P()}qc hello duniya`);
      const who = q && !arg ? `+${String(ctx.quoted.key.participant || ctx.from).split('@')[0].split(':')[0]}` : ctx.pushname;
      try {
        const out = await kit.quoteSticker(who, text);
        return ctx.sendSticker(await kit.setExif(out, ...stickerMeta(ctx)));
      } catch { return reply('❌ Quote sticker nahi ban saka.'); }
    }
    case 'ttp':
    case 'brat': {
      if (!arg) return reply(`❌ Text do.\nExample: ${P()}${command} hello`);
      try {
        const out = await kit.textSticker(arg, command);
        return ctx.sendSticker(await kit.setExif(out, ...stickerMeta(ctx)));
      } catch { return reply('❌ Text sticker nahi ban saka.'); }
    }

    /* ------------------------- media convert ------------------------- */
    case 'tovn': {
      const med = await getMedia(ctx, ['audio', 'video']);
      if (!med) return reply(`❌ Kisi audio/video par reply karke ${P()}tovn likho.`);
      const inp = tmp(med.kind === 'video' ? 'mp4' : 'mp3');
      const out = tmp('ogg');
      fs.writeFileSync(inp, med.buf);
      try {
        await ff(['-y', '-i', inp, '-vn', '-ac', '1', '-c:a', 'libopus', '-b:a', '64k', out]);
        return await ctx.send(ctx.from, { audio: fs.readFileSync(out), mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: ctx.m });
      } catch (e) { return reply(`❌ Voice note nahi ban saka: ${e.message.slice(0, 80)}`); } finally { rm(inp, out); }
    }
    case 'togif': {
      const med = await getMedia(ctx, ['video', 'sticker']);
      if (!med) return reply(`❌ Kisi video ya animated sticker par reply karke ${P()}togif likho.`);
      if (med.kind === 'video') {
        return ctx.send(ctx.from, { video: med.buf, gifPlayback: true, caption: `🎞️ _${config.BOT_NAME}_` }, { quoted: ctx.m });
      }
      const inp = tmp('webp');
      const out = tmp('mp4');
      fs.writeFileSync(inp, med.buf);
      try {
        await ff(['-y', '-i', inp, '-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', out]);
        return await ctx.send(ctx.from, { video: fs.readFileSync(out), gifPlayback: true }, { quoted: ctx.m });
      } catch { return reply('❌ GIF nahi ban saka (sirf animated sticker/video chalta hai).'); } finally { rm(inp, out); }
    }
    case 'toanime': {
      const med = await getMedia(ctx, ['image']);
      if (!med) return reply(`❌ Kisi photo par reply karke ${P()}toanime likho.`);
      await ctx.react('🎨').catch(() => {});
      try {
        const sharp = require('sharp');
        const out = await sharp(med.buf)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .median(5)
          .modulate({ saturation: 1.6, brightness: 1.05 })
          .linear(1.15, -10)
          .sharpen({ sigma: 1.4, m1: 1.5, m2: 3 })
          .jpeg({ quality: 90 })
          .toBuffer();
        return ctx.send(ctx.from, { image: out, caption: `🎌 *Anime style*\n_${config.BOT_NAME}_` }, { quoted: ctx.m });
      } catch { return reply('❌ Anime effect nahi laga.'); }
    }
    case 'removewm': {
      const med = await getMedia(ctx, ['image']);
      if (!med) return reply(`❌ Photo par reply karo.\nExample: ${P()}removewm bottom 10\n_(side: top/bottom/left/right, % kitna kaatna hai)_`);
      const [sideRaw, pctRaw] = (arg || 'bottom 8').toLowerCase().split(/\s+/);
      const side = ['top', 'bottom', 'left', 'right'].includes(sideRaw) ? sideRaw : 'bottom';
      const pct = Math.min(30, Math.max(2, Number(pctRaw) || 8)) / 100;
      try {
        const sharp = require('sharp');
        const { width, height } = await sharp(med.buf).metadata();
        const vertical = side === 'top' || side === 'bottom';
        const cut = Math.round((vertical ? height : width) * pct);
        const region = {
          left: side === 'left' ? cut : 0,
          top: side === 'top' ? cut : 0,
          width: vertical ? width : width - cut,
          height: vertical ? height - cut : height,
        };
        const out = await sharp(med.buf).extract(region).jpeg({ quality: 92 }).toBuffer();
        return ctx.send(ctx.from, { image: out, caption: `✂️ ${side} se ${Math.round(pct * 100)}% hata diya (watermark wala hissa).` }, { quoted: ctx.m });
      } catch { return reply('❌ Image process nahi ho saki.'); }
    }

    /* ------------------------- music ------------------------- */
    case 'shazam':
    case 'whatmusic':
      return recognise(ctx);
    case 'songinfo': {
      if (!arg) return reply(`❌ Gaane ka naam do.\nExample: ${P()}songinfo blinding lights`);
      try {
        const d = await getJSON(`https://itunes.apple.com/search?media=music&entity=song&limit=1&term=${encodeURIComponent(arg)}`);
        const s = d.results?.[0];
        if (!s) return reply(`❌ "${arg}" nahi mila.`);
        const ms = s.trackTimeMillis || 0;
        const mins = ms ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : '-';
        const caption = `🎵 *${s.trackName}*\n👤 ${s.artistName}\n💿 ${s.collectionName || '-'}\n🏷️ ${s.primaryGenreName || '-'}\n⏱️ ${mins}\n📅 ${(s.releaseDate || '').slice(0, 10) || '-'}\n🔗 ${s.trackViewUrl || '-'}`;
        const art = s.artworkUrl100 ? s.artworkUrl100.replace('100x100', '600x600') : null;
        if (art) return ctx.send(ctx.from, { image: { url: art }, caption }, { quoted: ctx.m });
        return reply(caption);
      } catch { return reply('❌ Song info service abhi busy hai.'); }
    }
    case 'reverbaudio': return audioFx(ctx, 'aecho=0.8:0.88:60|120:0.4|0.3', 'Reverb');
    case 'bass2': return audioFx(ctx, 'bass=g=18:f=110:w=0.6,volume=1.2', 'Bass');
    default:
      return reply('❓ Unknown media command');
  }
};

module.exports = {
  commands: [
    'spotify', 'soundcloud', 'threadsdl', 'snapchat', 'likee', 'capcutdl', 'pinterestdl', 'lyrics', 'wallpaper', 'podcast',
    'take', 'steal', 'smeme', 'qc', 'ttp', 'brat', 'tovn', 'togif', 'toanime', 'removewm',
    'shazam', 'whatmusic', 'songinfo', 'reverbaudio', 'bass2',
  ],
  category: '🎬 MEDIA PLUS',
  handler,
};
