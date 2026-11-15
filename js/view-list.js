import {auth,functions} from "./firebase.js";
import {onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {httpsCallable} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const $=id=>document.getElementById(id);
const form=$("lookup-form"),gate=$("sign-in-required"),input=$("list-reference"),message=$("lookup-message");
const getPublicWishlist=httpsCallable(functions,"getPublicWishlist");
let signedIn=false,busy=false;

onAuthStateChanged(auth,user=>{
  signedIn=!!user;
  gate.hidden=signedIn;
  form.hidden=!signedIn;
  if(!signedIn){
    const params=new URLSearchParams(location.search);
    const share=params.get("share")||params.get("code");
    const returnTo="view-list.html"+(share?"?share="+encodeURIComponent(share):"");
    $("login-link").href="login.html?redirect="+encodeURIComponent(returnTo);
    return;
  }
  const incoming=new URLSearchParams(location.search).get("share")||new URLSearchParams(location.search).get("code");
  if(incoming){input.value=incoming;openWishlist(incoming)}
});

$("logout")?.addEventListener("click",async()=>{await signOut(auth);location.href="index.html"});

function extractShareCode(value){
  const raw=value.trim();
  if(!raw)return "";
  if(/^https?:\/\//i.test(raw)){
    try{
      const url=new URL(raw);
      return url.searchParams.get("share")||url.searchParams.get("code")||url.searchParams.get("shareId")||"";
    }catch{return ""}
  }
  if(raw.includes("://")||raw.includes("/")||raw.includes("?")||raw.includes("#"))return "";
  return raw;
}

form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!signedIn||busy)return;
  const code=extractShareCode(input.value);
  if(!code){message.textContent="Enter a valid Wishly share link or share code.";return}
  await openWishlist(code);
});

async function openWishlist(code){
  if(!signedIn||busy)return;
  busy=true;
  const button=form.querySelector('button[type="submit"]');
  button.disabled=true;
  button.textContent="Finding wishlist…";
  message.textContent="";
  try{
    const result=await getPublicWishlist({shareId:code});
    if(!result.data||!Array.isArray(result.data.items))throw new Error("We couldn't load that wishlist.");
    if(result.data.isOwner){
      message.textContent="That’s one of your own lists. Open it from My Lists to manage it.";
      busy=false;
      button.disabled=false;
      button.textContent="Open wishlist →";
      return;
    }
    message.textContent="Wishlist found. Opening…";
    location.href="wishlist.html?share="+encodeURIComponent(code);
  }catch(error){
    const code=error.code||"";
    if(code.includes("permission-denied"))message.textContent="This wishlist is private and can't be opened with this share link.";
    else if(code.includes("not-found")||code.includes("invalid-argument"))message.textContent="We couldn't find a wishlist with that link or code. Check it and try again.";
    else message.textContent=error.message||"Couldn't open that wishlist. Please try again.";
    busy=false;
    button.disabled=false;
    button.textContent="Open wishlist →";
  }
}