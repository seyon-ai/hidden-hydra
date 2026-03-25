/**
 * Hidden Hydra — chat.js v5
 * Fixed: messages only showing first, mobile input hidden,
 *        friend request error, global rooms not visible.
 */

import { initializeApp }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
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

const REACT  = ['👍','❤️','😂','😮','😢','🔥','👏','🎉'];
const EMOJIS = '😀😁😂🤣😄😅😆😉😊😋😎😍🥰😘🤩🥳😏😒😞😔😕🙁😣😫😩🥺😢😭😤😠😡🤬😱😨😰😓🤗🤔🤫🤥😶😐😑😬🙄😯😦😧😮🥱😴😪😵🤢🤧😷🤒🤕🤑🤠💪🤝👋👍👎✊👊🤞✌💃🎉🎊🎈🎁🏆🔥⚡🌊💎👑🔮🌙⭐🌟💫✨🌸🌺🌻🌹🍀🌿🦋🐉🦊🦁🐯🐺';
const AVICS  = ['🐉','🦊','🐺','🦁','🐯','🦋','🔥','⚡','🌙','💎','🌊','🦅','🐬','🦝','🎭','🌸','🐙','🦄','⭐'];

/* Global rooms — users DON'T need to join, everyone sees them */
const GLOBAL_ROOMS = [
  { id:'g-lounge',   name:'Global Lounge', icon:'🌍', desc:'Talk to everyone worldwide!' },
  { id:'g-gaming',   name:'Gaming Den',    icon:'🎮', desc:'All platforms, all games.' },
  { id:'g-tech',     name:'Tech Talk',     icon:'🚀', desc:'Developers & tech lovers.' },
  { id:'g-music',    name:'Music Vibes',   icon:'🎵', desc:'Share music & artists.' },
  { id:'g-creative', name:'Creative Hub',  icon:'🎨', desc:'Art, design, photography.' },
];

/* ── STATE ── */
let ME = null, MY = null;
let chatId = null, chatType = null, chatData = null;
let replyTo = null, epOpen = false;
let typTimer = null, typListenerRef = null;
let msgUnsubFn = null;          // the function returned by onValue() — call it to detach
let dmUnsub = null, grpUnsub = null;

/* rendered message ids for the CURRENT chat only — reset on every chat open */
let renderedIds = new Set();
/* snapshot of last-known message data, keyed by id, for reaction diffing */
let msgCache = {};

/* ── UTILS ── */
const $  = id  => document.getElementById(id);
const el = tag => document.createElement(tag);
const esc = s  => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function toast(msg, type='') {
  const tc = $('toasts'); if (!tc) return;
  const t = el('div'); t.className = 'toast'+(type?' '+type:''); t.textContent = msg;
  tc.appendChild(t); setTimeout(()=>t.remove(), 3200);
}
window.toast = toast;

