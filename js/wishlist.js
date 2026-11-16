import {auth,db} from "./firebase.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {scryptAsync} from "https://esm.sh/@noble/hashes@1.8.0/scrypt.js";
import {
  collection,doc,getDoc,getDocs,query,where,writeBatch,serverTimestamp,setDoc,deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const safeUrl=value=>{try{const u=new URL(String(value||"").trim(),location.href);return u.protocol==="http:"||u.protocol==="https:"?u.href:""}catch{return ""}};
const params=new URLSearchParams(location.search);
const rawShare=params.get("share")||params.get("code")||params.get("shareId");
const share=(()=>{if(!rawShare)return "";try{const u=new URL(rawShare);return u.searchParams.get("share")||u.searchParams.get("code")||u.searchParams.get("shareId")||""}catch{return rawShare.trim()}})();
const root=document.getElementById("public-list");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $=id=>document.getElementById(id);
const SCRYPT={N:16384,r:8,p:1,dkLen:64};
const bytes=value=>new TextEncoder().encode(value);
const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,"0")).join("");
const randomHex=length=>{const data=new Uint8Array(length);crypto.getRandomValues(data);return hex(data)};
async function deriveVerifier(password,salt){
  return hex(await scryptAsync(bytes(password),bytes(salt),SCRYPT));
}
async function makeProof(verifier,nonce,uid,shareId,challengeId){
  return hex(await crypto.subtle.digest("SHA-256",bytes(`${verifier}|${nonce}|${uid}|${shareId}|${challengeId}`))).toUpperCase();
}
const grantRef=uid=>doc(db,"reservationAccess",`${share}_${uid}`);

let user=null,list=null;
onAuthStateChanged(auth,u=>{user=u;load()});

async function load(){
  if(!share){root.textContent="This wishlist link is missing or invalid.";return}
  root.innerHTML='<div class="skeleton"></div>';
  try{
    const publicRef=doc(db,"publicWishlists",share);
    const publicSnapshot=await getDoc(publicRef);
    if(!publicSnapshot.exists())throw Object.assign(new Error("This wishlist is private, unavailable, or the link is invalid."),{code:"not-found"});
    const data=publicSnapshot.data();
    if(typeof data.title!=="string"||!data.title)throw new Error("The wishlist data was incomplete.");
    const itemsSnapshot=await getDocs(collection(publicRef,"items"));
    list={title:data.title,description:data.description||"",occasion:data.occasion||"",eventDate:typeof data.eventDate==="string"?data.eventDate:null,passwordProtectionActive:!!data.passwordProtectionActive,items:itemsSnapshot.docs.map(item=>({id:item.id,...item.data()}))};
    if(user){
      const own=await getDocs(query(collection(db,"lists"),where("shareId","==",share),where("ownerUid","==",user.uid)));
      if(!own.empty){const ownerData=own.docs[0].data();list.isOwner=true;list.passwordHolderName=ownerData.passwordHolderName||null}
    }
    render();
  }catch(e){
    console.error("Wishly shared wishlist direct read failed:",e);
    if(e.code?.includes("permission-denied"))root.textContent="This wishlist is private and can’t be opened with this link.";
    else if(e.code?.includes("not-found")||e.code?.includes("invalid-argument"))root.textContent="We couldn’t find a public wishlist with that link or code. Check it and try again.";
    else root.textContent=e.message||"This wishlist isn’t available. Please check the link and try again.";
  }
}

function render(){
  root.innerHTML=`<span class="eyebrow">A WISHLY LIST</span><h1 class="public-title">${esc(list.title)}</h1><p class="public-description">${esc(list.description)}</p><div class="public-meta">${esc(list.occasion||"A collection of wishes")} ${list.eventDate?" · "+esc(list.eventDate):""}</div><div id="holder-message"></div><div id="password-area"></div><div class="public-items" id="items">${(list.items||[]).map(i=>`<article class="public-item"><div class="public-item-main">${safeUrl(i.imageUrl)?'<img src="'+esc(safeUrl(i.imageUrl))+'" alt="" loading="lazy">':'<div class="item-placeholder">♡</div>'}<div><h3>${esc(i.name)}</h3><p>${esc(i.description)}</p>${i.price!=null&&Number.isFinite(Number(i.price))?'<small>$'+Number(i.price).toFixed(2)+'</small>':""}${safeUrl(i.purchaseUrl)?'<a class="purchase-link" href="'+esc(safeUrl(i.purchaseUrl))+'" target="_blank" rel="noopener noreferrer">View item ↗</a>':""}</div></div><div class="reserve-zone" data-item="${esc(i.id)}"></div></article>`).join("")||'<p class="muted">This list is still empty.</p>'}</div>`;
  document.querySelectorAll(".public-item-main img").forEach(image=>image.addEventListener("error",()=>{const placeholder=document.createElement("div");placeholder.className="item-placeholder";placeholder.textContent="♡";image.replaceWith(placeholder)},{once:true}));
  if(user&&list.isOwner){
    $("holder-message").innerHTML=list.passwordHolderName?'<div class="notice"><b>Reservation protection activated</b><p>The first person to open your wishlist is <b>'+esc(list.passwordHolderName)+'</b>.</p><p>Tell gift buyers to contact this person for the reservation password. Your reservation statuses are hidden from you.</p></div>':'<div class="notice">You’re viewing your own list. Reservation details are hidden from the list creator.</div>';
    return;
  }
  if(user)initializeViewer();
  else $("password-area").innerHTML='<div class="notice">You can browse this list without an account. <a href="login.html">Log in</a> to reserve a gift.</div>';
}

