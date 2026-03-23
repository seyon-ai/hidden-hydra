// login.js — Hidden Hydra onboarding logic

const AVATAR_EMOJIS = ['🐉','🦊','🐺','🦁','🐯','🦋','🔥','⚡','🌙','💎','🌊','🦅','🐬','🦝','🎭','🌸','🐙','🦄','⭐','🗡️','🌑','🎪','🌿','🏔️','🌋'];
const ACCENT_COLORS = ['#C9A84C','#C0392B','#8E44AD','#2980B9','#16A085','#D35400','#E91E63','#00BCD4'];
const COUNTRIES = [
  {flag:'🌍',name:'Global'},{flag:'🇺🇸',name:'USA'},{flag:'🇬🇧',name:'UK'},
  {flag:'🇮🇳',name:'India'},{flag:'🇵🇰',name:'Pakistan'},{flag:'🇧🇩',name:'Bangladesh'},
  {flag:'🇩🇪',name:'Germany'},{flag:'🇫🇷',name:'France'},{flag:'🇯🇵',name:'Japan'},
  {flag:'🇨🇳',name:'China'},{flag:'🇧🇷',name:'Brazil'},{flag:'🇷🇺',name:'Russia'},
  {flag:'🇰🇷',name:'Korea'},{flag:'🇸🇦',name:'Saudi Arabia'},{flag:'🇦🇪',name:'UAE'},
  {flag:'🇳🇬',name:'Nigeria'},{flag:'🇿🇦',name:'South Africa'},{flag:'🇨🇦',name:'Canada'},
  {flag:'🇦🇺',name:'Australia'},{flag:'🇲🇽',name:'Mexico'},{flag:'🇮🇩',name:'Indonesia'},
  {flag:'🇹🇷',name:'Turkey'},{flag:'🇮🇹',name:'Italy'},{flag:'🇪🇸',name:'Spain'},
  {flag:'🇵🇭',name:'Philippines'},{flag:'🇵🇱',name:'Poland'},{flag:'🇺🇦',name:'Ukraine'},
  {flag:'🇹🇭',name:'Thailand'},{flag:'🇲🇾',name:'Malaysia'},{flag:'🇸🇬',name:'Singapore'}
];

let selectedAvatar = AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];
let selectedColor = ACCENT_COLORS[0];
let pendingPhotoURL = null;

function showToast(msg) {
  let tc = document.getElementById('toast-container');
  if (!tc) { tc = document.createElement('div'); tc.id='toast-container'; document.body.appendChild(tc); }
  const t = document.createElement('div'); t.className='toast'; t.textContent=msg;
  tc.appendChild(t); setTimeout(()=>t.remove(), 3000);
}

// Build emoji grid
function buildEmojiGrid() {
  const grid = document.getElementById('emoji-grid'); if (!grid) return;
  grid.innerHTML = '';
  AVATAR_EMOJIS.forEach(e => {
    const btn = document.createElement('div');
    btn.className = 'eg-item' + (e === selectedAvatar ? ' active' : '');
    btn.textContent = e;
    btn.onclick = () => {
      selectedAvatar = e;
      document.querySelectorAll('.eg-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateAvatarPreview();
    };
    grid.appendChild(btn);
  });
}

// Build color swatches
function buildColorSwatches() {
  const sw = document.getElementById('color-swatches'); if (!sw) return;
  sw.innerHTML = '';
  ACCENT_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'color-swatch' + (c === selectedColor ? ' active' : '');
    dot.style.background = c;
    dot.onclick = () => {
      selectedColor = c;
      document.querySelectorAll('.color-swatch').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      updateAvatarPreview();
    };
    sw.appendChild(dot);
  });
}

// Build country select
function buildCountrySelect() {
  const sel = document.getElementById('inp-country'); if (!sel) return;
  sel.innerHTML = COUNTRIES.map(c => `<option value="${c.flag} ${c.name}">${c.flag} ${c.name}</option>`).join('');
}

function updateAvatarPreview() {
  const preview = document.getElementById('av-preview'); if (!preview) return;
  if (!pendingPhotoURL) {
    preview.innerHTML = `<span id="av-emoji" style="font-size:48px">${selectedAvatar}</span><div class="av-ring"></div>`;
    preview.style.borderColor = selectedColor;
  }
}

