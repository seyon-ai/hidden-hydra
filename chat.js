/**
 * chat.js — Hidden Hydra
 *
 * KEY ARCHITECTURAL DECISION:
 * Messages use onChildAdded() NOT onValue().
 * onChildAdded fires ONCE per message — for existing messages on attach,
 * then once more for each new message. It never re-fires old ones.
 * This completely eliminates the "only first message shows" bug class.
 */

import {
  auth, db, rtdb,
  onAuthStateChanged, signOut,
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  ref, set, push, remove, onValue, onChildAdded, off,
  rtTs, onDisconnect,
  dbQuery, orderByChild, limitToLast, get, update
} from './firebase-config.js';

import {
  welcomeNewUser, handleAIChat, moderateMessage,
  parseCommand, ensureAIChatRoom, checkBanStatus,
  AI_CHAT_ID, BOT_ID
} from './ai.js';

// ─── CONSTANTS ────────────────────────────────────────
const REACT  = ['👍','❤️','😂','😮','😢','🔥','👏','🎉'];
const EMOJIS = '😀😁😂🤣😄😅😆😉😊😋😎😍🥰😘🤩🥳😏😒😞😔😕🙁😣😫😩🥺😢😭😤😠😡🤬😱😨😰😓🤗🤔🤫🤥😶😐😑😬🙄😯😦😧😮🥱😴😪😵🤢🤧😷🤒🤕🤑🤠💪🤝👋👍👎✊👊🤞✌💃🎉🎊🎈🎁🏆🔥⚡🌊💎👑🔮🌙⭐🌟💫✨🌸🌺🌻🌹🍀🌿🦋🐉🦊🦁🐯🐺';
const AVICS  = ['🐉','🦊','🐺','🦁','🐯','🦋','🔥','⚡','🌙','💎','🌊','🦅','🐬','🦝','🎭','🌸','🐙','🦄','⭐'];
const WORLD  = [
  {id:'g-ai-assistant',name:'AI Assistant', icon:'🤖', desc:'Chat with Hydra AI — ask anything!'},
  {id:'g-lounge',   name:'Global Lounge', icon:'🌍', desc:'Talk to everyone worldwide!'},
  {id:'g-gaming',   name:'Gaming Den',    icon:'🎮', desc:'All platforms, all games.'},
  {id:'g-tech',     name:'Tech Talk',     icon:'🚀', desc:'Developers & tech lovers.'},
  {id:'g-music',    name:'Music Vibes',   icon:'🎵', desc:'Share music & artists.'},
  {id:'g-creative', name:'Creative Hub',  icon:'🎨', desc:'Art, design, photography.'},
];

// ─── STATE ────────────────────────────────────────────
let ME   = null;  // Firebase Auth user
let MY   = null;  // Firestore profile
let CID  = null;  // active chat id
let CTYPE= null;  // 'dm' | 'group'
let CDATA= null;  // active chat data
let replyTo = null;
let epOpen  = false;
let typTimer= null;

// Listener refs — stored so we can detach them
let msgAddedRef  = null;   // RTDB ref we attached onChildAdded to
let reactUnsub   = null;   // onValue for reactions
let typRef       = null;   // RTDB ref for typing listener
let dmUnsub      = null;   // Firestore onSnapshot
let grpUnsub     = null;   // Firestore onSnapshot

// Per-chat message tracking
let lastMsgDate   = '';
let lastMsgSender = '';
let msgCount      = 0;

