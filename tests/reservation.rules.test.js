import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash,scryptSync,randomBytes} from "node:crypto";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,collection,getDoc,getDocs,setDoc,deleteDoc,writeBatch,serverTimestamp,Timestamp} from "firebase/firestore";

const projectId="demo-wishly2";
const share="share_012345678901234567890123456789";
const salt="0123456789abcdef0123456789abcdef";
const password="Wishly test passphrase 2026!";
const passwordHash=scryptSync(password,salt,64,{N:16384,r:8,p:1}).toString("hex");
let env;

before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{rules:await readFile("firestore.rules","utf8")}});
});
after(async()=>{await env.cleanup()});

async function seed({withSecret=false}={}){
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,"lists/list1"),{ownerUid:"owner",shareId:share,visibility:"public",title:"Test list"});
    await setDoc(doc(db,"publicWishlistIndex",share),{listId:"list1"});
    await setDoc(doc(db,"publicWishlists",share),{title:"Test list",description:"",occasion:"",eventDate:null,passwordProtectionActive:withSecret,mirrorVersion:1,reservationSalt:withSecret?salt:null});
    await setDoc(doc(db,"publicWishlists",share,"items","gift1"),{name:"Gift",description:"",imageUrl:"",purchaseUrl:"",price:null});
    await setDoc(doc(db,"users/holder"),{displayName:"First Viewer",email:"holder@example.test"});
    await setDoc(doc(db,"users/buyer"),{displayName:"Gift Buyer",email:"buyer@example.test"});
    await setDoc(doc(db,"users/buyer2"),{displayName:"Second Buyer",email:"buyer2@example.test"});
    await setDoc(doc(db,"users/other"),{displayName:"Other Buyer",email:"other@example.test"});
    if(withSecret)await setDoc(doc(db,"reservationSecrets",share),{holderUid:"holder",holderName:"First Viewer",salt,passwordHash,createdAt:Timestamp.now()});
    await setDoc(doc(db,"reservations",share,"items","gift1"),{reservedBy:"buyer",createdAt:Timestamp.now()});
  });
}
function proofFor(uid,challengeId,pass=password){
  const verifier=scryptSync(pass,salt,64,{N:16384,r:8,p:1}).toString("hex");
  const nonce=randomBytes(32).toString("hex");
  const proof=createHash("sha256").update(verifier+"|"+nonce+"|"+uid+"|"+share+"|"+challengeId).digest("hex").toUpperCase();
  return {nonce,proof};
}
async function unlockBatch(uid,challengeId,options={}){
  const db=env.authenticatedContext(uid,{email:uid+"@example.test",...(options.token||{})}).firestore();
  const {nonce,proof}=options.proof||proofFor(uid,challengeId,options.password);
  const batch=writeBatch(db);
  batch.set(doc(db,"reservationChallenges",challengeId),{
    shareId:share,uid,nonce,proof,consumed:true,
    createdAt:options.createdAt||serverTimestamp()
  });
  batch.set(doc(db,"reservationAccess",share+"_"+uid),{
    uid,shareId:share,challengeId,grantedAt:serverTimestamp()
  });
  return batch.commit();
}

test("diagnostic: Wishly profile rule and SHA-256 hashing work",async()=>{
  await seed({withSecret:true});
  const db=env.authenticatedContext("buyer",{email:"buyer@example.test"}).firestore();
  await assertSucceeds(setDoc(doc(db,"accountProbe","buyer"),{ok:true}));
  const input="verifier|nonce|buyer|"+share+"|diag";
  const digest=createHash("sha256").update(input).digest("hex").toUpperCase();
  await assertSucceeds(setDoc(doc(db,"hashProbe","known"),{input,proof:digest}));
});

test("public browsing works without authentication; private data does not",async()=>{
  await seed();
  const anon=env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon,"publicWishlists",share)));
  await assertSucceeds(getDocs(collection(anon,"publicWishlists",share,"items")));
  await assertFails(getDoc(doc(anon,"lists/list1")));
  await assertFails(getDoc(doc(anon,"reservationSecrets",share)));
  await assertFails(getDocs(collection(anon,"reservations",share,"items")));
});

test("password verifier cannot be read by viewers or the list owner",async()=>{
  await seed({withSecret:true});
  await assertFails(getDoc(doc(env.authenticatedContext("buyer").firestore(),"reservationSecrets",share)));
  await assertFails(getDoc(doc(env.authenticatedContext("owner").firestore(),"reservationSecrets",share)));
});

