import test, {before, after} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash, scryptSync, randomBytes} from "node:crypto";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from "@firebase/rules-unit-testing";
import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";

const projectId = "demo-wishly2";
const share = "share_012345678901234567890123456789";
const share2 = "share_112345678901234567890123456789";
const salt = "0123456789abcdef0123456789abcdef";
const password = "Wishly test passphrase 2026!";
const passwordHash = scryptSync(password, salt, 64, {
  N: 16384,
  r: 8,
  p: 1
}).toString("hex");

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {rules: await readFile("firestore.rules", "utf8")}
  });
});

after(async () => {
  await env.cleanup();
});

function accountDb(uid, extraClaims = {}) {
  return env.authenticatedContext(uid, {
    email: `${uid}@example.test`,
    email_verified: true,
    ...extraClaims
  }).firestore();
}

async function seed({withSecret = false} = {}) {
  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await setDoc(doc(db, "lists/list1"), {
      ownerUid: "owner",
      shareId: share,
      visibility: "public",
      title: "Test list"
    });
    await setDoc(doc(db, "lists/list2"), {
      ownerUid: "owner",
      shareId: share2,
      visibility: "public",
      title: "Second public list"
    });
    await setDoc(doc(db, "lists/privateList"), {
      ownerUid: "owner",
      shareId: "private_share_012345678901234567890",
      visibility: "private",
      title: "Private list"
    });

    await setDoc(doc(db, "publicWishlistIndex", share), {listId: "list1"});
    await setDoc(doc(db, "publicWishlistIndex", share2), {listId: "list2"});
    await setDoc(doc(db, "publicWishlistIndex/private_share_012345678901234567890"), {
      listId: "privateList"
    });

    await setDoc(doc(db, "publicWishlists", share), {
      title: "Test list",
      description: "",
      occasion: "",
      eventDate: null,
      passwordProtectionActive: withSecret,
      mirrorVersion: 1,
      reservationSalt: withSecret ? salt : null
    });
    await setDoc(doc(db, "publicWishlists", share2), {
      title: "Second public list",
      description: "",
      occasion: "",
      eventDate: null,
      passwordProtectionActive: withSecret,
      mirrorVersion: 1,
      reservationSalt: withSecret ? salt : null
    });
    await setDoc(doc(db, "publicWishlists/private_share_012345678901234567890"), {
      title: "Private list",
      description: "",
      occasion: "",
      eventDate: null,
      passwordProtectionActive: false,
      mirrorVersion: 1,
      reservationSalt: null
    });

    await setDoc(doc(db, "publicWishlists", share, "items", "gift1"), {
      name: "Already reserved gift",
      description: "",
      imageUrl: "",
      purchaseUrl: "",
      price: null
    });
    await setDoc(doc(db, "publicWishlists", share, "items", "gift2"), {
      name: "Available gift",
      description: "",
      imageUrl: "",
      purchaseUrl: "",
      price: null
    });
    await setDoc(doc(db, "publicWishlists", share2, "items", "gift3"), {
      name: "Gift on second list",
      description: "",
      imageUrl: "",
      purchaseUrl: "",
      price: null
    });

    for (const [uid, displayName] of [
      ["holder", "First Viewer"],
      ["owner", "List Owner"],
      ["buyer", "Gift Buyer"],
      ["buyer2", "Second Buyer"],
      ["other", "Other Buyer"]
    ]) {
      await setDoc(doc(db, "users", uid), {
        displayName,
        email: `${uid}@example.test`
      });
    }

    if (withSecret) {
      for (const shareId of [share, share2]) {
        await setDoc(doc(db, "reservationSecrets", shareId), {
          holderUid: "holder",
          holderName: "First Viewer",
          salt,
          passwordHash,
          createdAt: Timestamp.now()
        });
      }
    }

    await setDoc(doc(db, "reservations", share, "items", "gift1"), {
      reservedBy: "buyer",
      createdAt: Timestamp.now()
    });
  });
}

function proofFor(uid, challengeId, {
  password: candidatePassword = password,
  shareId = share,
  nonce = randomBytes(32).toString("hex")
} = {}) {
  const verifier = scryptSync(candidatePassword, salt, 64, {
    N: 16384,
    r: 8,
    p: 1
  }).toString("hex");

  const proof = createHash("sha256")
    .update(`${verifier}|${nonce}|${uid}|${shareId}|${challengeId}`)
    .digest("hex")
    .toUpperCase();

  return {nonce, proof};
}

