// app.js — Hidden Hydra Main Application
import { auth, db, rtdb, CLOUDINARY } from "./firebase.js";
import {
  signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, getDocs, collection,
  onSnapshot, query, where, orderBy, updateDoc,
  serverTimestamp, addDoc, deleteDoc, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref, set, onValue, onDisconnect, push,
  serverTimestamp as rtServerTimestamp, remove,
  query as rtQuery, orderByChild, limitToLast, off, get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ═══════════════════════════════════
// STATE
// ═══════════════════════════════════
let currentUser = null;
let currentProfile = null;
let activeChat = null;
let activeChatType = null; // 'dm' | 'group'
let activeChatData = null;
let msgListener = null;
let typingTimeout = null;
let typingListener = null;
let replyTo = null;
let dmList = [];
let groupList = [];
let onlineUsers = [];

const EMOJIS = ['👍','❤️','😂','😮','😢','🔥','👏','🎉','💀','🙏'];
const COUNTRIES = [
  {flag:'🌍',name:'Global'},{flag:'🇺🇸',name:'USA'},{flag:'🇬🇧',name:'UK'},
  {flag:'🇮🇳',name:'India'},{flag:'🇵🇰',name:'Pakistan'},{flag:'🇧🇩',name:'Bangladesh'},
  {flag:'🇩🇪',name:'Germany'},{flag:'🇫🇷',name:'France'},{flag:'🇯🇵',name:'Japan'},
  {flag:'🇨🇳',name:'China'},{flag:'🇧🇷',name:'Brazil'},{flag:'🇷🇺',name:'Russia'},
  {flag:'🇰🇷',name:'Korea'},{flag:'🇸🇦',name:'Saudi Arabia'},{flag:'🇦🇪',name:'UAE'},
  {flag:'🇳🇬',name:'Nigeria'},{flag:'🇿🇦',name:'South Africa'},{flag:'🇨🇦',name:'Canada'},
  {flag:'🇦🇺',name:'Australia'},{flag:'🇲🇽',name:'Mexico'},{flag:'🇮🇩',name:'Indonesia'},
  {flag:'🇹🇷',name:'Turkey'},{flag:'🇮🇹',name:'Italy'},{flag:'🇪🇸',name:'Spain'},
  {flag:'🇵🇭',name:'Philippines'},{flag:'🇵🇱',name:'Poland'},{flag:'🇺🇦',name:'Ukraine'}
];
const AVATAR_EMOJIS = ['🐉','🦊','🐺','🦁','🐯','🦋','🔥','⚡','🌙','💎','🌊','🦅','🐬','🦝','🎭','🌸','🐙','🦄','⭐','🗡️'];
const ACCENT_COLORS = ['#C9A84C','#C0392B','#8E44AD','#2980B9','#16A085','#D35400','#7F8C8D','#E91E63'];

// ═══════════════════════════════════
// DOM HELPERS
// ═══════════════════════════════════
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html='') => { const e=document.createElement(tag); if(cls)e.className=cls; if(html)e.innerHTML=html; return e; };

function showToast(msg) {
  const t = el('div','toast',msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function avatarHTML(profile, size=42) {
  if (!profile) return `<span>🐉</span>`;
  if (profile.photoURL) return `<img src="${profile.photoURL}" alt="">`;
  return `<span style="font-size:${size*0.5}px">${profile.avatar || '🐉'}</span>`;
}

// ═══════════════════════════════════
// AUTH + BOOT
// ═══════════════════════════════════
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const profileDoc = await getDoc(doc(db, 'users', user.uid));
    if (profileDoc.exists()) {
      currentProfile = profileDoc.data();
      setupPresence();
      showApp();
    } else {
      showOnboard();
    }
  } else {
    showOnboard();
  }
});

function showOnboard() {
  $('#onboard-screen').style.display = 'flex';
  $('#app-screen').classList.remove('active');
  renderOnboard();
}

function showApp() {
  $('#onboard-screen').style.display = 'none';
  $('#app-screen').classList.add('active');
  renderApp();
}

// ═══════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════
let pendingPhotoURL = null;
let selectedAvatar = AVATAR_EMOJIS[Math.floor(Math.random()*AVATAR_EMOJIS.length)];
let selectedColor = ACCENT_COLORS[0];