// Step navigation
window.goStep = function(n) {
  // Validate before moving
  if (n === 3) {
    const username = document.getElementById('inp-username')?.value.trim();
    if (!username || username.length < 2) { showToast('Please enter a username (min 2 chars)'); return; }
    // Update preview
    const pp = document.getElementById('pp-avatar');
    if (pp) {
      if (pendingPhotoURL) pp.innerHTML = `<img src="${pendingPhotoURL}">`;
      else pp.innerHTML = `<span style="font-size:28px">${selectedAvatar}</span>`;
    }
    const ppn = document.getElementById('pp-name'); if (ppn) ppn.textContent = username;
    const ppb = document.getElementById('pp-bio'); if (ppb) ppb.textContent = document.getElementById('inp-bio')?.value || 'No bio yet';
    const ppc = document.getElementById('pp-country'); if (ppc) ppc.textContent = document.getElementById('inp-country')?.value || '🌍 Global';
  }

  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('step-' + n);
  if (target) target.classList.add('active');
};

// Photo upload
function setupPhotoUpload() {
  const inp = document.getElementById('photo-input'); if (!inp) return;
  inp.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    showToast('⏳ Uploading photo...');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', 'hidden Hydra');
      const res = await fetch('https://api.cloudinary.com/v1_1/dyspzzb3z/image/upload', { method:'POST', body:fd });
      const data = await res.json();
      if (data.secure_url) {
        pendingPhotoURL = data.secure_url;
        const preview = document.getElementById('av-preview');
        if (preview) {
          preview.innerHTML = `<img src="${pendingPhotoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"><div class="av-ring"></div>`;
        }
        showToast('✅ Photo uploaded!');
      } else { showToast('❌ Upload failed'); }
    } catch(err) { showToast('❌ Upload failed: ' + err.message); }
  });
}

// Validate username
window.validateUsername = function(inp) {
  const hint = document.getElementById('username-hint');
  const val = inp.value.trim();
  if (!hint) return;
  if (val.length < 2) { hint.textContent = 'At least 2 characters'; hint.className='input-hint error'; }
  else if (val.length > 24) { hint.textContent = 'Max 24 characters'; hint.className='input-hint error'; }
  else if (!/^[a-zA-Z0-9_]+$/.test(val)) { hint.textContent = 'Only letters, numbers, underscores'; hint.className='input-hint error'; }
  else { hint.textContent = '✓ Looks good'; hint.className='input-hint ok'; }
};

// Quick join
window.quickJoin = function() {
  const adj = ['shadow','void','ember','frost','lunar','cosmic','neon','iron','dark','silent'];
  const noun = ['wolf','hydra','spark','raven','echo','flux','drift','veil','ghost','phantom'];
  const username = adj[Math.floor(Math.random()*adj.length)] + '_' + noun[Math.floor(Math.random()*noun.length)];
  selectedAvatar = AVATAR_EMOJIS[Math.floor(Math.random()*AVATAR_EMOJIS.length)];
  selectedColor = ACCENT_COLORS[Math.floor(Math.random()*ACCENT_COLORS.length)];
  document.getElementById('inp-username').value = username;
  goStep(3);
  setTimeout(() => window.createProfile(), 100);
};

// Create profile
window.createProfile = async function() {
  // Wait for firebase to be ready
  if (!window._auth) { setTimeout(window.createProfile, 200); return; }

  const username = document.getElementById('inp-username')?.value.trim() || 
    (() => { const adj=['shadow','void','ember']; const n=['wolf','hydra','spark']; return adj[Math.floor(Math.random()*adj.length)]+'_'+n[Math.floor(Math.random()*n.length)]; })();
  const bio = document.getElementById('inp-bio')?.value.trim() || '';
  const country = document.getElementById('inp-country')?.value || '🌍 Global';

  const btn = document.getElementById('btn-enter');
  const btnText = document.getElementById('enter-text');
  const loader = document.getElementById('btn-loader');
  if (btn) btn.disabled = true;
  if (btnText) btnText.style.display = 'none';
  if (loader) loader.style.display = 'block';

  try {
    let user = window._auth.currentUser;
    if (!user) {
      const cred = await window._signInAnonymously(window._auth);
      user = cred.user;
    }

    const profile = {
      uid: user.uid, username, bio, country,
      avatar: selectedAvatar, color: selectedColor,
      photoURL: pendingPhotoURL || null,
      createdAt: window._serverTimestamp(), online: true
    };

    await window._setDoc(window._doc(window._db, 'users', user.uid), profile);

    // Set presence
    await window._rtSet(window._rtRef(window._rtdb, `presence/${user.uid}`), {
      online: true, uid: user.uid, lastSeen: window._rtTs()
    });

    showToast('✅ Welcome to Hidden Hydra!');
    setTimeout(() => { window.location.href = 'chat.html'; }, 600);

  } catch(err) {
    showToast('❌ Error: ' + err.message);
    if (btn) btn.disabled = false;
    if (btnText) btnText.style.display = 'inline';
    if (loader) loader.style.display = 'none';
  }
};

// INIT
document.addEventListener('DOMContentLoaded', () => {
  buildEmojiGrid();
  buildColorSwatches();
  buildCountrySelect();
  setupPhotoUpload();
  updateAvatarPreview();
});
