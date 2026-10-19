/**
 * OWNER — owner-only commands
 *
 * .vv2/.vv3  -> unlock view-once media and send it to the bot's OWN chat
 *               ("Message yourself" / inbox). The *command* message then
 *               auto-deletes after ~1.5s; the unlocked media stays. Silent.
 *               (The PUBLIC `.vv` that reveals media in the current chat lives
 *               in `viewonce.js`.)
 * .ban / .unban / .banlist -> block + ignore a user's number.
 */
const config = require('../config');
const fs = require('fs');
const { downloadMedia, cleanNumber } = require('../lib/helpers');
const bans = require('../lib/bans');

/** Unwrap view-once wrappers into the inner media message.
 * RECURSIVE on purpose: WhatsApp sometimes nests view-once inside
 * ephemeralMessage (disappearing-mode chats) or wraps the wrappers — a single
 * level of unwrap misses those and .vv2 then says "not view-once". Same
 * recursive unwrap the public .vv uses. */
function unwrapViewOnce(qm) {
  let m = qm;
  for (let i = 0; m && i < 6; i++) {
    const next =
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.ephemeralMessage?.message ||
      null;
    if (!next) break;
    m = next;
  }
  return m || qm || null;
}

const handler = async (ctx) => {
const appeals = require('../lib/appeals');
  const { sock, command, reply, quoted } = ctx;

  switch (command) {
    case 'vv2': case 'vv3': {
      // RULE from the user: the chat where the view-once arrived must stay
      // COMPLETELY silent — no success text, no error text. Every complaint
      // goes to the bot's OWN inbox instead, and the command message ALWAYS
      // deletes itself — success or fail.
      let selfNum0 = cleanNumber(String(ctx.session?.number || '').split(':')[0].split('@')[0]);
      if (!selfNum0) {
        const uid0 = String(sock.user?.id || '');
        if (uid0 && !uid0.endsWith('@lid')) selfNum0 = cleanNumber(uid0.split(':')[0].split('@')[0]);
      }
      const selfJid0 = selfNum0 ? `${selfNum0}@s.whatsapp.net` : ctx.from;
      const selfError = async (txt) => {
        try { await ctx.send(selfJid0, { text: txt }, {}); } catch { /* never surface an error in the source chat */ }
      };
      // Command self-destruct: delete the .vv2/.vv3 message from the source chat.
      const deleteCmd = async () => {
        const k0 = ctx.m?.key;
        if (!k0) return;
        const delKey0 = { remoteJid: k0.remoteJid || ctx.from, id: k0.id, fromMe: true, participant: k0.participant };
        try { await sock.sendMessage(ctx.from, { delete: delKey0 }); } catch { /* ignore */ }
      };
      if (!quoted) { await deleteCmd(); return selfError('❌ Kisi *view-once* photo/video pe .vv2 ka reply karo.'); }
      const qm = unwrapViewOnce(quoted.message);
      const type = qm.imageMessage ? 'image' : qm.videoMessage ? 'video' : qm.audioMessage ? 'audio' : null;
      if (!type) { await deleteCmd(); return selfError('❌ Yeh view-once media nahi lagta (photo/video pe reply karo).'); }
      const msg = qm.imageMessage || qm.videoMessage || qm.audioMessage;
      let buf;
      try { buf = await downloadMedia(msg, type); }
      catch (e) { await deleteCmd(); return selfError('❌ View-once download nahi ho saka (expire ho gaya?): ' + String(e.message || e).slice(0, 80)); }
      const cap = `🔓 *View-once unlocked*\n👑 ${config.BOT_NAME}`;
      // .vv2 / .vv3 -> send to the bot's OWN chat ("Message yourself" / inbox).
      const toSelf = true;
      // Resolve the bot's OWN number. Prefer the session number (always a real
      // MSISDN); fall back to sock.user.id, but ignore it when it is a LID
      // (a LID is not a phone number and would send to a bogus chat).
      let selfNum = cleanNumber(String(ctx.session?.number || '').split(':')[0].split('@')[0]);
      if (!selfNum) {
        const uid = String(sock.user?.id || '');
        if (uid && !uid.endsWith('@lid')) selfNum = cleanNumber(uid.split(':')[0].split('@')[0]);
      }
      const selfJid = selfNum ? `${selfNum}@s.whatsapp.net` : ctx.from;
      const target = toSelf ? selfJid : ctx.from;
      const opts = toSelf ? {} : { quoted: ctx.m };

      let sent;
      if (type === 'image') sent = await ctx.send(target, { image: buf, caption: cap }, opts);
      else if (type === 'video') sent = await ctx.send(target, { video: buf, caption: cap }, opts);
      else sent = await ctx.send(target, { audio: buf, mimetype: 'audio/mpeg' }, opts);

      if (toSelf) {
        // The USER asked for this: the moment the unlocked media lands in the
        // inbox, the command message deletes IMMEDIATELY — no 1.5s delay.
        await deleteCmd();
      }
      break;
    }
    case 'forward': {
      if (!quoted) return reply('❌ Reply to a message.');
      if (!ctx.arg) return reply(`❌ Give a number. Example: ${config.PREFIX}forward 923xxxxxxxxxx`);
      const jid = cleanNumber(ctx.arg) + '@s.whatsapp.net';
      await sock.copyNForward(jid, quoted.message, true);
      await reply(`✅ Forwarded to +${jid.split('@')[0]}`);
      break;
    }
    case 'block': case 'unblock': {
      const num = cleanNumber(quoted ? (quoted.key.participant || quoted.key.remoteJid) : ctx.arg);
      if (!num) return reply('❌ Give a number or reply to a message.');
      await sock.updateBlockStatus(num + '@s.whatsapp.net', command === 'block' ? 'block' : 'unblock');
      await reply(`${command === 'block' ? '🚫' : '✅'} +${num} ${command}ed.`);
      break;
    }
    case 'ban': {
      const num = cleanNumber(quoted ? (quoted.key.participant || quoted.key.remoteJid) : ctx.arg);
      if (!num) return reply('❌ Give a number or reply to a message.');
      bans.add(num);
      await sock.updateBlockStatus(num + '@s.whatsapp.net', 'block').catch(() => {});
      await reply(`🚫 +${num} has been *BANNED* (blocked + ignored).`);
      break;
    }
    // ---- .unban -----------------------------------------------------------
    // Two different jobs share this command, because users ask for both:
    //   .unban <number>            -> lift OUR ban (block + ignore) on a user
    //   .unban <platform> appeal   -> that platform's OWN appeal route
    // The second one exists because "unban me from Instagram/WhatsApp" is a
    // completely different thing from our bot's ban list, and each platform
    // has its own address. No API, all static text.
    case 'unban': {
      const a = String(ctx.arg || '').trim();
      // .unban whatsapp appeal   /   .unban appeal instagram
      const words = a.toLowerCase().split(/\s+/).filter(Boolean);
      const wantsAppeal = words.includes('appeal') || words.includes('unblock') || words.includes('help');
      if (wantsAppeal) {
        const platform = words.filter((w) => w !== 'appeal' && w !== 'unblock' && w !== 'help').join(' ');
        const info = appeals.lookup(platform);
        if (!info) {
          return reply(
            `📬 *Ban Appeal*\n\nWhich platform? Example:\n` +
            `${config.PREFIX}unban whatsapp appeal\n${config.PREFIX}unban instagram appeal\n\n` +
            `_Available:_ ${appeals.listAll()}`
          );
        }
        return reply(appeals.render(info));
      }
      const num = cleanNumber(quoted ? (quoted.key.participant || quoted.key.remoteJid) : ctx.arg);
      if (!num) {
        return reply(
          `ℹ️ *How to unban*\n\n` +
          `▸ *${config.PREFIX}unban <number>* — lift this bot's ban\n` +
          `▸ *${config.PREFIX}unban <platform> appeal* — that app's own appeal route\n\n` +
          `_Platforms:_ ${appeals.listAll()}`
        );
      }
      bans.remove(num);
      await sock.updateBlockStatus(num + '@s.whatsapp.net', 'unblock').catch(() => {});
      await reply(`✅ +${cleanNumber(num) || num} has been *UNBANNED*.`);
      break;
    }
    case 'banlist': {
      const l = bans.all();
      await reply(`🚫 *Banlist (${l.length}):*\n\n${l.map((n) => `• +${n}`).join('\n') || '(empty)'}`);
      break;
    }
    case 'delete': {
      if (!quoted) return reply('❌ Reply to a message.');
      await sock.sendMessage(ctx.from, { delete: quoted.key });
      break;
    }
    case 'leave': {
      await reply('👋 Leaving the group... Goodbye!');
      setTimeout(() => {
        try { Promise.resolve(sock.groupLeave(ctx.from)).catch(() => {}); } catch { /* ignore */ }
      }, 1500);
      break;
    }
    case 'fullpp': case 'setpp': {
      const img = quoted?.message?.imageMessage || ctx.m.message.imageMessage;
      if (!img) return reply('❌ Reply to a photo, or send a photo with .setpp in the caption.');
      const raw = await downloadMedia(img, 'image');
      // FULL PICTURE, NO CROP: WhatsApp center-crops a raw DP. We pad the photo
      // onto a 640x640 square canvas — a blurred zoom of the same photo fills
      // the background, the WHOLE photo sits centered on top — so every pixel
      // survives the DP circle.
      const { execFile } = require('child_process');
      const ffmpeg = (args) => new Promise((res, rej) => execFile('ffmpeg', ['-y', ...args], { timeout: 60000 }, (e, so, se) => (e ? rej(new Error((se || e.message).slice(0, 150))) : res())));
      const out = raw + '_sq.jpg';
      let padded = false;
      try {
        await ffmpeg(['-i', raw, '-filter_complex',
          '[0:v]scale=640:640:force_original_aspect_ratio=increase,crop=640:640,boxblur=24:6[bg];[0:v]scale=640:640:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2',
          '-frames:v', '1', '-q:v', '3', out]);
        padded = fs.existsSync(out);
      } catch { /* no ffmpeg — fall back to the raw photo */ }
      try {
        await sock.updateProfilePicture(sock.user.id, padded ? out : raw);
        await reply(padded
          ? '✅ Profile picture updated — *poori picture, no crop* 🖼️'
          : '✅ Profile picture updated.');
      } finally {
        for (const f of [raw, out]) { try { fs.existsSync(f) && fs.unlinkSync(f); } catch { /* ignore */ } }
      }
      break;
    }
    case 'status': case 'status2': {
      const img = quoted?.message?.imageMessage || ctx.m.message.imageMessage;
      const vid = quoted?.message?.videoMessage || ctx.m.message.videoMessage;
      if (img || vid) {
        const buf = await downloadMedia(img || vid, img ? 'image' : 'video');
        await sock.sendMessage('status@broadcast', img ? { image: buf, caption: ctx.arg || '' } : { video: buf, caption: ctx.arg || '' });
        await reply('✅ Status posted.');
      } else if (ctx.arg) {
        await sock.sendMessage('status@broadcast', { text: ctx.arg });
        await reply('✅ Text status posted.');
      } else reply('❌ Write some text, or reply to media.');
      break;
    }
    case 'getbio': {
      const num = cleanNumber(quoted ? (quoted.key.participant || quoted.key.remoteJid) : (ctx.arg || sock.user.id.split(':')[0]));
      try {
        const s = await sock.fetchStatus(num + '@s.whatsapp.net');
        await reply(`📝 *Bio (+${num}):*\n${s[0]?.status || s?.status || '-'}`);
      } catch { await reply('❌ Could not fetch the bio.'); }
      break;
    }
    case 'updatebio':
      if (!ctx.arg) return reply('❌ Write the new bio.');
      await sock.updateProfileStatus(ctx.arg);
      await reply('✅ Bio updated.');
      break;
    case 'setname':
      if (!ctx.arg) return reply('❌ Give the new name.');
      await sock.updateProfileName(ctx.arg);
      await reply('✅ Name updated.');
      break;
    case 'pair': {
      const num = cleanNumber(ctx.arg);
      if (!num) return reply(`❌ Give a number. Example: ${config.PREFIX}pair 923xxxxxxxxxx`);
      try {
        // Use the session manager so this links a NEW number (not the current sock).
        const bot = require('../lib/bot');
        await reply('⏳ Generating the code, 2-3 seconds...');
        const code = await bot.requestPair(num);
        // Send the code ALONE so it can be copied with one tap — no label, no
        // extra text wrapped around it, and never inside a code block (some
        // clients make backtick-wrapped text hard to long-press).
        await ctx.send(ctx.from, { text: code }, { quoted: ctx.m });
        await ctx.send(ctx.from, {
          text: '📱 Enter this code in WhatsApp:\n*Linked Devices → Link with phone number*\n\n_The code expires in 45 seconds._',
        });
      } catch (e) { await reply('❌ ' + (e?.message || e)); }
      break;
    }
    case 'broadcast': {
      if (!ctx.arg) return reply(`❌ Give a message. Example: ${config.PREFIX}broadcast Hello everyone!`);
      const groups = await sock.groupFetchAllParticipating();
      const jids = Object.keys(groups);
      await reply(`📢 Broadcasting to ${jids.length} groups...`);
      let n = 0;
      for (const jid of jids) {
        try {
          await sock.sendMessage(jid, { text: `📢 *${config.BOT_NAME} Broadcast*\n\n${ctx.arg}` });
          n++;
        } catch { /* skip unreachable */ }
        // small delay so we don't get rate-limited / flagged as spam
        await new Promise((r) => setTimeout(r, 1200));
      }
      await reply(`✅ Broadcast sent to ${n}/${jids.length} groups.`);
      break;
    }
    case 'blocklist': {
      const bl = await sock.fetchBlocklist();
      await reply(`🚫 *Blocklist (${bl.length}):*\n\n${bl.map((j) => `• +${j.split('@')[0]}`).join('\n') || '(empty)'}`);
      break;
    }
    case 'restart': {
      await reply('🔄 Restarting the bot...');
      setTimeout(() => process.exit(0), 1500);
      break;
    }
    default: await reply('❓ Unknown owner command');
  }
};

module.exports = {
  commands: ['vv2', 'vv3', 'forward', 'block', 'unblock', 'ban', 'unban', 'banlist', 'delete', 'leave', 'fullpp', 'setpp', 'status', 'status2', 'getbio', 'updatebio', 'setname', 'pair', 'broadcast', 'blocklist', 'restart'],
  category: '👑 OWNER',
  ownerOnly: true,
  handler,
  unwrapViewOnce,
};
