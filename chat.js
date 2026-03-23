// chat.js — Hidden Hydra Main Chat (ES Module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, addDoc, updateDoc,
  collection, query, where, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDatabase, ref, set, push, remove, onValue, off,
  serverTimestamp as rtTs, onDisconnect,
  query as rtQuery, orderByChild, limitToLast, get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCj5A6GpHYppmaqZqY39HmIAID2jZv3eAM",
  authDomain: "hidden-hydra.firebaseapp.com",
  databaseURL: "https://hidden-hydra-default-rtdb.firebaseio.com",
  projectId: "hidden-hydra",
  storageBucket: "hidden-hydra.firebasestorage.app",
  messagingSenderId: "1487060887",
  appId: "1:1487060887:web:402fea888cdf486f8d0ed2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

const EMOJIS_REACTION = ['👍','❤️','😂','😮','😢','🔥','👏','🎉','💀','🙏'];
const EMOJIS_ALL = '😀😁😂🤣😄😅😆😉😊😋😎😍🥰😘🤩🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠💪🤝👋👍👎✊👊🤞✌️💃🎉🎊🎈🎁🏆🔥⚡🌊💎👑🗡️🔮🌙⭐🌟💫✨🌸🌺🌻🌹🍀🌿🦋🐉🦊🦁🐯🐺';
const AVATAR_EMOJIS = ['🐉','🦊','🐺','🦁','🐯','🦋','🔥','⚡','🌙','💎','🌊','🦅','🐬','🦝','🎭','🌸','🐙','🦄','⭐','🗡️'];

let currentUser = null, currentProfile = null;
let activeChat = null, activeChatType = null, activeChatData = null;
let msgUnsubscribe = null, typingRef = null, typingListener = null;
let replyTo = null, emojiOpen = false;
let dmListener = null, groupListener = null;
let typingTimeout = null;

function $(id) { return document.getElementById(id); }

function toast(msg) {
  const tc = $('toast-container'); if (!tc) return;
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  tc.appendChild(t); setTimeout(() => t.remove(), 3000);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function avatarEl(p, size = 40) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:${Math.floor(size*0.5)}px;background:var(--surface-2);flex-shrink:0;`;
  if (p?.photoURL) {
    const img = document.createElement('img');
    img.src = p.photoURL;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    wrap.appendChild(img);
  } else {
    wrap.textContent = p?.avatar || '🐉';
  }
  return wrap;
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return 'Today';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}

// ── AUTH ──
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'login.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) { window.location.href = 'login.html'; return; }
  currentProfile = snap.data();
  setupPresence();
  initApp();
});

function setupPresence() {
  const presRef = ref(rtdb, `presence/${currentUser.uid}`);
  set(presRef, { online: true, uid: currentUser.uid, lastSeen: rtTs() });
  onDisconnect(presRef).set({ online: false, uid: currentUser.uid, lastSeen: rtTs() });
}

function initApp() {
  $('auth-loading').style.display = 'none';
  $('app').style.display = 'flex';
  renderMyProfile();
  buildEmojiPanel();
  switchTab('dms', document.querySelector('[data-tab="dms"]'));
  listenOnlineUsers();
  $('new-group-fab').style.display = 'flex';
}

function renderMyProfile() {
  const avEl = $('my-av-el'); avEl.innerHTML = '';
  avEl.appendChild(avatarEl(currentProfile, 40));
  $('my-username-el').textContent = currentProfile.username || 'Unknown';
}

// ── TABS ──
window.switchTab = function(tab, btn) {
  document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  $('new-group-fab').style.display = tab === 'groups' ? 'flex' : 'none';
  if (tab === 'dms') loadDMs();
  else if (tab === 'groups') loadGroups();
  else if (tab === 'explore') loadExplore();
};

// ── DMs ──
function loadDMs() {
  if (dmListener) dmListener();
  const list = $('chat-list');
  list.innerHTML = '<div class="list-loading"><div class="loader-ring small"></div></div>';
  const q = query(collection(db, 'chats'), where('members', 'array-contains', currentUser.uid), where('type', '==', 'dm'));
  dmListener = onSnapshot(q, async (snap) => {
    const items = [];
    for (const d of snap.docs) {
      const data = d.data();
      const otherId = data.members.find(m => m !== currentUser.uid);
      try {
        const oDoc = await getDoc(doc(db, 'users', otherId));
        if (oDoc.exists()) items.push({ chatId: d.id, ...data, other: oDoc.data() });
      } catch {}
    }
    renderDMList(items);
  });
}

function renderDMList(items) {
  const list = $('chat-list'); if (!list) return;
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--text-faint);font-size:12px;letter-spacing:1px;line-height:2">No conversations yet.<br>Explore users to start chatting.</div>`;
    return;
  }
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'chat-item' + (activeChat === item.chatId ? ' active' : '');
    el.style.cssText = 'display:flex;align-items:center;gap:12px';
    const avWrap = document.createElement('div'); avWrap.className = 'ci-av';
    avWrap.appendChild(avatarEl(item.other, 44));
    el.appendChild(avWrap);
    const meta = document.createElement('div'); meta.className = 'ci-meta';
    meta.innerHTML = `<div class="ci-name">${escHtml(item.other.username)}</div><div class="ci-preview">${item.other.country || ''} · ${escHtml(item.lastMessage || 'Start chatting')}</div>`;
    el.appendChild(meta);
    el.onclick = () => openChat(item.chatId, 'dm', item.other);
    list.appendChild(el);
  });
}