function renderOnboard() {
  $('#onboard-screen').innerHTML = `
    <div class="onboard-card">
      <div class="brand-logo">
        <span class="hydra-icon">🐉</span>
        <h1>HIDDEN HYDRA</h1>
        <p>Where shadows speak</p>
      </div>
      <div class="avatar-preview">
        <div class="avatar-circle" id="ob-avatar" title="Click to upload photo">
          <span id="ob-avatar-emoji" style="font-size:36px">${selectedAvatar}</span>
          <div class="upload-hint">UPLOAD</div>
          <input type="file" id="ob-photo-input" accept="image/*" style="display:none">
        </div>
        <div>
          <div style="font-size:10px;letter-spacing:2px;color:var(--text-dim);margin-bottom:8px">PICK AVATAR</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;max-width:160px;margin-bottom:10px" id="avatar-grid">
            ${AVATAR_EMOJIS.map(a=>`<span onclick="selectAvatar('${a}')" style="cursor:pointer;font-size:20px;padding:2px;border-radius:4px;transition:transform 0.15s" title="${a}">${a}</span>`).join('')}
          </div>
          <div class="color-dots" id="color-dots">
            ${ACCENT_COLORS.map(c=>`<div class="color-dot${c===selectedColor?' active':''}" style="background:${c}" onclick="selectColor('${c}')"></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="input-group">
        <label>Username</label>
        <input class="luxury-input" id="ob-username" placeholder="Enter your name..." maxlength="24">
      </div>
      <div class="input-group">
        <label>Bio</label>
        <input class="luxury-input" id="ob-bio" placeholder="A short mystery..." maxlength="80">
      </div>
      <div class="input-group">
        <label>Country</label>
        <select class="country-select luxury-input" id="ob-country">
          ${COUNTRIES.map(c=>`<option value="${c.flag} ${c.name}">${c.flag} ${c.name}</option>`).join('')}
        </select>
      </div>
      <button class="btn-primary" onclick="createProfile()">ENTER THE HYDRA</button>
      <button class="btn-ghost" onclick="quickJoin()">⚡ 1-CLICK QUICK JOIN</button>
    </div>
  `;

  // Photo upload
  $('#ob-avatar').addEventListener('click', () => $('#ob-photo-input').click());
  $('#ob-photo-input').addEventListener('change', handlePhotoSelect);
}

window.selectAvatar = (a) => {
  selectedAvatar = a;
  $('#ob-avatar-emoji') && ($('#ob-avatar-emoji').textContent = a);
};
window.selectColor = (c) => {
  selectedColor = c;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
  event.target.classList.add('active');
};

async function handlePhotoSelect(e) {
  const file = e.target.files[0]; if (!file) return;
  showToast('⏳ Uploading photo...');
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY.uploadPreset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`, { method:'POST', body:fd });
    const data = await res.json();
    pendingPhotoURL = data.secure_url;
    const img = document.createElement('img');
    img.src = pendingPhotoURL;
    $('#ob-avatar').innerHTML = '';
    $('#ob-avatar').appendChild(img);
    const hint = el('div','upload-hint','CHANGE');
    $('#ob-avatar').appendChild(hint);
    const inp = el('input');
    inp.type='file'; inp.id='ob-photo-input'; inp.accept='image/*'; inp.style.display='none';
    inp.addEventListener('change', handlePhotoSelect);
    $('#ob-avatar').appendChild(inp);
    showToast('✅ Photo uploaded!');
  } catch { showToast('❌ Upload failed, try again'); }
}

async function createProfile() {
  const username = $('#ob-username').value.trim();
  const bio = $('#ob-bio').value.trim();
  const country = $('#ob-country').value;
  if (!username || username.length < 2) { showToast('Please enter a username (min 2 chars)'); return; }

  try {
    if (!currentUser) {
      const cred = await signInAnonymously(auth);
      currentUser = cred.user;
    }
    const profile = {
      uid: currentUser.uid, username, bio, country,
      avatar: selectedAvatar, color: selectedColor,
      photoURL: pendingPhotoURL || null,
      createdAt: serverTimestamp(), online: true
    };
    await setDoc(doc(db, 'users', currentUser.uid), profile);
    currentProfile = profile;
    setupPresence();
    showApp();
  } catch(e) { showToast('Error: ' + e.message); }
}

async function quickJoin() {
  const adj = ['shadow','void','ember','frost','lunar','cosmic','neon','iron'];
  const noun = ['wolf','hydra','spark','raven','echo','flux','drift','veil'];
  const username = adj[Math.floor(Math.random()*adj.length)]+'_'+noun[Math.floor(Math.random()*noun.length)];
  $('#ob-username').value = username;
  await createProfile();
}
window.quickJoin = quickJoin;
window.createProfile = createProfile;

// ═══════════════════════════════════
// PRESENCE
// ═══════════════════════════════════
function setupPresence() {
  if (!currentUser) return;
  const presRef = ref(rtdb, `presence/${currentUser.uid}`);
  set(presRef, { online: true, lastSeen: rtServerTimestamp(), uid: currentUser.uid });
  onDisconnect(presRef).set({ online: false, lastSeen: rtServerTimestamp(), uid: currentUser.uid });
}

