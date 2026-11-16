# Wishly2 reservation test setup

This test setup runs the existing Wishly2 Firestore Rules against the Firestore Emulator. It does not deploy rules, connect to the live Wishly Firebase project, use Cloud Functions, or require a Blaze plan.

## Local requirements

- Node.js 20 or newer
- Java 21 (required by the Firestore Emulator)
- Internet access for the first dependency and emulator downloads

No Firebase login, Firebase project credentials, service-account key, or live Firebase configuration is needed.

## Local commands

Run these from the repository root:

```sh
npm install --no-audit --no-fund
npm run test:crypto
npm run test:emulator
```

Or run both checks with one command:

```sh
npm test
```

The first run downloads the Firestore Emulator. Later runs reuse the cached emulator download.

## What the commands do

- `test:crypto` checks that the browser-compatible Noble scrypt implementation derives the same 64-byte verifier as Node's scrypt using the Wishly parameters (N=16384, r=8, p=1).
- `test:emulator` starts only the Firestore Emulator on port 8080, loads the repository's `firestore.rules`, runs `tests/reservation.rules.test.js`, and shuts the emulator down.
- The explicit project ID `demo-wishly2` is a Firebase demo project ID. Emulator requests are isolated from the live `wishly2` project; attempts to reach non-emulated Firebase services for this demo project fail.

## GitHub Actions

The workflow at `.github/workflows/reservation-tests.yml` runs on pushes to `test/emulator-suite` and `reservation-password-repair`, pull requests targeting `main`, and manual runs from the Actions tab.

GitHub Actions installs Node 20 and Java 21, installs the pinned test dependencies, runs the crypto compatibility check, then starts the Firestore Emulator and runs the Rules tests. It needs no repository secrets or Firebase credentials.

## Coverage

The emulator tests exercise:

- Anonymous public wishlist browsing and private wishlist denial
- Owner-only access to private list documents
- Verifier and challenge confidentiality, including denied client updates/deletes
- First eligible password-holder claim and competing first claims
- Wishly-account requirement for unlock and reservation access
- Wrong-password rejection and valid proof acceptance
- Proof binding to UID, share ID, nonce, and challenge document ID
- Atomic creation of a challenge and its matching access grant
- Create-only challenge records and rejection of challenge replay
- Owner exclusion from reservation grants and reservation records
- Revocation of access when a public list becomes private
- Reservation creation only for a real public item and only with a grant
- Owner-only cancellation of each reservation
- Simultaneous unlock and simultaneous reservation attempts

The suite seeds test documents through the Rules Unit Testing helper with rules disabled, then performs the actions under test with normal simulated client authentication. It never writes to production Firestore.

## What this does not test

- Real Firebase Authentication provider sign-in, Google OAuth, or authorized-domain configuration
- Browser UI rendering or the full GitHub Pages user journey
- Production Firestore data or live deployment
- Whether a second Firebase account belongs to the same human as the list owner

The tests use simulated Firebase auth claims and the Firestore Emulator, so no real account is needed. The test for an old `createdAt` value verifies that a client cannot backdate a challenge; it does **not** mean challenges expire. The current rules have no challenge TTL or automatic cleanup.

A captured successful proof can still be used for offline password guessing. Scrypt raises the cost of each guess but does not prevent offline guessing; see [reservation security notes](../docs/reservation-security.md).

## Files used

- `firebase.json`: points the emulator to `firestore.rules`, uses Firestore port 8080, and disables the Emulator UI.
- `package.json`: pins the Rules Unit Testing, Firebase SDK, Firebase CLI, and Noble hashes versions and defines the test commands.
- `tests/crypto.test.js`: checks scrypt compatibility.
- `tests/reservation.rules.test.js`: exercises Firestore Rules using the emulator.
- `.github/workflows/reservation-tests.yml`: runs the same checks in GitHub Actions.
