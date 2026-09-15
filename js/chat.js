/**
 * chat.js — Hidden Hydra (v2)
 *
 * v2 changes
 * ──────────
 * • E2EE: DMs via ECDH P-256 → AES-256-GCM; groups/world rooms via wrapped
 *   per-epoch room keys (see js/crypto.js). Bots & legacy messages stay readable.
 * • Image attachments (imgbb via /api/upload) + paste & drag-drop + lightbox.
 * • Collapsible sidebar & right panel (desktop) / hamburger + slide-overs (mobile).
 * • Private per-user AI assistant room (was: one shared public room).
 * • Bug fixes: mobile sidebar was un-openable; close-chat dead-end on mobile;
 *   friendship never registered for the requester; N+1 queries in explore/search;
 *   reactions used a full-tree onValue (now onChildChanged); autoscroll no longer
 *   yanks you down while reading history; ban applied live; group invite copy
 *   no longer inline-injectable; DM list snapshot race fixed.
 * • Unread dots, message delete/copy, linkified URLs, live DM presence,
 *   jump-to-latest, sent-count stat, title badge.
 */

import {
  auth, db, rtdb,
  onAuthStateChanged, signOut,
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, limit, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment,
  ref, set, push, remove, onValue, onChildAdded, onChildChanged, off,
  rtTs, onDisconnect,
  dbQuery, orderByChild, limitToLast, get, update
} from './firebase-config.js';

import {
  welcomeNewUser, handleAIChat, moderateMessage,
  parseCommand, checkBanStatus,
  AI_ROOM, isAIRoom, BOT_ID
} from './ai.js';

import * as api from './api.js';
import {
  ensureKeyPair, deriveDMKey, newRoomKeyRaw, readRoomStore, writeRoomStore,
  roomKeyForEpoch, currentRoomKey, wrapKeyFor, unwrapKey, encryptPayload, decryptPayload
} from './crypto.js';
import { icon, iconEl, avatarId, roomIconId, REACTIONS, reactionIconId, flagImg, countryName, AVATARS } from './icons.js';

// ─── CONSTANTS ────────────────────────────────────────
const WORLD = [
  { id: 'g-lounge',   name: 'Global Lounge', desc: 'Talk to everyone worldwide!' },
  { id: 'g-gaming',   name: 'Gaming Den',    desc: 'All platforms, all games.' },
  { id: 'g-tech',     name: 'Tech Talk',     desc: 'Developers & tech lovers.' },
  { id: 'g-music',    name: 'Music Vibes',   desc: 'Share music & artists.' },
  { id: 'g-creative', name: 'Creative Hub',  desc: 'Art, design, photography.' }
];

// ─── STATE ────────────────────────────────────────────
let ME = null, MY = null;
let CID = null, CTYPE = null, CDATA = null;
let ACTIVE = { mode: 'none', epoch: 0 };       // encryption context of open chat
let replyTo = null;
let epOpen = false;
let typTimer = null;
let pendingImages = [];                        // [{id,url,status}]
let decrypted = {};                            // msgKey -> {t,i,r} | {t} plaintext
let friends = new Set();
let totalUnread = 0;

let msgAddedRef = null, msgChangedRef = null, typRef = null, keyUnsub = null;
let dmUnsub = null, grpUnsub = null, selfUnsub = null, dmPresenceUnsub = null;

let lastMsgDate = '', lastMsgSender = '', msgCount = 0;
let lastDmUpgrade = 0;
let convTimer = null;
let renderedMids = new Set();

// surface silent failures instead of "nothing happens"
window.addEventListener('unhandledrejection', ev => {
  console.error('[HH] unhandled rejection:', ev.reason);
});
window.addEventListener('error', ev => {
  console.error('[HH] window error:', ev.message);
});

