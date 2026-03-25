/**
 * Hidden Hydra — chat.js FINAL
 * Clean rewrite. Two root bugs fixed:
 * 1. Groups infinite loading — removed != query (needs Firestore composite index)
 * 2. Messages after first not showing — simplified onValue, no complex state
 */

import { initializeApp }     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
                              from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDatabase, ref, set, push, remove, onValue, off,
  serverTimestamp as rtTs, onDisconnect,
  query as rq, orderByChild, limitToLast, get, update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ─── CONFIG ───────────────────────────────────────────
const app  = initializeApp({
  apiKey:            "AIzaSyCj5A6GpHYppmaqZqY39HmIAID2jZv3eAM",
  authDomain:        "hidden-hydra.firebaseapp.com",
  databaseURL:       "https://hidden-hydra-default-rtdb.firebaseio.com",
  projectId:         "hidden-hydra",
  storageBucket:     "hidden-hydra.firebasestorage.app",
  messagingSenderId: "1487060887",
  appId:             "1:1487060887:web:402fea888cdf486f8d0ed2"
});
const auth = getAuth(app);
const db   = getFirestore(app);
const rtdb = getDatabase(app);

// ─── CONSTANTS ────────────────────────────────────────
const REACT = ['👍','❤️','😂','😮','😢','🔥','👏','🎉'];
const EMOJIS = '😀😁😂🤣😄😅😆😉😊😋😎😍🥰😘🤩🥳😏😒😞😔😕🙁😣😫😩🥺😢😭😤😠😡🤬😱😨😰😓🤗🤔🤫🤥😶😐😑😬🙄😯😦😧😮🥱😴😪😵🤢🤧😷🤒🤕🤑🤠💪🤝👋👍👎✊👊🤞✌💃🎉🎊🎈🎁🏆🔥⚡🌊💎👑🔮🌙⭐🌟💫✨🌸🌺🌻🌹🍀🌿🦋🐉🦊🦁🐯🐺';
const AVICS = ['🐉','🦊','🐺','🦁','🐯','🦋','🔥','⚡','🌙','💎','🌊','🦅','🐬','🦝','🎭','🌸','🐙','🦄','⭐'];
const GLOBAL_ROOMS = [
  {id:'g-lounge',  name:'Global Lounge', icon:'🌍', desc:'Talk to everyone worldwide!'},
  {id:'g-gaming',  name:'Gaming Den',    icon:'🎮', desc:'All platforms, all games.'},
  {id:'g-tech',    name:'Tech Talk',     icon:'🚀', desc:'Developers & tech lovers.'},
  {id:'g-music',   name:'Music Vibes',   icon:'🎵', desc:'Share music & artists.'},
  {id:'g-creative',name:'Creative Hub',  icon:'🎨', desc:'Art, design, photography.'},
];

// ─── STATE ────────────────────────────────────────────
let ME = null, MY = null;
let activeChatId   = null;   // current open chat id
let activeChatType = null;   // 'dm' | 'group'
let activeChatData = null;   // profile or group object
let replyTo  = null;
let epOpen   = false;
let typTimer = null;

// Listener cleanup functions — called before attaching new listeners
let stopMsgs   = null;   // onValue unsub for messages
let stopTyping = null;   // ref we need to off()
let stopDMs    = null;   // onSnapshot unsub
let stopGroups = null;   // onSnapshot unsub

// Message render state — keyed per chat, reset on each open
let seenKeys  = new Set();  // message keys already in DOM
let reactCache= {};         // key -> JSON(reactions) for diffing

// ─── UTILS ────────────────────────────────────────────
const $   = id  => document.getElementById(id);
const mk  = tag => document.createElement(tag);
const esc = s   => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function toast(msg, type='') {
  const tc = $('toasts'); if (!tc) return;
  const t = mk('div'); t.className = 'toast'+(type?' '+type:''); t.textContent = msg;
  tc.appendChild(t); setTimeout(() => t.remove(), 3200);
}
window.toast = toast;