// ── GROUPS ──
function loadGroups() {
  if (groupListener) groupListener();
  const list = $('chat-list');
  list.innerHTML = '<div class="list-loading"><div class="loader-ring small"></div></div>';
  const q = query(collection(db, 'groups'), where('members', 'array-contains', currentUser.uid));
  groupListener = onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ groupId: d.id, ...d.data() }));
    renderGroupList(items);
  });
}

function renderGroupList(items) {
  const list = $('chat-list'); if (!list) return;
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--text-faint);font-size:12px;letter-spacing:1px;line-height:2">No groups yet.<br>Create one or explore!</div>`;
    return;
  }
  items.forEach(g => {
    const el = document.createElement('div');
    el.className = 'chat-item' + (activeChat === g.groupId ? ' active' : '');
    el.style.cssText = 'display:flex;align-items:center;gap:12px';
    el.innerHTML = `
      <div class="ci-av" style="font-size:22px">${g.icon || '🐉'}</div>
      <div class="ci-meta">
        <div class="ci-name">${escHtml(g.name)}</div>
        <div class="ci-preview">${g.members?.length || 0} members${g.lastMessage ? ' · ' + escHtml(g.lastMessage) : ''}</div>
      </div>`;
    el.onclick = () => openChat(g.groupId, 'group', g);
    list.appendChild(el);
  });
}