// ═══════════════════════════════════
// RENDER MAIN APP
// ═══════════════════════════════════
function renderApp() {
  $('#app-screen').innerHTML = `
    <div class="sidebar" id="sidebar">
      <div class="sidebar-top">
        <div class="my-profile" onclick="openEditProfile()">
          <div class="my-avatar" id="my-avatar-el">${avatarHTML(currentProfile)}</div>
          <div class="my-info">
            <div class="my-name">${currentProfile?.username || 'Unknown'}</div>
            <div class="my-status"><span style="color:var(--online);font-size:8px">●</span> Online · ${currentProfile?.country || '🌍'}</div>
          </div>
          <button class="settings-btn" title="Settings">⚙</button>
        </div>
        <div class="sidebar-tabs">
          <button class="sidebar-tab active" id="tab-dms" onclick="switchTab('dms')">DMs</button>
          <button class="sidebar-tab" id="tab-groups" onclick="switchTab('groups')">Groups</button>
          <button class="sidebar-tab" id="tab-explore" onclick="switchTab('explore')">Explore</button>
        </div>
      </div>
      <div class="sidebar-search">
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input type="text" placeholder="Search..." id="sidebar-search-input" oninput="handleSearch(this.value)">
        </div>
      </div>
      <div class="chat-list" id="chat-list"></div>
    </div>

    <div class="chat-main" id="chat-main">
      <div class="empty-state">
        <div class="hydra-big">🐉</div>
        <h2>HIDDEN HYDRA</h2>
        <p>Select a conversation to begin</p>
      </div>
    </div>

    <div class="right-panel" id="right-panel">
      <div class="panel-title">Online Now</div>
      <div id="online-list"></div>
    </div>
  `;

  loadDMs();
  listenOnlineUsers();
  switchTab('dms');
}

// ═══════════════════════════════════
// TABS
// ═══════════════════════════════════
window.switchTab = function(tab) {
  ['dms','groups','explore'].forEach(t => {
    $('#tab-'+t)?.classList.toggle('active', t===tab);
  });
  if (tab==='dms') loadDMs();
  if (tab==='groups') loadGroups();
  if (tab==='explore') loadExplore();
};

// ═══════════════════════════════════
// DMs
// ═══════════════════════════════════
async function loadDMs() {
  const list = $('#chat-list'); if (!list) return;
  list.innerHTML = '<div class="loader"></div>';

  const q = query(collection(db,'chats'), where('members','array-contains',currentUser.uid), where('type','==','dm'));
  onSnapshot(q, async (snap) => {
    dmList = [];
    for (const d of snap.docs) {
      const data = d.data();
      const otherId = data.members.find(m => m !== currentUser.uid);
      const otherDoc = await getDoc(doc(db,'users',otherId));
      if (otherDoc.exists()) {
        dmList.push({ chatId: d.id, ...data, other: otherDoc.data() });
      }
    }
    renderChatList('dms');
  });
}

async function loadGroups() {
  const list = $('#chat-list'); if (!list) return;
  list.innerHTML = '<div class="loader"></div>';

  const q = query(collection(db,'groups'), where('members','array-contains',currentUser.uid));
  onSnapshot(q, (snap) => {
    groupList = snap.docs.map(d => ({ groupId: d.id, ...d.data() }));
    renderChatList('groups');
  });
}

async function loadExplore() {
  const list = $('#chat-list'); if (!list) return;
  list.innerHTML = '<div class="loader"></div>';

  // Show all public groups not joined yet
  const snap = await getDocs(collection(db,'groups'));
  const all = snap.docs.map(d => ({ groupId: d.id, ...d.data() }));
  const notJoined = all.filter(g => !g.members?.includes(currentUser.uid));

  list.innerHTML = `
    <div class="new-group-btn" onclick="openCreateGroup()">＋ Create New Group</div>
    <div class="section-label">Discover Groups</div>
  `;
  if (!notJoined.length) {
    list.innerHTML += `<div style="padding:20px;color:var(--text-faint);font-size:12px;text-align:center">No public groups yet</div>`;
    return;
  }
  notJoined.forEach(g => {
    const item = el('div','chat-item');
    item.innerHTML = `
      <div class="chat-avatar"><span>${g.icon||'🐉'}</span></div>
      <div class="chat-meta">
        <div class="chat-name">${g.name}</div>
        <div class="chat-preview">${g.members?.length||0} members · ${g.description||''}</div>
      </div>
      <button onclick="joinGroup('${g.groupId}')" style="background:none;border:1px solid var(--gold-dim);color:var(--gold);padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer;letter-spacing:1px;font-family:'Raleway',sans-serif">JOIN</button>
    `;
    list.appendChild(item);
  });
}