// ─── UTILS ────────────────────────────────────────────
const $   = id => document.getElementById(id);
const mk  = tag => document.createElement(tag);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toast(msg, type = '') {
  const tc = $('toasts'); if (!tc) return;
  const t = mk('div'); t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg; tc.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
window.toast = toast;

/** avatar element: photo if present, else SVG emblem */
function avEl(profile, size = 40) {
  const w = mk('div');
  w.className = 'avw';
  w.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--s3);flex-shrink:0;color:var(--gold);`;
  const url = profile?.photoURL;
  if (url && url.startsWith('http')) {
    const img = mk('img');
    img.src = url; img.alt = profile?.username || 'avatar';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    img.onerror = () => { w.innerHTML = ''; w.appendChild(iconEl(avatarId(profile?.avatar), '', Math.round(size * .62))); };
    w.appendChild(img);
  } else {
    w.appendChild(iconEl(avatarId(profile?.avatar), '', Math.round(size * .62)));
  }
  return w;
}

function roomIconEl(g, size = 22) {
  const w = mk('div');
  w.style.cssText = `width:42px;height:42px;border-radius:50%;background:var(--s3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--gold);`;
  w.appendChild(iconEl(roomIconId(g), '', size));
  return w;
}

const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
function fmtDate(ts) {
  if (!ts) return 'Today';
  const d = new Date(ts), n = new Date();
  if (d.toDateString() === n.toDateString()) return 'Today';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}
function linkify(safeHtml) {
  return safeHtml.replace(/((https?:\/\/)[^\s<]+[^\s<.,:;"')\]])/g,
    u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

function setList(html) { const c = $('cl'); if (c) c.innerHTML = html; }
function mkLbl(t) { const d = mk('div'); d.className = 'sec-lbl'; d.textContent = t; return d; }
function mkOv() { const o = mk('div'); o.className = 'overlay'; return o; }
function mkCiRow() {
  const r = mk('div'); r.className = 'ci';
  const a = mk('div'); a.className = 'ci-av'; r.appendChild(a);
  const m = mk('div'); m.className = 'ci-meta';
  const n = mk('div'); n.className = 'ci-name'; m.appendChild(n);
  const p = mk('div'); p.className = 'ci-prev'; m.appendChild(p);
  r.appendChild(m);
  const dot = mk('span'); dot.className = 'unread-dot'; dot.style.display = 'none'; r.appendChild(dot);
  return r;
}
const seenTs  = cid => Number(localStorage.getItem('hh_seen_' + cid) || 0);
const markSeen = cid => localStorage.setItem('hh_seen_' + cid, String(Date.now()));
function prevLabel(txt, isEncrypted) {
  if (!txt) return 'Say hello!';
  if (txt === 'Encrypted message' || txt === 'Photo') return icon('lock', '', 11) + ' ' + txt;
  return esc(txt);
}

/* ── friends = accepted requests (both directions) ∪ legacy friends array ── */
async function refreshFriends() {
  friends = new Set(MY.friends || []);
  try {
    const [a, b] = await Promise.all([
      getDocs(query(collection(db, 'friendRequests'), where('from', '==', ME.uid), where('status', '==', 'accepted'))),
      getDocs(query(collection(db, 'friendRequests'), where('to', '==', ME.uid), where('status', '==', 'accepted')))
    ]);
    a.forEach(d => friends.add(d.data().to));
    b.forEach(d => friends.add(d.data().from));
  } catch (_) {}
  return friends;
}

// ─── AUTH + BOOT ──────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'login.html'; return; }
  ME = user;
  let snap;
  try { snap = await getDoc(doc(db, 'users', ME.uid)); }
  catch (e) { toast('Network error: ' + e.message, 'err'); return; }
  if (!snap.exists()) { window.location.href = 'login.html'; return; }
  MY = snap.data();

  // E2EE identity: create/load key pair, publish public key if missing/changed
  try {
    const pub = await ensureKeyPair(ME.uid);
    if (JSON.stringify(MY.publicKey || null) !== JSON.stringify(pub)) {
      await updateDoc(doc(db, 'users', ME.uid), { publicKey: pub });
      MY.publicKey = pub;
    }
  } catch (e) { console.warn('E2EE identity:', e); }

  setupPresence();

  if (await checkBanStatus(ME.uid)) return showBanned();
  // live ban check — react instantly if banned mid-session
  selfUnsub = onSnapshot(doc(db, 'users', ME.uid), s => {
    if (!s.exists()) return;
    MY = s.data();
    if (MY.banned) showBanned();
  });

  await seedWorldRooms();
  await refreshFriends();
  if (!MY.welcomed) setTimeout(() => welcomeNewUser(ME, MY), 2000);
  boot();
});

function showBanned() {
  $('loading').innerHTML =
    '<div style="text-align:center;padding:40px;font-family:Cinzel,serif;color:var(--danger)">' +
    '<div style="margin-bottom:16px;color:var(--danger)">' + icon('shield', '', 52) + '</div>' +
    '<div style="font-size:18px;letter-spacing:3px;margin-bottom:12px">ACCOUNT BANNED</div>' +
    '<div style="font-size:13px;color:var(--dim)">You have been removed from Hidden Hydra for violating community guidelines.</div></div>';
}

function setupPresence() {
  const pr = ref(rtdb, `presence/${ME.uid}`);
  set(pr, { online: true, uid: ME.uid, lastSeen: rtTs() });
  onDisconnect(pr).set({ online: false, uid: ME.uid, lastSeen: rtTs() });
}

async function seedWorldRooms() {
  for (const g of WORLD) {
    const snap = await getDoc(doc(db, 'groups', g.id));
    if (!snap.exists()) {
      await setDoc(doc(db, 'groups', g.id), {
        ...g, icon: roomIconId(g), type: 'global', visibility: 'public', joinCode: g.id,
        members: [], createdBy: 'system',
        createdAt: serverTimestamp(), lastMessage: '', lastTime: serverTimestamp()
      });
    }
  }
}

function boot() {
  $('loading').style.display = 'none';
  $('app').classList.add('show');
  renderMe();
  buildEmojiPanel();
  watchPresence();
  watchReqBadge();
  restorePanels();
  switchTab('world', document.querySelector('[data-tab="world"]'));
}

function renderMe() {
  const a = $('me-av'); a.innerHTML = ''; a.appendChild(avEl(MY, 40));
  $('me-name').textContent = MY.username || '—';
}

/* ── collapsible panels (item 7) ── */
function restorePanels() {
  const app = $('app');
  if (localStorage.getItem('hh_sb') === 'hidden' && innerWidth > 700) app.classList.add('sb-hidden');
  if (localStorage.getItem('hh_rp') === 'hidden' && innerWidth > 1100) app.classList.add('rp-off');
}
window.toggleSidebar = function () {
  const app = $('app');
  if (innerWidth <= 700) {                       // mobile: slide-over + backdrop
    const open = app.classList.toggle('sb-open');
    $('sb-backdrop').style.display = open ? 'block' : 'none';
  } else {
    const hidden = app.classList.toggle('sb-hidden');
    localStorage.setItem('hh_sb', hidden ? 'hidden' : 'shown');
  }
};
window.closeMobileSidebar = function () {
  $('app').classList.remove('sb-open');
  $('sb-backdrop').style.display = 'none';
};
window.toggleRightPanel = function () {
  const app = $('app');
  if (innerWidth <= 1100) {
    const open = app.classList.toggle('rp-open');
    $('sb-backdrop').style.display = open ? 'block' : 'none';
  } else {
    const off = app.classList.toggle('rp-off');
    localStorage.setItem('hh_rp', off ? 'hidden' : 'shown');
  }
};

// ─── TABS ─────────────────────────────────────────────
window.switchTab = function (tab, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $('fab').style.display = tab === 'groups' ? 'flex' : 'none';
  if (tab !== 'dms' && dmUnsub) { dmUnsub(); dmUnsub = null; }
  if (tab !== 'groups' && grpUnsub) { grpUnsub(); grpUnsub = null; }
  if (tab === 'world') loadWorld();
  if (tab === 'dms') loadDMs();
  if (tab === 'groups') loadGroups();
  if (tab === 'explore') loadExplore();
  if (tab === 'req') loadRequests();
};

function watchReqBadge() {
  const q = query(collection(db, 'friendRequests'), where('to', '==', ME.uid), where('status', '==', 'pending'));
  onSnapshot(q, snap => {
    const b = $('req-badge');
    if (b) { b.textContent = snap.size; b.style.display = snap.size ? 'flex' : 'none'; }
  });
}

// ─── WORLD ROOMS ──────────────────────────────────────
function loadWorld() {
  const cl = $('cl'); cl.innerHTML = '';
  cl.appendChild(mkLbl('PRIVATE AI'));
  const ai = mkCiRow();
  ai.querySelector('.ci-av').appendChild(roomIconEl({ id: AI_ROOM(ME.uid) }, 22));
  ai.querySelector('.ci-name').textContent = 'Hydra AI';
  ai.querySelector('.ci-prev').innerHTML = 'Your private assistant';
  if (CID === AI_ROOM(ME.uid)) ai.classList.add('active');
  ai.onclick = () => openChat(AI_ROOM(ME.uid), 'ai', { id: AI_ROOM(ME.uid), name: 'Hydra AI' });
  cl.appendChild(ai);

  cl.appendChild(mkLbl('WORLD CHAT · E2E ENCRYPTED'));
  WORLD.forEach(g => {
    const r = mkCiRow();
    r.querySelector('.ci-av').appendChild(roomIconEl(g, 22));
    r.querySelector('.ci-name').textContent = g.name;
    r.querySelector('.ci-prev').textContent = g.desc;
    if (CID === g.id) r.classList.add('active');
    r.onclick = () => openChat(g.id, 'group', { ...g, type: 'global' });
    cl.appendChild(r);
  });
}

// ─── DMs ──────────────────────────────────────────────
function loadDMs() {
  if (dmUnsub) { dmUnsub(); dmUnsub = null; }
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const q = query(collection(db, 'chats'), where('members', 'array-contains', ME.uid), where('type', '==', 'dm'), where('status', '==', 'accepted'));
  let seq = 0;
  dmUnsub = onSnapshot(q, async snap => {
    const my = ++seq;                                  // latest-snapshot-wins (fixes old race)
    const items = [];
    for (const d of snap.docs) {
      const data = d.data();
      const oid = data.members.find(m => m !== ME.uid); if (!oid) continue;
      try { const o = await getDoc(doc(db, 'users', oid)); if (o.exists() && my === seq) items.push({ id: d.id, ...data, other: o.data() }); } catch (_) {}
    }
    if (my !== seq) return;
    const cl = $('cl'); if (!cl) return; cl.innerHTML = '';
    if (!items.length) { cl.innerHTML = '<div class="empty-lm">No conversations yet.<br>Send a friend request to start.</div>'; return; }
    cl.appendChild(mkLbl('DIRECT MESSAGES · E2E ENCRYPTED'));
    items.forEach(item => {
      try {
        const r = mkCiRow();
        r.querySelector('.ci-av').appendChild(avEl(item.other, 42));
        r.querySelector('.ci-name').textContent = item.other.username || '—';
        r.querySelector('.ci-prev').innerHTML = prevLabel(item.lastMessage, true);
        const lt = item.lastTime?.toMillis?.() || 0;
        if (lt > seenTs(item.id)) r.querySelector('.unread-dot').style.display = 'block';
        if (CID === item.id) r.classList.add('active');
        r.onclick = () => openChat(item.id, 'dm', item.other);
        cl.appendChild(r);
      } catch (e) { console.error('dm row render failed:', e); }
    });
  });
}

// ─── GROUPS ───────────────────────────────────────────
function loadGroups() {
  if (grpUnsub) { grpUnsub(); grpUnsub = null; }
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const q = query(collection(db, 'groups'), where('members', 'array-contains', ME.uid));
  grpUnsub = onSnapshot(q, snap => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(g => g.type !== 'global');
    const cl = $('cl'); if (!cl) return; cl.innerHTML = '';
    if (!items.length) { cl.innerHTML = '<div class="empty-lm">No groups yet.<br>Create one below!</div>'; return; }
    cl.appendChild(mkLbl('MY GROUPS · E2E ENCRYPTED'));
    items.forEach(g => {
      const r = mkCiRow();
      r.querySelector('.ci-av').appendChild(roomIconEl(g, 22));
      r.querySelector('.ci-name').textContent = g.name;
      r.querySelector('.ci-prev').innerHTML =
        (g.members?.length || 0) + ' members' + (g.lastMessage ? ' · ' + prevLabel(g.lastMessage) : '');
      const lt = g.lastTime?.toMillis?.() || 0;
      if (lt > seenTs(g.id)) r.querySelector('.unread-dot').style.display = 'block';
      if (CID === g.id) r.classList.add('active');
      r.onclick = () => openChat(g.id, 'group', g);
      if (g.visibility === 'private') {
        const lk = iconEl('lock', '', 12); lk.style.cssText = 'color:var(--faint);flex-shrink:0'; r.appendChild(lk);
      }
      cl.appendChild(r);
    });
  });
}

// ─── EXPLORE ──────────────────────────────────────────
async function loadExplore() {
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const [gSnap, uSnap, sentSnap] = await Promise.all([
    getDocs(collection(db, 'groups')),
    getDocs(collection(db, 'users')),
    getDocs(query(collection(db, 'friendRequests'), where('from', '==', ME.uid), where('status', '==', 'pending')))
  ]);
  const sent = new Set(sentSnap.docs.map(d => d.data().to));       // one query, not N
  const pubGroups = gSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(g => g.type !== 'global' && g.visibility !== 'private' && !g.members?.includes(ME.uid));
  const users = uSnap.docs.map(d => d.data()).filter(u => u.uid !== ME.uid);
  const cl = $('cl'); cl.innerHTML = '';

  const bar = mk('div'); bar.className = 'code-bar';
  const inp = mk('input'); inp.className = 'code-inp'; inp.id = 'code-inp'; inp.placeholder = 'Enter invite code...';
  const jb = mk('button'); jb.className = 'join-btn'; jb.textContent = 'JOIN'; jb.onclick = joinByCode;
  bar.appendChild(inp); bar.appendChild(jb); cl.appendChild(bar);

  if (pubGroups.length) {
    cl.appendChild(mkLbl('PUBLIC GROUPS'));
    pubGroups.forEach(g => {
      const row = mk('div'); row.className = 'ex-item';
      row.appendChild(roomIconEl(g, 22));
      const meta = mk('div'); meta.style.cssText = 'flex:1;min-width:0';
      meta.innerHTML = `<div class="ci-name">${esc(g.name)}</div><div class="ci-prev">${g.members?.length || 0} members</div>`;
      const btn = mk('button'); btn.className = 'join-btn'; btn.textContent = 'JOIN'; btn.onclick = () => doJoinGroup(g.id);
      row.appendChild(meta); row.appendChild(btn); cl.appendChild(row);
    });
  }

  if (users.length) {
    cl.appendChild(mkLbl('PEOPLE'));
    for (const u of users.slice(0, 40)) {
      const row = mk('div'); row.className = 'ex-item';
      const avw = mk('div'); avw.style.cssText = 'flex-shrink:0'; avw.appendChild(avEl(u, 42));
      const meta = mk('div'); meta.style.cssText = 'flex:1;min-width:0';
      meta.innerHTML = `<div class="ci-name">${esc(u.username)}</div><div class="ci-prev">${flagImg(u.country, 14)} ${esc(countryName(u.country))} ${u.bio ? '· ' + esc(u.bio.substring(0, 24)) : ''}</div>`;
      let btn;
      if (friends.has(u.uid)) { btn = mk('button'); btn.className = 'join-btn fr'; btn.innerHTML = icon('msg', '', 12) + ' DM'; btn.onclick = () => startDM(u.uid); }
      else if (sent.has(u.uid)) { btn = mk('span'); btn.className = 'sent-tag'; btn.textContent = 'SENT'; }
      else { btn = mk('button'); btn.className = 'join-btn'; btn.textContent = '+ Add'; btn.onclick = () => sendFReq(u.uid, u.username, btn); }
      row.appendChild(avw); row.appendChild(meta); row.appendChild(btn); cl.appendChild(row);
    }
  }
}

// ─── REQUESTS ─────────────────────────────────────────
async function loadRequests() {
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const snap = await getDocs(query(collection(db, 'friendRequests'), where('to', '==', ME.uid), where('status', '==', 'pending')));
  const reqs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const cl = $('cl'); cl.innerHTML = '';
  cl.appendChild(mkLbl(`INCOMING (${reqs.length})`));
  if (!reqs.length) { cl.innerHTML += '<div class="empty-lm">No pending requests.</div>'; return; }
  for (const r of reqs) {
    const ud = await getDoc(doc(db, 'users', r.from)); if (!ud.exists()) continue;
    const u = ud.data();
    const row = mk('div'); row.className = 'ex-item';
    const avw = mk('div'); avw.style.cssText = 'flex-shrink:0'; avw.appendChild(avEl(u, 42));
    const meta = mk('div'); meta.style.cssText = 'flex:1;min-width:0';
    meta.innerHTML = `<div class="ci-name">${esc(u.username)}</div><div class="ci-prev">wants to connect · ${flagImg(u.country, 14)} ${esc(countryName(u.country))}</div>`;
    const wrap = mk('div'); wrap.style.cssText = 'display:flex;gap:5px;flex-shrink:0';
    const acc = mk('button'); acc.className = 'acc-btn'; acc.textContent = 'Accept'; acc.onclick = () => acceptReq(r, u, row);
    const rej = mk('button'); rej.className = 'rej-btn'; rej.innerHTML = icon('x', '', 12); rej.onclick = () => rejectReq(r.id, row);
    wrap.appendChild(acc); wrap.appendChild(rej);
    row.appendChild(avw); row.appendChild(meta); row.appendChild(wrap); cl.appendChild(row);
  }
}

// ─── FRIEND REQUESTS ──────────────────────────────────
async function sendFReq(toUid, toName, btn) {
  btn.disabled = true; btn.textContent = '...';
  try {
    await addDoc(collection(db, 'friendRequests'), { from: ME.uid, to: toUid, fromName: MY.username, toName, status: 'pending', createdAt: serverTimestamp() });
    btn.className = 'sent-tag'; btn.textContent = 'SENT'; btn.disabled = false;
    toast('Request sent!', 'ok');
  } catch (e) { toast('Error: ' + e.message, 'err'); btn.disabled = false; btn.textContent = '+ Add'; }
}

async function acceptReq(req, fromUser, rowEl) {
  try {
    await updateDoc(doc(db, 'friendRequests', req.id), { status: 'accepted' });
    await updateDoc(doc(db, 'users', ME.uid), { friends: arrayUnion(req.from) });
    const ex = await getDocs(query(collection(db, 'chats'), where('members', 'array-contains', ME.uid), where('type', '==', 'dm')));
    let cid = null; ex.forEach(d => { if (d.data().members.includes(req.from)) cid = d.id; });
    if (!cid) await addDoc(collection(db, 'chats'), { type: 'dm', members: [ME.uid, req.from], status: 'accepted', lastMessage: '', lastTime: serverTimestamp() });
    else await updateDoc(doc(db, 'chats', cid), { status: 'accepted' });
    friends.add(req.from);                                   // requester side resolves via refresh on next load
    rowEl.remove();
    const s = await getDoc(doc(db, 'users', ME.uid)); MY = s.data();
    toast(`Connected with ${fromUser.username}!`, 'ok');
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

async function rejectReq(reqId, rowEl) {
  try { await updateDoc(doc(db, 'friendRequests', reqId), { status: 'rejected' }); rowEl.remove(); toast('Declined.'); }
  catch (e) { toast('Error: ' + e.message, 'err'); }
}

// ─── JOIN GROUP ───────────────────────────────────────
async function doJoinGroup(gid) {
  try {
    await updateDoc(doc(db, 'groups', gid), { members: arrayUnion(ME.uid) });
    const s = await getDoc(doc(db, 'groups', gid));
    toast('Joined!', 'ok');
    openChat(gid, 'group', { id: gid, ...s.data() });
    switchTab('groups', document.querySelector('[data-tab="groups"]'));
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}
window.doJoinGroup = doJoinGroup;

async function joinByCode() {
  const code = $('code-inp')?.value.trim(); if (!code) return;
  const snap = await getDocs(query(collection(db, 'groups'), where('joinCode', '==', code)));
  if (snap.empty) { toast('No group with that code', 'err'); return; }
  const g = { id: snap.docs[0].id, ...snap.docs[0].data() };
  if (g.members?.includes(ME.uid)) { toast('Already a member!'); openChat(g.id, 'group', g); return; }
  doJoinGroup(g.id);
}
window.joinByCode = joinByCode;

// ─── START DM ─────────────────────────────────────────
async function startDM(uid) {
  if (!friends.has(uid)) {
    const [s1, s2] = await Promise.all([
      getDocs(query(collection(db, 'friendRequests'), where('from', '==', ME.uid), where('to', '==', uid), where('status', '==', 'accepted'))),
      getDocs(query(collection(db, 'friendRequests'), where('from', '==', uid), where('to', '==', ME.uid), where('status', '==', 'accepted')))
    ]);
    if (s1.empty && s2.empty) {
      const u = await getDoc(doc(db, 'users', uid));
      toast(`Send ${u.data()?.username || 'them'} a friend request first!`, 'err'); return;
    }
  }
  const ex = await getDocs(query(collection(db, 'chats'), where('members', 'array-contains', ME.uid), where('type', '==', 'dm')));
  let cid = null; ex.forEach(d => { if (d.data().members.includes(uid)) cid = d.id; });
  if (!cid) {
    const cr = await addDoc(collection(db, 'chats'), { type: 'dm', members: [ME.uid, uid], status: 'accepted', lastMessage: '', lastTime: serverTimestamp() });
    cid = cr.id;
  }
  const o = await getDoc(doc(db, 'users', uid));
  if (o.exists()) { openChat(cid, 'dm', o.data()); switchTab('dms', document.querySelector('[data-tab="dms"]')); }
}
window.startDM = startDM;

// ─── SEARCH ──────────────────────────────────────────
let searchTimer = null;
window.doSearch = function (val) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(val), 220);        // debounce
};
async function runSearch(val) {
  $('sc-clear').style.display = val ? 'block' : 'none';
  if (!val.trim()) { switchTab('world', document.querySelector('[data-tab="world"]')); return; }
  const [snap, sentSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(query(collection(db, 'friendRequests'), where('from', '==', ME.uid), where('status', '==', 'pending')))
  ]);
  const sent = new Set(sentSnap.docs.map(d => d.data().to));
  const res = snap.docs.map(d => d.data()).filter(u => u.uid !== ME.uid && u.username?.toLowerCase().includes(val.toLowerCase()));
  const cl = $('cl'); cl.innerHTML = '';
  cl.appendChild(mkLbl(`RESULTS (${res.length})`));
  res.forEach(u => {
    const r = mkCiRow();
    r.querySelector('.ci-av').appendChild(avEl(u, 42));
    r.querySelector('.ci-name').textContent = u.username;
    r.querySelector('.ci-prev').innerHTML = flagImg(u.country, 14) + ' ' + esc(countryName(u.country));
    const isFriend = friends.has(u.uid);
    const btn = mk('button'); btn.className = 'join-btn' + (isFriend ? ' fr' : '');
    btn.innerHTML = isFriend ? icon('msg', '', 12) + ' DM' : '+ Add';
    if (!isFriend && sent.has(u.uid)) { btn.className = 'sent-tag'; btn.textContent = 'SENT'; }
    btn.onclick = () => isFriend ? startDM(u.uid) : sendFReq(u.uid, u.username, btn);
    r.appendChild(btn); cl.appendChild(r);
  });
}
window.clearSearch = function () { $('search-inp').value = ''; $('sc-clear').style.display = 'none'; switchTab('world', document.querySelector('[data-tab="world"]')); };

// ─── E2EE ROOM KEY SETUP (wraps-map schema, multi-device safe) ───
// keys/{uid} = { wraps: { "1": {epk,ct}, "2": {...} }, latest: n }
// Merge-writes mean nobody ever destroys another epoch's wrap, and sharing
// is per-epoch so devices converge on every epoch they are missing.

async function readMyWraps(gid) {
  // returns Map epoch -> rawB64 that THIS device can unwrap, plus doc snapshot
  const kd = await getDoc(doc(db, 'groups', gid, 'keys', ME.uid));
  const out = { exists: kd.exists(), epochs: {}, latest: 0 };
  if (!kd.exists()) return out;
  const d = kd.data();
  const wraps = d.wraps || (d.epk ? { [d.epoch || 1]: { epk: d.epk, ct: d.ct } } : {});  // legacy shape
  for (const [ep, rec] of Object.entries(wraps)) {
    try { out.epochs[ep] = await unwrapKey(rec, ME.uid); out.latest = Math.max(out.latest, Number(ep)); }
    catch (_) { /* wrapped for another keypair (browser reset) — skip */ }
  }
  return out;
}

async function setupRoomKey(gid, members) {
  let mine;
  try { mine = await readMyWraps(gid); }
  catch (e) {
    console.warn('keys subcollection unreadable — Firestore rules not updated?', e);
    return { ok: false, rulesErr: true };
  }

  const st = readRoomStore(gid);
  let unlockedAny = false;
  for (const [ep, raw] of Object.entries(mine.epochs)) {
    st.epochs[ep] = raw; unlockedAny = true;
  }
  // local store from a previous session also counts
  if (!unlockedAny && st.epochs[st.current]) unlockedAny = true;
  if (unlockedAny) {
    if (mine.latest) st.current = mine.latest;
    if (!st.current || !st.epochs[st.current]) st.current = Number(Object.keys(st.epochs).pop() || 1);
    writeRoomStore(gid, st);
    // make sure our own doc carries wraps for epochs we hold (self-heal)
    for (const ep of Object.keys(st.epochs)) await publishMyKey(gid, st.epochs[ep], Number(ep));
    return { ok: true, epoch: st.current };
  }

  // we hold nothing: is the room empty of keys (first ever visitor) → mint epoch 1
  let anyKeys;
  try { anyKeys = await getDocs(query(collection(db, 'groups', gid, 'keys'), limit(1))); }
  catch (e) { return { ok: false, rulesErr: true }; }
  if (anyKeys.empty) {
    const raw = newRoomKeyRaw();
    st.epochs[1] = raw; st.current = 1; writeRoomStore(gid, st);
    await publishMyKey(gid, raw, 1);
    updateDoc(doc(db, 'groups', gid), { e2eeEpoch: 1 }).catch(() => {});
    return { ok: true, epoch: 1 };
  }

  // keys exist but none for us (or ours are for a lost keypair):
  // wait for a key-holder's share, then give up with guidance
  const res = await waitForWrappedKey(gid, 12000);
  if (res.ok) {
    for (const ep of Object.keys(st.epochs)) await publishMyKey(gid, st.epochs[ep], Number(ep)).catch(() => {});
  }
  return res;
}

/** merge-write our own wrap for an epoch (never destroys other epochs) */
async function publishMyKey(gid, raw, epoch) {
  try {
    const wrapped = await wrapKeyFor(raw, MY.publicKey);
    await setDoc(doc(db, 'groups', gid, 'keys', ME.uid),
      { [`wraps.${epoch}`]: wrapped, latest: epoch }, { merge: true });
  } catch (_) {}
}

function waitForWrappedKey(gid, ms) {
  return new Promise(resolve => {
    let done = false;
    const finish = val => { if (!done) { done = true; keyUnsub?.(); keyUnsub = null; resolve(val); } };
    const tryDoc = async snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      const wraps = d.wraps || (d.epk ? { [d.epoch || 1]: { epk: d.epk, ct: d.ct } } : {});
      const st = readRoomStore(gid);
      let got = false;
      for (const [ep, rec] of Object.entries(wraps)) {
        if (st.epochs[ep]) continue;
        try { st.epochs[ep] = await unwrapKey(rec, ME.uid); st.current = Number(ep); got = true; } catch (_) {}
      }
      if (got) { writeRoomStore(gid, st); finish({ ok: true, epoch: st.current }); }
    };
    keyUnsub = onSnapshot(doc(db, 'groups', gid, 'keys', ME.uid), snap => { tryDoc(snap); });
    setTimeout(() => finish({ ok: false, pending: true }), ms);
  });
}

/** key-holders merge-write wraps for every epoch each member is missing */
async function shareRoomKeys(gid, members) {
  const st = readRoomStore(gid);
  const myEpochs = Object.keys(st.epochs).map(Number);
  if (!myEpochs.length || !members?.length) return;
  try {
    await Promise.all(members.slice(0, 40).map(async uid => {
      if (uid === ME.uid) return;
      try {
        const kd = await getDoc(doc(db, 'groups', gid, 'keys', uid));
        const have = new Set(Object.keys(kd.exists() ? (kd.data().wraps || {}) : {}));
        const missing = myEpochs.filter(ep => !have.has(String(ep)));
        if (!missing.length) return;
        const u = await getDoc(doc(db, 'users', uid));
        if (!u.exists() || !u.data().publicKey) return;
        const patch = {};
        for (const ep of missing) patch[`wraps.${ep}`] = await wrapKeyFor(st.epochs[ep], u.data().publicKey);
        await setDoc(doc(db, 'groups', gid, 'keys', uid), patch, { merge: true });
      } catch (_) {}
    }));
  } catch (_) {}
}

/** start a fresh encryption epoch (rescues rooms where key sync is stuck) */
window.rekeyRoom = async function (gid) {
  const st = readRoomStore(gid);
  // NEVER reuse an epoch that already exists anywhere (doc, group field, session) —
  // re-minting an existing epoch splits the room (sender new key, peers old key).
  let docEpoch = 0;
  try {
    const gd = await getDoc(doc(db, 'groups', gid));
    docEpoch = gd.data()?.e2eeEpoch || 0;
  } catch (_) {}
  const epoch = Math.max(st.current || 0, docEpoch, ACTIVE.epoch || 0, 0) + 1;
  const raw = newRoomKeyRaw();
  st.epochs[epoch] = raw; st.current = epoch; writeRoomStore(gid, st);
  await publishMyKey(gid, raw, epoch);
  updateDoc(doc(db, 'groups', gid), { e2eeEpoch: epoch }).catch(() => {});
  let g = null;
  try { g = await getDoc(doc(db, 'groups', gid)); } catch (_) {}
  const members = g?.data()?.members || CDATA?.members || [];
  if (CID === gid) CDATA = { id: gid, ...(g?.data() || CDATA || {}) };
  await shareRoomKeys(gid, members);
  if (CID === gid) {
    ACTIVE = { mode: 'room', epoch, key: await currentRoomKey(gid) };
    $('keybar').style.display = 'none';
    decrypted = {};
    renderedMids = new Set();
    $('msgs').innerHTML = '';
    lastMsgDate = ''; lastMsgSender = ''; msgCount = 0;
    detachMsgListeners();
    attachMsgListeners(gid);
    attachTypingListener(gid);
    $('ch-sub').innerHTML = `${members.length} members · ${icon('lock', '', 10)} E2EE · epoch ${epoch}`;
  }
  toast(`Epoch ${epoch} started — new messages now work on every device. Older locked messages stay locked (their key is gone).`, 'ok');
};

// ─── OPEN CHAT ────────────────────────────────────────
window.openChat = async function (cid, type, data) {
  detachMsgListeners();
  CID = cid; CTYPE = type; CDATA = data; replyTo = null;
  lastMsgDate = ''; lastMsgSender = ''; msgCount = 0;
  pendingImages = []; renderPending();
  decrypted = {};
  renderedMids = new Set();
  $('keybar').style.display = 'none';

  $('empty').style.display = 'none';
  $('cv').classList.add('open');
  cancelReply();
  $('typing-row').style.visibility = 'hidden';
  $('msgs').innerHTML = '';
  markSeen(cid);

  const isGrp = type === 'group', isAI = type === 'ai';
  try {
  $('ch-name').textContent = isGrp ? data.name : isAI ? 'Hydra AI' : (data.username || '—');
  const chAv = $('ch-av'); chAv.innerHTML = '';
  if (isGrp) chAv.appendChild(roomIconEl(data, 20));
  else if (isAI) chAv.appendChild(roomIconEl({ id: cid }, 20));
  else chAv.appendChild(avEl(data, 38));

  const lock = $('ch-lock');
  lock.style.display = isAI ? 'none' : 'flex';
  lock.title = isAI ? '' : 'End-to-end encrypted';

  const ib = $('info-btn');
  ib.style.display = (isGrp && data.type !== 'global') ? 'flex' : 'none';

  if (type === 'dm') {
    $('ch-sub').textContent = 'checking status…';
    watchDmPresence(data?.uid);
  } else if (isAI) {
    $('ch-sub').textContent = 'Private assistant · not E2EE';
    if (dmPresenceUnsub) { dmPresenceUnsub(); dmPresenceUnsub = null; }
  } else {
    $('ch-sub').innerHTML = `${data.members?.length || 0} members · ${icon('lock', '', 10)} E2EE`;
    if (dmPresenceUnsub) { dmPresenceUnsub(); dmPresenceUnsub = null; }
  }

  // encryption context
  ACTIVE = { mode: 'none', epoch: 0 };
  if (isAI) {
    ACTIVE = { mode: 'ai', epoch: 0 };
  } else if (type === 'dm') {
    // resolve the peer uid robustly (profile payload or chat doc members)
    let otherUid = data.uid;
    if (!otherUid) {
      try {
        const cd = await getDoc(doc(db, 'chats', cid));
        otherUid = cd.data()?.members?.find(m => m !== ME.uid);
      } catch (_) {}
    }
    CDATA.otherUid = otherUid;
    try {
      const other = await getDoc(doc(db, 'users', otherUid));
      const pub = other.data()?.publicKey;
      if (pub) {
        ACTIVE = { mode: 'dm', key: await deriveDMKey(ME.uid, otherUid, pub), epoch: 0 };
      } else {
        ACTIVE = { mode: 'legacy', epoch: 0 };   // peer never loaded v2 yet → plaintext for now
        toast('This DM stays plaintext until the other person signs in once with the new build');
      }
    } catch (e) {
      console.warn('DM key setup failed:', e);
      ACTIVE = { mode: 'legacy', epoch: 0 };
      toast('E2EE unavailable for this DM (' + e.message + ') — sending plaintext');
    }
  } else {
    // world rooms: join members list (capped) so keys can propagate
    const isWorld = data.type === 'global' || WORLD.some(w => w.id === cid);
    if (isWorld && !(data.members || []).includes(ME.uid) && (data.members || []).length < 2000) {
      updateDoc(doc(db, 'groups', cid), { members: arrayUnion(ME.uid) }).catch(() => {});
      data.members = [...(data.members || []), ME.uid];
      $('ch-sub').innerHTML = `${data.members.length} members · ${icon('lock', '', 10)} E2EE`;
    }
    let res;
    try { res = await setupRoomKey(cid, data.members || []); }
    catch (e) { console.warn('key sync failed:', e); res = { ok: false, rulesErr: true }; }
    const rk = res.ok ? await currentRoomKey(cid) : null;
    if (res.ok && rk) {
      ACTIVE = { mode: 'room', epoch: res.epoch, key: rk };
      shareRoomKeys(cid, data.members || []);
      // background convergence: keep merge-writing missing wraps while we're here
      if (convTimer) clearInterval(convTimer);
      convTimer = setInterval(() => {
        if (CID === cid && CTYPE === 'group') shareRoomKeys(cid, CDATA?.members || []).catch(() => {});
      }, 60000);
    } else {
      if (res.ok && !rk) console.warn('room key setup ok but no local raw — treating as pending');
      $('keybar').style.display = 'flex';
      $('keybar').dataset.gid = cid;
      $('keybar-txt').textContent = res.rulesErr
        ? 'Encryption keys unreachable — paste firestore.rules into the Firebase console (Rules tab), then press Retry.'
        : "Syncing keys — a member who holds this room's key must open the room. If you reset this browser or switched devices, older messages stay locked; press New epoch to keep chatting.";
      if (!res.rulesErr) {
        // silent watcher: the instant a wrap we CAN unwrap lands, drop into decrypted mode
        keyUnsub = onSnapshot(doc(db, 'groups', cid, 'keys', ME.uid), async snap => {
          if (!snap.exists() || CID !== cid || ACTIVE.mode === 'room') return;
          const d = snap.data();
          const wraps = d.wraps || (d.epk ? { [d.epoch || 1]: { epk: d.epk, ct: d.ct } } : {});
          const st = readRoomStore(cid);
          let got = false;
          for (const [ep, rec] of Object.entries(wraps)) {
            if (st.epochs[ep]) continue;
            try { st.epochs[ep] = await unwrapKey(rec, ME.uid); st.current = Number(ep); got = true; } catch (_) {}
          }
          if (got) {
            writeRoomStore(cid, st);
            if (keyUnsub) { keyUnsub(); keyUnsub = null; }
            toast("Room key received — you're in", 'ok');
            openChat(cid, 'group', CDATA);
          }
        }, () => {});
      }
    }
  }

  } catch (e) {
    // NEVER leave the user with a dead chat: open anyway, degrade gracefully
    console.error('openChat setup failed:', e);
    toast('Chat opened with limited setup: ' + (e.message || e), 'err');
    if (type === 'dm') ACTIVE = { mode: 'legacy', epoch: 0 };
    else if (isGrp) { $('keybar').style.display = 'flex'; $('keybar').dataset.gid = cid; }
  }
  attachMsgListeners(cid);
  attachTypingListener(cid);
  if (innerWidth <= 700) closeMobileSidebar();
};
window.rekeyRetry = function () {
  const gid = $('keybar').dataset.gid;
  if (gid && CDATA) openChat(gid, 'group', CDATA);
};

/** "Unlock" button on locked bubbles / notice: re-fetch keys and re-render */
window.retryUnlock = async function () {
  if (!CID) return;
  toast('Fetching keys…');
  let ok = false;
  if (CTYPE === 'dm') {
    try {
      const ou = CDATA?.otherUid || CDATA?.uid;
      const od = await getDoc(doc(db, 'users', ou));
      const pub = od.data()?.publicKey;
      if (pub) { ACTIVE = { mode: 'dm', key: await deriveDMKey(ME.uid, ou, pub), epoch: 0 }; ok = true; }
    } catch (_) {}
  } else if (CTYPE === 'group') {
    let res;
    try { res = await setupRoomKey(CID, CDATA?.members || []); } catch (_) { res = { ok: false }; }
    if (res.ok) {
      ACTIVE = { mode: 'room', epoch: res.epoch, key: await currentRoomKey(CID) };
      ok = true;
      shareRoomKeys(CID, CDATA?.members || []);
    }
  }
  if (ok) {
    $('keybar').style.display = 'none';
    decrypted = {};
    renderedMids = new Set();
    $('msgs').innerHTML = '';
    lastMsgDate = ''; lastMsgSender = ''; msgCount = 0;
    detachMsgListeners();
    attachMsgListeners(CID);
    attachTypingListener(CID);
    toast('Unlocked', 'ok');
  } else {
    toast('Keys still unavailable — the other side must open the app once with the new build', 'err');
  }
};

function watchDmPresence(uid) {
  if (dmPresenceUnsub) { dmPresenceUnsub(); dmPresenceUnsub = null; }
  dmPresenceUnsub = onValue(ref(rtdb, `presence/${uid}`), snap => {
    if (CTYPE !== 'dm') return;
    const v = snap.val();
    if (v?.online) $('ch-sub').innerHTML = '<span class="pulse"></span> Online now';
    else if (v?.lastSeen) $('ch-sub').textContent = 'Last seen ' + fmtTime(v.lastSeen);
    else $('ch-sub').textContent = 'Offline';
  });
}

window.closeCv = function () {
  $('cv').classList.remove('open');
  $('empty').style.display = 'flex';
  detachMsgListeners();
  CID = null;
  if (innerWidth <= 700) toggleSidebar();      // mobile: back to the list, not a dead end
};

// ─── LISTENERS ────────────────────────────────────────
function detachMsgListeners() {
  if (convTimer) { clearInterval(convTimer); convTimer = null; }
  if (msgAddedRef) { off(msgAddedRef); msgAddedRef = null; }
  if (msgChangedRef) { off(msgChangedRef); msgChangedRef = null; }
  if (typRef) { off(typRef); typRef = null; }
  if (dmPresenceUnsub) { dmPresenceUnsub(); dmPresenceUnsub = null; }
  if (keyUnsub) { keyUnsub(); keyUnsub = null; }
  if (CID && ME) remove(ref(rtdb, `typing/${CID}/${ME.uid}`)).catch(() => {});
}

function attachMsgListeners(cid) {
  const q = dbQuery(ref(rtdb, `messages/${cid}`), orderByChild('timestamp'), limitToLast(100));
  msgAddedRef = ref(rtdb, `messages/${cid}`);
  onChildAdded(q, snap => {
    if (CID !== cid) return;
    appendMsg({ _key: snap.key, ...snap.val() });
  });
  // reactions/edits only — fires per changed child, NOT the whole tree
  msgChangedRef = ref(rtdb, `messages/${cid}`);
  onChildChanged(q, snap => {
    if (CID !== cid) return;
    const row = document.querySelector(`[data-mid="${snap.key}"]`);
    if (row) drawReacts(row.querySelector('[data-rr]'), { _key: snap.key, ...snap.val() });
  });
}

async function appendMsg(msg) {
  const wrap = $('msgs'); if (!wrap) return;
  // de-dupe: never render the same message id twice (replays, double listeners…)
  if (msg._key && (wrap.querySelector(`[data-mid="${msg._key}"]`) || renderedMids.has(msg._key))) return;
  if (msg._key) renderedMids.add(msg._key);
  const ph = wrap.querySelector('[data-ph]'); if (ph) ph.remove();

  const d = fmtDate(msg.timestamp);
  if (d !== lastMsgDate) {
    lastMsgDate = d;
    const div = mk('div'); div.className = 'date-div'; div.textContent = d;
    wrap.appendChild(div);
    lastMsgSender = '';
  }

  const mine = msg.senderId === ME.uid;
  const grouped = msg.senderId === lastMsgSender && msgCount > 0;
  lastMsgSender = msg.senderId;
  msgCount++;

  const row = mk('div');
  row.className = `msg-row${mine ? ' mine' : ''}${grouped ? ' grp' : ''}`;
  row.dataset.mid = msg._key;
  if (msg.senderId === BOT_ID) row.dataset.bot = '1';

  const avw = mk('div'); avw.className = 'msg-av';
  if (!mine) avw.appendChild(avEl({ avatar: msg.senderAvatar || 'dragon', photoURL: msg.senderPhoto || '' }, 28));
  row.appendChild(avw);

  const content = mk('div'); content.className = 'msg-content';

  if (CTYPE === 'group' && !mine && !grouped) {
    const sn = mk('div'); sn.className = 'msg-sender'; sn.textContent = msg.senderName || 'Unknown';
    content.appendChild(sn);
  }

  // decrypt payload
  let payload = null, locked = false;
  if (msg.ct) {
    if (decrypted[msg._key]) payload = decrypted[msg._key];
    else {
      let key = null;
      if (ACTIVE.mode === 'dm' && ACTIVE.key) key = ACTIVE.key;
      else if (ACTIVE.mode === 'room') key = await roomKeyForEpoch(CID, msg.e || ACTIVE.epoch || 1);
      if (key) {
        payload = await decryptPayload(key, msg.ct);
        if (payload) decrypted[msg._key] = payload;
      }
      // fallback: try every epoch this device holds (mis-tagged/older sends)
      if (!payload && ACTIVE.mode === 'room') {
        for (const ep of Object.keys(readRoomStore(CID).epochs)) {
          if (Number(ep) === (msg.e || ACTIVE.epoch || 1)) continue;
          const k2 = await roomKeyForEpoch(CID, Number(ep));
          if (!k2) continue;
          payload = await decryptPayload(k2, msg.ct);
          if (payload) { decrypted[msg._key] = payload; break; }
        }
      }
      // DM late-key upgrade: peer's publicKey may have landed after we opened the chat
      if (!payload && CTYPE === 'dm' && ACTIVE.mode !== 'dm') {
        const now = Date.now();
        if (now - lastDmUpgrade > 4000) {
          lastDmUpgrade = now;
          try {
            const ou = CDATA?.otherUid || CDATA?.uid;
            if (ou) {
              const od = await getDoc(doc(db, 'users', ou));
              const pub2 = od.data()?.publicKey;
              if (pub2) {
                const k3 = await deriveDMKey(ME.uid, ou, pub2);
                payload = await decryptPayload(k3, msg.ct);
                if (payload) { decrypted[msg._key] = payload; ACTIVE = { mode: 'dm', key: k3, epoch: 0 }; }
              }
            }
          } catch (_) {}
        }
      }
      if (!payload) locked = true;
    }
  } else {
      payload = { t: msg.text || '', i: msg.i || undefined, plain: true };
      decrypted[msg._key] = payload;
    }

  // locked messages collapse into a single honest notice instead of a wall of bubbles
  if (locked) {
    let note = wrap.querySelector('[data-locknote]');
    if (!note) {
      note = mk('div'); note.className = 'lock-note'; note.dataset.locknote = '1';
      note.innerHTML =
        icon('lock', '', 14) +
        `<span class="ln-txt">0 encrypted messages locked</span>` +
        `<span class="ln-why">This device doesn't hold their key — sent from another device/epoch, or before a browser reset. If BOTH sides see locked messages, press New epoch once: every device then converges on the fresh epoch and new messages flow normally.</span>` +
        `<span class="ln-btns"></span>`;
      const btns = note.querySelector('.ln-btns');
      const b1 = mk('button'); b1.className = 'btn-ghost'; b1.style.cssText = 'padding:5px 12px;font-size:9px';
      b1.innerHTML = icon('refresh', '', 11) + ' Retry key'; b1.onclick = () => retryUnlock();
      const b2 = mk('button'); b2.className = 'btn-ghost'; b2.style.cssText = 'padding:5px 12px;font-size:9px';
      b2.innerHTML = icon('key', '', 11) + ' New epoch'; b2.onclick = () => rekeyRoom(CID);
      const b3 = mk('button'); b3.className = 'btn-ghost'; b3.style.cssText = 'padding:5px 10px;font-size:9px';
      b3.innerHTML = icon('x', '', 11) + ' Hide'; b3.onclick = () => note.remove();
      btns.appendChild(b1); btns.appendChild(b2); btns.appendChild(b3);
      wrap.appendChild(note);
    }
    const n = (Number(note.dataset.count || 0) + 1);
    note.dataset.count = n;
    note.querySelector('.ln-txt').textContent = `${n} encrypted message${n !== 1 ? 's' : ''} locked`;
    const nearBottom2 = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 200;
    if (nearBottom2) wrap.scrollTop = wrap.scrollHeight;
    return;
  }

  // reply quote (new encrypted format, plus legacy v1 plaintext quotes)
  const r = payload?.r || (msg.replyTo ? { k: msg.replyTo.msgId, s: msg.replyTo.senderName, legacy: msg.replyTo.text } : null);
  if (r) {
    const rq = mk('div'); rq.className = 'rq';
    const src = decrypted[r.k];
    const snippet = src?.t ?? r.legacy ?? '';
    rq.innerHTML = `<div class="rq-s">${icon('reply', '', 10)} ${esc(r.s)}</div><div class="rq-t">${snippet ? esc(String(snippet).substring(0, 60)) : 'Encrypted message'}</div>`;
    content.appendChild(rq);
  }

  const b = mk('div'); b.className = 'bubble';
  if (locked) {
    b.classList.add('locked');
    b.innerHTML = icon('lock', '', 13) + ' <span>Encrypted — key not available on this device</span>';
    const ub = mk('button'); ub.className = 'mac unlock-btn'; ub.title = 'Try to fetch the key again';
    ub.innerHTML = icon('refresh', '', 13);
    ub.onclick = ev => { ev.stopPropagation(); retryUnlock(); };
    b.appendChild(ub);
  } else {
    if (payload.t) {
      const p = mk('div'); p.className = 'msg-text';
      p.innerHTML = linkify(esc(payload.t)).replace(/\n/g, '<br>');
      b.appendChild(p);
    }
    if (payload.i?.length) {
      const grid = mk('div'); grid.className = 'msg-imgs' + (payload.i.length > 1 ? ' multi' : '');
      payload.i.forEach(url => {
        const img = mk('img'); img.src = url; img.loading = 'lazy'; img.alt = 'attachment';
        img.onclick = () => openLightbox(url);
        grid.appendChild(img);
      });
      b.appendChild(grid);
    }
    if (!payload.t && !payload.i?.length) b.appendChild(document.createTextNode(' '));
  }

  // hover actions
  const acts = mk('div'); acts.className = 'msg-actions';
  REACTIONS.forEach(rct => {
    const ab = mk('button'); ab.className = 'mac'; ab.title = 'React';
    ab.innerHTML = icon(rct.id, '', 14);
    ab.onclick = ev => { ev.stopPropagation(); doReact(CID, msg._key, rct.id); };
    acts.appendChild(ab);
  });
  const rb = mk('button'); rb.className = 'mac'; rb.title = 'Reply'; rb.innerHTML = icon('reply', '', 14);
  rb.onclick = ev => { ev.stopPropagation(); setReply(msg, payload); };
  acts.appendChild(rb);
  const cb = mk('button'); cb.className = 'mac'; cb.title = 'Copy'; cb.innerHTML = icon('copy', '', 14);
  cb.onclick = ev => { ev.stopPropagation(); navigator.clipboard?.writeText(payload?.t || '').then(() => toast('Copied', 'ok')); };
  acts.appendChild(cb);
  if (mine) {
    const db_ = mk('button'); db_.className = 'mac danger'; db_.title = 'Delete'; db_.innerHTML = icon('trash', '', 14);
    db_.onclick = ev => { ev.stopPropagation(); remove(ref(rtdb, `messages/${CID}/${msg._key}`)); };
    acts.appendChild(db_);
  }
  b.appendChild(acts);
  content.appendChild(b);

  const rr = mk('div'); rr.className = 'reacts'; rr.dataset.rr = '1';
  if (msg.reactions) drawReacts(rr, msg);
  content.appendChild(rr);

  const tm = mk('div'); tm.className = 'msg-time';
  tm.innerHTML = fmtTime(msg.timestamp) + (msg.ct ? ' ' + icon('lock', '', 9) : '');
  content.appendChild(tm);

  row.appendChild(content);
  wrap.appendChild(row);

  const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 140;
  if (nearBottom || mine) wrap.scrollTop = wrap.scrollHeight;
  else $('jump-btn').classList.add('show');

  if (CID) markSeen(CID);
}

