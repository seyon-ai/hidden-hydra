# Hidden Hydra — v4 (Clean Rebuild)

## Files
```
index.html    — Landing page
login.html    — 3-step onboarding
chat.html     — Main chat app
chat.js       — All chat logic (Firebase)
profile.html  — Profile editor
```

---

## Firebase Rules (REQUIRED)

### Firestore — paste in Firebase Console → Firestore → Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /chats/{chatId} {
      allow read, write: if request.auth != null;
    }
    match /groups/{groupId} {
      allow read, write: if request.auth != null;
    }
    match /friendRequests/{reqId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
    }
  }
}
```

### Realtime Database — paste in Firebase Console → Realtime Database → Rules

```json
{
  "rules": {
    "messages": {
      "$chatId": {
        ".read": "auth != null",
        ".write": "auth != null",
        ".indexOn": ["timestamp"]
      }
    },
    "presence": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "typing": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

---

## Deploy
Upload all files to Vercel / Netlify / GitHub Pages root. Done.

## What's fixed in v4
- Messages never disappear — append-only rendering, zero full re-renders
- All users' messages display — null photo handled gracefully with fallback
- Global rooms: 5 permanent rooms auto-created on first login
- Friend request system — must be accepted before DMs open
- Groups: Public 🌍 or Private 🔒 with shareable invite codes
- Requests tab with accept / decline buttons + red badge count
- Typing listeners properly torn down when switching chats
- Clean single-file architecture — no CSS/JS file dependencies except chat.js