// ── EXPLORE ──
async function loadExplore() {
  const list = $('chat-list');
  list.innerHTML = '<div class="list-loading"><div class="loader-ring small"></div></div>';
  const [gSnap, uSnap] = await Promise.all([getDocs(collection(db, 'groups')), getDocs(collection(db, 'users'))]);
  const allGroups = gSnap.docs.map(d => ({ groupId: d.id, ...d.data() })).filter(g => !g.members?.includes(currentUser.uid));
  const users = uSnap.docs.map(d => d.data()).filter(u => u.uid !== currentUser.uid).slice(0, 20);

  list.innerHTML = '';
  if (allGroups.length) {
    const lbl = document.createElement('div'); lbl.className = 'section-label'; lbl.textContent = 'Public Groups';
    list.appendChild(lbl);
    allGroups.forEach(g => {
      const el = document.createElement('div'); el.className = 'explore-item';
      el.style.cssText = 'display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;transition:all 0.2s';
      el.innerHTML = `
        <div class="ci-av" style="font-size:22px">${g.icon || '🐉'}</div>
        <div class="ci-meta" style="flex:1;min-width:0">
          <div class="ci-name">${escHtml(g.name)}</div>
          <div class="ci-preview">${g.members?.length || 0} members</div>
        </div>
        <button class="join-btn">JOIN</button>`;
      el.querySelector('.join-btn').onclick = e => { e.stopPropagation(); joinGroup(g.groupId); };
      list.appendChild(el);
    });
  }
  if (users.length) {
    const lbl = document.createElement('div'); lbl.className = 'section-label'; lbl.textContent = 'All Users';
    list.appendChild(lbl);
    users.forEach(u => {
      const el = document.createElement('div'); el.className = 'explore-item';
      el.style.cssText = 'display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;transition:all 0.2s';
      const avWrap = document.createElement('div'); avWrap.className = 'ci-av';
      avWrap.appendChild(avatarEl(u, 44));
      el.appendChild(avWrap);
      const meta = document.createElement('div'); meta.className = 'ci-meta'; meta.style.cssText = 'flex:1;min-width:0';
      meta.innerHTML = `<div class="ci-name">${escHtml(u.username)}</div><div class="ci-preview">${u.country || ''}</div>`;
      el.appendChild(meta);
      const btn = document.createElement('button'); btn.className = 'join-btn'; btn.textContent = 'DM';
      btn.onclick = e => { e.stopPropagation(); window.startDM(u.uid); };
      el.appendChild(btn);
      list.appendChild(el);
    });
  }
  if (!allGroups.length && !users.length) {
    list.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-faint)">Nothing to explore yet</div>`;
  }
}

// ── SEARCH ──
window.handleSearch = async function(val) {
  const clear = $('s-clear'); if (clear) clear.style.display = val ? 'block' : 'none';
  if (!val.trim()) { switchTab('dms', document.querySelector('[data-tab="dms"]')); return; }
  const list = $('chat-list');
  list.innerHTML = '<div class="list-loading"><div class="loader-ring small"></div></div>';
  const snap = await getDocs(collection(db, 'users'));
  const results = snap.docs.map(d => d.data()).filter(u => u.uid !== currentUser.uid && u.username?.toLowerCase().includes(val.toLowerCase()));
  list.innerHTML = `<div class="section-label">Users (${results.length})</div>`;
  if (!results.length) { list.innerHTML += `<div style="padding:20px;color:var(--text-faint);font-size:12px;text-align:center">No users found</div>`; return; }
  results.forEach(u => {
    const el = document.createElement('div'); el.className = 'chat-item';
    el.style.cssText = 'display:flex;align-items:center;gap:12px';
    const avWrap = document.createElement('div'); avWrap.className = 'ci-av';
    avWrap.appendChild(avatarEl(u, 44)); el.appendChild(avWrap);
    const meta = document.createElement('div'); meta.className = 'ci-meta'; meta.style.cssText = 'flex:1;min-width:0';
    meta.innerHTML = `<div class="ci-name">${escHtml(u.username)}</div><div class="ci-preview">${u.country || ''}</div>`;
    el.appendChild(meta);
    const btn = document.createElement('button'); btn.className = 'join-btn'; btn.textContent = 'DM';
    btn.onclick = e => { e.stopPropagation(); window.startDM(u.uid); };
    el.appendChild(btn);
    list.appendChild(el);
  });
};

window.clearSearch = function() { $('search-inp').value = ''; $('s-clear').style.display = 'none'; switchTab('dms', document.querySelector('[data-tab="dms"]')); };

// ── START DM ──
window.startDM = async function(uid) {
  const q = query(collection(db, 'chats'), where('members', 'array-contains', currentUser.uid), where('type', '==', 'dm'));
  const snap = await getDocs(q);
  let chatId = null;
  snap.forEach(d => { if (d.data().members.includes(uid)) chatId = d.id; });
  if (!chatId) {
    const ref2 = await addDoc(collection(db, 'chats'), { type: 'dm', members: [currentUser.uid, uid], lastMessage: '', lastTime: serverTimestamp() });
    chatId = ref2.id;
  }
  const oDoc = await getDoc(doc(db, 'users', uid));
  if (oDoc.exists()) { openChat(chatId, 'dm', oDoc.data()); switchTab('dms', document.querySelector('[data-tab="dms"]')); }
};