async function claimBatch(uid,holderName="First Viewer"){
  const db=env.authenticatedContext(uid,{email:uid+"@example.test"}).firestore();
  const freshSalt="fedcba9876543210fedcba9876543210";
  const hash=scryptSync("Wishly claim password 2026!",freshSalt,64,{N:16384,r:8,p:1}).toString("hex");
  const batch=writeBatch(db);
  batch.set(doc(db,"reservationSecrets",share),{holderUid:uid,holderName,salt:freshSalt,passwordHash:hash,createdAt:serverTimestamp()});
  batch.update(doc(db,"lists/list1"),{reservationProtectionActivated:true,passwordHolderName:holderName,reservationSalt:freshSalt});
  batch.update(doc(db,"publicWishlists",share),{passwordProtectionActive:true,reservationSalt:freshSalt});
  batch.set(doc(db,"reservationAccess",share+"_"+uid),{uid,shareId:share,challengeId:"password-holder",grantedAt:serverTimestamp()});
  return batch.commit();
}

test("the first eligible viewer permanently claims the password and gets access",async()=>{
  await seed();
  await assertSucceeds(claimBatch("holder"));
  const db=env.authenticatedContext("holder",{email:"holder@example.test"}).firestore();
  await assertSucceeds(getDoc(doc(db,"reservationAccess",share+"_holder")));
  await assertFails(claimBatch("buyer","A Later Viewer"));
});

test("anonymous Firebase sessions cannot unlock reservations",async()=>{
  await seed({withSecret:true});
  await assertFails(unlockBatch("anon","anonymous-challenge",{token:{email:null}}));
});

test("incorrect password proof is rejected",async()=>{
  await seed({withSecret:true});
  await assertFails(unlockBatch("buyer","wrong-password-challenge",{password:"not the right password"}));
});

test("a valid one-time proof creates one access grant",async()=>{
  await seed({withSecret:true});
  await assertSucceeds(unlockBatch("buyer","valid-challenge"));
  const buyer=env.authenticatedContext("buyer").firestore();
  await assertSucceeds(getDoc(doc(buyer,"reservationAccess",share+"_buyer")));
  await assertSucceeds(getDocs(collection(buyer,"reservations",share,"items")));
});

test("a captured proof cannot be replayed for a new challenge or another UID",async()=>{
  await seed({withSecret:true});
  const captured=proofFor("buyer","original-challenge");
  await assertSucceeds(unlockBatch("buyer","original-challenge",{proof:captured}));
  await assertFails(unlockBatch("buyer2","replay-as-other-uid",{proof:captured}));
  await assertFails(unlockBatch("buyer","replay-new-challenge",{proof:captured}));
  await assertFails(unlockBatch("buyer","original-challenge",{proof:captured}));
});

test("expired challenge timestamps are rejected",async()=>{
  await seed({withSecret:true});
  const old=Timestamp.fromMillis(Date.now()-10*60*1000);
  await assertFails(unlockBatch("buyer","expired-challenge",{createdAt:old}));
});

test("the actual wishlist owner cannot unlock or read reservation records",async()=>{
  await seed({withSecret:true});
  await assertFails(unlockBatch("owner","owner-challenge"));
  const owner=env.authenticatedContext("owner").firestore();
  await assertFails(getDocs(collection(owner,"reservations",share,"items")));
});

test("only the reservation owner can cancel; competing reservations cannot overwrite",async()=>{
  await seed({withSecret:true});
  await assertSucceeds(unlockBatch("buyer","buyer-access"));
  const buyer=env.authenticatedContext("buyer").firestore();
  const other=env.authenticatedContext("other").firestore();
  await assertFails(deleteDoc(doc(other,"reservations",share,"items","gift1")));
  await assertFails(setDoc(doc(buyer,"reservations",share,"items","gift1"),{reservedBy:"buyer",createdAt:serverTimestamp()}));
  await assertSucceeds(deleteDoc(doc(buyer,"reservations",share,"items","gift1")));
});

test("simultaneous unlock attempts for one UID produce only one grant",async()=>{
  await seed({withSecret:true});
  const outcomes=await Promise.allSettled([
    unlockBatch("buyer","simultaneous-a"),
    unlockBatch("buyer","simultaneous-b")
  ]);
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
  const db=env.authenticatedContext("buyer").firestore();
  await assertSucceeds(getDoc(doc(db,"reservationAccess",share+"_buyer")));
});