function makeAv(profile, size=40) {
  const w = el('div');
  w.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;`+
    `display:flex;align-items:center;justify-content:center;`+
    `font-size:${Math.floor(size*.46)}px;background:var(--s3);flex-shrink:0;`;
  const url = profile?.photoURL;
  if (url && url.length > 8) {
    const img = el('img');
    img.src = url;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    img.onerror = () => { w.innerHTML=''; w.textContent = profile?.avatar||'🐉'; };
    w.appendChild(img);
  } else {
    w.textContent = profile?.avatar || '🐉';
  }
  return w;
}

const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
function fmtDate(ts) {
  if (!ts) return 'Today';
  const d=new Date(ts), n=new Date();
  if (d.toDateString()===n.toDateString()) return 'Today';
  const y=new Date(n); y.setDate(n.getDate()-1);
  if (d.toDateString()===y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}

/* ── AUTH ── */
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href='login.html'; return; }
  ME = user;
  const snap = await getDoc(doc(db,'users',ME.uid));
  if (!snap.exists()) { window.location.href='login.html'; return; }
  MY = snap.data();
  setupPresence();
  await ensureGlobalRooms();
  boot();
});

function setupPresence() {
  const pr = ref(rtdb,`presence/${ME.uid}`);
  set(pr,{online:true,uid:ME.uid,lastSeen:rtTs()});
  onDisconnect(pr).set({online:false,uid:ME.uid,lastSeen:rtTs()});
}

/* Create global room docs if missing. Members array is NOT used for global rooms. */
async function ensureGlobalRooms() {
  for (const g of GLOBAL_ROOMS) {
    const snap = await getDoc(doc(db,'groups',g.id));
    if (!snap.exists()) {
      await setDoc(doc(db,'groups',g.id),{
        ...g, type:'global', visibility:'public', joinCode:g.id,
        members:[], createdBy:'system',
        createdAt:serverTimestamp(), lastMessage:'', lastTime:serverTimestamp()
      });
    }
  }
}

function boot() {
  $('loading').style.display='none';
  $('app').classList.add('show');
  renderMe();
  buildEmojiPanel();
  watchPresence();
  watchFriendRequests();
  switchTab('world', document.querySelector('[data-t="world"]'));
}

function renderMe() {
  const av=$('me-av'); av.innerHTML=''; av.appendChild(makeAv(MY,40));
  $('me-name').textContent=MY.username||'—';
}

/* ── TABS ── */
window.switchTab = function(tab, btn) {
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  $('fab').style.display = tab==='groups'?'flex':'none';
  if (tab==='world')   loadWorldRooms();
  if (tab==='dms')     loadDMs();
  if (tab==='groups')  loadGroups();
  if (tab==='explore') loadExplore();
  if (tab==='req')     loadRequests();
};

/* ── FRIEND REQUEST BADGE ── */
function watchFriendRequests() {
  const q=query(collection(db,'friendRequests'),where('to','==',ME.uid),where('status','==','pending'));
  onSnapshot(q, snap=>{
    const b=$('req-badge');
    if(b){ b.textContent=snap.size; b.style.display=snap.size?'flex':'none'; }
  });
}

/* ── WORLD ROOMS (always visible, no join needed) ── */
function loadWorldRooms() {
  const cl=$('cl'); cl.innerHTML='';
  cl.appendChild(mkLabel('🌍 WORLD CHAT'));
  GLOBAL_ROOMS.forEach(g=>{
    const row=makeCiRow();
    const av=row.querySelector('.ci-av'); av.style.fontSize='21px'; av.textContent=g.icon;
    row.querySelector('.ci-name').textContent=g.name;
    row.querySelector('.ci-prev').textContent=g.desc;
    if(chatId===g.id) row.classList.add('on');
    row.onclick=()=>openChat(g.id,'group',{id:g.id,...g,type:'global'});
    cl.appendChild(row);
  });
}

/* ── DMs ── */
function loadDMs() {
  if(dmUnsub){dmUnsub();dmUnsub=null;}
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const q=query(collection(db,'chats'),where('members','array-contains',ME.uid),where('type','==','dm'),where('status','==','accepted'));
  dmUnsub=onSnapshot(q, async snap=>{
    const items=[];
    for(const d of snap.docs){
      const data=d.data();
      const otherId=data.members.find(m=>m!==ME.uid); if(!otherId) continue;
      try{ const o=await getDoc(doc(db,'users',otherId)); if(o.exists()) items.push({id:d.id,...data,other:o.data()}); }catch(_){}
    }
    const cl=$('cl'); if(!cl) return; cl.innerHTML='';
    if(!items.length){cl.innerHTML='<div class="empty-lm">No conversations yet.<br>Send a friend request to start.</div>';return;}
    items.forEach(item=>{
      const row=makeCiRow();
      row.querySelector('.ci-av').appendChild(makeAv(item.other,42));
      row.querySelector('.ci-name').textContent=item.other.username||'—';
      row.querySelector('.ci-prev').textContent=item.lastMessage||'Say hello!';
      if(chatId===item.id) row.classList.add('on');
      row.onclick=()=>openChat(item.id,'dm',item.other);
      cl.appendChild(row);
    });
  });
}

/* ── MY GROUPS ── */
function loadGroups() {
  if(grpUnsub){grpUnsub();grpUnsub=null;}
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const q=query(collection(db,'groups'),where('members','array-contains',ME.uid),where('type','!=','global'));
  grpUnsub=onSnapshot(q, snap=>{
    const items=snap.docs.map(d=>({id:d.id,...d.data()}));
    const cl=$('cl'); if(!cl) return; cl.innerHTML='';
    if(!items.length){cl.innerHTML='<div class="empty-lm">No groups yet.<br>Create one below!</div>';return;}
    cl.appendChild(mkLabel('MY GROUPS'));
    items.forEach(g=>cl.appendChild(mkGrpRow(g)));
  });
}

function mkGrpRow(g) {
  const row=makeCiRow();
  const av=row.querySelector('.ci-av'); av.style.fontSize='21px'; av.textContent=g.icon||'🐉';
  row.querySelector('.ci-name').textContent=g.name;
  row.querySelector('.ci-prev').textContent=(g.members?.length||0)+' members'+(g.lastMessage?' · '+g.lastMessage.substring(0,25):'');
  if(chatId===g.id) row.classList.add('on');
  if(g.visibility==='private'){const lk=el('span');lk.textContent='🔒';lk.style.cssText='font-size:11px;color:var(--faint)';row.appendChild(lk);}
  row.onclick=()=>openChat(g.id,'group',g);
  return row;
}

/* ── EXPLORE ── */
async function loadExplore() {
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const [gSnap,uSnap]=await Promise.all([getDocs(collection(db,'groups')),getDocs(collection(db,'users'))]);
  const pubGroups=gSnap.docs.map(d=>({id:d.id,...d.data()})).filter(g=>g.type!=='global'&&g.visibility!=='private'&&!g.members?.includes(ME.uid));
  const users=uSnap.docs.map(d=>d.data()).filter(u=>u.uid!==ME.uid);
  const cl=$('cl'); cl.innerHTML='';
  /* join-by-code */
  const bar=el('div'); bar.className='code-bar';
  const inp=el('input');inp.className='code-inp';inp.id='code-inp';inp.placeholder='Enter invite code...';
  const jbtn=el('button');jbtn.className='join-btn';jbtn.textContent='JOIN';jbtn.onclick=joinByCode;
  bar.appendChild(inp);bar.appendChild(jbtn);cl.appendChild(bar);
  if(pubGroups.length){
    cl.appendChild(mkLabel('PUBLIC GROUPS'));
    pubGroups.forEach(g=>{
      const row=el('div');row.className='ex-item';
      const av=el('div');av.className='ci-av';av.style.cssText='width:42px;height:42px;border-radius:50%;background:var(--s3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:21px;flex-shrink:0';av.textContent=g.icon||'🐉';
      const meta=el('div');meta.style.cssText='flex:1;min-width:0';
      meta.innerHTML=`<div class="ci-name">${esc(g.name)}</div><div class="ci-prev">${g.members?.length||0} members</div>`;
      const btn=el('button');btn.className='join-btn';btn.textContent='JOIN';btn.onclick=()=>joinGroup(g.id);
      row.appendChild(av);row.appendChild(meta);row.appendChild(btn);cl.appendChild(row);
    });
  }
  if(users.length){
    cl.appendChild(mkLabel('PEOPLE'));
    const freshSnap=await getDoc(doc(db,'users',ME.uid)); MY=freshSnap.data();
    for(const u of users.slice(0,40)){
      const isFriend=MY.friends?.includes(u.uid);
      const reqSnap=await getDocs(query(collection(db,'friendRequests'),where('from','==',ME.uid),where('to','==',u.uid),where('status','==','pending')));
      const sent=!reqSnap.empty;
      const row=el('div');row.className='ex-item';
      const avw=el('div');avw.style.cssText='width:42px;height:42px;border-radius:50%;flex-shrink:0';avw.appendChild(makeAv(u,42));
      const meta=el('div');meta.style.cssText='flex:1;min-width:0';
      meta.innerHTML=`<div class="ci-name">${esc(u.username)}</div><div class="ci-prev">${u.country||''} ${u.bio?'· '+esc(u.bio.substring(0,28)):''}</div>`;
      let btn;
      if(isFriend){btn=el('button');btn.className='join-btn fr';btn.textContent='💬 DM';btn.onclick=()=>window.startDM(u.uid);}
      else if(sent){btn=el('span');btn.className='sent-tag';btn.textContent='SENT ✓';}
      else{btn=el('button');btn.className='join-btn';btn.textContent='+ Add';btn.onclick=()=>sendFReq(u.uid,u.username,btn);}
      row.appendChild(avw);row.appendChild(meta);row.appendChild(btn);cl.appendChild(row);
    }
  }
}

/* ── REQUESTS ── */
async function loadRequests() {
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const snap=await getDocs(query(collection(db,'friendRequests'),where('to','==',ME.uid),where('status','==','pending')));
  const reqs=snap.docs.map(d=>({id:d.id,...d.data()}));
  const cl=$('cl'); cl.innerHTML='';
  cl.appendChild(mkLabel(`INCOMING (${reqs.length})`));
  if(!reqs.length){cl.innerHTML+='<div class="empty-lm">No pending requests.</div>';return;}
  for(const r of reqs){
    const uDoc=await getDoc(doc(db,'users',r.from));if(!uDoc.exists())continue;
    const u=uDoc.data();
    const row=el('div');row.className='ex-item';
    const avw=el('div');avw.style.cssText='width:42px;height:42px;border-radius:50%;flex-shrink:0';avw.appendChild(makeAv(u,42));
    const meta=el('div');meta.style.cssText='flex:1;min-width:0';
    meta.innerHTML=`<div class="ci-name">${esc(u.username)}</div><div class="ci-prev">wants to connect · ${u.country||''}</div>`;
    const wrap=el('div');wrap.style.cssText='display:flex;gap:5px;flex-shrink:0';
    const acc=el('button');acc.className='acc-btn';acc.textContent='✓ Accept';acc.onclick=()=>acceptReq(r,u,row);
    const rej=el('button');rej.className='rej-btn';rej.textContent='✕';rej.onclick=()=>rejectReq(r.id,row);
    wrap.appendChild(acc);wrap.appendChild(rej);
    row.appendChild(avw);row.appendChild(meta);row.appendChild(wrap);cl.appendChild(row);
  }
}

/* ── FRIEND REQUEST ACTIONS ──
   FIX: We no longer try to update the OTHER user's Firestore doc (permission denied).
   Instead we use a 'friendRequests' status that both sides read.
   The friends list is only updated on MY own doc, and the other side
   checks incoming accepted requests to build their own list lazily.
*/
async function sendFReq(toUid, toName, btn) {
  btn.disabled=true; btn.textContent='...';
  try{
    await addDoc(collection(db,'friendRequests'),{from:ME.uid,to:toUid,fromName:MY.username,toName,status:'pending',createdAt:serverTimestamp()});
    btn.className='sent-tag'; btn.textContent='SENT ✓'; btn.disabled=false;
    toast('Request sent!','ok');
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;btn.textContent='+ Add';}
}

async function acceptReq(req, fromUser, rowEl) {
  try{
    /* 1. Mark request accepted */
    await updateDoc(doc(db,'friendRequests',req.id),{status:'accepted'});
    /* 2. Update ONLY my own friends list (we own our doc) */
    await updateDoc(doc(db,'users',ME.uid),{friends:arrayUnion(req.from)});
    /* 3. Create or enable the DM chat doc */
    const existing=await getDocs(query(collection(db,'chats'),where('members','array-contains',ME.uid),where('type','==','dm')));
    let cid=null; existing.forEach(d=>{if(d.data().members.includes(req.from))cid=d.id;});
    if(!cid){
      const cr=await addDoc(collection(db,'chats'),{type:'dm',members:[ME.uid,req.from],status:'accepted',lastMessage:'',lastTime:serverTimestamp()});
      cid=cr.id;
    }else{
      await updateDoc(doc(db,'chats',cid),{status:'accepted'});
    }
    rowEl.remove();
    /* Refresh local profile */
    const snap=await getDoc(doc(db,'users',ME.uid)); MY=snap.data();
    toast(`Connected with ${fromUser.username}! 🎉`,'ok');
  }catch(e){toast('Error: '+e.message,'err');}
}

async function rejectReq(reqId, rowEl) {
  try{
    await updateDoc(doc(db,'friendRequests',reqId),{status:'rejected'});
    rowEl.remove(); toast('Declined.');
  }catch(e){toast('Error: '+e.message,'err');}
}

/* ── START DM ──
   FIX: check accepted friendRequest in BOTH directions, not just friends array
   (because the other user can't write to our doc, so friends array may be one-sided)
*/
window.startDM = async function(uid) {
  /* Check if we have an accepted friend request in either direction */
  const [sentSnap, recvSnap] = await Promise.all([
    getDocs(query(collection(db,'friendRequests'),where('from','==',ME.uid),where('to','==',uid),where('status','==','accepted'))),
    getDocs(query(collection(db,'friendRequests'),where('from','==',uid),where('to','==',ME.uid),where('status','==','accepted')))
  ]);
  const connected = !sentSnap.empty || !recvSnap.empty || MY.friends?.includes(uid);
  if(!connected){
    const uDoc=await getDoc(doc(db,'users',uid));
    toast(`Send ${uDoc.data()?.username||'them'} a friend request first!`,'err'); return;
  }
  const existing=await getDocs(query(collection(db,'chats'),where('members','array-contains',ME.uid),where('type','==','dm')));
  let cid=null; existing.forEach(d=>{if(d.data().members.includes(uid))cid=d.id;});
  if(!cid){
    const cr=await addDoc(collection(db,'chats'),{type:'dm',members:[ME.uid,uid],status:'accepted',lastMessage:'',lastTime:serverTimestamp()});
    cid=cr.id;
  }
  const oDoc=await getDoc(doc(db,'users',uid));
  if(oDoc.exists()){openChat(cid,'dm',oDoc.data());switchTab('dms',document.querySelector('[data-t="dms"]'));}
};

/* ── JOIN GROUP ── */
window.joinGroup = async function(gid) {
  try{
    await updateDoc(doc(db,'groups',gid),{members:arrayUnion(ME.uid)});
    const snap=await getDoc(doc(db,'groups',gid));
    toast('Joined!','ok');
    openChat(gid,'group',{id:gid,...snap.data()});
    switchTab('groups',document.querySelector('[data-t="groups"]'));
  }catch(e){toast('Error: '+e.message,'err');}
};

async function joinByCode() {
  const code=$('code-inp')?.value.trim(); if(!code) return;
  const snap=await getDocs(query(collection(db,'groups'),where('joinCode','==',code)));
  if(snap.empty){toast('No group with that code','err');return;}
  const g={id:snap.docs[0].id,...snap.docs[0].data()};
  if(g.members?.includes(ME.uid)){toast('Already a member!');openChat(g.id,'group',g);return;}
  window.joinGroup(g.id);
}
window.joinByCode=joinByCode;

/* ── SEARCH ── */
window.doSearch=async function(val){
  $('sc-btn').style.display=val?'block':'none';
  if(!val.trim()){switchTab('world',document.querySelector('[data-t="world"]'));return;}
  const snap=await getDocs(collection(db,'users'));
  const res=snap.docs.map(d=>d.data()).filter(u=>u.uid!==ME.uid&&u.username?.toLowerCase().includes(val.toLowerCase()));
  const cl=$('cl'); cl.innerHTML='';
  cl.appendChild(mkLabel(`RESULTS (${res.length})`));
  const freshSnap=await getDoc(doc(db,'users',ME.uid)); MY=freshSnap.data();
  res.forEach(u=>{
    const row=makeCiRow();
    row.querySelector('.ci-av').appendChild(makeAv(u,42));
    row.querySelector('.ci-name').textContent=u.username;
    row.querySelector('.ci-prev').textContent=u.country||'';
    const isFriend=MY.friends?.includes(u.uid);
    const btn=el('button');btn.className='join-btn'+(isFriend?' fr':'');btn.textContent=isFriend?'💬 DM':'+ Add';
    btn.onclick=()=>isFriend?window.startDM(u.uid):sendFReq(u.uid,u.username,btn);
    row.appendChild(btn); cl.appendChild(row);
  });
};
window.clearSearch=function(){$('search-inp').value='';$('sc-btn').style.display='none';switchTab('world',document.querySelector('[data-t="world"]'));};

/* ── OPEN CHAT ── */
window.openChat = function(cid, type, data) {
  /* Detach previous listeners */
  if(msgUnsubFn){ msgUnsubFn(); msgUnsubFn=null; }
  if(typListenerRef){ off(typListenerRef); typListenerRef=null; }
  clearTimeout(typTimer);
  if(chatId) remove(ref(rtdb,`typing/${chatId}/${ME.uid}`));

  chatId=cid; chatType=type; chatData=data; replyTo=null;
  renderedIds=new Set(); msgCache={};

  /* Show chat view */
  $('empty').style.display='none';
  $('cv').classList.add('open');

  cancelReply();
  $('typing-row').style.visibility='hidden';

  const isGroup=type==='group';
  $('ch-name').textContent=isGroup?data.name:(data.username||'—');
  $('ch-sub').textContent=isGroup?`${data.members?.length||0} members`:`${data.country||''} ${data.bio?'· '+data.bio:''}`;
  const chAv=$('ch-av'); chAv.innerHTML='';
  if(isGroup){chAv.style.fontSize='20px';chAv.textContent=data.icon||'🐉';}
  else chAv.appendChild(makeAv(data,38));

  const ib=$('info-btn');
  ib.style.display=isGroup&&data.type!=='global'?'flex':'none';
  if(isGroup) ib.onclick=openGroupInfo;

  /* Clear and start loading */
  const wrap=$('msgs'); wrap.innerHTML='';
  listenMessages(cid);
  listenTyping(cid);

  /* Mobile: open sidebar collapses */
  if(window.innerWidth<=700) $('sb').classList.remove('open');
};

window.closeCv=function(){
  $('cv').classList.remove('open'); $('empty').style.display='flex';
};

/* ── MESSAGES ──
   FIX: onValue fires every time ANY child changes (e.g. reactions).
   We use seenIds set to NEVER re-render existing messages, only appending new ones.
   Reactions are updated in-place by patching just the reaction row DOM element.
*/
function listenMessages(cid) {
  const msgRef = rq(ref(rtdb,`messages/${cid}`), orderByChild('timestamp'), limitToLast(120));

  msgUnsubFn = onValue(msgRef, snap => {
    /* CRITICAL: if user switched chat while this listener was still firing, ignore */
    if (chatId !== cid) return;

    const wrap = $('msgs');
    if (!wrap) return;

    /* Build ordered array from snapshot */
    const all = [];
    snap.forEach(c => all.push({ key: c.key, ...c.val() }));

    /* Empty chat */
    if (!all.length) {
      if (renderedIds.size === 0) {
        wrap.innerHTML = '';
        const ph = el('div'); ph.dataset.ph='1';
        ph.style.cssText = 'text-align:center;padding:48px 20px;color:var(--faint);font-size:13px;letter-spacing:1px;line-height:2';
        ph.innerHTML = 'No messages yet.<br>Be the first! 👋';
        wrap.appendChild(ph);
      }
      return;
    }

    /* Remove empty placeholder if it exists */
    const ph = wrap.querySelector('[data-ph]');
    if (ph) ph.remove();

    if (renderedIds.size === 0) {
      /* ── FIRST LOAD: render all messages from scratch ── */
      wrap.innerHTML = '';
      let prevDate = null, prevSender = null;
      all.forEach((msg, i) => {
        const d = fmtDate(msg.timestamp);
        if (d !== prevDate) { prevDate = d; wrap.appendChild(mkDateDiv(d)); }
        const grouped = (msg.senderId === prevSender) && i > 0;
        prevSender = msg.senderId;
        wrap.appendChild(mkMsgEl(msg, grouped));
        renderedIds.add(msg.key);
        msgCache[msg.key] = JSON.stringify(msg.reactions || {});
      });
      wrap.scrollTop = wrap.scrollHeight;

    } else {
      /* ── SUBSEQUENT FIRES: only append genuinely new messages ── */
      const newMsgs = all.filter(m => !renderedIds.has(m.key));
      if (newMsgs.length) {
        newMsgs.forEach(msg => {
          wrap.appendChild(mkMsgEl(msg, false));
          renderedIds.add(msg.key);
          msgCache[msg.key] = JSON.stringify(msg.reactions || {});
        });
        wrap.scrollTop = wrap.scrollHeight;
      }

      /* ── IN-PLACE REACTION UPDATE — never re-render bubbles ── */
      all.forEach(msg => {
        const current = JSON.stringify(msg.reactions || {});
        if (msgCache[msg.key] !== current) {
          msgCache[msg.key] = current;
          const row = wrap.querySelector(`[data-mid="${msg.key}"]`);
          if (row) {
            const rr = row.querySelector('[data-rr]');
            if (rr) renderReacts(rr, msg);
          }
        }
      });
    }

    checkPurge(cid, all.length);
  });
}

function mkDateDiv(label){
  const d=el('div');d.className='date-div';d.textContent=label;return d;
}

function mkMsgEl(msg, grouped){
  const mine=msg.senderId===ME.uid;
  const row=el('div');
  row.className=`msg-row${mine?' mine':''}${grouped?' grp':''}`;
  row.dataset.mid=msg.key;

  const avw=el('div');avw.className='msg-av';
  if(!mine) avw.appendChild(makeAv({avatar:msg.senderAvatar||'🐉',photoURL:msg.senderPhoto||''},28));
  row.appendChild(avw);

  const content=el('div');content.className='msg-content';

  if(chatType==='group'&&!mine&&!grouped){
    const sn=el('div');sn.className='msg-sender';sn.textContent=msg.senderName||'Unknown';
    content.appendChild(sn);
  }

  if(msg.replyTo){
    const rq2=el('div');rq2.className='rq';
    rq2.innerHTML=`<div class="rq-s">↩ ${esc(msg.replyTo.senderName)}</div><div class="rq-t">${esc(msg.replyTo.text||'')}</div>`;
    content.appendChild(rq2);
  }

  const b=el('div');b.className='bubble';b.textContent=msg.text||'';

  const acts=el('div');acts.className='actions';
  REACT.forEach(emoji=>{
    const ab=el('button');ab.className='ab';ab.textContent=emoji;
    ab.onclick=ev=>{ev.stopPropagation();doReact(chatId,msg.key,emoji);};
    acts.appendChild(ab);
  });
  const rb=el('button');rb.className='ab';rb.textContent='↩';rb.title='Reply';
  rb.onclick=ev=>{ev.stopPropagation();setReply(msg);};
  acts.appendChild(rb);
  b.appendChild(acts);
  content.appendChild(b);

  const rr=el('div');rr.className='reacts';rr.dataset.rr='1';
  renderReacts(rr,msg);
  content.appendChild(rr);

  const tm=el('div');tm.className='msg-time';tm.textContent=fmtTime(msg.timestamp);
  content.appendChild(tm);

  row.appendChild(content);
  return row;
}

function renderReacts(container, msg){
  container.innerHTML='';
  if(!msg.reactions) return;
  Object.entries(msg.reactions).forEach(([emoji,users])=>{
    const uids=Object.keys(users||{});if(!uids.length) return;
    const chip=el('div');chip.className='rc'+(uids.includes(ME.uid)?' me':'');
    chip.innerHTML=`${emoji} <span>${uids.length}</span>`;
    chip.onclick=()=>doReact(chatId,msg.key,emoji);
    container.appendChild(chip);
  });
}

async function doReact(cid,msgKey,emoji){
  const path=`messages/${cid}/${msgKey}/reactions/${emoji}/${ME.uid}`;
  const r=ref(rtdb,path);
  const snap=await get(r);
  if(snap.exists()) await remove(r); else await set(r,true);
}

/* ── REPLY ── */
function setReply(msg){
  replyTo=msg;
  $('reply-bar').classList.add('show');
  $('rb-sender').textContent=msg.senderName||MY.username;
  $('rb-text').textContent=(msg.text||'').substring(0,60);
  $('msg-ta').focus();
}
window.cancelReply=function(){replyTo=null;$('reply-bar').classList.remove('show');};

/* ── TYPING ── */
window.notifyTyping=function(){
  if(!chatId) return;
  const tr=ref(rtdb,`typing/${chatId}/${ME.uid}`);
  set(tr,MY.username||'Someone');
  clearTimeout(typTimer);
  typTimer=setTimeout(()=>remove(tr),2500);
};

function listenTyping(cid){
  const tr=ref(rtdb,`typing/${cid}`);
  typListenerRef=tr;
  onValue(tr,snap=>{
    const names=[];snap.forEach(c=>{if(c.key!==ME.uid)names.push(c.val());});
    const row=$('typing-row');
    if(row){
      row.style.visibility=names.length?'visible':'hidden';
      $('typing-txt').textContent=names.length?`${names[0]} is typing...`:'';
    }
  });
}

/* ── SEND ── */
window.sendMsg=async function(){
  const ta=$('msg-ta');if(!ta)return;
  const text=ta.value.trim();if(!text||!chatId)return;
  const msg={
    text,
    senderId:ME.uid,
    senderName:MY.username||'Unknown',
    senderAvatar:MY.avatar||'🐉',
    senderPhoto:MY.photoURL||'',
    timestamp:Date.now(),
    reactions:{}
  };
  if(replyTo) msg.replyTo={msgId:replyTo.key,text:replyTo.text,senderName:replyTo.senderName||MY.username};
  await push(ref(rtdb,`messages/${chatId}`),msg);
  try{
    const col=chatType==='dm'?'chats':'groups';
    await updateDoc(doc(db,col,chatId),{lastMessage:text,lastTime:serverTimestamp()});
  }catch(_){}
  ta.value='';ta.style.height='40px';ta.style.overflowY='hidden';
  window.cancelReply();
  remove(ref(rtdb,`typing/${chatId}/${ME.uid}`));
  if(epOpen) toggleEp();
};

window.taKey=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.sendMsg();}};
window.taResize=function(ta){
  /* Reset to 1 row minimum WITHOUT setting height:auto (which causes visual flash) */
  ta.style.height='40px';
  const h=Math.min(ta.scrollHeight,130);
  ta.style.height=h+'px';
  /* Ensure overflow is correct */
  ta.style.overflowY=h>=130?'auto':'hidden';
};

/* ── EMOJI ── */
function buildEmojiPanel(){
  const grid=$('ep-grid');if(!grid)return;grid.innerHTML='';
  [...EMOJIS].forEach(e=>{
    if(!e.trim())return;
    const b=el('button');b.className='epb';b.textContent=e;
    b.onclick=()=>{const ta=$('msg-ta');if(ta){ta.value+=e;ta.focus();}toggleEp();};
    grid.appendChild(b);
  });
}
window.toggleEp=function(){epOpen=!epOpen;$('ep').classList.toggle('show',epOpen);};
document.addEventListener('click',e=>{if(epOpen&&!e.target.closest('#ep')&&!e.target.closest('.ep-toggle'))toggleEp();});

/* ── PURGE ── */
async function checkPurge(cid,count){
  if(count>=1000) await doPurge(cid,800);
  else if(count>=300) await doPurge(cid,200);
}
async function doPurge(cid,n){
  const snap=await get(rq(ref(rtdb,`messages/${cid}`),orderByChild('timestamp'),limitToLast(9999)));
  const keys=[];snap.forEach(c=>keys.push(c.key));
  const upd={};keys.slice(0,n).forEach(k=>{upd[`messages/${cid}/${k}`]=null;});
  if(Object.keys(upd).length) await update(ref(rtdb),upd);
}

/* ── ONLINE PRESENCE ── */
function watchPresence(){
  onValue(ref(rtdb,'presence'),async snap=>{
    const uids=[];snap.forEach(c=>{if(c.val().online&&c.key!==ME.uid)uids.push(c.key);});
    const panel=$('rp-list');if(!panel)return;
    panel.innerHTML='';
    if(!uids.length){panel.innerHTML='<div style="padding:18px;color:var(--faint);font-size:11px;text-align:center">No one online</div>';return;}
    for(const uid of uids.slice(0,20)){
      try{
        const ud=await getDoc(doc(db,'users',uid));if(!ud.exists())continue;
        const u=ud.data();
        const item=el('div');item.className='rp-u';
        const avw=el('div');avw.className='rp-av';avw.style.cssText='position:relative;flex-shrink:0';
        avw.appendChild(makeAv(u,30));
        const dot=el('div');dot.className='rp-dot';avw.appendChild(dot);
        item.appendChild(avw);
        const info=el('div');info.style.cssText='flex:1;min-width:0';
        info.innerHTML=`<div class="rp-name">${esc(u.username)}</div><div class="rp-ct">${u.country||''}</div>`;
        item.appendChild(info);
        const isFriend=MY.friends?.includes(uid);
        const btn=el('button');btn.className='sm-btn'+(isFriend?' fr':'');
        btn.textContent=isFriend?'💬':'+ Add';
        btn.onclick=()=>isFriend?window.startDM(uid):sendFReq(uid,u.username,btn);
        item.appendChild(btn);panel.appendChild(item);
      }catch(_){}
    }
  });
}

/* ── CREATE GROUP ── */
window.openCreateGroup=function(){
  const ov=mkOv();
  let selIcon='🐉';
  ov.innerHTML=`<div class="modal">
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
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  const grid=ov.querySelector('#ig-g');
  AVICS.forEach(a=>{
    const s=el('span');s.className='ig-item'+(a===selIcon?' on':'');s.textContent=a;
    s.onclick=()=>{selIcon=a;grid.querySelectorAll('.ig-item').forEach(x=>x.classList.remove('on'));s.classList.add('on');window._gi=selIcon;};
    grid.appendChild(s);
  });
  window._gi=selIcon;
};

