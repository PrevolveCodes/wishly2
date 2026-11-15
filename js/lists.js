import {auth,db} from "./firebase.js";
import {onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  collection,addDoc,query,where,getDocs,doc,getDoc,updateDoc,deleteDoc,writeBatch,
  serverTimestamp,increment,onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeUrl=value=>{
  try{
    const url=new URL(String(value||"").trim());
    return url.protocol==="https:"||url.protocol==="http:"?url.href:"";
  }catch{return ""}
};

let user=null;
onAuthStateChanged(auth,u=>{
  if(!u){location.replace("login.html");return}
  user=u;
  if($("all-lists"))loadAll();
  if($("list-detail"))loadOne();
});

$("logout")?.addEventListener("click",()=>signOut(auth).then(()=>location.href="index.html"));

$("create-list")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const message=$("message"),button=event.currentTarget.querySelector('button[type="submit"]');
  button.disabled=true;
  message.textContent="Creating your list…";
  try{
    const ref=await addDoc(collection(db,"lists"),{
      ownerUid:user.uid,title:$("title").value.trim(),description:$("description").value.trim(),
      occasion:$("occasion").value.trim(),eventDate:$("eventDate").value||null,
      visibility:$("visibility").value,
      shareId:crypto.randomUUID()+crypto.randomUUID().replaceAll("-",""),
      itemCount:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
    });
    location.href="list.html?id="+encodeURIComponent(ref.id);
  }catch(error){message.textContent=error.message||"Couldn't create your list.";button.disabled=false}
});

async function loadAll(){
  try{
    const snapshot=await getDocs(query(collection(db,"lists"),where("ownerUid","==",user.uid)));
    $("all-lists").innerHTML=snapshot.empty
      ?'<div class="empty-state"><div class="empty-symbol">＋</div><h3>No lists yet</h3><p>Create a list to start collecting wishes.</p><a class="button button-dark" href="make-list.html">Make a list</a></div>'
      :snapshot.docs.map(d=>{
        const data=d.data();
        return `<a class="list-card" href="list.html?id=${encodeURIComponent(d.id)}"><span class="list-card-icon">♡</span><b>${esc(data.title)}</b><small>${Number(data.itemCount)||0} items · ${data.visibility==="public"?"Public":"Private"}</small></a>`;
      }).join("");
  }catch(error){$("message").textContent=error.message||"Couldn't load your lists."}
}

