const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");
const { before, after, beforeEach, test } = require("node:test");

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "wishly2",
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8")
    }
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seedPublicList(shareId = "public-share") {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "lists/list-1"), {
      title: "Test list",
      ownerUid: "owner-1",
      shareId,
      visibility: "public"
    });
    await setDoc(doc(db, "publicWishlistIndex/" + shareId), { listId: "list-1" });
    await setDoc(doc(db, "publicWishlists/" + shareId), {
      title: "Test list",
      description: "",
      occasion: "",
      eventDate: "",
      passwordProtectionActive: false,
      mirrorVersion: 1
    });
  });
}

test("a list owner can read their own list", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "lists/list-1"), {
      title: "Private list",
      ownerUid: "owner-1",
      shareId: "private-share",
      visibility: "private"
    });
  });
  const db = testEnv.authenticatedContext("owner-1").firestore();
  await assertSucceeds(getDoc(doc(db, "lists/list-1")));
});

test("another signed-in user cannot read a private list document", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "lists/list-1"), {
      title: "Private list",
      ownerUid: "owner-1",
      shareId: "private-share",
      visibility: "private"
    });
  });
  const db = testEnv.authenticatedContext("viewer-1").firestore();
  await assertFails(getDoc(doc(db, "lists/list-1")));
});

test("an unauthenticated visitor can read a public share mirror", async () => {
  await seedPublicList();
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "publicWishlists/public-share")));
});

test("an unrelated visitor cannot read the hidden public-share index", async () => {
  await seedPublicList();
  const db = testEnv.authenticatedContext("viewer-1").firestore();
  await assertFails(getDoc(doc(db, "publicWishlistIndex/public-share")));
});

test("reservation verifier documents cannot be read or written by clients", async () => {
  const db = testEnv.authenticatedContext("viewer-1").firestore();
  await assertFails(getDoc(doc(db, "reservationSecrets/public-share")));
  await assertFails(setDoc(doc(db, "reservationSecrets/public-share"), {
    salt: "test-salt",
    verifier: "test-verifier"
  }));
});

test("reservation access grants cannot be read or written by clients under current rules", async () => {
  const db = testEnv.authenticatedContext("viewer-1").firestore();
  await assertFails(getDoc(doc(db, "reservationAccess/viewer-1_public-share")));
  await assertFails(setDoc(doc(db, "reservationAccess/viewer-1_public-share"), {
    uid: "viewer-1",
    shareId: "public-share"
  }));
});

test("reservation records cannot be read or written by clients under current rules", async () => {
  const db = testEnv.authenticatedContext("viewer-1").firestore();
  await assertFails(getDoc(doc(db, "reservations/public-share/items/item-1")));
  await assertFails(setDoc(doc(db, "reservations/public-share/items/item-1"), {
    uid: "viewer-1",
    status: "reserved"
  }));
});

// Positive challenge/grant/reservation tests are specified in
// RESERVATION-TEST-PLAN.md. They cannot be implemented accurately until the
// implementation defines the challenge document path and atomic write shape.
