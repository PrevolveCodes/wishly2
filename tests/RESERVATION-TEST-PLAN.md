# Wishly reservation Rules Emulator test plan

The current firestore.rules denies all client reads and writes to
reservationSecrets, reservationAccess, and reservations. The executable tests
therefore cover the current security baseline only. They do not claim that the
approved direct-Firestore reservation flow works.

After the implementation defines the challenge document path and exact fields,
add positive and negative Rules Unit Testing cases for:

1. Verifier confidentiality: unauthenticated visitors, viewers, password
   holders, and the owner cannot read the verifier. Public documents contain no
   verifier, private salt metadata, proof, or reservation records.
2. Challenge proofs: proofs fail when UID, share ID, nonce, or challenge ID
   differs; a proof cannot be replayed after challenge consumption; expired
   challenges fail; no reusable proof is written to a readable grant.
3. Atomic consumption: challenge consumption and grant creation succeed or
   fail together; two attempts cannot consume one challenge; two first-holder
   claims cannot both become permanent holder.
4. Owner restrictions: the list-owner UID cannot claim holder status, unlock
   reservation statuses, read reservations, create reservations, or cancel
   another user's reservation.
5. Public/private access: anonymous visitors can read only public mirrors and
   public items; private lists remain inaccessible through share IDs, mirrors,
   index, and item paths; owners retain access to their own lists.
6. Reservation operations: a signed-in non-owner with a valid grant can reserve
   an available item; no grant means no access; concurrent reservations for
   one item yield exactly one success; viewers can cancel only their own
   reservation; the owner cannot read statuses or mutate reservation records.

For concurrency, use separate authenticated contexts and Promise.all to
attempt the same challenge consumption and same-item reservation. Assert
exactly one success and inspect final documents with
withSecurityRulesDisabled. Never use a disabled-rules context for the operation
under test.

Security note: a captured challenge-specific proof can still support offline
password guessing. An attacker can test candidate passwords against the
captured proof and public challenge inputs. scrypt raises the cost per guess
but does not eliminate this weakness. Do not describe this design as immune to
offline guessing.