function renderChatList(type) {
  const list = $('#chat-list'); if (!list) return;
  list.innerHTML = '';

  if (type === 'dms') {
    if (!dmList.length) {
      list.innerHTML = `<div style="padding:24px 20px;color:var(--text-faint);font-size:12px;text-align:center;letter-spacing:1px">No conversations yet.<br>Find users in Explore.</div>`;
      return;
    }
    dmList.forEach(dm => {
      const item = el('div', `chat-item${activeChat===dm.chatId?' active':''}`);
      item.innerHTML = `
        <div class="chat-avatar">${avatarHTML(dm.other)}</div>
        <div class="chat-meta">
          <div class="chat-name">${dm.other.username}</div>
          <div class="chat-preview">${dm.other.country||''} · ${dm.lastMessage||'Start chatting'}</div>
        </div>
      `;
      item.onclick = () => openChat(dm.chatId, 'dm', dm.other);
      list.appendChild(item);
    });
  }

  if (type === 'groups') {
    list.innerHTML = `<div class="new-group-btn" onclick="openCreateGroup()">＋ Create New Group</div>`;
    if (!groupList.length) {
      list.innerHTML += `<div style="padding:20px;color:var(--text-faint);font-size:12px;text-align:center">No groups yet</div>`;
      return;
    }
    groupList.forEach(g => {
      const item = el('div', `chat-item${activeChat===g.groupId?' active':''}`);
      item.innerHTML = `
        <div class="chat-avatar"><span>${g.icon||'🐉'}</span></div>
        <div class="chat-meta">
          <div class="chat-name">${g.name}</div>
          <div class="chat-preview">${g.members?.length||0} members</div>
        </div>
      `;
      item.onclick = () => openChat(g.groupId, 'group', g);
      list.appendChild(item);
    });
  }
}

// ═══════════════════════════════════
// OPEN CHAT
// ═══════════════════════════════════
window.openChat = function(chatId, type, data) {
  activeChat = chatId;
  activeChatType = type;
  activeChatData = data;
  replyTo = null;

  // detach old listeners
  if (msgListener) msgListener();
  if (typingListener) { off(ref(rtdb, `typing/${activeChat}`)); }

  const main = $('#chat-main'); if (!main) return;

  const isGroup = type === 'group';
  const name = isGroup ? data.name : data.username;
  const avatarEl = isGroup ? `<span>${data.icon||'🐉'}</span>` : avatarHTML(data);
  const sub = isGroup ? `${data.members?.length||0} members` : `${data.country||''} · ${data.bio||''}`;

  main.innerHTML = `
    <div class="chat-topbar">
      <div class="topbar-avatar">${avatarEl}</div>
      <div class="topbar-info">
        <div class="topbar-name">${name}</div>
        <div class="topbar-sub" id="topbar-sub">${sub}</div>
      </div>
      ${isGroup ? `<button onclick="openGroupInfo('${chatId}')" style="background:none;border:1px solid var(--border);color:var(--text-dim);padding:6px 12px;border-radius:4px;font-size:11px;cursor:pointer;letter-spacing:1px">INFO</button>` : ''}
    </div>
    <div class="messages-area" id="messages-area"></div>
    <div class="input-area" id="input-area">
      <div id="reply-bar" style="display:none" class="reply-bar">
        <span id="reply-text"></span>
        <button class="close-reply" onclick="cancelReply()">×</button>
      </div>
      <div class="input-row">
        <div class="input-box-wrap" style="position:relative">
          <div id="emoji-picker-wrap" style="display:none;position:absolute;bottom:60px;left:0;z-index:100">
            <div class="emoji-picker">
              ${EMOJIS.map(e=>`<button onclick="insertEmoji('${e}')">${e}</button>`).join('')}
              <div style="width:100%;height:1px;background:var(--border);margin:4px 0"></div>
              ${'😀😁😂🤣😃😄😅😆😉😊😋😎😍🥰😘🤩🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠'.split('').filter(c=>c.trim()).map(e=>`<button onclick="insertEmoji('${e}')">${e}</button>`).join('')}
            </div>
          </div>
        </div>
        <button class="emoji-btn" onclick="toggleEmojiPicker()">😊</button>
        <textarea class="msg-input" id="msg-input" placeholder="Speak in the shadows..." rows="1"
          oninput="autoResize(this);handleTyping()"
          onkeydown="handleInputKey(event)"></textarea>
        <button class="send-btn" onclick="sendMessage()">➤</button>
      </div>
    </div>
  `;

  listenMessages(chatId);
  listenTyping(chatId);

  // mark active in sidebar
  document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
};