function drawReacts(container, msg) {
  if (!container) return;
  if (!msg.reactions) { container.innerHTML = ''; return; }
  const html = Object.entries(msg.reactions).map(([key, users]) => {
    const uids = Object.keys(users || {}); if (!uids.length) return '';
    const me = uids.includes(ME.uid);
    const label = key.startsWith('r-') || ['heart', 'flame'].includes(key)
      ? icon(reactionIconId(key), '', 12)
      : esc(key);
    return `<div class="rc${me ? ' me' : ''}" data-react="${esc(key)}">${label} <span>${uids.length}</span></div>`;
  }).join('');
  if (container.innerHTML !== html) container.innerHTML = html;
  container.querySelectorAll('[data-react]').forEach(el => {
    el.onclick = () => doReact(CID, msg._key, el.dataset.react);
  });
}

window.doReact = async function (cid, key, emoji) {
  const path = `messages/${cid}/${key}/reactions/${emoji}/${ME.uid}`;
  const r = ref(rtdb, path);
  const snap = await get(r);
  if (snap.exists()) await remove(r); else await set(r, true);
};

// ─── REPLY ────────────────────────────────────────────
function setReply(msg, payload) {
  replyTo = { k: msg._key, s: msg.senderName || MY.username };
  $('reply-bar').classList.add('show');
  $('rb-sender').textContent = replyTo.s;
  $('rb-text').textContent = payload?.t ? String(payload.t).substring(0, 60) : (msg.ct ? 'Encrypted message' : '');
  $('msg-ta').focus();
}
window.cancelReply = function () { replyTo = null; $('reply-bar').classList.remove('show'); };

