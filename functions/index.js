const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {initializeApp}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const crypto=require("node:crypto");

initializeApp();
const db=getFirestore();
const fail=(code,message)=>{throw new HttpsError(code,message)};
const hash=(password,salt)=>new Promise((resolve,reject)=>{
  crypto.scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(key.toString("hex")));
});

async function listFor(shareId){
  if(typeof shareId!=="string"||shareId.trim().length<30||shareId.length>200){
    fail("invalid-argument","That wishlist share link or code is invalid.");
  }
  const matches=await db.collection("lists").where("shareId","==",shareId.trim()).limit(1).get();
  if(matches.empty)fail("not-found","We couldn't find a wishlist with that share link or code.");
  const list=matches.docs[0];
  if(list.data().visibility!=="public")fail("permission-denied","This wishlist is private.");
  return list;
}

exports.getPublicWishlist=onCall(async request=>{
  try{
    const list=await listFor(request.data?.shareId);
    const data=list.data();
    const items=await list.ref.collection("items").get();
    const isOwner=!!request.auth&&request.auth.uid===data.ownerUid;
    return {
      title:String(data.title||""),
      description:String(data.description||""),
      occasion:String(data.occasion||""),
      eventDate:data.eventDate||null,
      isOwner,
      passwordProtectionActive:!!data.reservationProtectionActivated,
      passwordHolderName:isOwner?(data.passwordHolderName||null):null,
      items:items.docs.map(snapshot=>{
        const item=snapshot.data();
        return {
          id:snapshot.id,
          name:String(item.name||""),
          description:String(item.description||""),
          imageUrl:typeof item.imageUrl==="string"?item.imageUrl:"",
          purchaseUrl:typeof item.purchaseUrl==="string"?item.purchaseUrl:"",
          price:typeof item.price==="number"&&Number.isFinite(item.price)?item.price:null
        };
      })
    };
  }catch(error){
    if(error instanceof HttpsError)throw error;
    console.error("getPublicWishlist failed:",error);
    throw new HttpsError("internal","Wishly couldn't load this wishlist. Please try again.");
  }
});

exports.claimReservationPassword=onCall(async request=>{
  if(!request.auth)fail("unauthenticated","Log in to continue.");
  const {shareId,password}=request.data||{};
  if(typeof password!=="string"||password.length<8||password.length>128)fail("invalid-argument","Use a password between 8 and 128 characters.");
  const list=await listFor(shareId);
  if(list.data().ownerUid===request.auth.uid)fail("permission-denied","The list creator cannot become the password holder.");
  const secretRef=db.collection("reservationSecrets").doc(shareId);
  const salt=crypto.randomBytes(16).toString("hex");
  const passwordHash=await hash(password,salt);
  const user=await db.collection("users").doc(request.auth.uid).get();
  const holderName=user.exists?user.data().displayName:"Wishly viewer";
  let claimed=false;
  await db.runTransaction(async transaction=>{
    const existing=await transaction.get(secretRef);
    if(existing.exists)return;
    transaction.create(secretRef,{holderUid:request.auth.uid,holderName,salt,passwordHash,createdAt:FieldValue.serverTimestamp()});
    claimed=true;
  });
  if(!claimed)fail("already-exists","A reservation password has already been created. Ask the first visitor for it.");
  await list.ref.update({reservationProtectionActivated:true,passwordHolderName:holderName});
  const accessId=crypto.createHash("sha256").update(shareId+request.auth.uid).digest("hex");
  await db.collection("reservationAccess").doc(accessId).set({uid:request.auth.uid,shareId,grantedAt:FieldValue.serverTimestamp()});
  return {success:true};
});

exports.unlockReservations=onCall(async request=>{
  if(!request.auth)fail("unauthenticated","Log in to continue.");
  const list=await listFor(request.data?.shareId);
  if(list.data().ownerUid===request.auth.uid)fail("permission-denied","Reservation details are hidden from the list creator.");
  const secret=await db.collection("reservationSecrets").doc(request.data.shareId).get();
  if(!secret.exists)fail("failed-precondition","Reservation protection has not been activated.");
  const data=secret.data();
  const actual=Buffer.from(await hash(String(request.data.password||""),data.salt),"hex");
  const expected=Buffer.from(data.passwordHash,"hex");
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))fail("permission-denied","Incorrect reservation password.");
  const accessId=crypto.createHash("sha256").update(request.data.shareId+request.auth.uid).digest("hex");
  await db.collection("reservationAccess").doc(accessId).set({uid:request.auth.uid,shareId:request.data.shareId,grantedAt:FieldValue.serverTimestamp()});
  const reservations=await db.collection("reservations").doc(request.data.shareId).collection("items").get();
  return {statuses:reservations.docs.map(item=>({itemId:item.id,reserved:true,mine:item.data().reservedBy===request.auth.uid}))};
});

exports.getReservationStatuses=onCall(async request=>{
  if(!request.auth)fail("unauthenticated","Log in to continue.");
  const list=await listFor(request.data?.shareId);
  if(list.data().ownerUid===request.auth.uid)fail("permission-denied","Reservation details are hidden from the list creator.");
  const accessId=crypto.createHash("sha256").update(request.data.shareId+request.auth.uid).digest("hex");
  const grant=await db.collection("reservationAccess").doc(accessId).get();
  if(!grant.exists)fail("permission-denied","Enter the reservation password first.");
  const reservations=await db.collection("reservations").doc(request.data.shareId).collection("items").get();
  return {statuses:reservations.docs.map(item=>({itemId:item.id,reserved:true,mine:item.data().reservedBy===request.auth.uid}))};
});

exports.reserveGift=onCall(async request=>{
  if(!request.auth)fail("unauthenticated","Log in to reserve a gift.");
  const list=await listFor(request.data?.shareId);
  if(list.data().ownerUid===request.auth.uid)fail("permission-denied","The list creator cannot reserve gifts on their own list.");
  const itemId=String(request.data.itemId||"");
  if(!itemId||itemId.length>150)fail("invalid-argument","Invalid item.");
  const item=await list.ref.collection("items").doc(itemId).get();
  if(!item.exists)fail("not-found","That item no longer exists.");
  const reservationRef=db.collection("reservations").doc(request.data.shareId).collection("items").doc(itemId);
  await db.runTransaction(async transaction=>{
    const existing=await transaction.get(reservationRef);
    if(existing.exists)fail("already-exists","Someone has already reserved this gift.");
    transaction.create(reservationRef,{reservedBy:request.auth.uid,createdAt:FieldValue.serverTimestamp()});
  });
  return {success:true};
});

exports.cancelReservation=onCall(async request=>{
  if(!request.auth)fail("unauthenticated","Log in to continue.");
  const shareId=request.data?.shareId;
  const itemId=String(request.data?.itemId||"");
  const list=await listFor(shareId);
  if(list.data().ownerUid===request.auth.uid)fail("permission-denied","The list creator cannot cancel another person's reservation.");
  const reservationRef=db.collection("reservations").doc(shareId).collection("items").doc(itemId);
  await db.runTransaction(async transaction=>{
    const reservation=await transaction.get(reservationRef);
    if(!reservation.exists)fail("not-found","Reservation not found.");
    if(reservation.data().reservedBy!==request.auth.uid)fail("permission-denied","You can only cancel your own reservation.");
    transaction.delete(reservationRef);
  });
  return {success:true};
});