// ── JOIN GROUP ──
async function joinGroup(groupId) {
  const gRef = doc(db, 'groups', groupId);
  const snap = await getDoc(gRef); if (!snap.exists()) return;
  const members = snap.data().members || [];
  if (!members.includes(currentUser.uid)) await updateDoc(gRef, { members: [...members, currentUser.uid] });
  toast('✅ Joined group!');
  openChat(groupId, 'group', { groupId, ...snap.data(), members: [...members, currentUser.uid] });
  switchTab('groups', document.querySelector('[data-tab="groups"]'));
}

// ── OPEN CHAT ──
window.openChat = function(chatId, type, data) {
  if (msgUnsubscribe) { msgUnsubscribe(); msgUnsubscribe = null; }
  if (typingRef) remove(typingRef);
  if (typingListener) off(ref(rtdb, `typing/${activeChat}`));

  activeChat = chatId; activeChatType = type; activeChatData = data; replyTo = null;
  $('empty-state').style.display = 'none';
  $('chat-view').style.display = 'flex';

  const isGroup = type === 'group';
  $('ch-name').textContent = isGroup ? data.name : data.username;
  $('ch-sub').textContent = isGroup ? `${data.members?.length || 0} members` : `${data.country || ''} ${data.bio ? '· ' + data.bio : ''}`;

  const chAv = $('ch-av'); chAv.innerHTML = '';
  if (isGroup) chAv.textContent = data.icon || '🐉';
  else chAv.appendChild(avatarEl(data, 40));

  const infoBtn = $('ch-info-btn');
  if (infoBtn) infoBtn.onclick = isGroup ? () => openGroupInfo(chatId) : null;

  $('reply-bar').style.display = 'none';
  $('typing-area').style.display = 'none';
  closeEmojiPicker();

  $('messages-wrap').innerHTML = '<div class="msgs-loading"><div class="loader-ring"></div></div>';
  listenMessages(chatId);
  listenTyping(chatId);
};

window.closeChatView = function() {
  $('chat-view').style.display = 'none';
  $('empty-state').style.display = 'flex';
};

// ── MESSAGES ──
function listenMessages(chatId) {
  const msgQ = rtQuery(ref(rtdb, `messages/${chatId}`), orderByChild('timestamp'), limitToLast(100));
  msgUnsubscribe = onValue(msgQ, snap => {
    const msgs = [];
    snap.forEach(c => msgs.push({ id: c.key, ...c.val() }));
    renderMessages(msgs);
    checkAutoPurge(chatId, msgs.length);
  });
}