// ─── UTILS ────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const mk = tag => document.createElement(tag);
const esc = s  => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function toast(msg, type='') {
  const tc = $('toasts');
  if (!tc) return;
  const t = mk('div');
  t.className = 'toast' + (type ? ' '+type : '');
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
window.toast = toast;

function avEl(profile, size=40) {
  const w = mk('div');
  w.style.cssText =
    `width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;` +
    `display:flex;align-items:center;justify-content:center;` +
    `font-size:${Math.floor(size*.46)}px;background:var(--s3);flex-shrink:0;`;
  const url = profile?.photoURL;
  if (url && url.startsWith('http')) {
    const img = mk('img');
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

function setList(html) { const c=$('cl'); if(c) c.innerHTML=html; }
function mkLbl(t) { const d=mk('div'); d.className='sec-lbl'; d.textContent=t; return d; }
function mkOv()   { const o=mk('div'); o.className='overlay'; return o; }
function mkCiRow() {
  const r=mk('div'); r.className='ci';
  const a=mk('div'); a.className='ci-av'; r.appendChild(a);
  const m=mk('div'); m.className='ci-meta';
  const n=mk('div'); n.className='ci-name'; m.appendChild(n);
  const p=mk('div'); p.className='ci-prev'; m.appendChild(p);
  r.appendChild(m); return r;
}

// ─── AUTH + BOOT ──────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href='login.html'; return; }
  ME = user;
  const snap = await getDoc(doc(db,'users',ME.uid));
  if (!snap.exists()) { window.location.href='login.html'; return; }
  MY = snap.data();
  setupPresence();
  // Check if user is banned
  const banned = await checkBanStatus(ME.uid);
  if (banned) {
    document.getElementById('loading').innerHTML =
      '<div style="text-align:center;padding:40px;font-family:Cinzel,serif;color:var(--danger)">' +
      '<div style="font-size:48px;margin-bottom:16px">🚫</div>' +
      '<div style="font-size:18px;letter-spacing:3px;margin-bottom:12px">ACCOUNT BANNED</div>' +
      '<div style="font-size:13px;color:var(--dim)">You have been removed from Hidden Hydra for violating community guidelines.</div>' +
      '</div>';
    return;
  }
  await seedWorldRooms();
  await ensureAIChatRoom();
  // Welcome new users
  if (!MY.welcomed) {
    setTimeout(() => welcomeNewUser(ME, MY), 2000);
  }
  boot();
});

function setupPresence() {
  const pr = ref(rtdb,`presence/${ME.uid}`);
  set(pr,{online:true,uid:ME.uid,lastSeen:rtTs()});
  onDisconnect(pr).set({online:false,uid:ME.uid,lastSeen:rtTs()});
}

async function seedWorldRooms() {
  for (const g of WORLD) {
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
  watchReqBadge();
  switchTab('world', document.querySelector('[data-tab="world"]'));
}

function renderMe() {
  const a=$('me-av'); a.innerHTML=''; a.appendChild(avEl(MY,40));
  $('me-name').textContent = MY.username||'—';
}

// ─── TABS ─────────────────────────────────────────────
window.switchTab = function(tab, btn) {
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $('fab').style.display = tab==='groups' ? 'flex' : 'none';
  if (tab!=='dms'    && dmUnsub)  { dmUnsub();  dmUnsub=null; }
  if (tab!=='groups' && grpUnsub) { grpUnsub(); grpUnsub=null; }
  if (tab==='world')   loadWorld();
  if (tab==='dms')     loadDMs();
  if (tab==='groups')  loadGroups();
  if (tab==='explore') loadExplore();
  if (tab==='req')     loadRequests();
};

// ─── REQUEST BADGE ────────────────────────────────────
function watchReqBadge() {
  const q=query(collection(db,'friendRequests'),where('to','==',ME.uid),where('status','==','pending'));
  onSnapshot(q, snap=>{
    const b=$('req-badge');
    if(b){ b.textContent=snap.size; b.style.display=snap.size?'flex':'none'; }
  });
}

// ─── WORLD ROOMS ──────────────────────────────────────
function loadWorld() {
  const cl=$('cl'); cl.innerHTML='';
  cl.appendChild(mkLbl('🌍 WORLD CHAT'));
  WORLD.forEach(g=>{
    const r=mkCiRow();
    r.querySelector('.ci-av').style.fontSize='22px';
    r.querySelector('.ci-av').textContent=g.icon;
    r.querySelector('.ci-name').textContent=g.name;
    r.querySelector('.ci-prev').textContent=g.desc;
    if(CID===g.id) r.classList.add('active');
    r.onclick=()=>openChat(g.id,'group',{...g,type:'global'});
    cl.appendChild(r);
  });
}

// ─── DMs ──────────────────────────────────────────────
function loadDMs() {
  if(dmUnsub){ dmUnsub(); dmUnsub=null; }
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const q=query(collection(db,'chats'),where('members','array-contains',ME.uid),where('type','==','dm'),where('status','==','accepted'));
  let busy=false;
  dmUnsub=onSnapshot(q, async snap=>{
    if(busy) return; busy=true;
    const items=[];
    for(const d of snap.docs){
      const data=d.data();
      const oid=data.members.find(m=>m!==ME.uid); if(!oid) continue;
      try{ const o=await getDoc(doc(db,'users',oid)); if(o.exists()) items.push({id:d.id,...data,other:o.data()}); }catch(_){}
    }
    busy=false;
    const cl=$('cl'); if(!cl) return; cl.innerHTML='';
    if(!items.length){ cl.innerHTML='<div class="empty-lm">No conversations yet.<br>Send a friend request to start.</div>'; return; }
    cl.appendChild(mkLbl('DIRECT MESSAGES'));
    items.forEach(item=>{
      const r=mkCiRow();
      r.querySelector('.ci-av').appendChild(avEl(item.other,42));
      r.querySelector('.ci-name').textContent=item.other.username||'—';
      r.querySelector('.ci-prev').textContent=item.lastMessage||'Say hello!';
      if(CID===item.id) r.classList.add('active');
      r.onclick=()=>openChat(item.id,'dm',item.other);
      cl.appendChild(r);
    });
  });
}

// ─── GROUPS ───────────────────────────────────────────
function loadGroups() {
  if(grpUnsub){ grpUnsub(); grpUnsub=null; }
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  // Fetch all joined groups, filter globals client-side (avoids composite index)
  const q=query(collection(db,'groups'),where('members','array-contains',ME.uid));
  grpUnsub=onSnapshot(q, snap=>{
    const items=snap.docs.map(d=>({id:d.id,...d.data()})).filter(g=>g.type!=='global');
    const cl=$('cl'); if(!cl) return; cl.innerHTML='';
    if(!items.length){ cl.innerHTML='<div class="empty-lm">No groups yet.<br>Create one below!</div>'; return; }
    cl.appendChild(mkLbl('MY GROUPS'));
    items.forEach(g=>{
      const r=mkCiRow();
      r.querySelector('.ci-av').style.fontSize='22px';
      r.querySelector('.ci-av').textContent=g.icon||'🐉';
      r.querySelector('.ci-name').textContent=g.name;
      r.querySelector('.ci-prev').textContent=(g.members?.length||0)+' members'+(g.lastMessage?' · '+g.lastMessage.substring(0,25):'');
      if(CID===g.id) r.classList.add('active');
      if(g.visibility==='private'){ const lk=mk('span'); lk.textContent='🔒'; lk.style.cssText='font-size:11px;color:var(--faint);flex-shrink:0'; r.appendChild(lk); }
      r.onclick=()=>openChat(g.id,'group',g);
      cl.appendChild(r);
    });
  });
}

// ─── EXPLORE ──────────────────────────────────────────
async function loadExplore() {
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const [gSnap,uSnap]=await Promise.all([getDocs(collection(db,'groups')),getDocs(collection(db,'users'))]);
  const pubGroups=gSnap.docs.map(d=>({id:d.id,...d.data()})).filter(g=>g.type!=='global'&&g.visibility!=='private'&&!g.members?.includes(ME.uid));
  const users=uSnap.docs.map(d=>d.data()).filter(u=>u.uid!==ME.uid);
  const cl=$('cl'); cl.innerHTML='';

  // Join-by-code
  const bar=mk('div'); bar.className='code-bar';
  const inp=mk('input'); inp.className='code-inp'; inp.id='code-inp'; inp.placeholder='Enter invite code...';
  const jb=mk('button'); jb.className='join-btn'; jb.textContent='JOIN'; jb.onclick=joinByCode;
  bar.appendChild(inp); bar.appendChild(jb); cl.appendChild(bar);

  if(pubGroups.length){
    cl.appendChild(mkLbl('PUBLIC GROUPS'));
    pubGroups.forEach(g=>{
      const row=mk('div'); row.className='ex-item';
      const av=mk('div'); av.style.cssText='width:42px;height:42px;border-radius:50%;background:var(--s3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0'; av.textContent=g.icon||'🐉';
      const meta=mk('div'); meta.style.cssText='flex:1;min-width:0';
      meta.innerHTML=`<div class="ci-name">${esc(g.name)}</div><div class="ci-prev">${g.members?.length||0} members</div>`;
      const btn=mk('button'); btn.className='join-btn'; btn.textContent='JOIN'; btn.onclick=()=>doJoinGroup(g.id);
      row.appendChild(av); row.appendChild(meta); row.appendChild(btn); cl.appendChild(row);
    });
  }

  if(users.length){
    const fs=await getDoc(doc(db,'users',ME.uid)); MY=fs.data();
    cl.appendChild(mkLbl('PEOPLE'));
    for(const u of users.slice(0,40)){
      const isFriend=MY.friends?.includes(u.uid);
      const rs=await getDocs(query(collection(db,'friendRequests'),where('from','==',ME.uid),where('to','==',u.uid),where('status','==','pending')));
      const sent=!rs.empty;
      const row=mk('div'); row.className='ex-item';
      const avw=mk('div'); avw.style.cssText='width:42px;height:42px;border-radius:50%;flex-shrink:0'; avw.appendChild(avEl(u,42));
      const meta=mk('div'); meta.style.cssText='flex:1;min-width:0';
      meta.innerHTML=`<div class="ci-name">${esc(u.username)}</div><div class="ci-prev">${u.country||''} ${u.bio?'· '+esc(u.bio.substring(0,28)):''}</div>`;
      let btn;
      if(isFriend){ btn=mk('button'); btn.className='join-btn fr'; btn.textContent='💬 DM'; btn.onclick=()=>startDM(u.uid); }
      else if(sent){ btn=mk('span'); btn.className='sent-tag'; btn.textContent='SENT ✓'; }
      else{ btn=mk('button'); btn.className='join-btn'; btn.textContent='+ Add'; btn.onclick=()=>sendFReq(u.uid,u.username,btn); }
      row.appendChild(avw); row.appendChild(meta); row.appendChild(btn); cl.appendChild(row);
    }
  }
}

// ─── REQUESTS ─────────────────────────────────────────
async function loadRequests() {
  setList('<div style="padding:24px;text-align:center"><div class="ring sm"></div></div>');
  const snap=await getDocs(query(collection(db,'friendRequests'),where('to','==',ME.uid),where('status','==','pending')));
  const reqs=snap.docs.map(d=>({id:d.id,...d.data()}));
  const cl=$('cl'); cl.innerHTML='';
  cl.appendChild(mkLbl(`INCOMING (${reqs.length})`));
  if(!reqs.length){ cl.innerHTML+='<div class="empty-lm">No pending requests.</div>'; return; }
  for(const r of reqs){
    const ud=await getDoc(doc(db,'users',r.from)); if(!ud.exists()) continue;
    const u=ud.data();
    const row=mk('div'); row.className='ex-item';
    const avw=mk('div'); avw.style.cssText='width:42px;height:42px;border-radius:50%;flex-shrink:0'; avw.appendChild(avEl(u,42));
    const meta=mk('div'); meta.style.cssText='flex:1;min-width:0';
    meta.innerHTML=`<div class="ci-name">${esc(u.username)}</div><div class="ci-prev">wants to connect · ${u.country||''}</div>`;
    const wrap=mk('div'); wrap.style.cssText='display:flex;gap:5px;flex-shrink:0';
    const acc=mk('button'); acc.className='acc-btn'; acc.textContent='✓ Accept'; acc.onclick=()=>acceptReq(r,u,row);
    const rej=mk('button'); rej.className='rej-btn'; rej.textContent='✕'; rej.onclick=()=>rejectReq(r.id,row);
    wrap.appendChild(acc); wrap.appendChild(rej);
    row.appendChild(avw); row.appendChild(meta); row.appendChild(wrap); cl.appendChild(row);
  }
}

// ─── FRIEND REQUESTS ──────────────────────────────────
async function sendFReq(toUid, toName, btn) {
  btn.disabled=true; btn.textContent='...';
  try{
    await addDoc(collection(db,'friendRequests'),{from:ME.uid,to:toUid,fromName:MY.username,toName,status:'pending',createdAt:serverTimestamp()});
    btn.className='sent-tag'; btn.textContent='SENT ✓'; btn.disabled=false;
    toast('Request sent!','ok');
  }catch(e){ toast('Error: '+e.message,'err'); btn.disabled=false; btn.textContent='+ Add'; }
}

async function acceptReq(req, fromUser, rowEl) {
  try{
    await updateDoc(doc(db,'friendRequests',req.id),{status:'accepted'});
    await updateDoc(doc(db,'users',ME.uid),{friends:arrayUnion(req.from)});
    const ex=await getDocs(query(collection(db,'chats'),where('members','array-contains',ME.uid),where('type','==','dm')));
    let cid=null; ex.forEach(d=>{if(d.data().members.includes(req.from))cid=d.id;});
    if(!cid){
      const cr=await addDoc(collection(db,'chats'),{type:'dm',members:[ME.uid,req.from],status:'accepted',lastMessage:'',lastTime:serverTimestamp()});
      cid=cr.id;
    } else {
      await updateDoc(doc(db,'chats',cid),{status:'accepted'});
    }
    rowEl.remove();
    const s=await getDoc(doc(db,'users',ME.uid)); MY=s.data();
    toast(`Connected with ${fromUser.username}! 🎉`,'ok');
  }catch(e){ toast('Error: '+e.message,'err'); }
}

async function rejectReq(reqId, rowEl) {
  try{ await updateDoc(doc(db,'friendRequests',reqId),{status:'rejected'}); rowEl.remove(); toast('Declined.'); }
  catch(e){ toast('Error: '+e.message,'err'); }
}

// ─── JOIN GROUP ───────────────────────────────────────
async function doJoinGroup(gid) {
  try{
    await updateDoc(doc(db,'groups',gid),{members:arrayUnion(ME.uid)});
    const s=await getDoc(doc(db,'groups',gid));
    toast('Joined!','ok');
    openChat(gid,'group',{id:gid,...s.data()});
    switchTab('groups',document.querySelector('[data-tab="groups"]'));
  }catch(e){ toast('Error: '+e.message,'err'); }
}
window.doJoinGroup=doJoinGroup;

async function joinByCode() {
  const code=$('code-inp')?.value.trim(); if(!code) return;
  const snap=await getDocs(query(collection(db,'groups'),where('joinCode','==',code)));
  if(snap.empty){ toast('No group with that code','err'); return; }
  const g={id:snap.docs[0].id,...snap.docs[0].data()};
  if(g.members?.includes(ME.uid)){ toast('Already a member!'); openChat(g.id,'group',g); return; }
  doJoinGroup(g.id);
}
window.joinByCode=joinByCode;

// ─── START DM ─────────────────────────────────────────
async function startDM(uid) {
  const [s1,s2]=await Promise.all([
    getDocs(query(collection(db,'friendRequests'),where('from','==',ME.uid),where('to','==',uid),where('status','==','accepted'))),
    getDocs(query(collection(db,'friendRequests'),where('from','==',uid),where('to','==',ME.uid),where('status','==','accepted')))
  ]);
  if(s1.empty&&s2.empty&&!MY.friends?.includes(uid)){
    const u=await getDoc(doc(db,'users',uid));
    toast(`Send ${u.data()?.username||'them'} a friend request first!`,'err'); return;
  }
  const ex=await getDocs(query(collection(db,'chats'),where('members','array-contains',ME.uid),where('type','==','dm')));
  let cid=null; ex.forEach(d=>{if(d.data().members.includes(uid))cid=d.id;});
  if(!cid){
    const cr=await addDoc(collection(db,'chats'),{type:'dm',members:[ME.uid,uid],status:'accepted',lastMessage:'',lastTime:serverTimestamp()});
    cid=cr.id;
  }
  const o=await getDoc(doc(db,'users',uid));
  if(o.exists()){ openChat(cid,'dm',o.data()); switchTab('dms',document.querySelector('[data-tab="dms"]')); }
}
window.startDM=startDM;

// ─── SEARCH ───────────────────────────────────────────
window.doSearch=async function(val){
  $('sc-clear').style.display=val?'block':'none';
  if(!val.trim()){ switchTab('world',document.querySelector('[data-tab="world"]')); return; }
  const snap=await getDocs(collection(db,'users'));
  const res=snap.docs.map(d=>d.data()).filter(u=>u.uid!==ME.uid&&u.username?.toLowerCase().includes(val.toLowerCase()));
  const cl=$('cl'); cl.innerHTML='';
  cl.appendChild(mkLbl(`RESULTS (${res.length})`));
  const fs=await getDoc(doc(db,'users',ME.uid)); MY=fs.data();
  res.forEach(u=>{
    const r=mkCiRow();
    r.querySelector('.ci-av').appendChild(avEl(u,42));
    r.querySelector('.ci-name').textContent=u.username;
    r.querySelector('.ci-prev').textContent=u.country||'';
    const isFriend=MY.friends?.includes(u.uid);
    const btn=mk('button'); btn.className='join-btn'+(isFriend?' fr':''); btn.textContent=isFriend?'💬 DM':'+ Add';
    btn.onclick=()=>isFriend?startDM(u.uid):sendFReq(u.uid,u.username,btn);
    r.appendChild(btn); cl.appendChild(r);
  });
};
window.clearSearch=function(){$('search-inp').value='';$('sc-clear').style.display='none';switchTab('world',document.querySelector('[data-tab="world"]'));};

// ─── OPEN CHAT ────────────────────────────────────────
window.openChat=function(cid, type, data) {
  // 1. Detach ALL previous listeners
  detachMsgListeners();

  // 2. Update state
  CID=cid; CTYPE=type; CDATA=data; replyTo=null;
  lastMsgDate=''; lastMsgSender=''; msgCount=0;

  // 3. Show UI
  $('empty').style.display='none';
  $('cv').classList.add('open');
  cancelReply();
  $('typing-row').style.visibility='hidden';
  $('msgs').innerHTML='';

  const isGrp=type==='group';
  $('ch-name').textContent=isGrp?data.name:(data.username||'—');
  $('ch-sub').textContent=isGrp?`${data.members?.length||0} members`:`${data.country||''} ${data.bio?'· '+data.bio:''}`;
  const chAv=$('ch-av'); chAv.innerHTML='';
  if(isGrp){ chAv.style.fontSize='22px'; chAv.textContent=data.icon||'🐉'; }
  else chAv.appendChild(avEl(data,38));

  const ib=$('info-btn');
  ib.style.display=(isGrp&&data.type!=='global')?'flex':'none';
  if(isGrp) ib.onclick=openGroupInfo;

  // 4. Attach listeners
  attachMsgListeners(cid);
  attachTypingListener(cid);

  // 5. Mobile: close sidebar
  if(window.innerWidth<=700) $('sb').classList.remove('open');
};

window.closeCv=function(){
  $('cv').classList.remove('open');
  $('empty').style.display='flex';
};

// ─── DETACH LISTENERS ─────────────────────────────────
function detachMsgListeners() {
  if(msgAddedRef){ off(msgAddedRef); msgAddedRef=null; }
  if(reactUnsub) { reactUnsub();    reactUnsub=null;  }
  if(typRef)     { off(typRef);     typRef=null;      }
  if(CID) remove(ref(rtdb,`typing/${CID}/${ME.uid}`));
}

// ─── MESSAGE LISTENERS ────────────────────────────────
// *** THE KEY FIX ***
// onChildAdded fires once per child — existing ones on attach, new ones as they arrive.
// It NEVER re-fires old messages. No "only first message" bug possible.

function attachMsgListeners(cid) {
  const msgRef = dbQuery(
    ref(rtdb, `messages/${cid}`),
    orderByChild('timestamp'),
    limitToLast(100)
  );

  msgAddedRef = ref(rtdb, `messages/${cid}`);

  // Use onChildAdded — fires once per message, never re-fires
  onChildAdded(msgRef, snap => {
    if(CID !== cid) return; // stale listener guard
    const msg = { _key: snap.key, ...snap.val() };
    appendMsg(msg);
  });

  // Use onValue only for reactions — runs on reaction changes only
  // We watch at message level for reaction updates
  reactUnsub = onValue(ref(rtdb,`messages/${cid}`), snap=>{
    if(CID!==cid) return;
    snap.forEach(c=>{
      const key=c.key;
      const row=$(`[data-mid="${key}"]`);
      if(row){
        const rr=row.querySelector('[data-rr]');
        if(rr) drawReacts(rr, {_key:key,...c.val()});
      }
    });
  });
}

function appendMsg(msg) {
  const wrap=$('msgs'); if(!wrap) return;

  // Remove "no messages" placeholder
  const ph=wrap.querySelector('[data-ph]'); if(ph) ph.remove();

  // Date divider if date changed
  const d=fmtDate(msg.timestamp);
  if(d!==lastMsgDate){
    lastMsgDate=d;
    const div=mk('div'); div.className='date-div'; div.textContent=d;
    wrap.appendChild(div);
    lastMsgSender=''; // reset grouping on new date
  }

  const mine=msg.senderId===ME.uid;
  const grouped=msg.senderId===lastMsgSender && msgCount>0;
  lastMsgSender=msg.senderId;
  msgCount++;

  const isBot = msg.senderId === BOT_ID;
  const row=mk('div');
  row.className=`msg-row${mine?' mine':''}${grouped?' grp':''}`;
  row.dataset.mid=msg._key;
  if(isBot) row.dataset.bot='1';

  // Avatar
  const avw=mk('div'); avw.className='msg-av';
  if(!mine) avw.appendChild(avEl({avatar:msg.senderAvatar||'🐉',photoURL:msg.senderPhoto||''},28));
  row.appendChild(avw);

  const content=mk('div'); content.className='msg-content';

  // Sender name (groups)
  if(CTYPE==='group'&&!mine&&!grouped){
    const sn=mk('div'); sn.className='msg-sender'; sn.textContent=msg.senderName||'Unknown';
    content.appendChild(sn);
  }

  // Reply quote
  if(msg.replyTo){
    const rq=mk('div'); rq.className='rq';
    rq.innerHTML=`<div class="rq-s">↩ ${esc(msg.replyTo.senderName)}</div><div class="rq-t">${esc(msg.replyTo.text||'')}</div>`;
    content.appendChild(rq);
  }

  // Bubble + actions
  const b=mk('div'); b.className='bubble'; b.textContent=msg.text||'';
  const acts=mk('div'); acts.className='msg-actions';
  REACT.forEach(emoji=>{
    const ab=mk('button'); ab.className='mac'; ab.textContent=emoji;
    ab.onclick=ev=>{ev.stopPropagation();doReact(CID,msg._key,emoji);};
    acts.appendChild(ab);
  });
  const rb=mk('button'); rb.className='mac'; rb.textContent='↩'; rb.title='Reply';
  rb.onclick=ev=>{ev.stopPropagation();setReply(msg);};
  acts.appendChild(rb);
  b.appendChild(acts);
  content.appendChild(b);

  // Reactions
  const rr=mk('div'); rr.className='reacts'; rr.dataset.rr='1';
  if(msg.reactions) drawReacts(rr,msg);
  content.appendChild(rr);

  // Time
  const tm=mk('div'); tm.className='msg-time'; tm.textContent=fmtTime(msg.timestamp);
  content.appendChild(tm);

  row.appendChild(content);
  wrap.appendChild(row);
  wrap.scrollTop=wrap.scrollHeight;
}

function drawReacts(container, msg) {
  if(!msg.reactions){ container.innerHTML=''; return; }
  // Only update if reactions changed (simple check)
  const newHTML = Object.entries(msg.reactions)
    .map(([emoji,users])=>{
      const uids=Object.keys(users||{}); if(!uids.length) return '';
      const me=uids.includes(ME.uid);
      return `<div class="rc${me?' me':''}" onclick="doReact('${CID}','${msg._key}','${emoji}')">${emoji} <span>${uids.length}</span></div>`;
    }).join('');
  if(container.innerHTML!==newHTML) container.innerHTML=newHTML;
}

window.doReact=async function(cid,key,emoji){
  const path=`messages/${cid}/${key}/reactions/${emoji}/${ME.uid}`;
  const r=ref(rtdb,path);
  const snap=await get(r);
  if(snap.exists()) await remove(r); else await set(r,true);
};

// ─── REPLY ────────────────────────────────────────────
function setReply(msg){
  replyTo=msg;
  $('reply-bar').classList.add('show');
  $('rb-sender').textContent=msg.senderName||MY.username;
  $('rb-text').textContent=(msg.text||'').substring(0,60);
  $('msg-ta').focus();
}
window.cancelReply=function(){ replyTo=null; $('reply-bar').classList.remove('show'); };

// ─── TYPING ───────────────────────────────────────────
window.notifyTyping=function(){
  if(!CID) return;
  const tr=ref(rtdb,`typing/${CID}/${ME.uid}`);
  set(tr,MY.username||'Someone');
  clearTimeout(typTimer);
  typTimer=setTimeout(()=>remove(tr),2500);
};

function attachTypingListener(cid){
  const tr=ref(rtdb,`typing/${cid}`);
  typRef=tr;
  onValue(tr,snap=>{
    const names=[]; snap.forEach(c=>{if(c.key!==ME.uid)names.push(c.val());});
    const row=$('typing-row');
    if(row){ row.style.visibility=names.length?'visible':'hidden'; $('typing-txt').textContent=names.length?`${names[0]} is typing...`:''; }
  });
}

// ─── SEND MESSAGE ─────────────────────────────────────
window.sendMsg=async function(){
  const ta=$('msg-ta'); if(!ta) return;
  const text=ta.value.trim(); if(!text||!CID) return;

  // Handle commands (/help, /ai, /report)
  const isCmd = await parseCommand(ME.uid, MY.username, CID, text, async(t) => {
    // actual send function passed to command parser
    await push(ref(rtdb,`messages/${CID}`),{text:t,senderId:ME.uid,senderName:MY.username||'Unknown',senderAvatar:MY.avatar||'🐉',senderPhoto:MY.photoURL||'',timestamp:Date.now(),reactions:null});
  });
  if (isCmd) {
    ta.value=''; ta.style.height='40px'; ta.style.overflowY='hidden';
    cancelReply(); remove(ref(rtdb,`typing/${CID}/${ME.uid}`)); if(epOpen) toggleEp();
    return;
  }

  // If this is the AI Assistant room, route to AI
  if (CID === AI_CHAT_ID) {
    const msg={text,senderId:ME.uid,senderName:MY.username||'Unknown',senderAvatar:MY.avatar||'🐉',senderPhoto:MY.photoURL||'',timestamp:Date.now(),reactions:null};
    await push(ref(rtdb,`messages/${CID}`),msg);
    ta.value=''; ta.style.height='40px'; ta.style.overflowY='hidden';
    cancelReply(); remove(ref(rtdb,`typing/${CID}/${ME.uid}`)); if(epOpen) toggleEp();
    // Let AI respond
    setTimeout(() => handleAIChat(ME.uid, MY.username, text), 400);
    return;
  }

  const msg={
    text,
    senderId:    ME.uid,
    senderName:  MY.username||'Unknown',
    senderAvatar:MY.avatar||'🐉',
    senderPhoto: MY.photoURL||'',
    timestamp:   Date.now(),
    reactions:   null   // null instead of {} — Firebase drops empty objects anyway
  };
  if(replyTo) msg.replyTo={msgId:replyTo._key,text:replyTo.text,senderName:replyTo.senderName||MY.username};

  const pushResult = await push(ref(rtdb,`messages/${CID}`),msg);
  const msgKey = pushResult.key;

  // AI moderation for group/world chats (not DMs)
  if (CTYPE === 'group') {
    moderateMessage(CID, msgKey, ME.uid, MY.username||'Unknown', text).catch(()=>{});
  }

  try{
    const col=CTYPE==='dm'?'chats':'groups';
    await updateDoc(doc(db,col,CID),{lastMessage:text,lastTime:serverTimestamp()});
  }catch(_){}

  ta.value=''; ta.style.height='40px'; ta.style.overflowY='hidden';
  cancelReply();
  remove(ref(rtdb,`typing/${CID}/${ME.uid}`));
  if(epOpen) toggleEp();
};

window.taKey=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.sendMsg();}};
window.taResize=function(ta){
  ta.style.height='40px';
  const h=Math.min(ta.scrollHeight,130);
  ta.style.height=h+'px';
  ta.style.overflowY=h>=130?'auto':'hidden';
};