async function unlockBatch(uid, challengeId, options = {}) {
  const shareId = options.shareId || share;
  const db = options.db || accountDb(uid);
  const proof = options.proof || proofFor(uid, challengeId, {
    password: options.password,
    shareId
  });
  const payloadShareId = options.payloadShareId || shareId;

  const batch = writeBatch(db);
  batch.set(doc(db, "reservationChallenges", challengeId), {
    shareId: payloadShareId,
    uid: options.payloadUid || uid,
    nonce: options.nonce || proof.nonce,
    proof: proof.proof,
    consumed: options.consumed ?? true,
    createdAt: options.createdAt || serverTimestamp()
  });
  batch.set(doc(db, "reservationAccess", `${shareId}_${uid}`), {
    uid: options.payloadUid || uid,
    shareId: payloadShareId,
    challengeId,
    grantedAt: serverTimestamp()
  });

  return batch.commit();
}

test("public visitors can browse public mirrors but cannot read private or reservation data", async () => {
  await seed();
  const anon = env.unauthenticatedContext().firestore();
  const buyer = accountDb("buyer");
  const owner = accountDb("owner");

  await assertSucceeds(getDoc(doc(anon, "publicWishlists", share)));
  await assertSucceeds(getDocs(collection(anon, "publicWishlists", share, "items")));
  await assertSucceeds(getDoc(doc(anon, "publicWishlistIndex", share)));

  await assertSucceeds(getDoc(doc(owner, "lists/list1")));
  await assertSucceeds(getDoc(doc(owner, "lists/privateList")));
  await assertFails(getDoc(doc(anon, "lists/list1")));
  await assertFails(getDoc(doc(buyer, "lists/privateList")));
  await assertFails(getDoc(doc(anon, "publicWishlists/private_share_012345678901234567890")));
  await assertFails(getDoc(doc(anon, "publicWishlistIndex/private_share_012345678901234567890")));

  await assertFails(getDoc(doc(anon, "reservationSecrets", share)));
  await assertFails(getDocs(collection(anon, "reservations", share, "items")));
  await assertFails(getDocs(collection(buyer, "reservations", share, "items")));
});

test("the password verifier and challenge documents are never readable by clients", async () => {
  await seed({withSecret: true});
  const anon = env.unauthenticatedContext().firestore();

  for (const db of [anon, accountDb("holder"), accountDb("buyer"), accountDb("owner")]) {
    await assertFails(getDoc(doc(db, "reservationSecrets", share)));
    await assertFails(getDoc(doc(db, "reservationChallenges", "not-created")));
  }

  await assertFails(updateDoc(doc(accountDb("holder"), "reservationSecrets", share), {
    passwordHash: "0".repeat(128)
  }));
  await assertFails(deleteDoc(doc(accountDb("holder"), "reservationSecrets", share)));

  const publicData = (await getDoc(doc(anon, "publicWishlists", share))).data();
  for (const forbidden of ["passwordHash", "reservationStatuses", "reservationCount", "holderUid"]) {
    assert.equal(Object.hasOwn(publicData, forbidden), false, `public mirror must not contain ${forbidden}`);
  }
});

async function claimBatch(uid, holderName = "First Viewer") {
  const db = accountDb(uid);
  const freshSalt = "fedcba9876543210fedcba9876543210";
  const hash = scryptSync("Wishly claim password 2026!", freshSalt, 64, {
    N: 16384,
    r: 8,
    p: 1
  }).toString("hex");

  const batch = writeBatch(db);
  batch.set(doc(db, "reservationSecrets", share), {
    holderUid: uid,
    holderName,
    salt: freshSalt,
    passwordHash: hash,
    createdAt: serverTimestamp()
  });
  batch.update(doc(db, "lists/list1"), {
    reservationProtectionActivated: true,
    passwordHolderName: holderName,
    reservationSalt: freshSalt
  });
  batch.update(doc(db, "publicWishlists", share), {
    passwordProtectionActive: true,
    reservationSalt: freshSalt
  });
  batch.set(doc(db, "reservationAccess", `${share}_${uid}`), {
    uid,
    shareId: share,
    challengeId: "password-holder",
    grantedAt: serverTimestamp()
  });

  return batch.commit();
}