// ─── TYPING ───────────────────────────────────────────
window.notifyTyping = function () {
  if (!CID || CTYPE === 'ai') return;
  const tr = ref(rtdb, `typing/${CID}/${ME.uid}`);
  set(tr, MY.username || 'Someone');
  clearTimeout(typTimer);
  typTimer = setTimeout(() => remove(tr).catch(() => {}), 2500);
};

function attachTypingListener(cid) {
  const tr = ref(rtdb, `typing/${cid}`);
  typRef = tr;
  onValue(tr, snap => {
    const names = []; snap.forEach(c => { if (c.key !== ME.uid) names.push(c.val()); });
    const row = $('typing-row');
    if (row) { row.style.visibility = names.length ? 'visible' : 'hidden'; $('typing-txt').textContent = names.length ? `${names[0]} is typing...` : ''; }
  });
}

// ─── IMAGE ATTACHMENTS ────────────────────────────────
window.attachFiles = function (files) {
  [...files].slice(0, 4).forEach(async file => {
    if (!file.type?.startsWith('image/')) { toast('Only images can be attached', 'err'); return; }
    const id = 'p' + Math.random().toString(36).slice(2, 8);
    pendingImages.push({ id, url: null, status: 'loading', preview: URL.createObjectURL(file) });
    renderPending();
    try {
      const url = await api.uploadImage(file);
      const p = pendingImages.find(x => x.id === id);
      if (p) { p.url = url; p.status = 'done'; }
    } catch (e) {
      const p = pendingImages.find(x => x.id === id);
      if (p) p.status = 'error';
      toast('Upload failed: ' + e.message, 'err');
    }
    renderPending();
  });
};
function renderPending() {
  const strip = $('pending-strip'); if (!strip) return;
  strip.innerHTML = '';
  strip.style.display = pendingImages.length ? 'flex' : 'none';
  pendingImages.forEach(p => {
    const chip = mk('div'); chip.className = 'pchip' + (p.status === 'error' ? ' err' : '');
    const img = mk('img'); img.src = p.preview; chip.appendChild(img);
    if (p.status === 'loading') { const s = mk('div'); s.className = 'ring sm pspin'; chip.appendChild(s); }
    if (p.status === 'error') { const s = mk('div'); s.className = 'perr'; s.innerHTML = icon('alert', '', 14); chip.appendChild(s); }
    const x = mk('button'); x.className = 'px'; x.innerHTML = icon('x', '', 10);
    x.onclick = () => { pendingImages = pendingImages.filter(y => y.id !== p.id); renderPending(); };
    chip.appendChild(x);
    strip.appendChild(chip);
  });
}
window.openLightbox = function (url) {
  $('lb-img').src = url;
  $('lightbox').classList.add('open');
};
window.closeLightbox = function () { $('lightbox').classList.remove('open'); };

