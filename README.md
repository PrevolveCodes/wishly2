# Wishly

A fresh wishlist application built with vanilla HTML, CSS, JavaScript, Firebase Authentication, Cloud Firestore, and callable Cloud Functions. The public website is branded only as **Wishly**.

## Deploy

1. Install Node.js 20+, Firebase CLI, and Git.
2. In Firebase Console for project `wishly2`, enable Email/Password and Google providers under Authentication → Sign-in method.
3. Add your GitHub Pages domain and any custom domain under Authentication → Settings → Authorized domains.
4. Create a Cloud Firestore database.
5. Upgrade the Firebase project to the Blaze plan before deploying Cloud Functions.
6. From the repository root run `firebase deploy --only firestore:rules,functions`.
7. Enable GitHub Pages from the repository's main branch and root folder.

The Firebase web config is in `js/firebase.js`. It is a public client configuration, not an administrative credential.

## Security architecture

- User profile and owner list management use Firestore rules scoped to the authenticated UID.
- Public list reads are served by the `getPublicWishlist` callable function, not direct public Firestore reads.
- Reservation secrets and reservation records deny all direct client reads and writes.
- Cloud Functions hash reservation passwords with per-list random salts and Node's scrypt implementation.
- The first signed-in non-owner visitor claims the password-holder role in a Firestore transaction.
- A successful password check creates a server-side account grant, so that visitor does not need to re-enter the password on every visit.
- Reservations are created atomically; a second reservation for the same item is rejected.
- The creator-facing list contains the password-holder display name only. Reservation statuses are not returned to the creator's account.

## Setup notes

Cloud Functions must be deployed before reservation features work. GitHub Pages does not run backend code; the static site calls deployed Firebase Functions directly. The current app includes list creation, editing, item management, sharing, auth, and the Families placeholder. Some reservation UI states may need further integration testing after deployment.

An alternate account cannot be reliably recognized as the same human as the list creator. The password holder must keep the password private.