// ═══════════════════════════════════
// MESSAGES
// ═══════════════════════════════════
function listenMessages(chatId) {
  const msgRef = rtQuery(ref(rtdb, `messages/${chatId}`), orderByChild('timestamp'), limitToLast(100));
  msgListener = onValue(msgRef, (snap) => {
    const msgs = [];
    snap.forEach(c => msgs.push({ id: c.key, ...c.val() }));
    renderMessages(msgs, chatId);
    checkAutoPurge(chatId, msgs.length);
  });
}

async function renderMessages(msgs, chatId) {
  const area = $('#messages-area'); if (!area) return;
  area.innerHTML = '';

  let lastDate = null;
  for (const msg of msgs) {
    const mine = msg.senderId === currentUser.uid;
    const date = msg.timestamp ? new Date(msg.timestamp).toLocaleDateString() : 'Today';

    if (date !== lastDate) {
      lastDate = date;
      area.appendChild(el('div','date-divider', date));
    }

    // fetch sender profile for groups
    let senderProfile = mine ? currentProfile : null;
    if (!mine && activeChatType === 'group') {
      senderProfile = { username: msg.senderName, avatar: msg.senderAvatar, photoURL: msg.senderPhoto };
    } else if (!mine) {
      senderProfile = activeChatData;
    }

    const row = el('div', `msg-row${mine?' mine':''}`);

    // Avatar
    const av = el('div','msg-avatar');
    av.innerHTML = avatarHTML(senderProfile, 32);
    row.appendChild(av);

    const content = el('div','msg-content');

    // Sender name (groups)
    if (activeChatType === 'group' && !mine) {
      const sn = el('div','msg-sender', msg.senderName || 'Unknown');
      content.appendChild(sn);
    }

    // Reply preview
    if (msg.replyTo) {
      const rp = el('div','reply-preview');
      rp.innerHTML = `<strong>↩ ${msg.replyTo.senderName}</strong>${msg.replyTo.text?.substring(0,60)}...`;
      content.appendChild(rp);
    }

    // Bubble
    const bubble = el('div','msg-bubble');
    bubble.innerHTML = `${escapeHTML(msg.text || '')}`;

    // Actions overlay
    const actions = el('div','msg-actions');
    EMOJIS.slice(0,5).forEach(emoji => {
      const btn = el('button','action-btn', emoji);
      btn.onclick = (e) => { e.stopPropagation(); addReaction(chatId, msg.id, emoji); };
      actions.appendChild(btn);
    });
    const replyBtn = el('button','action-btn','↩');
    replyBtn.title = 'Reply';
    replyBtn.onclick = (e) => { e.stopPropagation(); setReply(msg); };
    actions.appendChild(replyBtn);
    bubble.appendChild(actions);
    content.appendChild(bubble);

    // Reactions
    if (msg.reactions && Object.keys(msg.reactions).length) {
      const rr = el('div','reactions-row');
      Object.entries(msg.reactions).forEach(([emoji, users]) => {
        const uids = Object.keys(users);
        if (!uids.length) return;
        const chip = el('div',`reaction-chip${uids.includes(currentUser.uid)?' mine':''}`,
          `${emoji} <span>${uids.length}</span>`);
        chip.onclick = () => addReaction(chatId, msg.id, emoji);
        rr.appendChild(chip);
      });
      content.appendChild(rr);
    }

    // Time
    const time = el('div','msg-time', msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '');
    content.appendChild(time);

    row.appendChild(content);
    area.appendChild(row);
  }

  area.scrollTop = area.scrollHeight;
}

async function sendMessage() {
  const input = $('#msg-input'); if (!input) return;
  const text = input.value.trim(); if (!text) return;

  const msgData = {
    text,
    senderId: currentUser.uid,
    senderName: currentProfile.username,
    senderAvatar: currentProfile.avatar || '🐉',
    senderPhoto: currentProfile.photoURL || null,
    timestamp: Date.now(),
    reactions: {}
  };
  if (replyTo) {
    msgData.replyTo = {
      msgId: replyTo.id,
      text: replyTo.text,
      senderName: replyTo.senderName
    };
  }

  const msgRef = ref(rtdb, `messages/${activeChat}`);
  await push(msgRef, msgData);

  // Update lastMessage in Firestore
  if (activeChatType === 'dm') {
    await updateDoc(doc(db,'chats',activeChat), { lastMessage: text, lastTime: serverTimestamp() });
  } else {
    await updateDoc(doc(db,'groups',activeChat), { lastMessage: text, lastTime: serverTimestamp() });
  }

  input.value = ''; input.style.height = 'auto';
  cancelReply();
  clearTyping();
}