// ─── EMOJI ────────────────────────────────────────────
function buildEmojiPanel(){
  const g=$('ep-grid'); if(!g) return; g.innerHTML='';
  [...EMOJIS].forEach(e=>{
    if(!e.trim()) return;
    const b=mk('button'); b.className='epb'; b.textContent=e;
    b.onclick=()=>{ const ta=$('msg-ta'); if(ta){ta.value+=e;ta.focus();}toggleEp(); };
    g.appendChild(b);
  });
}
window.toggleEp=function(){ epOpen=!epOpen; $('ep').classList.toggle('open',epOpen); };
document.addEventListener('click',e=>{if(epOpen&&!e.target.closest('#ep')&&!e.target.closest('[onclick="toggleEp()"]'))toggleEp();});

// ─── ONLINE PRESENCE ──────────────────────────────────
function watchPresence(){
  onValue(ref(rtdb,'presence'),async snap=>{
    const uids=[]; snap.forEach(c=>{if(c.val().online&&c.key!==ME.uid)uids.push(c.key);});
    const panel=$('rp-list'); if(!panel) return;
    panel.innerHTML='';
    if(!uids.length){ panel.innerHTML='<div style="padding:18px;color:var(--faint);font-size:11px;text-align:center">No one online</div>'; return; }
    for(const uid of uids.slice(0,20)){
      try{
        const ud=await getDoc(doc(db,'users',uid)); if(!ud.exists()) continue;
        const u=ud.data();
        const item=mk('div'); item.className='rp-u';
        const avw=mk('div'); avw.className='rp-av'; avw.style.cssText='position:relative;flex-shrink:0'; avw.appendChild(avEl(u,30));
        const dot=mk('div'); dot.className='rp-dot'; avw.appendChild(dot);
        item.appendChild(avw);
        const info=mk('div'); info.style.cssText='flex:1;min-width:0';
        info.innerHTML=`<div class="rp-name">${esc(u.username)}</div><div class="rp-ct">${u.country||''}</div>`;
        item.appendChild(info);
        const isFriend=MY.friends?.includes(uid);
        const btn=mk('button'); btn.className='sm-btn'+(isFriend?' fr':''); btn.textContent=isFriend?'💬':'+ Add';
        btn.onclick=()=>isFriend?startDM(uid):sendFReq(uid,u.username,btn);
        item.appendChild(btn); panel.appendChild(item);
      }catch(_){}
    }
  });
}