test("the first eligible Wishly account permanently claims the password and receives access", async () => {
  await seed();
  await assertSucceeds(claimBatch("holder"));

  const holder = accountDb("holder");
  await assertSucceeds(getDoc(doc(holder, "reservationAccess", `${share}_holder`)));
  await assertFails(claimBatch("buyer", "A Later Viewer"));

  const ownerList = (await getDoc(doc(accountDb("owner"), "lists/list1"))).data();
  assert.equal(ownerList.passwordHolderName, "First Viewer");
  for (const forbidden of ["passwordHash", "reservationStatuses", "reservationCount", "passwordHolderUid"]) {
    assert.equal(Object.hasOwn(ownerList, forbidden), false);
  }
});

test("simultaneous first claims permanently select exactly one password holder", async () => {
  await seed();
  const results = await Promise.allSettled([
    claimBatch("holder", "First Viewer"),
    claimBatch("buyer", "Gift Buyer")
  ]);

  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);

  await env.withSecurityRulesDisabled(async context => {
    const secret = await getDoc(doc(context.firestore(), "reservationSecrets", share));
    assert.ok(["holder", "buyer"].includes(secret.data().holderUid));
  });
});

test("anonymous Firebase sessions cannot unlock reservations", async () => {
  await seed({withSecret: true});
  await assertFails(unlockBatch("anon", "anonymous-challenge", {
    db: accountDb("anon", {email: null, email_verified: false})
  }));
});

test("an incorrect password proof is rejected", async () => {
  await seed({withSecret: true});
  await assertFails(unlockBatch("buyer", "wrong-password-challenge", {
    password: "not the right password"
  }));
});

test("a valid challenge-specific proof creates one access grant", async () => {
  await seed({withSecret: true});
  const buyer = accountDb("buyer");

  await assertSucceeds(unlockBatch("buyer", "valid-challenge", {db: buyer}));
  await assertSucceeds(getDoc(doc(buyer, "reservationAccess", `${share}_buyer`)));
  await assertSucceeds(getDocs(collection(buyer, "reservations", share, "items")));
  await assertFails(getDoc(doc(buyer, "reservationChallenges", "valid-challenge")));
  await assertFails(updateDoc(doc(buyer, "reservationChallenges", "valid-challenge"), {
    consumed: false
  }));
  await assertFails(deleteDoc(doc(buyer, "reservationChallenges", "valid-challenge")));
});

test("a captured proof cannot be reused with another UID, share, nonce, or challenge ID", async () => {
  await seed({withSecret: true});
  const captured = proofFor("buyer", "original-challenge");

  await assertSucceeds(unlockBatch("buyer", "original-challenge", {proof: captured}));
  await assertFails(unlockBatch("buyer2", "replay-as-other-uid", {proof: captured}));
  await assertFails(unlockBatch("buyer", "replay-new-challenge", {proof: captured}));
  await assertFails(unlockBatch("buyer", "replay-altered-nonce", {
    proof: captured,
    nonce: "f".repeat(64)
  }));
  await assertFails(unlockBatch("buyer", "replay-on-other-share", {
    shareId: share2,
    proof: captured
  }));
  await assertFails(unlockBatch("buyer", "original-challenge", {proof: captured}));
});

test("challenge and grant creation must be one atomic batch; challenges are create-only", async () => {
  await seed({withSecret: true});
  const buyer = accountDb("buyer");
  const challengeId = "atomic-challenge";
  const proof = proofFor("buyer", challengeId);

  await assertFails(setDoc(doc(buyer, "reservationChallenges", challengeId), {
    shareId: share,
    uid: "buyer",
    nonce: proof.nonce,
    proof: proof.proof,
    consumed: true,
    createdAt: serverTimestamp()
  }));

  await assertFails(setDoc(doc(buyer, "reservationAccess", `${share}_buyer`), {
    uid: "buyer",
    shareId: share,
    challengeId,
    grantedAt: serverTimestamp()
  }));

  await assertFails(unlockBatch("buyer", "not-consumed-challenge", {consumed: false}));
  await assertSucceeds(unlockBatch("buyer", challengeId, {proof, db: buyer}));

  await assertFails(unlockBatch("buyer", challengeId, {proof: proofFor("buyer", challengeId), db: buyer}));
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    assert.equal((await getDoc(doc(db, "reservationChallenges", challengeId))).exists(), true);
    assert.equal((await getDoc(doc(db, "reservationAccess", `${share}_buyer`))).exists(), true);
    assert.equal((await getDoc(doc(db, "reservationChallenges", "not-consumed-challenge"))).exists(), false);
  });
});