// paste + drag-drop
document.addEventListener('paste', e => {
  if (!CID) return;
  const items = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/'));
  if (items.length) { e.preventDefault(); attachFiles(items.map(i => i.getAsFile())); }
});
document.addEventListener('DOMContentLoaded', () => {
  const cv = $('cv');
  cv?.addEventListener('dragover', e => { e.preventDefault(); cv.classList.add('drag'); });
  cv?.addEventListener('dragleave', () => cv.classList.remove('drag'));
  cv?.addEventListener('drop', e => {
    e.preventDefault(); cv.classList.remove('drag');
    if (e.dataTransfer?.files?.length) attachFiles(e.dataTransfer.files);
  });
});

// ─── SEND MESSAGE ─────────────────────────────────────
window.sendMsg = async function () {
  const ta = $('msg-ta'); if (!ta) return;
  const text = ta.value.trim();
  const imgs = pendingImages.filter(p => p.status === 'done').map(p => p.url);
  if ((!text && !imgs.length) || !CID) return;
  if (pendingImages.some(p => p.status === 'loading')) { toast('Still uploading…', 'err'); return; }
  if (CTYPE === 'group' && ACTIVE.mode === 'none') { toast('Encryption keys not synced yet — retry from the banner', 'err'); return; }

  const clear = () => {
    ta.value = ''; ta.style.height = '40px'; ta.style.overflowY = 'hidden';
    pendingImages = []; renderPending();
    cancelReply();
    if (CID && CTYPE !== 'ai') remove(ref(rtdb, `typing/${CID}/${ME.uid}`)).catch(() => {});
    if (epOpen) toggleEp();
  };

  const plainPush = async t => {
    await push(ref(rtdb, `messages/${CID}`), {
      text: t, senderId: ME.uid, senderName: MY.username || 'Unknown',
      senderAvatar: MY.avatar || 'dragon', senderPhoto: MY.photoURL || '',
      timestamp: Date.now(), reactions: null
    });
  };

  // commands
  const isCmd = await parseCommand(ME.uid, MY.username, CID, text, plainPush);
  if (isCmd) { clear(); return; }

  // last-minute DM upgrade: peer's keys may have landed since we opened the chat
  if (CTYPE === 'dm' && ACTIVE.mode === 'legacy' && CDATA?.otherUid) {
    try {
      const od = await getDoc(doc(db, 'users', CDATA.otherUid));
      const pub2 = od.data()?.publicKey;
      if (pub2) ACTIVE = { mode: 'dm', key: await deriveDMKey(ME.uid, CDATA.otherUid, pub2), epoch: 0 };
    } catch (_) {}
  }

  // AI room — plaintext by design (the AI must read it)
  if (CTYPE === 'ai') {
    await plainPush(text);
    clear();
    $('typing-row').style.visibility = 'visible';
    $('typing-txt').textContent = 'Hydra AI is thinking...';
    setTimeout(async () => {
      await handleAIChat(ME.uid, MY.username, text);
      $('typing-row').style.visibility = 'hidden';
    }, 350);
    return;
  }

  if (ACTIVE.mode === 'dm' || ACTIVE.mode === 'room') {
    // never hand a null key to WebCrypto (that silently killed the send button)
    if (!ACTIVE.key) {
      if (ACTIVE.mode === 'room') ACTIVE.key = await currentRoomKey(CID);
      else if (CDATA?.otherUid) {
        try {
          const od = await getDoc(doc(db, 'users', CDATA.otherUid));
          const pub2 = od.data()?.publicKey;
          if (pub2) ACTIVE.key = await deriveDMKey(ME.uid, CDATA.otherUid, pub2);
        } catch (_) {}
      }
    }
    if (!ACTIVE.key) { toast('Encryption key not ready yet — press Retry key / open the room again', 'err'); return; }
    try {
      const payload = { t: text, i: imgs, r: replyTo || null };
      const ct = await encryptPayload(ACTIVE.key, payload);
      // NB: RTDB rejects `undefined` VALUES — only set keys we actually have
      const obj = {
        ct,
        img: imgs.length ? 1 : 0,
        senderId: ME.uid, senderName: MY.username || 'Unknown',
        senderAvatar: MY.avatar || 'dragon', senderPhoto: MY.photoURL || '',
        timestamp: Date.now(), reactions: null
      };
      if (ACTIVE.mode === 'room') obj.e = ACTIVE.epoch || 1;
      const pushResult = await push(ref(rtdb, `messages/${CID}`), obj);
      decrypted[pushResult.key] = payload;   // own messages always render, even pre-listener
      if (CTYPE === 'group') moderateMessage(CID, pushResult.key, ME.uid, MY.username || 'Unknown', text).catch(() => {});
      try {
        const col = CTYPE === 'dm' ? 'chats' : 'groups';
        await updateDoc(doc(db, col, CID), { lastMessage: imgs.length && !text ? 'Photo' : 'Encrypted message', lastTime: serverTimestamp() });
      } catch (_) {}
    } catch (e) {
      console.error('send failed:', e);
      toast('Send failed: ' + (e.message || e), 'err');
      return;   // keep the typed text so nothing is lost
    }
  } else {
    // legacy plaintext fallback (peer has no E2EE keys yet) — images included
    const msg = {
      text,
      senderId: ME.uid, senderName: MY.username || 'Unknown',
      senderAvatar: MY.avatar || 'dragon', senderPhoto: MY.photoURL || '',
      timestamp: Date.now(), reactions: null
    };
    if (imgs.length) msg.i = imgs;
    if (replyTo) msg.replyTo = { msgId: replyTo.k, text: decrypted[replyTo.k]?.t || '', senderName: replyTo.s };
    await push(ref(rtdb, `messages/${CID}`), msg);
    try {
      const col = CTYPE === 'dm' ? 'chats' : 'groups';
      await updateDoc(doc(db, col, CID), { lastMessage: text, lastTime: serverTimestamp() });
    } catch (_) {}
  }

  updateDoc(doc(db, 'users', ME.uid), { sentCount: increment(1) }).catch(() => {});
  clear();
};