window.doCreateGroup=async function(){
  const name=document.getElementById('mg-n')?.value.trim();
  const desc=document.getElementById('mg-d')?.value.trim();
  const vis=document.getElementById('mg-v')?.value||'public';
  if(!name){toast('Enter a group name','err');return;}
  const code=name.toLowerCase().replace(/\s+/g,'-')+'-'+Math.random().toString(36).slice(2,5);
  await addDoc(collection(db,'groups'),{name,description:desc||'',icon:window._gi||'🐉',members:[ME.uid],createdBy:ME.uid,createdAt:serverTimestamp(),lastMessage:'',lastTime:serverTimestamp(),visibility:vis,type:'custom',joinCode:code});
  document.querySelector('.overlay')?.remove();
  toast('Group created!','ok');
  switchTab('groups',document.querySelector('[data-t="groups"]'));
};

/* ── GROUP INFO ── */
async function openGroupInfo(){
  if(!chatId)return;
  const snap=await getDoc(doc(db,'groups',chatId));if(!snap.exists())return;
  const g=snap.data();const isOwner=g.createdBy===ME.uid;
  const ov=mkOv();
  ov.innerHTML=`<div class="modal">
    <button class="mcl" onclick="this.closest('.overlay').remove()">×</button>
    <h2>${g.icon||'🐉'} ${esc(g.name)}</h2>
    <p style="text-align:center;color:var(--dim);font-size:13px;margin-bottom:18px">${esc(g.description||'No description')}</p>
    <div style="text-align:center;font-size:10px;letter-spacing:2px;color:var(--dim);margin-bottom:14px">${g.members?.length||0} MEMBERS · ${g.visibility==='private'?'🔒 PRIVATE':'🌍 PUBLIC'}</div>
    ${g.joinCode?`<div class="code-display"><div style="font-size:9px;letter-spacing:2px;color:var(--dim);margin-bottom:6px">INVITE CODE</div><div class="code-val">${g.joinCode}</div><button class="code-copy" onclick="navigator.clipboard.writeText('${g.joinCode}').then(()=>toast('Copied!','ok'))">📋 Copy</button></div>`:''}
    ${isOwner?`<button class="btn-danger" onclick="doDeleteGroup('${chatId}')">DELETE GROUP</button>`:''}
    <button class="btn-leave" onclick="doLeaveGroup('${chatId}')">LEAVE GROUP</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
window.openGroupInfo=openGroupInfo;

window.doLeaveGroup=async function(gid){
  await updateDoc(doc(db,'groups',gid),{members:arrayRemove(ME.uid)});
  document.querySelector('.overlay')?.remove();
  chatId=null;$('cv').classList.remove('open');$('empty').style.display='flex';
  toast('Left group');switchTab('groups',document.querySelector('[data-t="groups"]'));
};
window.doDeleteGroup=async function(gid){
  if(!confirm('Delete this group and all messages?'))return;
  await deleteDoc(doc(db,'groups',gid));
  await remove(ref(rtdb,`messages/${gid}`));
  document.querySelector('.overlay')?.remove();
  chatId=null;$('cv').classList.remove('open');$('empty').style.display='flex';
  toast('Deleted');switchTab('groups',document.querySelector('[data-t="groups"]'));
};

/* ── PROFILE / LOGOUT ── */
window.goProfile=()=>window.location.href='profile.html';
window.doLogout=async function(){
  if(!confirm('Sign out?'))return;
  try{await set(ref(rtdb,`presence/${ME.uid}`),{online:false,uid:ME.uid,lastSeen:rtTs()});}catch(_){}
  await signOut(auth);window.location.href='login.html';
};

/* ── DOM HELPERS ── */
function setList(html){const cl=$('cl');if(cl)cl.innerHTML=html;}
function mkLabel(text){const d=el('div');d.className='sec-lbl';d.textContent=text;return d;}
function mkOv(){const ov=el('div');ov.className='overlay';return ov;}
function makeCiRow(){
  const row=el('div');row.className='ci';
  const av=el('div');av.className='ci-av';row.appendChild(av);
  const meta=el('div');meta.className='ci-meta';
  const n=el('div');n.className='ci-name';meta.appendChild(n);
  const p=el('div');p.className='ci-prev';meta.appendChild(p);
  row.appendChild(meta);return row;
}