test("challenge creation requires a server timestamp, not a stale client timestamp", async () => {
  await seed({withSecret: true});
  const old = Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);
  await assertFails(unlockBatch("buyer", "stale-timestamp-challenge", {createdAt: old}));
});

test("reservation access stops working when the wishlist becomes private", async () => {
  await seed({withSecret: true});
  await assertSucceeds(unlockBatch("buyer", "private-after-unlock"));

  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "lists/list1"), {
      ownerUid: "owner",
      shareId: share,
      visibility: "private",
      title: "Test list"
    });
  });

  const buyer = accountDb("buyer");
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, "publicWishlists", share)));
  await assertFails(getDocs(collection(anon, "publicWishlists", share, "items")));
  await assertFails(getDocs(collection(buyer, "reservations", share, "items")));
});

test("the actual wishlist owner cannot claim, unlock, or read reservation records", async () => {
  await seed();
  await assertFails(claimBatch("owner"));
  await seed({withSecret: true});
  await assertFails(unlockBatch("owner", "owner-challenge"));

  const owner = accountDb("owner");
  await assertFails(getDocs(collection(owner, "reservations", share, "items")));
  await assertFails(getDoc(doc(owner, "reservationAccess", `${share}_holder`)));
  await assertFails(getDoc(doc(owner, "reservationChallenges", "owner-challenge")));
});

test("a Wishly account without a grant cannot read or create reservations", async () => {
  await seed({withSecret: true});
  const buyer = accountDb("buyer");

  await assertFails(getDocs(collection(buyer, "reservations", share, "items")));
  await assertFails(setDoc(doc(buyer, "reservations", share, "items", "gift2"), {
    reservedBy: "buyer",
    createdAt: serverTimestamp()
  }));
});

test("a granted viewer can reserve an available public item", async () => {
  await seed({withSecret: true});
  const buyer = accountDb("buyer");
  await assertSucceeds(unlockBatch("buyer", "buyer-access", {db: buyer}));

  await assertSucceeds(setDoc(doc(buyer, "reservations", share, "items", "gift2"), {
    reservedBy: "buyer",
    createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(buyer, "reservations", share, "items", "missing-gift"), {
    reservedBy: "buyer",
    createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(buyer, "reservations", share, "items", "gift2"), {
    reservedBy: "buyer",
    createdAt: serverTimestamp()
  }));
});

test("only the reservation owner can cancel; another granted viewer cannot cancel or overwrite", async () => {
  await seed({withSecret: true});
  const buyer = accountDb("buyer");
  const other = accountDb("other");

  await assertSucceeds(unlockBatch("buyer", "buyer-access", {db: buyer}));
  await assertSucceeds(unlockBatch("other", "other-access", {db: other}));

  await assertFails(deleteDoc(doc(other, "reservations", share, "items", "gift1")));
  await assertFails(setDoc(doc(buyer, "reservations", share, "items", "gift1"), {
    reservedBy: "buyer",
    createdAt: serverTimestamp()
  }));
  await assertSucceeds(deleteDoc(doc(buyer, "reservations", share, "items", "gift1")));
});

test("simultaneous unlock attempts for one UID produce only one access grant", async () => {
  await seed({withSecret: true});
  const outcomes = await Promise.allSettled([
    unlockBatch("buyer", "simultaneous-a"),
    unlockBatch("buyer", "simultaneous-b")
  ]);

  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  await assertSucceeds(getDoc(doc(accountDb("buyer"), "reservationAccess", `${share}_buyer`)));
});

test("simultaneous reservations for one item allow exactly one buyer to win", async () => {
  await seed({withSecret: true});
  const buyer = accountDb("buyer");
  const buyer2 = accountDb("buyer2");

  await assertSucceeds(unlockBatch("buyer", "buyer-unlock", {db: buyer}));
  await assertSucceeds(unlockBatch("buyer2", "buyer2-unlock", {db: buyer2}));

  const attempts = await Promise.allSettled([
    setDoc(doc(buyer, "reservations", share, "items", "gift2"), {
      reservedBy: "buyer",
      createdAt: serverTimestamp()
    }),
    setDoc(doc(buyer2, "reservations", share, "items", "gift2"), {
      reservedBy: "buyer2",
      createdAt: serverTimestamp()
    })
  ]);

  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);

  await env.withSecurityRulesDisabled(async context => {
    const reservation = await getDoc(doc(context.firestore(), "reservations", share, "items", "gift2"));
    assert.ok(["buyer", "buyer2"].includes(reservation.data().reservedBy));
  });
});