// ─── CREATE GROUP ─────────────────────────────────────
window.openCreateGroup=function(){
  const ov=mkOv(); let selIcon='🐉';
  ov.innerHTML=`<div class="modal">
    <button class="modal-close" onclick="this.closest('.overlay').remove()">×</button>
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
    <button class="btn-gold" style="width:100%;justify-content:center;margin-top:8px" onclick="doCreateGroup()">CREATE REALM</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  const grid=ov.querySelector('#ig-g');
  AVICS.forEach(a=>{
    const s=mk('span'); s.className='ig-item'+(a===selIcon?' on':''); s.textContent=a;
    s.onclick=()=>{ selIcon=a; window._gi=a; grid.querySelectorAll('.ig-item').forEach(x=>x.classList.remove('on')); s.classList.add('on'); };
    grid.appendChild(s);
  });
  window._gi=selIcon;
};

window.doCreateGroup=async function(){
  const name=document.getElementById('mg-n')?.value.trim();
  const desc=document.getElementById('mg-d')?.value.trim();
  const vis=document.getElementById('mg-v')?.value||'public';
  if(!name){ toast('Enter a group name','err'); return; }
  const code=name.toLowerCase().replace(/\s+/g,'-')+'-'+Math.random().toString(36).slice(2,5);
  await addDoc(collection(db,'groups'),{name,description:desc||'',icon:window._gi||'🐉',members:[ME.uid],createdBy:ME.uid,type:'custom',createdAt:serverTimestamp(),lastMessage:'',lastTime:serverTimestamp(),visibility:vis,joinCode:code});
  document.querySelector('.overlay')?.remove();
  toast('Group created!','ok');
  switchTab('groups',document.querySelector('[data-tab="groups"]'));
};

// ─── GROUP INFO ───────────────────────────────────────
async function openGroupInfo(){
  if(!CID) return;
  const snap=await getDoc(doc(db,'groups',CID)); if(!snap.exists()) return;
  const g=snap.data(); const isOwner=g.createdBy===ME.uid;
  const ov=mkOv();
  ov.innerHTML=`<div class="modal">
    <button class="modal-close" onclick="this.closest('.overlay').remove()">×</button>
    <h2>${g.icon||'🐉'} ${esc(g.name)}</h2>
    <p style="text-align:center;color:var(--dim);font-size:13px;margin-bottom:18px">${esc(g.description||'No description')}</p>
    <div style="text-align:center;font-size:10px;letter-spacing:2px;color:var(--dim);margin-bottom:14px">${g.members?.length||0} MEMBERS · ${g.visibility==='private'?'🔒 PRIVATE':'🌍 PUBLIC'}</div>
    ${g.joinCode?`<div class="code-display"><div style="font-size:9px;letter-spacing:2px;color:var(--dim);margin-bottom:6px">INVITE CODE</div><div class="code-val">${g.joinCode}</div><button class="btn-ghost" style="font-size:11px;padding:6px 14px;margin-top:8px" onclick="navigator.clipboard.writeText('${g.joinCode}').then(()=>toast('Copied!','ok'))">📋 Copy</button></div>`:''}
    ${isOwner?`<button class="btn-danger" onclick="doDeleteGroup('${CID}')">DELETE GROUP</button>`:''}
    <button class="btn-leave" onclick="doLeaveGroup('${CID}')">LEAVE GROUP</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
window.openGroupInfo=openGroupInfo;

window.doLeaveGroup=async function(gid){
  await updateDoc(doc(db,'groups',gid),{members:arrayRemove(ME.uid)});
  document.querySelector('.overlay')?.remove();
  CID=null; $('cv').classList.remove('open'); $('empty').style.display='flex';
  toast('Left group'); switchTab('groups',document.querySelector('[data-tab="groups"]'));
};
window.doDeleteGroup=async function(gid){
  if(!confirm('Delete this group and all messages?')) return;
  await deleteDoc(doc(db,'groups',gid));
  await remove(ref(rtdb,`messages/${gid}`));
  document.querySelector('.overlay')?.remove();
  CID=null; $('cv').classList.remove('open'); $('empty').style.display='flex';
  toast('Deleted'); switchTab('groups',document.querySelector('[data-tab="groups"]'));
};

// ─── PROFILE / LOGOUT ─────────────────────────────────
window.goProfile=()=>window.location.href='profile.html';
window.doLogout=async function(){
  if(!confirm('Sign out?')) return;
  try{ await set(ref(rtdb,`presence/${ME.uid}`),{online:false,uid:ME.uid,lastSeen:rtTs()}); }catch(_){}
  await signOut(auth); window.location.href='login.html';
};