function renderMessages(msgs) {
  const wrap = $('messages-wrap'); if (!wrap) return;
  wrap.innerHTML = '';
  let lastDate = null, lastSenderId = null;

  msgs.forEach((msg, i) => {
    const mine = msg.senderId === currentUser.uid;
    const date = formatDate(msg.timestamp);
    if (date !== lastDate) {
      lastDate = date;
      const div = document.createElement('div'); div.className = 'date-divider'; div.textContent = date;
      wrap.appendChild(div);
    }
    const grouped = msg.senderId === lastSenderId && i > 0;
    lastSenderId = msg.senderId;

    const row = document.createElement('div');
    row.className = `msg-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`;

    const avWrap = document.createElement('div'); avWrap.className = 'msg-av';
    if (!mine) avWrap.appendChild(avatarEl({ avatar: msg.senderAvatar, photoURL: msg.senderPhoto }, 30));
    row.appendChild(avWrap);

    const content = document.createElement('div'); content.className = 'msg-content';

    if (activeChatType === 'group' && !mine && !grouped) {
      const sn = document.createElement('div'); sn.className = 'msg-sender'; sn.textContent = msg.senderName || 'Unknown';
      content.appendChild(sn);
    }

    if (msg.replyTo) {
      const rq = document.createElement('div'); rq.className = 'reply-quote';
      rq.innerHTML = `<div class="reply-quote-sender">↩ ${escHtml(msg.replyTo.senderName)}</div><div class="reply-quote-text">${escHtml(msg.replyTo.text || '')}</div>`;
      content.appendChild(rq);
    }

    const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
    bubble.textContent = msg.text || '';

    const actions = document.createElement('div'); actions.className = 'msg-action-row';
    EMOJIS_REACTION.slice(0, 5).forEach(e => {
      const btn = document.createElement('button'); btn.className = 'mac-btn'; btn.textContent = e;
      btn.onclick = ev => { ev.stopPropagation(); addReaction(activeChat, msg.id, e); };
      actions.appendChild(btn);
    });
    const replyBtn = document.createElement('button'); replyBtn.className = 'mac-btn'; replyBtn.textContent = '↩'; replyBtn.title = 'Reply';
    replyBtn.onclick = ev => { ev.stopPropagation(); setReply(msg); };
    actions.appendChild(replyBtn);
    bubble.appendChild(actions);
    content.appendChild(bubble);

    if (msg.reactions && Object.keys(msg.reactions).length) {
      const rr = document.createElement('div'); rr.className = 'reactions-row';
      Object.entries(msg.reactions).forEach(([emoji, users]) => {
        const uids = Object.keys(users || {}); if (!uids.length) return;
        const chip = document.createElement('div');
        chip.className = 'reaction-chip' + (uids.includes(currentUser.uid) ? ' mine' : '');
        chip.innerHTML = `${emoji} <span>${uids.length}</span>`;
        chip.onclick = () => addReaction(activeChat, msg.id, emoji);
        rr.appendChild(chip);
      });
      content.appendChild(rr);
    }

    const time = document.createElement('div'); time.className = 'msg-time'; time.textContent = formatTime(msg.timestamp);
    content.appendChild(time);
    row.appendChild(content);
    wrap.appendChild(row);
  });
  wrap.scrollTop = wrap.scrollHeight;
}

// ── REACTIONS ──
async function addReaction(chatId, msgId, emoji) {
  const path = `messages/${chatId}/${msgId}/reactions/${emoji}/${currentUser.uid}`;
  const r = ref(rtdb, path);
  const snap = await get(r);
  if (snap.exists()) await remove(r); else await set(r, true);
}

// ── REPLY ──
function setReply(msg) {
  replyTo = msg;
  $('reply-bar').style.display = 'flex';
  $('reply-sender').textContent = msg.senderName || currentProfile.username;
  $('reply-preview-text').textContent = (msg.text || '').substring(0, 60);
  $('msg-textarea').focus();
}
window.cancelReply = function() { replyTo = null; $('reply-bar').style.display = 'none'; };

// ── TYPING ──
function handleTyping() {
  if (!activeChat) return;
  typingRef = ref(rtdb, `typing/${activeChat}/${currentUser.uid}`);
  set(typingRef, currentProfile.username || 'Someone');
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => { if (typingRef) { remove(typingRef); typingRef = null; } }, 2500);
}
window.handleTyping = handleTyping;

function listenTyping(chatId) {
  const tRef = ref(rtdb, `typing/${chatId}`);
  onValue(tRef, snap => {
    const typers = []; snap.forEach(c => { if (c.key !== currentUser.uid) typers.push(c.val()); });
    const ta = $('typing-area'); const tt = $('typing-text');
    if (ta && tt) { ta.style.display = typers.length ? 'flex' : 'none'; tt.textContent = typers.length ? `${typers[0]} is typing...` : ''; }
  });
  typingListener = tRef;
}