window.taKey = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMsg(); } };
window.taResize = function (ta) {
  ta.style.height = '40px';
  const h = Math.min(ta.scrollHeight, 130);
  ta.style.height = h + 'px';
  ta.style.overflowY = h >= 130 ? 'auto' : 'hidden';
};

// ─── EMOJI (message content — stays Unicode, like a keyboard) ──
const EMOJIS = '😀😁😂🤣😄😆😉😊😎😍🥰😘🤩😏😒😞😔😕🙁😣😫😩🥺😢😭😤😠😡🤬😱😨😰😓🤗🤫😶😐😑😬🙄😯😦😧😮🥱😴😵🤢🤧😷🤒🤕🤑🤠💪👋👎✊👊🤞✌💃🎉🎊🎈🎁🏆⚡💎🔮⭐🌟💫✨🌸🌺🌻🌹🍀🌿🦋🐉🦊🦁🐯🐺';
function buildEmojiPanel() {
  const g = $('ep-grid'); if (!g) return; g.innerHTML = '';
  [...EMOJIS].forEach(e => {
    if (!e.trim()) return;
    const b = mk('button'); b.className = 'epb'; b.textContent = e;
    b.onclick = () => { const ta = $('msg-ta'); if (ta) { ta.value += e; ta.focus(); } toggleEp(); };
    g.appendChild(b);
  });
}
window.toggleEp = function () { epOpen = !epOpen; $('ep').classList.toggle('open', epOpen); };
document.addEventListener('click', e => { if (epOpen && !e.target.closest('#ep') && !e.target.closest('#emoji-btn')) toggleEp(); });