async function loadOne(){
  const id=new URLSearchParams(location.search).get("id");
  const root=$("list-detail");
  if(!id){root.textContent="List not found.";return}
  const listRef=doc(db,"lists",id);
  try{
    const snapshot=await getDoc(listRef);
    if(!snapshot.exists()||snapshot.data().ownerUid!==user.uid){root.textContent="This list isn't available.";return}
    let listData=snapshot.data();
    const itemsRef=collection(listRef,"items");
    let itemRows=[];
    const editingItems=new Set();
    let stopItems=null;

    function renderItems(){
      const host=$("owner-items");
      if(!host)return;
      host.innerHTML=itemRows.length?itemRows.map(item=>{
        const image=safeUrl(item.imageUrl);
        const purchase=safeUrl(item.purchaseUrl);
        return `<article class="owner-item" data-owner-item="${esc(item.id)}">
          <div class="owner-item-main">
            ${image?`<img class="owner-item-image" src="${esc(image)}" alt="" loading="lazy">`:""}
            <div class="owner-item-copy">
              <b>${esc(item.name)}</b>
              ${item.description?`<small>${esc(item.description)}</small>`:""}
              ${item.price!=null&&Number.isFinite(Number(item.price))?`<small>$${Number(item.price).toFixed(2)}</small>`:""}
              ${purchase?`<a class="purchase-link" href="${esc(purchase)}" target="_blank" rel="noopener noreferrer">View product ↗</a>`:""}
            </div>
          </div>
          <div class="owner-item-actions"><button class="small-danger" data-edit-item="${esc(item.id)}" ${editingItems.has(item.id)?"disabled":""}>Edit</button> <button class="small-danger" data-delete-item="${esc(item.id)}" ${editingItems.has(item.id)?"disabled":""}>Remove</button></div>
        </article>`;
      }).join(""):'<p class="muted">No items yet.</p>';
      host.querySelectorAll("[data-edit-item]").forEach(button=>button.addEventListener("click",()=>editItem(button.dataset.editItem,button)));
      host.querySelectorAll("[data-delete-item]").forEach(button=>button.addEventListener("click",()=>removeItem(button.dataset.deleteItem,button)));
    }

    function renderShell(){
      root.innerHTML=`<div class="page-heading"><div><span class="eyebrow">LIST DETAILS</span><h1 class="page-title" id="list-title">${esc(listData.title)}</h1><p id="list-description">${esc(listData.description)}</p></div><button class="button button-quiet" id="share">Copy share link</button></div>
      ${listData.passwordHolderName?'<div class="notice"><b>Reservation protection activated</b><p>The first person to open your wishlist is <b>'+esc(listData.passwordHolderName)+'</b>.</p><p>Tell gift buyers to contact this person for the reservation password. Your reservation statuses are hidden from you.</p></div>':""}
      <form id="edit-list" class="panel form-stack">
        <label>Title<input class="app-input" id="edit-title" value="${esc(listData.title)}" required></label>
        <label>Description<textarea class="app-input" id="edit-description" rows="2">${esc(listData.description)}</textarea></label>
        <div class="two-fields"><label>Occasion<input class="app-input" id="edit-occasion" value="${esc(listData.occasion)}"></label><label>Event date<input class="app-input" type="date" id="edit-date" value="${esc(listData.eventDate)}"></label></div>
        <label>Visibility<select class="app-input" id="edit-visibility"><option value="public" ${listData.visibility==="public"?"selected":""}>Anyone with the link</option><option value="private" ${listData.visibility==="private"?"selected":""}>Only me</option></select></label>
        <button class="button button-dark" type="submit">Save changes</button><p class="form-message" id="edit-message"></p>
      </form>
      <div class="section-heading"><div><h2>Wishlist items</h2><p>Add the things you’d love to receive.</p></div></div>
      <div class="panel"><form id="add-item" class="form-stack">
        <label>Item name<input class="app-input" id="item-name" required maxlength="120"></label>
        <label>Description<input class="app-input" id="item-desc" maxlength="400"></label>
        <label>Image URL<input class="app-input" id="item-image" type="url" placeholder="https://…"></label>
        <label>Purchase URL<input class="app-input" id="item-url" type="url" placeholder="https://…"></label>
        <label>Price<input class="app-input" id="item-price" type="number" min="0" step=".01"></label>
        <button class="button button-dark" type="submit">Add item</button><p class="form-message" id="item-message" role="status"></p>
      </form></div>
      <div class="owner-items" id="owner-items"><div class="skeleton"></div></div>
      <button class="danger-button" id="delete-list">Delete this list</button>`;

      $("share").onclick=async()=>{
        const url=location.origin+location.pathname.replace("list.html","wishlist.html")+"?share="+encodeURIComponent(listData.shareId);
        try{await navigator.clipboard.writeText(url);$("share").textContent="Copied!"}
        catch{$("share").textContent="Copy unavailable";$("edit-message").textContent=url}
      };

      $("edit-list").onsubmit=async event=>{
        event.preventDefault();
        const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),message=$("edit-message");
        const previous={...listData};
        const next={...listData,title:$("edit-title").value.trim(),description:$("edit-description").value.trim(),occasion:$("edit-occasion").value.trim(),eventDate:$("edit-date").value||null,visibility:$("edit-visibility").value};
        listData=next;
        $("list-title").textContent=next.title;
        $("list-description").textContent=next.description;
        button.disabled=true;message.textContent="Saving…";
        try{
          await updateDoc(listRef,{title:next.title,description:next.description,occasion:next.occasion,eventDate:next.eventDate,visibility:next.visibility,updatedAt:serverTimestamp()});
          message.textContent="Saved.";message.classList.add("success");
        }catch(error){
          listData=previous;
          $("edit-title").value=previous.title;$("edit-description").value=previous.description;$("edit-occasion").value=previous.occasion;$("edit-date").value=previous.eventDate||"";$("edit-visibility").value=previous.visibility;
          $("list-title").textContent=previous.title;$("list-description").textContent=previous.description;
          message.textContent=error.message||"Couldn't save your changes.";message.classList.remove("success");
        }finally{button.disabled=false}
      };

      $("add-item").onsubmit=async event=>{
        event.preventDefault();
        const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),message=$("item-message");
        const name=$("item-name").value.trim();
        const imageUrl=$("item-image").value.trim();
        const purchaseUrl=$("item-url").value.trim();
        if(imageUrl&&!safeUrl(imageUrl)){message.textContent="Enter a valid image URL starting with http:// or https://.";return}
        if(purchaseUrl&&!safeUrl(purchaseUrl)){message.textContent="Enter a valid purchase URL starting with http:// or https://.";return}
        const priceText=$("item-price").value;
        const price=priceText===""?null:Number(priceText);
        if(price!==null&&(!Number.isFinite(price)||price<0)){message.textContent="Enter a valid price.";return}
        const newRef=doc(itemsRef);
        const item={id:newRef.id,name,description:$("item-desc").value.trim(),imageUrl,purchaseUrl,price,createdAt:serverTimestamp()};
        button.disabled=true;message.textContent="Adding…";
        try{
          const batch=writeBatch(db);
          batch.set(newRef,item);
          batch.update(listRef,{itemCount:increment(1),updatedAt:serverTimestamp()});
          await batch.commit();
          form.reset();message.textContent="Item added.";message.classList.add("success");
        }catch(error){message.textContent=error.message||"Couldn't add this item.";message.classList.remove("success")}
        finally{button.disabled=false}
      };

      $("delete-list").onclick=async()=>{
        if(!confirm("Delete this list? This cannot be undone."))return;
        const button=$("delete-list");button.disabled=true;
        try{
          const current=await getDocs(itemsRef);
          await Promise.all(current.docs.map(item=>deleteDoc(item.ref)));
          await deleteDoc(listRef);
          location.href="my-lists.html";
        }catch(error){button.disabled=false;alert(error.message||"Couldn't delete this list.")}
      };
    }

    async function editItem(itemId,button){
      const current=itemRows.find(item=>item.id===itemId);
      if(!current||editingItems.has(itemId))return;
      editingItems.add(itemId);
      renderItems();
      try{
        const name=prompt("Item name",current.name||"");if(name===null)return;
        const description=prompt("Description",current.description||"");if(description===null)return;
        const imageUrl=prompt("Image URL",current.imageUrl||"");if(imageUrl===null)return;
        const purchaseUrl=prompt("Purchase URL",current.purchaseUrl||"");if(purchaseUrl===null)return;
        const priceText=prompt("Price (leave blank for none)",current.price??"");if(priceText===null)return;
        const cleanImage=imageUrl.trim(),cleanPurchase=purchaseUrl.trim();
        if(cleanImage&&!safeUrl(cleanImage)){alert("Enter a valid image URL starting with http:// or https://.");return}
        if(cleanPurchase&&!safeUrl(cleanPurchase)){alert("Enter a valid purchase URL starting with http:// or https://.");return}
        const price=priceText.trim()===""?null:Number(priceText);
        if(price!==null&&(!Number.isFinite(price)||price<0)){alert("Enter a valid price.");return}
        const patch={name:name.trim(),description:description.trim(),imageUrl:cleanImage,purchaseUrl:cleanPurchase,price};
        await updateDoc(doc(itemsRef,itemId),patch);
      }catch(error){
        alert(error.message||"Couldn't update this item. Your previous item data has been restored.");
      }finally{
        editingItems.delete(itemId);
        renderItems();
      }
    }
    async function removeItem(itemId,button){
      if(!confirm("Remove this item?"))return;
      button.disabled=true;
      try{
        const batch=writeBatch(db);
        batch.delete(doc(itemsRef,itemId));
        batch.update(listRef,{itemCount:increment(-1),updatedAt:serverTimestamp()});
        await batch.commit();
      }catch(error){button.disabled=false;alert(error.message||"Couldn't remove this item.")}
    }

    renderShell();
    stopItems=onSnapshot(itemsRef,itemsSnapshot=>{
      itemRows=itemsSnapshot.docs.map(item=>({id:item.id,...item.data()}));
      renderItems();
    },error=>{$("owner-items").textContent=error.message||"Couldn't load wishlist items."});
    window.addEventListener("pagehide",()=>stopItems?.(),{once:true});
  }catch(error){root.textContent="Couldn't load this list: "+(error.message||"Please try again.")}
}
