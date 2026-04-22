# Hidden Hydra — Clean Rebuild

## Files
```
firebase-config.js   ← All Firebase setup (edit credentials here)
global.css           ← Shared styles
index.html           ← Landing page
login.html + login.css
chat.html + chat.css + chat.js  ← Main app
profile.html
```

## Why messages work now
Previous versions used `onValue()` which fires for EVERY change to the entire messages list.
This rebuild uses `onChildAdded()` which fires ONCE per message — existing ones on attach,
then once per new message. It never re-fires old messages. No "only first message" bug possible.

---

## Firestore Rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /chats/{id} {
      allow read, write: if request.auth != null;
    }
    match /groups/{id} {
      allow read, write: if request.auth != null;
    }
    match /friendRequests/{id} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null &&
        (request.auth.uid == resource.data.to || request.auth.uid == resource.data.from);
    }
  }
}
```

## Realtime Database Rules
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
      "$uid": { ".write": "auth != null && auth.uid === $uid" }
    },
    "typing": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

## Deploy
Upload all files to Vercel / Netlify root. Done.