// ═══════════════════════════════════
// REACTIONS
// ═══════════════════════════════════
async function addReaction(chatId, msgId, emoji) {
  const path = `messages/${chatId}/${msgId}/reactions/${emoji}/${currentUser.uid}`;
  const r = ref(rtdb, path);
  const snap = await get(r);
  if (snap.exists()) { await remove(r); } else { await set(r, true); }
}

// ═══════════════════════════════════
// REPLY
// ═══════════════════════════════════
window.setReply = function(msg) {
  replyTo = msg;
  const bar = $('#reply-bar');
  const rt = $('#reply-text');
  if (bar && rt) {
    bar.style.display = 'flex';
    rt.textContent = `↩ ${msg.senderName}: ${msg.text?.substring(0,50)}`;
  }
};
window.cancelReply = function() {
  replyTo = null;
  const bar = $('#reply-bar'); if (bar) bar.style.display = 'none';
};

// ═══════════════════════════════════
// TYPING
// ═══════════════════════════════════
function handleTyping() {
  if (!activeChat) return;
  const typRef = ref(rtdb, `typing/${activeChat}/${currentUser.uid}`);
  set(typRef, currentProfile.username);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => clearTyping(), 2000);
}

function clearTyping() {
  if (!activeChat) return;
  remove(ref(rtdb, `typing/${activeChat}/${currentUser.uid}`));
}

