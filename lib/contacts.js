/**
 * SAQIB-MD — LID ⇄ phone-number resolver
 * ---------------------------------------
 * WhatsApp now delivers many senders/participants as *LIDs* (Linked IDs) — long
 * numeric identifiers like `212223345675336@lid`. If a command mentions a LID,
 * it looks like a fake phone number (the exact bug the user reported: mentions
 * showing things like `+212223345675336`).
 *
 * This module learns the mapping between a LID and the real phone number (PN)
 * from every message key and every group-metadata fetch, then lets the rest of
 * the bot resolve a JID to a real number before mentioning it.
 *
 * It is best-effort: if a LID has never been seen paired with a PN we return the
 * original JID unchanged (never invent a number).
 */
const lidToPn = new Map(); // "212223345675336" -> "923001234567"
const pnToLid = new Map(); // "923001234567"     -> "212223345675336"

const bare = (jid) => String(jid || '').split('@')[0].split(':')[0];

/** Pull LID/PN pairs out of a message key and remember them. */
function learnFromMessage(m) {
  try {
    const k = m?.key || {};
    const fields = [
      k.participant, k.participantPn, k.participantAlt,
      k.senderPn, k.senderLid,
      k.remoteJid, k.remoteJidAlt, k.remoteJidPn,
    ];
    const lids = new Set();
    const pns = new Set();
    for (const f of fields) {
      if (typeof f !== 'string') continue;
      if (f.endsWith('@lid')) lids.add(bare(f));
      else if (f.endsWith('@s.whatsapp.net')) pns.add(bare(f));
    }
    // Best-effort pairing: a single LID alongside a single PN in the same key
    // almost always refers to the same person (the message author).
    if (lids.size === 1 && pns.size === 1) {
      const l = [...lids][0];
      const p = [...pns][0];
      if (/^[0-9]{5,20}$/.test(l) && /^[0-9]{5,20}$/.test(p)) {
        lidToPn.set(l, p);
        pnToLid.set(p, l);
      }
    }
  } catch { /* ignore */ }
}

/** Learn LID/PN pairs from a group-metadata response. */
function learnFromGroupMeta(meta) {
  try {
    for (const p of meta?.participants || []) {
      const id = p?.id || '';
      const lid = p?.lid || p?.lidJid || '';
      if (id.endsWith('@s.whatsapp.net') && lid) {
        const pn = bare(id);
        const l = bare(lid);
        if (pn && l) { lidToPn.set(l, pn); pnToLid.set(pn, l); }
      }
    }
  } catch { /* ignore */ }
}

/** Resolve a JID to a real phone JID when a mapping is known. */
function resolve(jid) {
  const s = String(jid || '');
  if (!s.endsWith('@lid')) return s;
  const pn = lidToPn.get(bare(s));
  return pn ? `${pn}@s.whatsapp.net` : s;
}

/**
 * The number to show / mention for a JID.
 * Returns the real phone number when known, otherwise the bare id (so callers
 * never render a fake-looking `+<lid>`).
 */
function displayNum(jid) {
  return bare(resolve(jid));
}

/** True when the JID is a LID we could NOT resolve to a real number. */
function isUnresolvedLid(jid) {
  const s = String(jid || '');
  return s.endsWith('@lid') && !lidToPn.has(bare(s));
}

module.exports = { learnFromMessage, learnFromGroupMeta, resolve, displayNum, isUnresolvedLid, lidToPn, pnToLid };