// ── SEND ──
window.sendMessage = async function() {
  const ta = $('msg-textarea'); if (!ta) return;
  const text = ta.value.trim(); if (!text || !activeChat) return;

  const msgData = {
    text, senderId: currentUser.uid,
    senderName: currentProfile.username,
    senderAvatar: currentProfile.avatar || '🐉',
    senderPhoto: currentProfile.photoURL || null,
    timestamp: Date.now(), reactions: {}
  };
  if (replyTo) msgData.replyTo = { msgId: replyTo.id, text: replyTo.text, senderName: replyTo.senderName };

  await push(ref(rtdb, `messages/${activeChat}`), msgData);
  try {
    if (activeChatType === 'dm') await updateDoc(doc(db, 'chats', activeChat), { lastMessage: text, lastTime: serverTimestamp() });
    else await updateDoc(doc(db, 'groups', activeChat), { lastMessage: text, lastTime: serverTimestamp() });
  } catch {}
  ta.value = ''; ta.style.height = 'auto';
  window.cancelReply();
  if (typingRef) { remove(typingRef); typingRef = null; }
  closeEmojiPicker();
};

window.handleKey = function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMessage(); } };
window.autoResize = function(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; };

// ── EMOJI ──
function buildEmojiPanel() {
  const grid = $('ep-grid'); if (!grid) return;
  grid.innerHTML = '';
  [...EMOJIS_ALL].forEach(e => {
    if (!e.trim()) return;
    const btn = document.createElement('button'); btn.className = 'ep-btn'; btn.textContent = e;
    btn.onclick = () => { const ta = $('msg-textarea'); if (ta) { ta.value += e; ta.focus(); } closeEmojiPicker(); };
    grid.appendChild(btn);
  });
}
window.toggleEmojiPicker = function() { emojiOpen = !emojiOpen; $('emoji-panel').style.display = emojiOpen ? 'block' : 'none'; };
function closeEmojiPicker() { emojiOpen = false; const p = $('emoji-panel'); if (p) p.style.display = 'none'; }
document.addEventListener('click', e => { if (!e.target.closest('#emoji-panel') && !e.target.closest('.emoji-toggle')) closeEmojiPicker(); });

// ── AUTO PURGE ──
async function checkAutoPurge(chatId, count) {
  if (count >= 1000) await purgeOldest(chatId, 800);
  else if (count >= 300) await purgeOldest(chatId, 200);
}
async function purgeOldest(chatId, n) {
  const q = rtQuery(ref(rtdb, `messages/${chatId}`), orderByChild('timestamp'), limitToLast(9999));
  const snap = await get(q);
  const keys = []; snap.forEach(c => keys.push(c.key));
  for (const k of keys.slice(0, n)) await remove(ref(rtdb, `messages/${chatId}/${k}`));
}

// ── ONLINE USERS ──
function listenOnlineUsers() {
  onValue(ref(rtdb, 'presence'), async snap => {
    const uids = []; snap.forEach(c => { if (c.val().online && c.key !== currentUser.uid) uids.push(c.key); });
    const rpl = $('rp-list'); if (!rpl) return;
    rpl.innerHTML = '';
    if (!uids.length) { rpl.innerHTML = `<div style="padding:20px;color:var(--text-faint);font-size:11px;text-align:center">No one online</div>`; return; }
    for (const uid of uids.slice(0, 25)) {
      try {
        const ud = await getDoc(doc(db, 'users', uid)); if (!ud.exists()) continue;
        const u = ud.data();
        const item = document.createElement('div'); item.className = 'rp-user';
        item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;transition:background 0.2s';
        const avWrap = document.createElement('div'); avWrap.className = 'rp-av'; avWrap.style.cssText = 'position:relative;flex-shrink:0';
        avWrap.appendChild(avatarEl(u, 32));
        const dot = document.createElement('div'); dot.className = 'rp-dot'; avWrap.appendChild(dot);
        item.appendChild(avWrap);
        const info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0';
        info.innerHTML = `<div class="rp-name">${escHtml(u.username)}</div><div class="rp-country">${u.country || ''}</div>`;
        item.appendChild(info);
        const btn = document.createElement('button'); btn.className = 'rp-dm-btn'; btn.textContent = 'DM';
        btn.onclick = () => window.startDM(uid); item.appendChild(btn);
        rpl.appendChild(item);
      } catch {}
    }
  });
}