function listenTyping(chatId) {
  const typRef = ref(rtdb, `typing/${chatId}`);
  onValue(typRef, (snap) => {
    const typers = [];
    snap.forEach(c => { if (c.key !== currentUser.uid) typers.push(c.val()); });
    const sub = $('#topbar-sub'); if (!sub) return;
    if (typers.length) {
      sub.innerHTML = `<span style="color:var(--gold-dim)">${typers.join(', ')} is typing</span> <div class="typing-dots" style="display:inline-flex;gap:3px;vertical-align:middle"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    } else {
      if (activeChatType === 'group') sub.textContent = `${activeChatData?.members?.length||0} members`;
      else sub.textContent = `${activeChatData?.country||''} · ${activeChatData?.bio||''}`;
    }
  });
}

// ═══════════════════════════════════
// AUTO PURGE
// ═══════════════════════════════════
async function checkAutoPurge(chatId, count) {
  if (count >= 1000) {
    // delete oldest 800, keep 200
    await purgeMessages(chatId, 800);
  } else if (count >= 300) {
    // delete oldest 200, keep 100
    await purgeMessages(chatId, 200);
  }
}

async function purgeMessages(chatId, deleteCount) {
  const msgRef = rtQuery(ref(rtdb, `messages/${chatId}`), orderByChild('timestamp'), limitToLast(9999));
  const snap = await get(msgRef);
  const all = [];
  snap.forEach(c => all.push(c.key));
  // delete oldest deleteCount
  const toDelete = all.slice(0, deleteCount);
  for (const key of toDelete) {
    await remove(ref(rtdb, `messages/${chatId}/${key}`));
  }
}

// ═══════════════════════════════════
// ONLINE USERS PANEL
// ═══════════════════════════════════
function listenOnlineUsers() {
  const presRef = ref(rtdb, 'presence');
  onValue(presRef, async (snap) => {
    const uids = [];
    snap.forEach(c => { if (c.val().online && c.key !== currentUser.uid) uids.push(c.key); });

    const panel = $('#online-list'); if (!panel) return;
    panel.innerHTML = '';
    for (const uid of uids.slice(0,20)) {
      const uDoc = await getDoc(doc(db,'users',uid));
      if (!uDoc.exists()) continue;
      const u = uDoc.data();
      const item = el('div','online-user');
      item.innerHTML = `
        <div class="ou-avatar">${avatarHTML(u,34)}<div class="ou-dot"></div></div>
        <div>
          <div class="ou-name">${u.username}</div>
          <div class="ou-country">${u.country||''}</div>
        </div>
        <button class="dm-btn" onclick="startDM('${uid}')">DM</button>
      `;
      panel.appendChild(item);
    }
    if (!uids.length) {
      panel.innerHTML = `<div style="padding:20px;color:var(--text-faint);font-size:11px;text-align:center;letter-spacing:1px">No one online</div>`;
    }
  });
}

// ═══════════════════════════════════
// START DM
// ═══════════════════════════════════
window.startDM = async function(uid) {
  // Check if DM chat exists
  const q = query(collection(db,'chats'), where('members','array-contains',currentUser.uid), where('type','==','dm'));
  const snap = await getDocs(q);
  let chatId = null;
  snap.forEach(d => {
    if (d.data().members.includes(uid)) chatId = d.id;
  });

  if (!chatId) {
    const chatDoc = await addDoc(collection(db,'chats'), {
      type: 'dm', members: [currentUser.uid, uid],
      lastMessage: '', lastTime: serverTimestamp()
    });
    chatId = chatDoc.id;
  }

  const otherDoc = await getDoc(doc(db,'users',uid));
  if (otherDoc.exists()) {
    openChat(chatId, 'dm', otherDoc.data());
    switchTab('dms');
  }
};

// ═══════════════════════════════════
// CREATE GROUP
// ═══════════════════════════════════
window.openCreateGroup = function() {
  const overlay = el('div','modal-overlay');
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      <h2>CREATE GROUP</h2>
      <div class="input-group"><label>Group Name</label>
        <input class="luxury-input" id="g-name" placeholder="Name your realm..."></div>
      <div class="input-group"><label>Description</label>
        <input class="luxury-input" id="g-desc" placeholder="What is this about?"></div>
      <div class="input-group"><label>Icon</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px" id="g-icon-grid">
          ${AVATAR_EMOJIS.map(a=>`<span onclick="selectGroupIcon('${a}')" style="font-size:24px;cursor:pointer;padding:4px;border-radius:4px;border:1px solid transparent;transition:all 0.2s" data-icon="${a}">${a}</span>`).join('')}
        </div>
      </div>
      <button class="btn-primary" onclick="createGroup()">CREATE REALM</button>
    </div>
  `;
  document.body.appendChild(overlay);
};

let selectedGroupIcon = '🐉';
window.selectGroupIcon = function(icon) {
  selectedGroupIcon = icon;
  document.querySelectorAll('[data-icon]').forEach(el => {
    el.style.borderColor = el.dataset.icon === icon ? 'var(--gold)' : 'transparent';
  });
};

window.createGroup = async function() {
  const name = $('#g-name')?.value.trim();
  const desc = $('#g-desc')?.value.trim();
  if (!name) { showToast('Enter a group name'); return; }

  await addDoc(collection(db,'groups'), {
    name, description: desc||'', icon: selectedGroupIcon,
    members: [currentUser.uid], createdBy: currentUser.uid,
    createdAt: serverTimestamp(), lastMessage: '', lastTime: serverTimestamp()
  });
  $('.modal-overlay')?.remove();
  showToast('✅ Group created!');
  switchTab('groups');
};

window.joinGroup = async function(groupId) {
  const gDoc = doc(db,'groups',groupId);
  const snap = await getDoc(gDoc);
  if (!snap.exists()) return;
  const members = snap.data().members || [];
  if (!members.includes(currentUser.uid)) {
    await updateDoc(gDoc, { members: [...members, currentUser.uid] });
  }
  showToast('✅ Joined group!');
  switchTab('groups');
};

// ═══════════════════════════════════
// GROUP INFO
// ═══════════════════════════════════
window.openGroupInfo = async function(groupId) {
  const snap = await getDoc(doc(db,'groups',groupId));
  if (!snap.exists()) return;
  const g = snap.data();
  const overlay = el('div','modal-overlay');
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      <h2>${g.icon||'🐉'} ${g.name}</h2>
      <p style="color:var(--text-dim);font-size:13px;text-align:center;margin-bottom:20px">${g.description||''}</p>
      <div style="font-size:11px;letter-spacing:2px;color:var(--text-dim);margin-bottom:12px">${g.members?.length||0} MEMBERS</div>
      <button class="btn-ghost" onclick="leaveGroup('${groupId}')">LEAVE GROUP</button>
    </div>
  `;
  document.body.appendChild(overlay);
};

window.leaveGroup = async function(groupId) {
  const gDoc = doc(db,'groups',groupId);
  const snap = await getDoc(gDoc);
  if (!snap.exists()) return;
  const members = snap.data().members.filter(m => m !== currentUser.uid);
  await updateDoc(gDoc, { members });
  $('.modal-overlay')?.remove();
  activeChat = null; activeChatType = null; activeChatData = null;
  $('#chat-main').innerHTML = `<div class="empty-state"><div class="hydra-big">🐉</div><h2>HIDDEN HYDRA</h2><p>Select a conversation to begin</p></div>`;
  showToast('Left group');
  switchTab('groups');
};

// ═══════════════════════════════════
// EDIT PROFILE
// ═══════════════════════════════════
window.openEditProfile = function() {
  const p = currentProfile;
  const overlay = el('div','modal-overlay');
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      <h2>EDIT PROFILE</h2>
      <div style="text-align:center;margin-bottom:20px">
        <div class="avatar-circle" id="edit-av" style="margin:0 auto;cursor:pointer">
          ${p.photoURL ? `<img src="${p.photoURL}">` : `<span style="font-size:36px">${p.avatar||'🐉'}</span>`}
          <div class="upload-hint">CHANGE</div>
          <input type="file" id="edit-photo-input" accept="image/*" style="display:none">
        </div>
      </div>
      <div class="input-group"><label>Username</label>
        <input class="luxury-input" id="edit-username" value="${p.username||''}" maxlength="24"></div>
      <div class="input-group"><label>Bio</label>
        <input class="luxury-input" id="edit-bio" value="${p.bio||''}" maxlength="80"></div>
      <div class="input-group"><label>Country</label>
        <select class="country-select luxury-input" id="edit-country">
          ${COUNTRIES.map(c=>`<option value="${c.flag} ${c.name}" ${p.country===c.flag+' '+c.name?'selected':''}>${c.flag} ${c.name}</option>`).join('')}
        </select>
      </div>
      <button class="btn-primary" onclick="saveProfile()">SAVE CHANGES</button>
    </div>
  `;
  document.body.appendChild(overlay);
  $('#edit-av').addEventListener('click', () => $('#edit-photo-input').click());
  $('#edit-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    showToast('⏳ Uploading...');
    try {
      const fd = new FormData(); fd.append('file',file); fd.append('upload_preset', CLOUDINARY.uploadPreset);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`,{method:'POST',body:fd});
      const data = await res.json();
      pendingPhotoURL = data.secure_url;
      const img = document.createElement('img'); img.src = pendingPhotoURL;
      $('#edit-av').innerHTML = ''; $('#edit-av').appendChild(img);
      showToast('✅ Photo ready');
    } catch { showToast('❌ Upload failed'); }
  });
};

window.saveProfile = async function() {
  const username = $('#edit-username')?.value.trim();
  const bio = $('#edit-bio')?.value.trim();
  const country = $('#edit-country')?.value;
  if (!username || username.length < 2) { showToast('Username too short'); return; }
  const updates = { username, bio, country };
  if (pendingPhotoURL) updates.photoURL = pendingPhotoURL;
  await updateDoc(doc(db,'users',currentUser.uid), updates);
  Object.assign(currentProfile, updates);
  pendingPhotoURL = null;
  $('.modal-overlay')?.remove();
  // Update UI
  const myAv = $('#my-avatar-el'); if (myAv) myAv.innerHTML = avatarHTML(currentProfile);
  const myName = $('.my-name'); if (myName) myName.textContent = username;
  showToast('✅ Profile updated!');
};

// ═══════════════════════════════════
// SEARCH
// ═══════════════════════════════════
window.handleSearch = async function(val) {
  if (!val.trim()) { return; }
  // Search users by username
  const snap = await getDocs(collection(db,'users'));
  const results = snap.docs.map(d=>d.data()).filter(u => u.uid !== currentUser.uid && u.username?.toLowerCase().includes(val.toLowerCase()));
  const list = $('#chat-list'); if (!list) return;
  list.innerHTML = '<div class="section-label">Users Found</div>';
  if (!results.length) { list.innerHTML += `<div style="padding:16px 20px;color:var(--text-faint);font-size:12px">No users found</div>`; return; }
  results.forEach(u => {
    const item = el('div','chat-item');
    item.innerHTML = `
      <div class="chat-avatar">${avatarHTML(u)}</div>
      <div class="chat-meta">
        <div class="chat-name">${u.username}</div>
        <div class="chat-preview">${u.country||''} · ${u.bio||''}</div>
      </div>
      <button onclick="startDM('${u.uid}')" class="dm-btn">DM</button>
    `;
    list.appendChild(item);
  });
};

// ═══════════════════════════════════
// INPUT HELPERS
// ═══════════════════════════════════
window.handleInputKey = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
};
window.autoResize = function(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};
window.toggleEmojiPicker = function() {
  const w = $('#emoji-picker-wrap'); if (!w) return;
  w.style.display = w.style.display === 'none' ? 'block' : 'none';
};
window.insertEmoji = function(e) {
  const inp = $('#msg-input'); if (!inp) return;
  inp.value += e;
  inp.focus();
  $('#emoji-picker-wrap').style.display = 'none';
};

function escapeHTML(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Close emoji picker on outside click
document.addEventListener('click', (e) => {
  const w = $('#emoji-picker-wrap');
  if (w && !e.target.closest('#emoji-picker-wrap') && !e.target.closest('.emoji-btn')) {
    w.style.display = 'none';
  }
});

// Init — trigger auth check
signInAnonymously(auth).catch(() => {});
