# 1.4.0 candidate checklist

This is a development candidate, not approval for public distribution. Build
Android and iOS from the same reviewed commit and record both artifact hashes.
No release tag should precede successful device validation.

## Changes to exercise

- Taproot is the default receive address. Legacy, P2SH and Bech32 remain available.
- Additional HD addresses can be issued within the recovery gap limit.
- Internal Taproot addresses are reserved atomically before signing, with one
  address per transaction, including individual consolidation transactions.
- The financial preview is unsigned. Changed inputs, outputs or fees require
  another confirmation before signing.
- Signed transactions and retry state survive locking and application restart.
- One transaction window follows sending, planned retries, server acceptance,
  mempool observation, confirmation and unresolved outcomes.
- RBF can increase the fee without reducing recipients' payments. Cancellation
  attempts instead send the funds to a new internal address. The original can
  still confirm first. The window identifies whichever transaction confirms.

## Compatibility and storage

- No migration or rewrite of the 1.3.1 encrypted vault is introduced.
- The historical Bech32 wallet identifier remains the storage identity.
- Only the reconstructible public database gains tables, through schema 7.
- The network snapshot remains the financial authority. Tracking never credits
  a balance, and a replacement is not optimistically added beside its original.
- Reserved or signed internal indices are not reused. The existing gap limit
  remains enforced, including after interrupted attempts.

## RBF policy and limits

The implementation was compared with the new web wallet at `628e3a9`, in
`src/wallet/transparentSend.ts` and `app/wallet-dashboard.tsx`, and with Nito
Core's `src/policy/rbf.cpp`.

- New transactions explicitly signal RBF with sequence `0xfffffffd`.
- Replacement inputs must exactly match the original, with parent outputs and
  wallet ownership verified before constructing the unsigned review.
- The fee rate is at least the network priority estimate plus 20 percent, and
  at least the rounded-up original rate plus one nitoshi per virtual byte.
- The absolute fee also covers the original fee plus the default incremental
  relay increase of one nitoshi per replacement virtual byte.
- A conservative size bound is checked against the signed transaction. The
  rate is capped at 10,000 nitoshis per virtual byte, as in the web wallet.
- An unavailable or invalid fee estimate is an explicit refusal, not a silently
  invented network estimate. Acceleration requires identifiable internal change.
- Already signed replacements can resume if the server forgot the original.
  Confirmed originals prevent further replacement broadcasts.
- Five actual broadcasts are allowed, with retry delays of 15 seconds, one
  minute, five minutes and fifteen minutes. Network verification failures keep
  backing off without creating or signing another payment.
- Different node policy or unconfirmed descendants can require higher fees
  than the basic replacement calculation. Rejection never triggers an automatic
  unreviewed fee increase. RBF and cancellation are attempts, not guarantees.

## Local verification

Run lint, typecheck, the full test suite repeatedly, release checks, Expo
dependency alignment, Expo Doctor, production dependency audit, Rust format,
Clippy and tests, and both Metro production exports.

The SQLite tests use Python's standard SQLite implementation with the actual
application SQL and write queue. They do not replace testing Expo's native
SQLite bridge on Android and iOS. JavaScript signing fixtures and native Rust
unit tests do not establish network acceptance of the final device builds.

At preparation on 4 September 2026, the npm audit API timed out. That audit
remains unverified until a complete response is obtained. A timeout is never
zero vulnerabilities. The existing workflow audit gate is unchanged.

No local regtest node is used, at the owner's request. No workflow is launched
as part of this preparation.

## Final Android and iOS campaign

- [ ] Upgrade an existing 1.3.1 test wallet without reimporting its phrase.
      Unlock by password and biometrics. Check historical balances and history.
- [ ] Create and import wallets. Verify Taproot default, all four address types,
      QR codes, distinct empty HD addresses and recovery near the gap boundary.
- [ ] Receive and spend using all four families. Send to multiple recipients.
      Check amounts, fees, change and internal transaction formatting.
- [ ] Confirm that each consolidation transaction uses a different internal
      address, and retains its output split when accelerated.
- [ ] Interrupt after reservation, signing, persistence and network acceptance.
      Lock and restart. Confirm that saved signed transactions resume once,
      without a second payment or reuse of an internal index.
- [ ] Hide and reopen the tracking window while writes or refreshes are in
      flight. Restart and verify the saved visibility and selection.
- [ ] Observe all seven tracking states, including a failed final retry. Restore
      the network after a lost broadcast response and check idempotent recovery.
- [ ] Accelerate an unconfirmed send. Recipients and amounts must stay unchanged.
      Confirm the replacement, with no duplicate original in financial history.
- [ ] Attempt cancellation to a fresh internal Taproot address. Test both races:
      replacement confirms first, and original confirms first. Verify the
      displayed result, transaction ID, final balance and network fee.
- [ ] Change the fee estimate between review and confirmation. Verify that a new
      financial review appears and nothing is signed until confirmed again.
- [ ] Test unavailable fee estimates, custom-server failure and return to the
      official servers. Server changes must invalidate unsigned previews.
- [ ] Check small screens, both themes, all nine languages, scrolling and large
      amounts. Capture protection must remain limited to visible recovery words.
- [ ] Confirm npm audit responds successfully before public distribution.