// ── CREATE GROUP ──
window.openCreateGroup = function() {
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      <h2>CREATE GROUP</h2>
      <div class="input-group"><label>Group Name *</label><input class="luxury-input" id="mg-name" placeholder="Name your realm..."></div>
      <div class="input-group"><label>Description</label><input class="luxury-input" id="mg-desc" placeholder="What's this group about?"></div>
      <div class="input-group"><label>Icon</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px" id="mg-icon-grid">
          ${AVATAR_EMOJIS.map(a => `<span data-icon="${a}" onclick="selectGroupIcon(this,'${a}')" style="font-size:24px;cursor:pointer;padding:4px;border-radius:6px;border:1px solid transparent;transition:all 0.2s">${a}</span>`).join('')}
        </div>
      </div>
      <button class="btn-primary" style="width:100%;margin-top:8px;justify-content:center" onclick="createGroup()">CREATE REALM</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
};

let selectedGroupIcon = '🐉';
window.selectGroupIcon = function(el, icon) {
  selectedGroupIcon = icon;
  document.querySelectorAll('[data-icon]').forEach(e => e.style.borderColor = 'transparent');
  el.style.borderColor = 'var(--gold)';
};

window.createGroup = async function() {
  const name = document.getElementById('mg-name')?.value.trim();
  const desc = document.getElementById('mg-desc')?.value.trim();
  if (!name) { toast('Enter a group name'); return; }
  await addDoc(collection(db, 'groups'), { name, description: desc || '', icon: selectedGroupIcon, members: [currentUser.uid], createdBy: currentUser.uid, createdAt: serverTimestamp(), lastMessage: '', lastTime: serverTimestamp() });
  document.querySelector('.modal-overlay')?.remove();
  toast('✅ Group created!');
  switchTab('groups', document.querySelector('[data-tab="groups"]'));
};

// ── GROUP INFO ──
window.openGroupInfo = async function(groupId) {
  const snap = await getDoc(doc(db, 'groups', groupId)); if (!snap.exists()) return;
  const g = snap.data();
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      <h2>${g.icon || '🐉'} ${escHtml(g.name)}</h2>
      <p style="text-align:center;color:var(--text-dim);font-size:13px;margin-bottom:24px">${escHtml(g.description || 'No description')}</p>
      <div style="text-align:center;font-size:11px;letter-spacing:2px;color:var(--text-dim);margin-bottom:24px">${g.members?.length || 0} MEMBERS</div>
      <button style="width:100%;padding:13px;background:rgba(192,57,43,0.1);border:1px solid var(--danger);color:var(--danger);border-radius:var(--r);font-family:'Cinzel',serif;font-size:11px;letter-spacing:2px;cursor:pointer" onclick="leaveGroup('${groupId}')">LEAVE GROUP</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
};

window.leaveGroup = async function(groupId) {
  const gRef = doc(db, 'groups', groupId);
  const snap = await getDoc(gRef); if (!snap.exists()) return;
  const members = snap.data().members.filter(m => m !== currentUser.uid);
  await updateDoc(gRef, { members });
  document.querySelector('.modal-overlay')?.remove();
  activeChat = null; activeChatType = null; activeChatData = null;
  $('chat-view').style.display = 'none'; $('empty-state').style.display = 'flex';
  toast('Left group');
  switchTab('groups', document.querySelector('[data-tab="groups"]'));
};

// ── PROFILE / LOGOUT ──
window.openProfilePage = function() { window.location.href = 'profile.html'; };
window.logout = async function() {
  if (!confirm('Sign out of Hidden Hydra?')) return;
  try { await set(ref(rtdb, `presence/${currentUser.uid}`), { online: false, lastSeen: rtTs(), uid: currentUser.uid }); } catch {}
  await signOut(auth);
  window.location.href = 'login.html';
};
