// profile.js — Hidden Hydra Profile Page
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getDatabase, ref, set, serverTimestamp as rtTs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const app = initializeApp({
  apiKey: "AIzaSyCj5A6GpHYppmaqZqY39HmIAID2jZv3eAM",
  authDomain: "hidden-hydra.firebaseapp.com",
  databaseURL: "https://hidden-hydra-default-rtdb.firebaseio.com",
  projectId: "hidden-hydra",
  storageBucket: "hidden-hydra.firebasestorage.app",
  messagingSenderId: "1487060887",
  appId: "1:1487060887:web:402fea888cdf486f8d0ed2"
});
const auth = getAuth(app), db = getFirestore(app), rtdb = getDatabase(app);
const CLOUDINARY = { cloudName: 'dyspzzb3z', uploadPreset: 'hidden Hydra' };

const AVATAR_EMOJIS = ['🐉','🦊','🐺','🦁','🐯','🦋','🔥','⚡','🌙','💎','🌊','🦅','🐬','🦝','🎭','🌸','🐙','🦄','⭐','🗡️','🌑','🎪','🌿','🏔️','🌋'];
const ACCENT_COLORS = ['#C9A84C','#C0392B','#8E44AD','#2980B9','#16A085','#D35400','#E91E63','#00BCD4'];
const COUNTRIES = [
  {flag:'🌍',name:'Global'},{flag:'🇺🇸',name:'USA'},{flag:'🇬🇧',name:'UK'},
  {flag:'🇮🇳',name:'India'},{flag:'🇵🇰',name:'Pakistan'},{flag:'🇧🇩',name:'Bangladesh'},
  {flag:'🇩🇪',name:'Germany'},{flag:'🇫🇷',name:'France'},{flag:'🇯🇵',name:'Japan'},
  {flag:'🇨🇳',name:'China'},{flag:'🇧🇷',name:'Brazil'},{flag:'🇷🇺',name:'Russia'},
  {flag:'🇰🇷',name:'Korea'},{flag:'🇸🇦',name:'Saudi Arabia'},{flag:'🇦🇪',name:'UAE'},
  {flag:'🇨🇦',name:'Canada'},{flag:'🇦🇺',name:'Australia'},{flag:'🇲🇽',name:'Mexico'},
  {flag:'🇹🇷',name:'Turkey'},{flag:'🇮🇹',name:'Italy'},{flag:'🇪🇸',name:'Spain'},
  {flag:'🇵🇭',name:'Philippines'},{flag:'🇵🇱',name:'Poland'},{flag:'🇺🇦',name:'Ukraine'},
];

let currentUser = null, currentProfile = null, pendingPhotoURL = null;
let selectedAvatar = null, selectedColor = null;

function $(id) { return document.getElementById(id); }
function toast(msg) {
  const tc = $('toast-container'); if (!tc) return;
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  tc.appendChild(t); setTimeout(() => t.remove(), 3000);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'login.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) { window.location.href = 'login.html'; return; }
  currentProfile = snap.data();
  selectedAvatar = currentProfile.avatar || '🐉';
  selectedColor = currentProfile.color || ACCENT_COLORS[0];
  $('auth-loading').style.display = 'none';
  $('profile-app').style.display = 'block';
  renderProfile();
  buildForms();
  loadStats();
});

function renderProfile() {
  const p = currentProfile;
  const avBig = $('profile-av-big'); avBig.innerHTML = '';
  if (p.photoURL) {
    const img = document.createElement('img'); img.src = p.photoURL;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    avBig.appendChild(img);
  } else {
    avBig.textContent = p.avatar || '🐉'; avBig.style.fontSize = '60px';
  }
  $('profile-username').textContent = p.username || '—';
  $('profile-bio').textContent = p.bio || 'No bio yet';
  $('profile-country').textContent = p.country || '🌍 Global';
  if (p.createdAt?.seconds) {
    $('profile-joined').textContent = 'Joined ' + new Date(p.createdAt.seconds * 1000).toLocaleDateString('en', { month: 'long', year: 'numeric' });
  }
}

function buildForms() {
  const p = currentProfile;
  $('edit-username').value = p.username || '';
  $('edit-bio').value = p.bio || '';

  const cs = $('edit-country');
  cs.innerHTML = COUNTRIES.map(c => `<option value="${c.flag} ${c.name}" ${p.country === c.flag + ' ' + c.name ? 'selected' : ''}>${c.flag} ${c.name}</option>`).join('');

  const eg = $('mini-emoji-grid'); eg.innerHTML = '';
  AVATAR_EMOJIS.forEach(e => {
    const el = document.createElement('div'); el.className = 'meg-item' + (e === selectedAvatar ? ' active' : '');
    el.textContent = e;
    el.onclick = () => { selectedAvatar = e; document.querySelectorAll('.meg-item').forEach(i => i.classList.remove('active')); el.classList.add('active'); };
    eg.appendChild(el);
  });

  const sw = $('edit-color-swatches'); sw.innerHTML = '';
  ACCENT_COLORS.forEach(c => {
    const dot = document.createElement('div'); dot.className = 'color-swatch' + (c === selectedColor ? ' active' : '');
    dot.style.background = c;
    dot.onclick = () => { selectedColor = c; document.querySelectorAll('.color-swatch').forEach(d => d.classList.remove('active')); dot.classList.add('active'); };
    sw.appendChild(dot);
  });

  $('profile-photo-inp').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    toast('⏳ Uploading photo...');
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('upload_preset', CLOUDINARY.uploadPreset);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.secure_url) {
        pendingPhotoURL = data.secure_url;
        const avBig = $('profile-av-big'); avBig.innerHTML = '';
        const img = document.createElement('img'); img.src = pendingPhotoURL;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
        avBig.appendChild(img);
        toast('✅ Photo ready — click Save to apply');
      } else toast('❌ Upload failed');
    } catch { toast('❌ Upload error'); }
  });
}

async function loadStats() {
  try {
    const [dm, gr] = await Promise.all([
      getDocs(query(collection(db, 'chats'), where('members', 'array-contains', currentUser.uid))),
      getDocs(query(collection(db, 'groups'), where('members', 'array-contains', currentUser.uid)))
    ]);
    $('stat-dms').textContent = dm.size;
    $('stat-groups').textContent = gr.size;
  } catch {}
}

window.saveProfile = async function() {
  const username = $('edit-username')?.value.trim();
  const bio = $('edit-bio')?.value.trim();
  const country = $('edit-country')?.value;
  if (!username || username.length < 2) { toast('Username too short (min 2 chars)'); return; }

  const saveText = $('save-text'); const loader = $('save-loader');
  saveText.style.display = 'none'; loader.style.display = 'block';

  try {
    const updates = { username, bio, country, avatar: selectedAvatar, color: selectedColor };
    if (pendingPhotoURL) updates.photoURL = pendingPhotoURL;
    await updateDoc(doc(db, 'users', currentUser.uid), updates);
    Object.assign(currentProfile, updates);
    renderProfile();
    pendingPhotoURL = null;
    toast('✅ Profile saved!');
  } catch (e) { toast('❌ Error: ' + e.message); }

  saveText.style.display = 'inline'; loader.style.display = 'none';
};

window.logout = async function() {
  if (!confirm('Sign out of Hidden Hydra?')) return;
  try { await set(ref(rtdb, `presence/${currentUser.uid}`), { online: false, lastSeen: rtTs(), uid: currentUser.uid }); } catch {}
  await signOut(auth); window.location.href = 'login.html';
};