async function initializeViewer(){
  try{
    const grant=await getDoc(grantRef(user.uid));
    if(grant.exists()){await refreshStatuses();return}
  }catch(error){console.error("Could not check reservation access:",error)}
  if(!list.passwordProtectionActive){
    $("password-area").innerHTML='<div class="notice"><b>Help keep the surprise safe.</b><p>You’re the first signed-in visitor. Set a reservation password and share it with other gift buyers.</p><form id="set-password" class="inline-form"><input class="app-input" type="password" id="new-password" minlength="12" maxlength="128" autocomplete="new-password" placeholder="Create a password (12+ characters)" required><button class="button button-dark">Set password</button></form><p id="pw-msg" class="form-message"></p></div>';
    $("set-password").onsubmit=async e=>{
      e.preventDefault();const button=e.currentTarget.querySelector("button"),password=$("new-password").value;
      if(password.length<12){$("pw-msg").textContent="Use at least 12 characters.";return}
      button.disabled=true;$("pw-msg").textContent="Creating password…";
      try{await claimPassword(password);await load()}
      catch(error){console.error("Password setup failed:",error);$("pw-msg").textContent=error.code==="already-exists"?"Someone has already created the reservation password. Reload this page.":error.message||"Couldn't create the reservation password.";button.disabled=false}
    };
    return;
  }
  $("password-area").innerHTML='<div class="notice"><b>Reservation protection is on.</b><p>Ask the first visitor for the reservation password. The list creator cannot unlock reservation details.</p><form id="unlock-form" class="inline-form"><input class="app-input" type="password" id="reservation-password" autocomplete="current-password" placeholder="Reservation password" required><button class="button button-dark">Unlock</button></form><p id="unlock-msg" class="form-message"></p></div>';
  $("unlock-form").onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector("button");button.disabled=true;try{await unlockPassword($("reservation-password").value);await refreshStatuses()}catch(error){console.error("Reservation unlock failed:",error);$("unlock-msg").textContent=error.message||"That password didn't work.";button.disabled=false}};
}

async function claimPassword(password){
  const indexSnap=await getDoc(doc(db,"publicWishlistIndex",share));
  if(!indexSnap.exists())throw new Error("This public wishlist could not be found.");
  const listRef=doc(db,"lists",indexSnap.data().listId);
  const userSnap=await getDoc(doc(db,"users",user.uid));
  const holderName=String(userSnap.data()?.displayName||user.displayName||"Wishly viewer").slice(0,100);
  const salt=randomHex(16);
  const passwordHash=await deriveVerifier(password,salt);
  const batch=writeBatch(db);
  batch.create(doc(db,"reservationSecrets",share),{holderUid:user.uid,holderName,salt,passwordHash,createdAt:serverTimestamp()});
  batch.update(listRef,{reservationProtectionActivated:true,passwordHolderName:holderName,reservationSalt:salt});
  batch.update(doc(db,"publicWishlists",share),{passwordProtectionActive:true,reservationSalt:salt});
  batch.create(grantRef(user.uid),{uid:user.uid,shareId:share,challengeId:"password-holder",grantedAt:serverTimestamp()});
  await batch.commit();
}

async function unlockPassword(password){
  if(typeof password!=="string"||password.length<1)throw new Error("Enter the reservation password.");
  const publicSnap=await getDoc(doc(db,"publicWishlists",share));
  const salt=publicSnap.data()?.reservationSalt;
  if(typeof salt!=="string"||! /^[0-9a-f]{32}$/.test(salt))throw new Error("Reservation password setup is incomplete. Ask the password holder to reload and try again.");
  const verifier=await deriveVerifier(password,salt);
  const challengeRef=doc(collection(db,"reservationChallenges"));
  const nonce=randomHex(32);
  const proof=await makeProof(verifier,nonce,user.uid,share,challengeRef.id);
  const batch=writeBatch(db);
  batch.create(challengeRef,{shareId:share,uid:user.uid,nonce,proof,consumed:true,createdAt:serverTimestamp()});
  batch.create(grantRef(user.uid),{uid:user.uid,shareId:share,challengeId:challengeRef.id,grantedAt:serverTimestamp()});
  await batch.commit();
}

async function refreshStatuses(){
  const snapshot=await getDocs(collection(db,"reservations",share,"items"));
  showStatuses(snapshot.docs.map(d=>({itemId:d.id,mine:d.data().reservedBy===user.uid})));
}
async function reserveItem(itemId){
  await setDoc(doc(db,"reservations",share,"items",itemId),{reservedBy:user.uid,createdAt:serverTimestamp()});
}
async function cancelItem(itemId){
  await deleteDoc(doc(db,"reservations",share,"items",itemId));
}
function showStatuses(statuses){
  $("password-area").innerHTML='<div class="notice"><b>Reservation access unlocked.</b><p>Reserved items are marked below. You can cancel reservations you made.</p></div>';
  const map=new Map(statuses.map(s=>[s.itemId,s]));
  document.querySelectorAll(".reserve-zone").forEach(zone=>{
    const status=map.get(zone.dataset.item);zone.innerHTML="";
    if(status){const label=document.createElement("span");label.className="reserved-label";label.textContent="Reserved";zone.append(label);if(status.mine){const button=document.createElement("button");button.className="small-danger";button.textContent="Cancel";button.onclick=async()=>{button.disabled=true;try{await cancelItem(zone.dataset.item);await refreshStatuses()}catch(error){button.disabled=false;button.textContent="Try again"}};zone.append(button)}}
    else{const label=document.createElement("span");label.className="available-label";label.textContent="Available";const button=document.createElement("button");button.className="button button-quiet reserve-button";button.textContent="I’ll buy this";button.onclick=async()=>{button.disabled=true;try{await reserveItem(zone.dataset.item);await refreshStatuses()}catch(error){button.disabled=false;button.textContent=error.code==="permission-denied"?"Unavailable":"Try again"}};zone.append(label,button)}
  });
}