// ─── ONLINE PRESENCE PANEL ────────────────────────────
function watchPresence() {
  onValue(ref(rtdb, 'presence'), async snap => {
    const uids = []; snap.forEach(c => { if (c.val().online && c.key !== ME.uid) uids.push(c.key); });
    const panel = $('rp-list'); if (!panel) return;
    panel.innerHTML = '';
    if (!uids.length) { panel.innerHTML = '<div style="padding:18px;color:var(--faint);font-size:11px;text-align:center">No one online</div>'; return; }
    for (const uid of uids.slice(0, 20)) {
      try {
        const ud = await getDoc(doc(db, 'users', uid)); if (!ud.exists()) continue;
        const u = ud.data();
        const item = mk('div'); item.className = 'rp-u';
        const avw = mk('div'); avw.className = 'rp-av'; avw.appendChild(avEl(u, 30));
        const dot = mk('div'); dot.className = 'rp-dot'; avw.appendChild(dot);
        item.appendChild(avw);
        const info = mk('div'); info.style.cssText = 'flex:1;min-width:0';
        info.innerHTML = `<div class="rp-name">${esc(u.username)}</div><div class="rp-ct">${flagImg(u.country, 12)} ${esc(countryName(u.country))}</div>`;
        item.appendChild(info);
        const isFriend = friends.has(uid);
        const btn = mk('button'); btn.className = 'sm-btn' + (isFriend ? ' fr' : '');
        btn.innerHTML = isFriend ? icon('msg', '', 11) : '+ Add';
        btn.onclick = () => isFriend ? startDM(uid) : sendFReq(uid, u.username, btn);
        item.appendChild(btn); panel.appendChild(item);
      } catch (_) {}
    }
  });
}

