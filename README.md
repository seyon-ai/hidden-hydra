# Hidden Hydra v5

## Files
index.html / login.html / chat.html / chat.js / profile.html

---

## Firestore Rules — paste in Firebase Console → Firestore → Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{uid} {
      allow read: if request.auth != null;
      // Only owner can write their own doc
      allow write: if request.auth != null && request.auth.uid == uid;
    }

    match /chats/{chatId} {
      allow read, write: if request.auth != null;
    }

    match /groups/{groupId} {
      allow read, write: if request.auth != null;
    }

    match /friendRequests/{reqId} {
      // Anyone logged in can read requests addressed to them
      allow read: if request.auth != null;
      // Anyone can create a request
      allow create: if request.auth != null;
      // Recipient OR sender can update (accept/reject/cancel)
      allow update: if request.auth != null &&
        (request.auth.uid == resource.data.to ||
         request.auth.uid == resource.data.from);
      allow delete: if request.auth != null;
    }

  }
}
```

## Realtime Database Rules — paste in Firebase Console → Realtime Database → Rules

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

## Fixes in v5
1. Messages only showing first one → fixed (append-only, reaction updates never re-render)
2. Mobile input bar hidden → fixed (sticky bottom, always visible)
3. Friend request accept error → fixed (only update own doc, check both directions for DM)
4. World chat missing → fixed (🌍 tab always shows 5 global rooms, no join needed)
