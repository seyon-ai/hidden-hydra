/**
 * crypto.js — Hidden Hydra end-to-end encryption (Web Crypto API)
 *
 * Model
 * ─────
 * • Every user gets an ECDH P-256 key pair on first login.
 *     – private key : stays in THIS browser (localStorage), never uploaded
 *     – public key  : stored on the Firestore user doc (publicKey field)
 *
 * • DMs  : AES-256-GCM key = HKDF(ECDH(myPriv, theirPub))  → true 2-party E2EE.
 *
 * • Groups / world rooms : a random AES-256-GCM "room key" per epoch.
 *     The room key is *wrapped* (encrypted) for each member with an ephemeral
 *     ECDH exchange and stored in  groups/{gid}/keys/{uid}.
 *     Anyone holding the raw room key auto-wraps it for members who lack one,
 *     so keys propagate while people are online. Messages carry their epoch,
 *     so a re-key never hides history you already hold keys for.
 *
 * • Payloads are JSON {t: text, i: imageUrl, r: reply} encrypted with AES-GCM
 *   (random 12-byte IV per message). Sender name/avatar/time stay in clear —
 *   same metadata model as Signal/WhatsApp.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  to(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  from(str) {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');   // tolerate base64url (JWK)
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
};

/* ── key material cache ── */
const mem = { priv: {}, pub: {}, dm: {} };

async function importPriv(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}
async function importPub(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}
function hkdf(bits, info) {
  return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']).then(mk =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) },
      mk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    )
  );
}
async function aesFromRaw(rawBytes) {
  return crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/* ── identity ─ */
export async function ensureKeyPair(uid) {
  if (mem.pub[uid]) return mem.pub[uid];
  const ls = localStorage.getItem('hk_id_' + uid);
  let priv, pub;
  if (ls) {
    try {
      const j = JSON.parse(ls);
      priv = await importPriv(j.priv);
      pub = j.pub;
    } catch (_) { localStorage.removeItem('hk_id_' + uid); }
  }
  if (!priv) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const [privJwk, pubJwk] = await Promise.all([
      crypto.subtle.exportKey('jwk', kp.privateKey),
      crypto.subtle.exportKey('jwk', kp.publicKey)
    ]);
    priv = kp.privateKey;
    pub = pubJwk;
    localStorage.setItem('hk_id_' + uid, JSON.stringify({ priv: privJwk, pub: pubJwk }));
  }
  mem.priv[uid] = priv;
  mem.pub[uid] = pub;
  return pub; // JWK → store on user doc
}

export function myPublicKey(uid) { return mem.pub[uid] || null; }

/** short human-readable fingerprint of a public JWK (for the profile page) */
export async function fingerprint(pubJwk) {
  if (!pubJwk) return '—';
  const raw = b64.from(pubJwk.x || 'aaaa');
  const h = await crypto.subtle.digest('SHA-256', raw);
  const hex = [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 24).match(/.{4}/g).join(' ').toUpperCase();
}

/* ── DM keys ── */
export async function deriveDMKey(myUid, theirUid, theirPubJwk) {
  const pair = [myUid, theirUid].sort().join('|');
  if (mem.dm[pair]) return mem.dm[pair];
  if (!mem.priv[myUid]) await ensureKeyPair(myUid);
  const theirPub = await importPub(theirPubJwk);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirPub }, mem.priv[myUid], 256);
  const key = await hkdf(bits, 'hh-dm-' + pair);
  mem.dm[pair] = key;
  return key;
}

/* ── room keys ── */
export function newRoomKeyRaw() {
  return b64.to(crypto.getRandomValues(new Uint8Array(32)));
}
export function readRoomStore(gid) {
  try { return JSON.parse(localStorage.getItem('hk_rk_' + gid)) || { epochs: {}, current: 0 }; }
  catch (_) { return { epochs: {}, current: 0 }; }
}
export function writeRoomStore(gid, store) {
  localStorage.setItem('hk_rk_' + gid, JSON.stringify(store));
}
export function roomKeyForEpoch(gid, epoch) {
  const raw = readRoomStore(gid).epochs[epoch || 1];
  return raw ? aesFromRaw(b64.from(raw)) : Promise.resolve(null);
}
export function currentRoomKey(gid) {
  const st = readRoomStore(gid);
  const raw = st.epochs[st.current];
  return raw ? aesFromRaw(b64.from(raw)) : Promise.resolve(null);
}

/** wrap a raw room key (b64) for a recipient's public JWK using ephemeral ECDH */
export async function wrapKeyFor(rawB64, recipientPubJwk) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const theirPub = await importPub(recipientPubJwk);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirPub }, kp.privateKey, 256);
  const key = await hkdf(bits, 'hh-wrap');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(rawB64));
  const epkJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { epk: epkJwk, ct: b64.to(iv) + '.' + b64.to(ct) };
}

export async function unwrapKey(rec, myUid) {
  if (!mem.priv[myUid]) await ensureKeyPair(myUid);
  const epk = await importPub(rec.epk);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, mem.priv[myUid], 256);
  const key = await hkdf(bits, 'hh-wrap');
  const [ivB64, ctB64] = rec.ct.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.from(ivB64) }, key, b64.from(ctB64));
  return dec.decode(pt);
}

/* ── message payloads ── */
export async function encryptPayload(aesKey, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc.encode(JSON.stringify(obj)));
  return b64.to(iv) + '.' + b64.to(ct);
}
export async function decryptPayload(aesKey, ctStr) {
  try {
    const [ivB64, ctB64] = ctStr.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.from(ivB64) }, aesKey, b64.from(ctB64));
    return JSON.parse(dec.decode(pt));
  } catch (_) { return null; }
}