// ─── CREATE GROUP ─────────────────────────────────────
window.openCreateGroup = function () {
  const ov = mkOv(); let selIcon = AVATARS[0];
  ov.innerHTML = `<div class="modal">
    <button class="modal-close" data-close>${icon('x', '', 18)}</button>
    <h2>CREATE GROUP</h2>
    <div class="ig"><label>Name *</label><input class="ii" id="mg-n" placeholder="Name your realm..."></div>
    <div class="ig"><label>Description</label><input class="ii" id="mg-d" placeholder="What's this about?"></div>
    <div class="ig"><label>Visibility</label>
      <select class="ii" id="mg-v">
        <option value="public">Public — anyone can join</option>
        <option value="private">Private — invite code only</option>
      </select>
    </div>
    <div class="ig"><label>Emblem</label><div class="icon-grid" id="ig-g"></div></div>
    <button class="btn-gold" style="width:100%;justify-content:center;margin-top:8px" id="mg-create">CREATE REALM</button>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-close]').onclick = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#mg-create').onclick = () => doCreateGroup();
  const grid = ov.querySelector('#ig-g');
  window._gi = selIcon;
  AVATARS.forEach(a => {
    const s = mk('span'); s.className = 'ig-item' + (a === selIcon ? ' on' : '');
    s.appendChild(iconEl('av-' + a, '', 22));
    s.onclick = () => {
      selIcon = a; window._gi = a;
      grid.querySelectorAll('.ig-item').forEach(x => x.classList.remove('on'));
      s.classList.add('on');
    };
    grid.appendChild(s);
  });
};

window.doCreateGroup = async function () {
  const name = document.getElementById('mg-n')?.value.trim();
  const desc = document.getElementById('mg-d')?.value.trim();
  const vis = document.getElementById('mg-v')?.value || 'public';
  if (!name) { toast('Enter a group name', 'err'); return; }
  const code = name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 5);
  const cr = await addDoc(collection(db, 'groups'), {
    name, description: desc || '', icon: window._gi || 'dragon', members: [ME.uid], createdBy: ME.uid,
    type: 'custom', createdAt: serverTimestamp(), lastMessage: '', lastTime: serverTimestamp(),
    visibility: vis, joinCode: code, e2eeEpoch: 0
  });
  // mint epoch 1 room key now so every future member can get it
  const raw = newRoomKeyRaw();
  const st = readRoomStore(cr.id); st.epochs[1] = raw; st.current = 1; writeRoomStore(cr.id, st);
  await publishMyKey(cr.id, raw, 1);
  await updateDoc(doc(db, 'groups', cr.id), { e2eeEpoch: 1 }).catch(() => {});
  document.querySelector('.overlay')?.remove();
  toast('Group created — E2EE keys ready', 'ok');
  switchTab('groups', document.querySelector('[data-tab="groups"]'));
};

// ─── GROUP INFO ───────────────────────────────────────
async function openGroupInfo() {
  if (!CID) return;
  const snap = await getDoc(doc(db, 'groups', CID)); if (!snap.exists()) return;
  const g = snap.data(); const isOwner = g.createdBy === ME.uid;
  const st = readRoomStore(CID);
  const ov = mkOv();
  ov.innerHTML = `<div class="modal wide">
    <button class="modal-close" data-close>${icon('x', '', 18)}</button>
    <h2>${esc(g.name)}</h2>
    <p style="text-align:center;color:var(--dim);font-size:13px;margin-bottom:14px">${esc(g.description || 'No description')}</p>
    <div style="text-align:center;font-size:10px;letter-spacing:2px;color:var(--dim);margin-bottom:14px">
      ${g.members?.length || 0} MEMBERS · ${g.visibility === 'private' ? 'PRIVATE' : 'PUBLIC'} · EPOCH ${g.e2eeEpoch || 1}
    </div>
    ${g.joinCode ? `<div class="code-display"><div style="font-size:9px;letter-spacing:2px;color:var(--dim);margin-bottom:6px">INVITE CODE</div>
      <div class="code-val">${esc(g.joinCode)}</div>
      <button class="btn-ghost" style="font-size:11px;padding:6px 14px;margin-top:8px" id="copy-code">${icon('copy', '', 12)} Copy</button></div>` : ''}
    <div class="e2ee-box">${icon('lock', '', 14)}<div><b>End-to-end encrypted.</b> Keys are wrapped per member (epoch ${st.current || 1}).
      ${st.epochs[st.current] ? 'You hold this room’s key.' : 'You do not hold this room’s key yet.'}</div></div>
    <div class="member-strip" id="mi-members"></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn-ghost" style="flex:1" id="share-keys">${icon('key', '', 12)} Share keys</button>
      <button class="btn-ghost" style="flex:1" id="rekey-btn">${icon('refresh', '', 12)} New epoch</button>
    </div>
    ${isOwner ? `<button class="btn-danger" id="del-grp">DELETE GROUP</button>` : ''}
    <button class="btn-leave" id="leave-grp">LEAVE GROUP</button>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-close]').onclick = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#copy-code')?.addEventListener('click', () =>
    navigator.clipboard.writeText(g.joinCode).then(() => toast('Copied!', 'ok')));
  ov.querySelector('#share-keys').onclick = async () => { await shareRoomKeys(CID, g.members || []); toast('Keys shared with members', 'ok'); };
  ov.querySelector('#rekey-btn').onclick = () => { if (confirm('Start a new encryption epoch? Members will resync keys; very old messages may become unreadable for those without the old key.')) { ov.remove(); rekeyRoom(CID); } };
  ov.querySelector('#del-grp')?.addEventListener('click', () => doDeleteGroup(CID));
  ov.querySelector('#leave-grp').onclick = () => doLeaveGroup(CID);

  const strip = ov.querySelector('#mi-members');
  (g.members || []).slice(0, 40).forEach(async uid => {
    try {
      const u = await getDoc(doc(db, 'users', uid)); if (!u.exists()) return;
      const chip = mk('div'); chip.className = 'mchip';
      chip.appendChild(avEl(u.data(), 26));
      const s = mk('span'); s.textContent = u.data().username; chip.appendChild(s);
      strip.appendChild(chip);
    } catch (_) {}
  });
}
window.openGroupInfo = openGroupInfo;

window.doLeaveGroup = async function (gid) {
  await updateDoc(doc(db, 'groups', gid), { members: arrayRemove(ME.uid) });
  document.querySelector('.overlay')?.remove();
  CID = null; $('cv').classList.remove('open'); $('empty').style.display = 'flex';
  toast('Left group'); switchTab('groups', document.querySelector('[data-tab="groups"]'));
};
window.doDeleteGroup = async function (gid) {
  if (!confirm('Delete this group and all messages?')) return;
  await deleteDoc(doc(db, 'groups', gid));
  await remove(ref(rtdb, `messages/${gid}`));
  document.querySelector('.overlay')?.remove();
  CID = null; $('cv').classList.remove('open'); $('empty').style.display = 'flex';
  toast('Deleted'); switchTab('groups', document.querySelector('[data-tab="groups"]'));
};

// ─── MISC UI ──────────────────────────────────────────
window.jumpBottom = function () {
  const w = $('msgs'); w.scrollTop = w.scrollHeight;
  $('jump-btn').classList.remove('show');
};
document.addEventListener('scroll', e => {
  if (e.target?.id === 'msgs') {
    const w = e.target;
    const near = w.scrollHeight - w.scrollTop - w.clientHeight < 140;
    if (near) $('jump-btn').classList.remove('show');
  }
}, true);

window.goProfile = () => window.location.href = 'profile.html';
window.doLogout = async function () {
  if (!confirm('Sign out?')) return;
  try { await set(ref(rtdb, `presence/${ME.uid}`), { online: false, uid: ME.uid, lastSeen: rtTs() }); } catch (_) {}
  await signOut(auth); window.location.href = 'login.html';
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeLightbox();
    document.querySelector('.overlay')?.remove();
    if (epOpen) toggleEp();
  }
});