function avEl(p, size=40) {
  const w = mk('div');
  w.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;` +
    `display:flex;align-items:center;justify-content:center;` +
    `font-size:${Math.floor(size*.46)}px;background:var(--s3);flex-shrink:0;`;
  const url = p?.photoURL;
  if (url && url.length > 8) {
    const img = mk('img');
    img.src = url;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    img.onerror = () => { w.innerHTML = ''; w.textContent = p?.avatar||'🐉'; };
    w.appendChild(img);
  } else {
    w.textContent = p?.avatar || '🐉';
  }
  return w;
}

const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
function fmtDate(ts) {
  if (!ts) return 'Today';
  const d = new Date(ts), n = new Date();
  if (d.toDateString() === n.toDateString()) return 'Today';
  const y = new Date(n); y.setDate(n.getDate()-1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}

function setList(html) { const c = $('cl'); if (c) c.innerHTML = html; }
function mkLabel(t) { const d=mk('div'); d.className='sec-lbl'; d.textContent=t; return d; }
function mkOv()     { const o=mk('div'); o.className='overlay'; return o; }

function makeCiRow() {
  const row = mk('div'); row.className = 'ci';
  const av  = mk('div'); av.className  = 'ci-av'; row.appendChild(av);
  const m   = mk('div'); m.className   = 'ci-meta';
  const n   = mk('div'); n.className   = 'ci-name'; m.appendChild(n);
  const p   = mk('div'); p.className   = 'ci-prev'; m.appendChild(p);
  row.appendChild(m);
  return row;
}

// ─── AUTH + BOOT ──────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'login.html'; return; }
  ME = user;
  const snap = await getDoc(doc(db, 'users', ME.uid));
  if (!snap.exists()) { window.location.href = 'login.html'; return; }
  MY = snap.data();
  setupPresence();
  await seedGlobalRooms();
  boot();
});

function setupPresence() {
  const pr = ref(rtdb, `presence/${ME.uid}`);
  set(pr, {online:true, uid:ME.uid, lastSeen:rtTs()});
  onDisconnect(pr).set({online:false, uid:ME.uid, lastSeen:rtTs()});
}

// Idempotent — only creates rooms that don't exist yet
async function seedGlobalRooms() {
  for (const g of GLOBAL_ROOMS) {
    const snap = await getDoc(doc(db, 'groups', g.id));
    if (!snap.exists()) {
      await setDoc(doc(db, 'groups', g.id), {
        ...g, type:'global', visibility:'public', joinCode:g.id,
        members:[], createdBy:'system',
        createdAt:serverTimestamp(), lastMessage:'', lastTime:serverTimestamp()
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
  switchTab('world', document.querySelector('[data-t="world"]'));
}

function renderMe() {
  const a = $('me-av'); a.innerHTML = ''; a.appendChild(avEl(MY, 40));
  $('me-name').textContent = MY.username || '—';
}

// ─── TABS ─────────────────────────────────────────────
window.switchTab = function(tab, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  $('fab').style.display = tab === 'groups' ? 'flex' : 'none';
  // Cancel sidebar listeners when switching away
  if (tab !== 'dms'    && stopDMs)    { stopDMs();    stopDMs    = null; }
  if (tab !== 'groups' && stopGroups) { stopGroups(); stopGroups = null; }
  if (tab === 'world')   loadWorldRooms();
  if (tab === 'dms')     loadDMs();
  if (tab === 'groups')  loadMyGroups();
  if (tab === 'explore') loadExplore();
  if (tab === 'req')     loadRequests();
};

// ─── BADGE ────────────────────────────────────────────
function watchReqBadge() {
  const q = query(collection(db,'friendRequests'),
    where('to','==',ME.uid), where('status','==','pending'));
  onSnapshot(q, snap => {
    const b = $('req-badge');
    if (b) { b.textContent = snap.size; b.style.display = snap.size ? 'flex' : 'none'; }
  });
}

// ─── WORLD ROOMS ──────────────────────────────────────
// No Firestore query needed — just render from the constant array
function loadWorldRooms() {
  const cl = $('cl'); cl.innerHTML = '';
  cl.appendChild(mkLabel('🌍 WORLD CHAT'));
  GLOBAL_ROOMS.forEach(g => {
    const row = makeCiRow();
    const av  = row.querySelector('.ci-av');
    av.style.fontSize = '22px'; av.textContent = g.icon;
    row.querySelector('.ci-name').textContent = g.name;
    row.querySelector('.ci-prev').textContent = g.desc;
    if (activeChatId === g.id) row.classList.add('on');
    row.onclick = () => openChat(g.id, 'group', {...g, type:'global'});
    cl.appendChild(row);
  });
}

// ─── DMs ──────────────────────────────────────────────
function loadDMs() {
  if (stopDMs) { stopDMs(); stopDMs = null; }
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');

  const q = query(collection(db,'chats'),
    where('members','array-contains',ME.uid),
    where('type','==','dm'),
    where('status','==','accepted'));

  // Use a local render flag to prevent concurrent async renders
  let rendering = false;

  stopDMs = onSnapshot(q, async snap => {
    if (rendering) return;
    rendering = true;

    const items = [];
    for (const d of snap.docs) {
      const data = d.data();
      const otherId = data.members.find(m => m !== ME.uid);
      if (!otherId) continue;
      try {
        const o = await getDoc(doc(db, 'users', otherId));
        if (o.exists()) items.push({id:d.id, ...data, other:o.data()});
      } catch(_) {}
    }

    rendering = false;
    const cl = $('cl'); if (!cl) return;
    cl.innerHTML = '';
    if (!items.length) {
      cl.innerHTML = '<div class="empty-lm">No conversations yet.<br>Send a friend request to start.</div>';
      return;
    }
    cl.appendChild(mkLabel('DIRECT MESSAGES'));
    items.forEach(item => {
      const row = makeCiRow();
      row.querySelector('.ci-av').appendChild(avEl(item.other, 42));
      row.querySelector('.ci-name').textContent = item.other.username || '—';
      row.querySelector('.ci-prev').textContent = item.lastMessage || 'Say hello!';
      if (activeChatId === item.id) row.classList.add('on');
      row.onclick = () => openChat(item.id, 'dm', item.other);
      cl.appendChild(row);
    });
  });
}

// ─── MY GROUPS ────────────────────────────────────────
// FIX: removed where('type','!=','global') — that needs a composite Firestore index
// Instead fetch all member groups and filter client-side
function loadMyGroups() {
  if (stopGroups) { stopGroups(); stopGroups = null; }
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');

  const q = query(collection(db,'groups'),
    where('members','array-contains',ME.uid));

  stopGroups = onSnapshot(q, snap => {
    // Filter out global rooms client-side — no index needed
    const items = snap.docs
      .map(d => ({id:d.id, ...d.data()}))
      .filter(g => g.type !== 'global');

    const cl = $('cl'); if (!cl) return;
    cl.innerHTML = '';
    if (!items.length) {
      cl.innerHTML = '<div class="empty-lm">No groups yet.<br>Create one below!</div>';
      return;
    }
    cl.appendChild(mkLabel('MY GROUPS'));
    items.forEach(g => {
      const row = makeCiRow();
      const av  = row.querySelector('.ci-av');
      av.style.fontSize = '22px'; av.textContent = g.icon || '🐉';
      row.querySelector('.ci-name').textContent = g.name;
      row.querySelector('.ci-prev').textContent =
        (g.members?.length||0)+' members'+(g.lastMessage?' · '+g.lastMessage.substring(0,25):'');
      if (activeChatId === g.id) row.classList.add('on');
      if (g.visibility === 'private') {
        const lk = mk('span'); lk.textContent = '🔒';
        lk.style.cssText = 'font-size:11px;color:var(--faint);flex-shrink:0';
        row.appendChild(lk);
      }
      row.onclick = () => openChat(g.id, 'group', g);
      cl.appendChild(row);
    });
  });
}

// ─── EXPLORE ──────────────────────────────────────────
async function loadExplore() {
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');

  const [gSnap, uSnap] = await Promise.all([
    getDocs(collection(db,'groups')),
    getDocs(collection(db,'users'))
  ]);

  // Public non-global groups not yet joined
  const pubGroups = gSnap.docs
    .map(d => ({id:d.id, ...d.data()}))
    .filter(g => g.type !== 'global' && g.visibility !== 'private' && !g.members?.includes(ME.uid));

  const users = uSnap.docs.map(d => d.data()).filter(u => u.uid !== ME.uid);

  const cl = $('cl'); cl.innerHTML = '';

  // Join-by-code bar
  const bar = mk('div'); bar.className = 'code-bar';
  const inp = mk('input'); inp.className='code-inp'; inp.id='code-inp'; inp.placeholder='Enter invite code...';
  const jbtn = mk('button'); jbtn.className='join-btn'; jbtn.textContent='JOIN'; jbtn.onclick=joinByCode;
  bar.appendChild(inp); bar.appendChild(jbtn); cl.appendChild(bar);

  if (pubGroups.length) {
    cl.appendChild(mkLabel('PUBLIC GROUPS'));
    pubGroups.forEach(g => {
      const row = mk('div'); row.className = 'ex-item';
      const av = mk('div');
      av.style.cssText = 'width:42px;height:42px;border-radius:50%;background:var(--s3);' +
        'border:1px solid var(--border);display:flex;align-items:center;justify-content:center;' +
        'font-size:22px;flex-shrink:0';
      av.textContent = g.icon || '🐉';
      const meta = mk('div'); meta.style.cssText = 'flex:1;min-width:0';
      meta.innerHTML = `<div class="ci-name">${esc(g.name)}</div>` +
        `<div class="ci-prev">${g.members?.length||0} members</div>`;
      const btn = mk('button'); btn.className='join-btn'; btn.textContent='JOIN';
      btn.onclick = () => window.joinGroup(g.id);
      row.appendChild(av); row.appendChild(meta); row.appendChild(btn);
      cl.appendChild(row);
    });
  }

  if (users.length) {
    // Refresh MY profile once before the loop
    const freshSnap = await getDoc(doc(db,'users',ME.uid)); MY = freshSnap.data();

    cl.appendChild(mkLabel('PEOPLE'));
    for (const u of users.slice(0, 40)) {
      const isFriend = MY.friends?.includes(u.uid);
      // Check if request already sent
      const reqSnap = await getDocs(query(collection(db,'friendRequests'),
        where('from','==',ME.uid), where('to','==',u.uid), where('status','==','pending')));
      const sent = !reqSnap.empty;

      const row = mk('div'); row.className = 'ex-item';
      const avw = mk('div');
      avw.style.cssText = 'width:42px;height:42px;border-radius:50%;flex-shrink:0';
      avw.appendChild(avEl(u, 42));
      const meta = mk('div'); meta.style.cssText = 'flex:1;min-width:0';
      meta.innerHTML = `<div class="ci-name">${esc(u.username)}</div>` +
        `<div class="ci-prev">${u.country||''} ${u.bio?'· '+esc(u.bio.substring(0,28)):''}</div>`;

      let btn;
      if (isFriend) {
        btn = mk('button'); btn.className='join-btn fr'; btn.textContent='💬 DM';
        btn.onclick = () => window.startDM(u.uid);
      } else if (sent) {
        btn = mk('span'); btn.className='sent-tag'; btn.textContent='SENT ✓';
      } else {
        btn = mk('button'); btn.className='join-btn'; btn.textContent='+ Add';
        btn.onclick = () => sendFReq(u.uid, u.username, btn);
      }
      row.appendChild(avw); row.appendChild(meta); row.appendChild(btn);
      cl.appendChild(row);
    }
  }
}

// ─── REQUESTS ─────────────────────────────────────────
async function loadRequests() {
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const snap = await getDocs(query(collection(db,'friendRequests'),
    where('to','==',ME.uid), where('status','==','pending')));
  const reqs = snap.docs.map(d => ({id:d.id, ...d.data()}));
  const cl = $('cl'); cl.innerHTML = '';
  cl.appendChild(mkLabel(`INCOMING (${reqs.length})`));
  if (!reqs.length) { cl.innerHTML += '<div class="empty-lm">No pending requests.</div>'; return; }
  for (const r of reqs) {
    const uDoc = await getDoc(doc(db,'users',r.from)); if (!uDoc.exists()) continue;
    const u = uDoc.data();
    const row = mk('div'); row.className = 'ex-item';
    const avw = mk('div'); avw.style.cssText='width:42px;height:42px;border-radius:50%;flex-shrink:0';
    avw.appendChild(avEl(u,42));
    const meta = mk('div'); meta.style.cssText='flex:1;min-width:0';
    meta.innerHTML = `<div class="ci-name">${esc(u.username)}</div>` +
      `<div class="ci-prev">wants to connect · ${u.country||''}</div>`;
    const wrap = mk('div'); wrap.style.cssText='display:flex;gap:5px;flex-shrink:0';
    const acc = mk('button'); acc.className='acc-btn'; acc.textContent='✓ Accept';
    acc.onclick = () => acceptReq(r, u, row);
    const rej = mk('button'); rej.className='rej-btn'; rej.textContent='✕';
    rej.onclick = () => rejectReq(r.id, row);
    wrap.appendChild(acc); wrap.appendChild(rej);
    row.appendChild(avw); row.appendChild(meta); row.appendChild(wrap);
    cl.appendChild(row);
  }
}

// ─── FRIEND REQUESTS ──────────────────────────────────
async function sendFReq(toUid, toName, btn) {
  btn.disabled = true; btn.textContent = '...';
  try {
    await addDoc(collection(db,'friendRequests'), {
      from:ME.uid, to:toUid, fromName:MY.username, toName,
      status:'pending', createdAt:serverTimestamp()
    });
    btn.className = 'sent-tag'; btn.textContent = 'SENT ✓'; btn.disabled = false;
    toast('Request sent!','ok');
  } catch(e) { toast('Error: '+e.message,'err'); btn.disabled=false; btn.textContent='+ Add'; }
}

async function acceptReq(req, fromUser, rowEl) {
  try {
    await updateDoc(doc(db,'friendRequests',req.id), {status:'accepted'});
    await updateDoc(doc(db,'users',ME.uid), {friends:arrayUnion(req.from)});
    // Create DM chat
    const existing = await getDocs(query(collection(db,'chats'),
      where('members','array-contains',ME.uid), where('type','==','dm')));
    let cid = null;
    existing.forEach(d => { if (d.data().members.includes(req.from)) cid = d.id; });
    if (!cid) {
      const cr = await addDoc(collection(db,'chats'), {
        type:'dm', members:[ME.uid,req.from], status:'accepted',
        lastMessage:'', lastTime:serverTimestamp()
      });
      cid = cr.id;
    } else {
      await updateDoc(doc(db,'chats',cid), {status:'accepted'});
    }
    rowEl.remove();
    const s = await getDoc(doc(db,'users',ME.uid)); MY = s.data();
    toast(`Connected with ${fromUser.username}! 🎉`,'ok');
  } catch(e) { toast('Error: '+e.message,'err'); }
}

async function rejectReq(reqId, rowEl) {
  try {
    await updateDoc(doc(db,'friendRequests',reqId), {status:'rejected'});
    rowEl.remove(); toast('Declined.');
  } catch(e) { toast('Error: '+e.message,'err'); }
}

// ─── JOIN GROUP ───────────────────────────────────────
window.joinGroup = async function(gid) {
  try {
    await updateDoc(doc(db,'groups',gid), {members:arrayUnion(ME.uid)});
    const snap = await getDoc(doc(db,'groups',gid));
    toast('Joined!','ok');
    openChat(gid,'group',{id:gid,...snap.data()});
    switchTab('groups',document.querySelector('[data-t="groups"]'));
  } catch(e) { toast('Error: '+e.message,'err'); }
};

async function joinByCode() {
  const code = $('code-inp')?.value.trim(); if (!code) return;
  const snap = await getDocs(query(collection(db,'groups'),where('joinCode','==',code)));
  if (snap.empty) { toast('No group with that code','err'); return; }
  const g = {id:snap.docs[0].id, ...snap.docs[0].data()};
  if (g.members?.includes(ME.uid)) { toast('Already a member!'); openChat(g.id,'group',g); return; }
  window.joinGroup(g.id);
}
window.joinByCode = joinByCode;

// ─── START DM ─────────────────────────────────────────
window.startDM = async function(uid) {
  // Check friendship both directions
  const [s1, s2] = await Promise.all([
    getDocs(query(collection(db,'friendRequests'),where('from','==',ME.uid),where('to','==',uid),where('status','==','accepted'))),
    getDocs(query(collection(db,'friendRequests'),where('from','==',uid),where('to','==',ME.uid),where('status','==','accepted')))
  ]);
  if (s1.empty && s2.empty && !MY.friends?.includes(uid)) {
    const u = await getDoc(doc(db,'users',uid));
    toast(`Send ${u.data()?.username||'them'} a friend request first!`,'err'); return;
  }
  const existing = await getDocs(query(collection(db,'chats'),
    where('members','array-contains',ME.uid), where('type','==','dm')));
  let cid = null;
  existing.forEach(d => { if (d.data().members.includes(uid)) cid = d.id; });
  if (!cid) {
    const cr = await addDoc(collection(db,'chats'), {
      type:'dm', members:[ME.uid,uid], status:'accepted',
      lastMessage:'', lastTime:serverTimestamp()
    });
    cid = cr.id;
  }
  const o = await getDoc(doc(db,'users',uid));
  if (o.exists()) {
    openChat(cid,'dm',o.data());
    switchTab('dms',document.querySelector('[data-t="dms"]'));
  }
};

// ─── SEARCH ───────────────────────────────────────────
window.doSearch = async function(val) {
  $('sc-btn').style.display = val ? 'block' : 'none';
  if (!val.trim()) { switchTab('world',document.querySelector('[data-t="world"]')); return; }
  const snap = await getDocs(collection(db,'users'));
  const res  = snap.docs.map(d=>d.data())
    .filter(u => u.uid!==ME.uid && u.username?.toLowerCase().includes(val.toLowerCase()));
  const cl = $('cl'); cl.innerHTML = '';
  cl.appendChild(mkLabel(`RESULTS (${res.length})`));
  const fs = await getDoc(doc(db,'users',ME.uid)); MY = fs.data();
  res.forEach(u => {
    const row = makeCiRow();
    row.querySelector('.ci-av').appendChild(avEl(u,42));
    row.querySelector('.ci-name').textContent = u.username;
    row.querySelector('.ci-prev').textContent = u.country||'';
    const isFriend = MY.friends?.includes(u.uid);
    const btn = mk('button');
    btn.className = 'join-btn'+(isFriend?' fr':'');
    btn.textContent = isFriend ? '💬 DM' : '+ Add';
    btn.onclick = () => isFriend ? window.startDM(u.uid) : sendFReq(u.uid,u.username,btn);
    row.appendChild(btn); cl.appendChild(row);
  });
};
window.clearSearch = function() {
  $('search-inp').value=''; $('sc-btn').style.display='none';
  switchTab('world',document.querySelector('[data-t="world"]'));
};

// ─── OPEN CHAT ────────────────────────────────────────
window.openChat = function(cid, type, data) {
  // 1. Tear down previous listeners
  if (stopMsgs)   { stopMsgs(); stopMsgs = null; }
  if (stopTyping) { off(stopTyping); stopTyping = null; }
  clearTimeout(typTimer);
  if (activeChatId) remove(ref(rtdb, `typing/${activeChatId}/${ME.uid}`));

  // 2. Reset state for new chat
  activeChatId   = cid;
  activeChatType = type;
  activeChatData = data;
  replyTo        = null;
  // seenKeys/reactCache removed — using simple full re-render now

  // 3. Show chat UI
  $('empty').style.display = 'none';
  $('cv').classList.add('open');
  cancelReply();
  $('typing-row').style.visibility = 'hidden';

  const isGrp = type === 'group';
  $('ch-name').textContent = isGrp ? data.name : (data.username||'—');
  $('ch-sub').textContent  = isGrp
    ? `${data.members?.length||0} members`
    : `${data.country||''} ${data.bio?'· '+data.bio:''}`;

  const chAv = $('ch-av'); chAv.innerHTML = '';
  if (isGrp) { chAv.style.fontSize='22px'; chAv.textContent = data.icon||'🐉'; }
  else chAv.appendChild(avEl(data,38));

  const ib = $('info-btn');
  ib.style.display = (isGrp && data.type!=='global') ? 'flex' : 'none';
  if (isGrp) ib.onclick = openGroupInfo;

  // 4. Clear messages area and attach listener
  $('msgs').innerHTML = '';
  startMsgListener(cid);
  startTypingListener(cid);

  // 5. Mobile: close sidebar
  if (window.innerWidth <= 700) $('sb').classList.remove('open');
};

window.closeCv = function() {
  $('cv').classList.remove('open');
  $('empty').style.display = 'flex';
};

// ─── MESSAGES ─────────────────────────────────────────
// Strategy: onValue fires for EVERY change (new msg, reaction, typing nearby).
// We ONLY append elements for keys not yet in seenKeys.
// Reactions are patched in-place using reactCache diff.
// The chatId guard prevents stale listeners from writing to the wrong chat.

function startMsgListener(cid) {
  const msgRef = rq(
    ref(rtdb, `messages/${cid}`),
    orderByChild('timestamp'),
    limitToLast(100)
  );

  // Track scroll position — if user is near bottom, auto-scroll on new messages
  let lastCount = 0;

  stopMsgs = onValue(msgRef, snap => {
    // Guard: ignore stale listener from previous chat
    if (activeChatId !== cid) return;

    const wrap = $('msgs');
    if (!wrap) return;

    // Build ordered array from snapshot
    const all = [];
    snap.forEach(c => all.push({ _key: c.key, ...c.val() }));

    // Empty chat
    if (all.length === 0) {
      wrap.innerHTML =
        '<div style="text-align:center;padding:48px 20px;color:var(--faint);' +
        'font-size:13px;letter-spacing:1px;line-height:2">' +
        'No messages yet.<br>Say something! 👋</div>';
      lastCount = 0;
      return;
    }

    // Was user near bottom before this render?
    const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;

    // Full re-render every time — simple and bulletproof
    wrap.innerHTML = '';
    let lastDate = '', lastSender = '';
    all.forEach((msg, i) => {
      const d = fmtDate(msg.timestamp);
      if (d !== lastDate) {
        lastDate = d;
        const div = mk('div'); div.className='date-div'; div.textContent=d;
        wrap.appendChild(div);
      }
      const grouped = msg.senderId === lastSender && i > 0;
      lastSender = msg.senderId;
      wrap.appendChild(buildMsgEl(msg, grouped));
    });

    // Scroll to bottom if new messages arrived or first load
    if (nearBottom || all.length > lastCount) {
      wrap.scrollTop = wrap.scrollHeight;
    }
    lastCount = all.length;

    checkPurge(cid, all.length);
  });
}

function buildMsgEl(msg, grouped) {
  const mine = msg.senderId === ME.uid;
  const row  = mk('div');
  row.className = `msg-row${mine?' mine':''}${grouped?' grp':''}`;
  row.dataset.mid = msg._key;

  // Avatar
  const avw = mk('div'); avw.className = 'msg-av';
  if (!mine) {
    avw.appendChild(avEl({avatar:msg.senderAvatar||'🐉', photoURL:msg.senderPhoto||''}, 28));
  }
  row.appendChild(avw);

  const content = mk('div'); content.className = 'msg-content';

  // Sender name (groups only)
  if (activeChatType==='group' && !mine && !grouped) {
    const sn = mk('div'); sn.className='msg-sender'; sn.textContent=msg.senderName||'Unknown';
    content.appendChild(sn);
  }

  // Reply quote
  if (msg.replyTo) {
    const rq = mk('div'); rq.className='rq';
    rq.innerHTML =
      `<div class="rq-s">↩ ${esc(msg.replyTo.senderName)}</div>` +
      `<div class="rq-t">${esc(msg.replyTo.text||'')}</div>`;
    content.appendChild(rq);
  }

  // Bubble + hover actions
  const b = mk('div'); b.className='bubble';
  b.textContent = msg.text || '';

  const acts = mk('div'); acts.className='actions';
  REACT.forEach(emoji => {
    const ab = mk('button'); ab.className='ab'; ab.textContent=emoji;
    ab.onclick = ev => { ev.stopPropagation(); doReact(activeChatId, msg._key, emoji); };
    acts.appendChild(ab);
  });
  const rb = mk('button'); rb.className='ab'; rb.textContent='↩'; rb.title='Reply';
  rb.onclick = ev => { ev.stopPropagation(); setReply(msg); };
  acts.appendChild(rb);
  b.appendChild(acts);
  content.appendChild(b);

  // Reactions row
  const rr = mk('div'); rr.className='reacts'; rr.dataset.rr='1';
  drawReactions(rr, msg);
  content.appendChild(rr);

  // Timestamp
  const tm = mk('div'); tm.className='msg-time'; tm.textContent=fmtTime(msg.timestamp);
  content.appendChild(tm);

  row.appendChild(content);
  return row;
}

function drawReactions(container, msg) {
  container.innerHTML = '';
  if (!msg.reactions) return;
  Object.entries(msg.reactions).forEach(([emoji, users]) => {
    const uids = Object.keys(users||{}); if (!uids.length) return;
    const chip = mk('div');
    chip.className = 'rc'+(uids.includes(ME.uid)?' me':'');
    chip.innerHTML = `${emoji} <span>${uids.length}</span>`;
    chip.onclick = () => doReact(activeChatId, msg._key, emoji);
    container.appendChild(chip);
  });
}

async function doReact(cid, msgKey, emoji) {
  const path = `messages/${cid}/${msgKey}/reactions/${emoji}/${ME.uid}`;
  const r = ref(rtdb, path);
  const snap = await get(r);
  if (snap.exists()) await remove(r); else await set(r, true);
}

// ─── REPLY ────────────────────────────────────────────
function setReply(msg) {
  replyTo = msg;
  $('reply-bar').classList.add('show');
  $('rb-sender').textContent = msg.senderName || MY.username;
  $('rb-text').textContent   = (msg.text||'').substring(0, 60);
  $('msg-ta').focus();
}
window.cancelReply = function() { replyTo=null; $('reply-bar').classList.remove('show'); };

// ─── TYPING ───────────────────────────────────────────
window.notifyTyping = function() {
  if (!activeChatId) return;
  const tr = ref(rtdb, `typing/${activeChatId}/${ME.uid}`);
  set(tr, MY.username || 'Someone');
  clearTimeout(typTimer);
  typTimer = setTimeout(() => remove(tr), 2500);
};

function startTypingListener(cid) {
  const tr = ref(rtdb, `typing/${cid}`);
  stopTyping = tr;
  onValue(tr, snap => {
    const names = []; snap.forEach(c => { if (c.key!==ME.uid) names.push(c.val()); });
    const row = $('typing-row');
    if (row) {
      row.style.visibility = names.length ? 'visible' : 'hidden';
      $('typing-txt').textContent = names.length ? `${names[0]} is typing...` : '';
    }
  });
}

// ─── SEND ─────────────────────────────────────────────
window.sendMsg = async function() {
  const ta = $('msg-ta'); if (!ta) return;
  const text = ta.value.trim(); if (!text || !activeChatId) return;

  const msg = {
    text,
    senderId:     ME.uid,
    senderName:   MY.username   || 'Unknown',
    senderAvatar: MY.avatar     || '🐉',
    senderPhoto:  MY.photoURL   || '',
    timestamp:    Date.now(),
    reactions:    {}
  };
  if (replyTo) {
    msg.replyTo = {
      msgId:      replyTo._key,
      text:       replyTo.text,
      senderName: replyTo.senderName || MY.username
    };
  }

  await push(ref(rtdb, `messages/${activeChatId}`), msg);

  try {
    const col = activeChatType==='dm' ? 'chats' : 'groups';
    await updateDoc(doc(db, col, activeChatId), {
      lastMessage: text, lastTime: serverTimestamp()
    });
  } catch(_) {}

  ta.value = ''; ta.style.height='40px'; ta.style.overflowY='hidden';
  window.cancelReply();
  remove(ref(rtdb, `typing/${activeChatId}/${ME.uid}`));
  if (epOpen) toggleEp();
};

window.taKey    = e  => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); window.sendMsg(); } };
window.taResize = ta => {
  ta.style.height = '40px';
  const h = Math.min(ta.scrollHeight, 130);
  ta.style.height = h + 'px';
  ta.style.overflowY = h >= 130 ? 'auto' : 'hidden';
};

// ─── EMOJI ────────────────────────────────────────────
function buildEmojiPanel() {
  const g = $('ep-grid'); if (!g) return; g.innerHTML = '';
  [...EMOJIS].forEach(e => {
    if (!e.trim()) return;
    const b = mk('button'); b.className='epb'; b.textContent=e;
    b.onclick = () => {
      const ta = $('msg-ta'); if (ta) { ta.value += e; ta.focus(); }
      toggleEp();
    };
    g.appendChild(b);
  });
}
window.toggleEp = function() { epOpen=!epOpen; $('ep').classList.toggle('show',epOpen); };
document.addEventListener('click', e => {
  if (epOpen && !e.target.closest('#ep') && !e.target.closest('.ep-toggle')) toggleEp();
});

// ─── AUTO PURGE ───────────────────────────────────────
async function checkPurge(cid, count) {
  if (count >= 1000) await doPurge(cid, 800);
  else if (count >= 300) await doPurge(cid, 200);
}
async function doPurge(cid, n) {
  const snap = await get(rq(ref(rtdb,`messages/${cid}`), orderByChild('timestamp'), limitToLast(9999)));
  const keys = []; snap.forEach(c => keys.push(c.key));
  const upd  = {}; keys.slice(0,n).forEach(k => { upd[`messages/${cid}/${k}`]=null; });
  if (Object.keys(upd).length) await update(ref(rtdb), upd);
}

// ─── ONLINE PRESENCE ──────────────────────────────────
function watchPresence() {
  onValue(ref(rtdb,'presence'), async snap => {
    const uids = []; snap.forEach(c => { if (c.val().online && c.key!==ME.uid) uids.push(c.key); });
    const panel = $('rp-list'); if (!panel) return;
    panel.innerHTML = '';
    if (!uids.length) {
      panel.innerHTML = '<div style="padding:18px;color:var(--faint);font-size:11px;text-align:center">No one online</div>';
      return;
    }
    for (const uid of uids.slice(0,20)) {
      try {
        const ud = await getDoc(doc(db,'users',uid)); if (!ud.exists()) continue;
        const u  = ud.data();
        const item = mk('div'); item.className='rp-u';
        const avw  = mk('div'); avw.className='rp-av'; avw.style.cssText='position:relative;flex-shrink:0';
        avw.appendChild(avEl(u,30));
        const dot = mk('div'); dot.className='rp-dot'; avw.appendChild(dot);
        item.appendChild(avw);
        const info = mk('div'); info.style.cssText='flex:1;min-width:0';
        info.innerHTML = `<div class="rp-name">${esc(u.username)}</div><div class="rp-ct">${u.country||''}</div>`;
        item.appendChild(info);
        const isFriend = MY.friends?.includes(uid);
        const btn = mk('button');
        btn.className = 'sm-btn'+(isFriend?' fr':'');
        btn.textContent = isFriend ? '💬' : '+ Add';
        btn.onclick = () => isFriend ? window.startDM(uid) : sendFReq(uid, u.username, btn);
        item.appendChild(btn); panel.appendChild(item);
      } catch(_) {}
    }
  });
}

// ─── CREATE GROUP ─────────────────────────────────────
window.openCreateGroup = function() {
  const ov = mkOv();
  let selIcon = '🐉';
  ov.innerHTML = `<div class="modal">
    <button class="mcl" onclick="this.closest('.overlay').remove()">×</button>
    <h2>CREATE GROUP</h2>
    <div class="ig"><label>Name *</label><input class="ii" id="mg-n" placeholder="Name your realm..."></div>
    <div class="ig"><label>Description</label><input class="ii" id="mg-d" placeholder="What's this about?"></div>
    <div class="ig"><label>Visibility</label>
      <select class="ii" id="mg-v">
        <option value="public">🌍 Public — anyone can join</option>
        <option value="private">🔒 Private — invite code only</option>
      </select>
    </div>
    <div class="ig"><label>Icon</label><div class="icon-grid" id="ig-g"></div></div>
    <button class="btn-gold" onclick="doCreateGroup()">CREATE REALM</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) ov.remove(); });
  const grid = ov.querySelector('#ig-g');
  AVICS.forEach(a => {
    const s = mk('span'); s.className='ig-item'+(a===selIcon?' on':''); s.textContent=a;
    s.onclick = () => {
      selIcon = a; window._gi = a;
      grid.querySelectorAll('.ig-item').forEach(x => x.classList.remove('on'));
      s.classList.add('on');
    };
    grid.appendChild(s);
  });
  window._gi = selIcon;
};

