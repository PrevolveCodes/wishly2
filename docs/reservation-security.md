# Wishly reservation password security notes

## Implementation

Wishly2 keeps its existing public/private wishlist layout and uses these Firestore collections for reservations:

- `reservationSecrets/{shareId}`: the permanent password holder, random salt, and scrypt verifier. Client reads are denied.
- `reservationChallenges/{challengeId}`: a one-time, UID- and wishlist-bound proof. Client reads, updates, and deletes are denied.
- `reservationAccess/{shareId_uid}`: a permanent per-account grant. Only that account can read its own grant.
- `reservations/{shareId}/items/{itemId}`: reservation records, readable only by a Wishly account with a grant.

The first signed-in Wishly account to claim the password creates the secret, updates the owner's private list metadata, publishes the salt, and receives its own grant in one atomic batch. Firestore Rules enforce the first-claim condition.

Other viewers derive the verifier in their browser using scrypt with the same parameters as the former Node implementation: N=16384, r=8, p=1, output length 64 bytes. They submit a proof calculated from the verifier, a fresh random nonce, their Firebase UID, the share ID, and a new challenge document ID. Firestore Rules compare that proof to the hidden verifier and require the challenge and access grant to be created atomically. Challenges are immutable and unreadable after creation.

Reservation status reads, reserve operations, and cancellation are all authorized by Firestore Rules. The JavaScript interface is not the security boundary. Email-based Wishly accounts are required; public browsing remains unauthenticated.

## Known security limitations

A captured successful challenge proof can be used for offline password guessing. An attacker who captures the proof, knows the public salt and challenge fields, and has a candidate password can derive that candidate's scrypt verifier and compare the expected SHA-256 proof. Scrypt makes each guess expensive; it does not make offline guessing impossible. Require a password of at least 12 characters, preferably a long, unique passphrase. Do not reuse an email or account password.

The design does not provide a PAKE and does not rate-limit offline guesses. A proof is bound to one UID, share ID, nonce, and challenge ID, and cannot be replayed to create another grant after the original challenge is consumed. A thief who captures a valid proof and can act as the same Firebase account before the legitimate request commits may race to redeem it; Firebase account compromise is outside this mechanism.

The actual list-owner UID is blocked from receiving a grant or reading reservations. Firebase cannot determine whether a separate account belongs to the same human, so an alternate account belonging to the owner cannot be reliably identified.

The first password holder is permanent. If that person loses the password, there is no password-reset workflow in this architecture.

## Verification

Run `npm install`, then `npm run test:crypto` and `npm run test:emulator`. The GitHub Actions workflow runs both checks on the repair branch and pull request. Do not deploy the rules until the emulator suite is green and the final rules have been reviewed.
