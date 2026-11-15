import {auth,db,functions} from "./firebase.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {httpsCallable} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import {collection,doc,getDoc,getDocs,query,where,updateDoc} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const safeUrl=value=>{try{const u=new URL(String(value||"").trim(),location.href);return u.protocol==="http:"||u.protocol==="https:"?u.href:""}catch{return ""}};
const params=new URLSearchParams(location.search);
const rawShare=params.get("share")||params.get("code")||params.get("shareId");
const share=(()=>{
  if(!rawShare)return "";
  try{const u=new URL(rawShare);return u.searchParams.get("share")||u.searchParams.get("code")||u.searchParams.get("shareId")||""}
  catch{return rawShare.trim()}
})();
const root=document.getElementById("public-list");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $=id=>document.getElementById(id);

const getStatuses=httpsCallable(functions,"getReservationStatuses");
const claim=httpsCallable(functions,"claimReservationPassword");
const unlock=httpsCallable(functions,"unlockReservations");
const reserve=httpsCallable(functions,"reserveGift");
const cancel=httpsCallable(functions,"cancelReservation");

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
    list={
      title:data.title,description:data.description||"",occasion:data.occasion||"",
      eventDate:typeof data.eventDate==="string"?data.eventDate:null,
      passwordProtectionActive:!!data.passwordProtectionActive,
      items:itemsSnapshot.docs.map(item=>({id:item.id,...item.data()}))
    };
    if(user){
      const own=await getDocs(query(collection(db,"lists"),where("shareId","==",share),where("ownerUid","==",user.uid)));
      if(!own.empty){
        const ownerData=own.docs[0].data();
        list.isOwner=true;
        list.passwordHolderName=ownerData.passwordHolderName||null;
      }
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
  document.querySelectorAll(".public-item-main img").forEach(image=>image.addEventListener("error",()=>{
    const placeholder=document.createElement("div");
    placeholder.className="item-placeholder";
    placeholder.textContent="♡";
    image.replaceWith(placeholder);
  },{once:true}));
  if(user&&list.isOwner){
    $("holder-message").innerHTML=list.passwordHolderName?'<div class="notice"><b>Reservation protection activated</b><p>The first person to open your wishlist is <b>'+esc(list.passwordHolderName)+'</b>.</p><p>Tell gift buyers to contact this person for the reservation password. Your reservation statuses are hidden from you.</p></div>':'<div class="notice">You’re viewing your own list. Reservation details are hidden from the list creator.</div>';
    return;
  }
  if(user)initializeViewer();
  else $("password-area").innerHTML='<div class="notice">You can browse this list without an account. <a href="login.html">Log in</a> to reserve a gift.</div>';
}

async function markPasswordProtectionActive(){
  await updateDoc(doc(db,"publicWishlists",share),{passwordProtectionActive:true});
  list.passwordProtectionActive=true;
}

async function initializeViewer(){
  if(!list.passwordProtectionActive){
    $("password-area").innerHTML='<div class="notice"><b>Help keep the surprise safe.</b><p>You’re the first signed-in visitor. Set a reservation password and share it with other gift buyers.</p><form id="set-password" class="inline-form"><input class="app-input" type="password" id="new-password" minlength="8" placeholder="Create a password (8+ characters)" required><button class="button button-dark">Set password</button></form><p id="pw-msg" class="form-message"></p></div>';
    $("set-password").onsubmit=async e=>{
      e.preventDefault();
      const button=e.currentTarget.querySelector("button");
      button.disabled=true;
      try{
        await claim({shareId:share,password:$("new-password").value});
        await markPasswordProtectionActive();
        $("pw-msg").textContent="Reservation password created.";
        await load();
      }catch(err){
        if(String(err.code||"").includes("already-exists")){
          try{await markPasswordProtectionActive();await load();return}catch(syncError){console.error(syncError)}
        }
        $("pw-msg").textContent=err.message||"Couldn't create the reservation password.";
        button.disabled=false;
      }
    };
    return;
  }
  $("password-area").innerHTML='<div class="notice"><b>Reservation protection is on.</b><p>Ask the first visitor for the reservation password. The list creator cannot unlock reservation details.</p><form id="unlock-form" class="inline-form"><input class="app-input" type="password" id="reservation-password" placeholder="Reservation password" required><button class="button button-dark">Unlock</button></form><p id="unlock-msg" class="form-message"></p></div>';
  $("unlock-form").onsubmit=async e=>{
    e.preventDefault();
    const button=e.currentTarget.querySelector("button");
    button.disabled=true;
    try{
      const out=await unlock({shareId:share,password:$("reservation-password").value});
      showStatuses(out.data.statuses||[]);
    }catch(err){$("unlock-msg").textContent="That password didn't work.";button.disabled=false}
  };
  const cached=await getStatuses({shareId:share}).catch(()=>null);
  if(cached)showStatuses(cached.data.statuses||[]);
  else document.querySelectorAll(".reserve-zone").forEach(enableReserve);
}

function enableReserve(zone){
  zone.innerHTML='<button class="button button-quiet reserve-button">I’ll buy this</button>';
  zone.querySelector("button").onclick=async()=>{
    try{await reserve({shareId:share,itemId:zone.dataset.item});enableCancel(zone)}
    catch(e){zone.textContent=e.message||"Could not reserve this item."}
  };
}
function enableCancel(zone){
  zone.innerHTML='<span class="reserve-confirm">Reserved by you</span><button class="small-danger">Cancel</button>';
  zone.querySelector("button").onclick=async()=>{
    try{await cancel({shareId:share,itemId:zone.dataset.item});enableReserve(zone)}
    catch(e){zone.querySelector("button").textContent="Try again"}
  };
}
function showStatuses(statuses){
  const map=new Map(statuses.map(s=>[s.itemId,s]));
  document.querySelectorAll(".reserve-zone").forEach(z=>{
    const status=map.get(z.dataset.item);
    z.innerHTML="";
    if(status){
      const label=document.createElement("span");
      label.className="reserved-label";label.textContent="Reserved";z.append(label);
      if(status.mine){
        const button=document.createElement("button");
        button.className="small-danger";button.textContent="Cancel";
        button.onclick=async()=>{
          try{await cancel({shareId:share,itemId:z.dataset.item});showStatuses(statuses.filter(x=>x.itemId!==z.dataset.item))}
          catch(e){button.textContent="Try again"}
        };
        z.append(button);
      }
    }else{
      const label=document.createElement("span");
      label.className="available-label";label.textContent="Available";
      const button=document.createElement("button");
      button.className="button button-quiet reserve-button";button.textContent="I’ll buy this";
      button.onclick=async()=>{
        try{await reserve({shareId:share,itemId:z.dataset.item});showStatuses([...statuses,{itemId:z.dataset.item,reserved:true,mine:true}])}
        catch(e){button.textContent=e.message||"Unavailable"}
      };
      z.append(label,button);
    }
  });
}
