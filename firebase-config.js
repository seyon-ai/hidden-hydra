// firebase-config.js — Hidden Hydra
// All Firebase imports and initialization in one place

import { initializeApp }                from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut }
                                         from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDatabase, ref, set, push, remove, onValue, onChildAdded, off,
  serverTimestamp as rtTs, onDisconnect,
  query as dbQuery, orderByChild, limitToLast, get, update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCj5A6GpHYppmaqZqY39HmIAID2jZv3eAM",
  authDomain:        "hidden-hydra.firebaseapp.com",
  databaseURL:       "https://hidden-hydra-default-rtdb.firebaseio.com",
  projectId:         "hidden-hydra",
  storageBucket:     "hidden-hydra.firebasestorage.app",
  messagingSenderId: "1487060887",
  appId:             "1:1487060887:web:402fea888cdf486f8d0ed2"
};

export const CLOUDINARY = {
  cloudName:    "dyspzzb3z",
  uploadPreset: "hidden Hydra"
};

const firebaseApp = initializeApp(FIREBASE_CONFIG);

export const auth  = getAuth(firebaseApp);
export const db    = getFirestore(firebaseApp);
export const rtdb  = getDatabase(firebaseApp);

// Re-export all Firebase functions so pages only import from this one file
export {
  signInAnonymously, onAuthStateChanged, signOut,
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  ref, set, push, remove, onValue, onChildAdded, off,
  rtTs, onDisconnect,
  dbQuery, orderByChild, limitToLast, get, update
};
