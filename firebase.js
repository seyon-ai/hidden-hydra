// firebase.js — Hidden Hydra Firebase Config
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);

// Cloudinary Config
export const CLOUDINARY = {
  cloudName: "dyspzzb3z",
  uploadPreset: "hidden Hydra"
};
