import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
const firebaseConfig={apiKey:"AIzaSyBDPydRPyd9AbGrZQIfXwnURKu7R3qdlk",authDomain:"wishly2.firebaseapp.com",projectId:"wishly2",storageBucket:"wishly2.firebasestorage.app",messagingSenderId:"591580458569",appId:"1:591580458569:web:f53353a5cfde5bcdc79998",measurementId:"G-379WRXWRX1"};
export const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getFirestore(app);
export const functions=getFunctions(app);