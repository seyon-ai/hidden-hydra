# Hidden Hydra — v2 "Iron Scales"

Anonymous, **end-to-end encrypted** global chat. Dark-gold secret-society design,
Firebase realtime backend, Groq-powered AI, imgbb image attachments — with all
secrets moved server-side into **Vercel environment variables**.

```
hidden-hydra/
├── api/                  ← Vercel serverless functions (SECRETS LIVE HERE)
│   ├── ai.js             ← Groq proxy: assistant / welcome / moderation
│   └── upload.js         ← imgbb proxy for image attachments & photos
├── assets/               ← real logo art, favicons, PWA icons, OG image
├── css/
│   ├── global.css        ← theme, buttons, modals, icon system
│   ├── pages.css         ← shared marketing-page chrome (nav/footer/docs)
│   ├── chat.css          ← the app shell
│   └── login.css
├── js/
│   ├── firebase-config.js← Firebase init + re-exports (public config only)
│   ├── icons.js          ← SVG sprite: every UI emoji replaced by line-art icons
│   ├── crypto.js         ← E2EE: ECDH P-256 + AES-256-GCM + wrapped room keys
│   ├── api.js            ← client → /api bridge + on-device image compression
│   ├── ai.js             ← bot logic (no keys!), private AI rooms, moderation
│   └── chat.js           ← the app
├── index.html  login.html  chat.html  profile.html
├── features.html  about.html  security.html  help.html  privacy.html  404.html
├── manifest.json         ← installable PWA
├── vercel.json           ← clean URLs + asset caching
├── firestore.rules / database.rules.json   ← paste into Firebase console
├── dev-server.mjs        ← local dev with .env (node dev-server.mjs)
└── .env.example
```

---

## 1 · Deploy (repo → Vercel)

1. **Push this folder to your GitHub repo** (root of the repo = this folder).
2. In **Vercel**: *Add New → Project → Import* that repo.
   Framework preset: **Other**. Build command: *(empty)*. Output: *(default)*.
3. **Before deploying**, add environment variables in
   *Project → Settings → Environment Variables* (all environments):
   | Variable | Where to get it |
   |---|---|
   | `GROQ_API_KEY` | console.groq.com → API Keys (**rotate your old key — it was committed in the old repo!**) |
   | `IMGBB_API_KEY` | api.imgbb.com → Get API key |
   | `GROQ_MODEL` *(optional)* | default `llama-3.1-8b-instant` |
   | `APP_ORIGIN` *(optional)* | comma-separated allow-list for `/api` origins |
4. Deploy. Done — `/api/ai` and `/api/upload` now read the keys from Vercel;
   **no secret exists in the repository or in any browser.**

### Local development
```bash
cp .env.example .env     # fill in the two keys
node dev-server.mjs      # → http://localhost:3000 (static + /api emulation)
```

### Firebase (one-time)
- Paste `firestore.rules` into *Firestore → Rules*, and `database.rules.json`
  into *Realtime Database → Rules*.
- Keep **Anonymous auth** enabled. The Firebase web config in
  `js/firebase-config.js` is a *public identifier* (like a client-id) — that is
  normal and safe; access control is done by the rules above. For extra
  hardening, restrict authorized domains in *Firebase → Auth → Settings* and
  consider App Check.

---

## 2 · What changed in v2

### 🔐 Secrets (your item 2)
- Groq key **removed from client code** → `api/ai.js` reads `GROQ_API_KEY` from
  Vercel env. Cloudinary removed entirely; uploads go through `api/upload.js`
  with `IMGBB_API_KEY`.
- Client shows friendly errors if a key is missing instead of breaking chat.

### 🖼 Real imagery (item 1)
- New AI-drawn **gold hydra emblem** replaces the 🐉 emoji everywhere:
  nav, loader, empty state, login, favicon, PWA icons, OG social card.
- **Every UI emoji replaced** by a hand-drawn inline-SVG icon system
  (`js/icons.js`, ~60 icons: tabs, buttons, reactions, room icons, and 20
  avatar emblems). Legacy emoji avatar/room/reaction values from v1 profiles
  are mapped automatically, so old accounts keep their look.
- Country flags render as **real flag images** (flagcdn) with graceful fallback.
- Message-content emoji picker stays Unicode on purpose — that's user *content*,
  like a keyboard, not UI chrome.

### 📎 Image attachments (item 3)
- Attach button, **Ctrl/Cmd+V paste**, and **drag & drop** into any chat.
- On-device compression (max 1600px JPEG) → `/api/upload` → imgbb URL →
  the URL is embedded **inside the encrypted payload**.
- Thumbnail grid in bubbles + full-screen lightbox. Profile photos use the same pipeline.

### 🔒 End-to-end encryption (item 6)
See `security.html` (in-site) for the user-facing explainer.
- Identity: per-browser **ECDH P-256** pair; private key never leaves the device;
  public key on the profile; fingerprint shown on the profile page.
- DMs: `HKDF(ECDH shared)` → **AES-256-GCM**, fresh IV per message.
- Groups/world rooms: random room key per **epoch**, wrapped per member
  (ephemeral ECDH) into `groups/{id}/keys/{uid}`; members who hold the key
  auto-wrap it for those who don't; `New epoch` escape hatch if sync stalls.
- Chat lists show "Encrypted message" instead of leaking previews.
- Bots/AI rooms intentionally plaintext and clearly labelled.
- Honest limits documented (metadata, imgbb-hosted files, key-sync waits).

### 🪟 Layout (items 5 & 7)
- **Collapsible chat sidebar** (desktop collapse + floating reopen button;
  mobile hamburger + slide-over with backdrop) and **toggleable Online panel**.
- Responsive overhaul: safe-area input insets, touch-visible message actions,
  wider bubbles on phones, scrollable modals, tablet breakpoints.
- **Six new pages**: Features, About, Security, Help/FAQ, Privacy, themed 404 —
  plus clean URLs (`/security` works) and a shared nav/footer with mobile menu.

### 🐞 Fixes (item 4)
- Mobile: sidebar was impossible to open; closing a chat dead-ended.
- Friendship never registered for the *requester* (explore showed "+ Add" again).
- DM list snapshot race dropped updates (`busy` flag) → latest-snapshot-wins.
- Explore/search did N+1 friend-request queries → single query + debounce.
- Reactions listened with a full-tree `onValue` → `onChildChanged`.
- Autoscroll yanked readers to the bottom → near-bottom check + jump button.
- Bans applied live via profile snapshot; group invite copy no longer
  inline-injectable; AI assistant is now **private per user** (was one shared
  public room where everyone read everyone's AI chats).

### ✨ New features (item 8)
Unread dots + "Encrypted message" previews · delete/copy own messages ·
linkified URLs · live online/last-seen in DM headers · jump-to-latest ·
message-sent counter on profile · E2EE badge + key epoch UI in group info ·
PWA manifest (installable) · OG social card · themed 404 · dev server.

---

## 3 · Notes & honest limits
- Group key sync needs *some* key-holder online; otherwise the room offers a
  new epoch. World rooms cap the member array at 2,000 for wrapping.
- Clearing browser data discards your private key (that's the point of E2EE).
- Moderation runs on the sender's device against the sender's own document —
  the server never reads encrypted content.
- Stats on the landing page are marketing placeholders from v1.

© 2025 Hidden Hydra — where shadows speak.