window.doCreateGroup = async function() {
  const name = document.getElementById('mg-n')?.value.trim();
  const desc = document.getElementById('mg-d')?.value.trim();
  const vis  = document.getElementById('mg-v')?.value || 'public';
  if (!name) { toast('Enter a group name','err'); return; }
  const code = name.toLowerCase().replace(/\s+/g,'-') + '-' + Math.random().toString(36).slice(2,5);
  await addDoc(collection(db,'groups'), {
    name, description:desc||'', icon:window._gi||'🐉',
    members:[ME.uid], createdBy:ME.uid, type:'custom',
    createdAt:serverTimestamp(), lastMessage:'', lastTime:serverTimestamp(),
    visibility:vis, joinCode:code
  });
  document.querySelector('.overlay')?.remove();
  toast('Group created!','ok');
  switchTab('groups',document.querySelector('[data-t="groups"]'));
};

// ─── GROUP INFO ───────────────────────────────────────
async function openGroupInfo() {
  if (!activeChatId) return;
  const snap = await getDoc(doc(db,'groups',activeChatId)); if (!snap.exists()) return;
  const g = snap.data(); const isOwner = g.createdBy === ME.uid;
  const ov = mkOv();
  ov.innerHTML = `<div class="modal">
    <button class="mcl" onclick="this.closest('.overlay').remove()">×</button>
    <h2>${g.icon||'🐉'} ${esc(g.name)}</h2>
    <p style="text-align:center;color:var(--dim);font-size:13px;margin-bottom:18px">${esc(g.description||'No description')}</p>
    <div style="text-align:center;font-size:10px;letter-spacing:2px;color:var(--dim);margin-bottom:14px">
      ${g.members?.length||0} MEMBERS · ${g.visibility==='private'?'🔒 PRIVATE':'🌍 PUBLIC'}
    </div>
    ${g.joinCode?`<div class="code-display">
      <div style="font-size:9px;letter-spacing:2px;color:var(--dim);margin-bottom:6px">INVITE CODE</div>
      <div class="code-val">${g.joinCode}</div>
      <button class="code-copy" onclick="navigator.clipboard.writeText('${g.joinCode}').then(()=>toast('Copied!','ok'))">📋 Copy</button>
    </div>`:''}
    ${isOwner?`<button class="btn-danger" onclick="doDeleteGroup('${activeChatId}')">DELETE GROUP</button>`:''}
    <button class="btn-leave" onclick="doLeaveGroup('${activeChatId}')">LEAVE GROUP</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) ov.remove(); });
}
window.openGroupInfo = openGroupInfo;

window.doLeaveGroup = async function(gid) {
  await updateDoc(doc(db,'groups',gid), {members:arrayRemove(ME.uid)});
  document.querySelector('.overlay')?.remove();
  activeChatId = null;
  $('cv').classList.remove('open'); $('empty').style.display='flex';
  toast('Left group');
  switchTab('groups',document.querySelector('[data-t="groups"]'));
};

window.doDeleteGroup = async function(gid) {
  if (!confirm('Delete this group and all messages?')) return;
  await deleteDoc(doc(db,'groups',gid));
  await remove(ref(rtdb, `messages/${gid}`));
  document.querySelector('.overlay')?.remove();
  activeChatId = null;
  $('cv').classList.remove('open'); $('empty').style.display='flex';
  toast('Deleted');
  switchTab('groups',document.querySelector('[data-t="groups"]'));
};

// ─── PROFILE / LOGOUT ─────────────────────────────────
window.goProfile = () => window.location.href='profile.html';
window.doLogout  = async function() {
  if (!confirm('Sign out?')) return;
  try { await set(ref(rtdb,`presence/${ME.uid}`),{online:false,uid:ME.uid,lastSeen:rtTs()}); } catch(_) {}
  await signOut(auth); window.location.href='login.html';
};
