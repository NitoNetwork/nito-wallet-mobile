# 1.4.0 candidate checklist

This is a development candidate, not approval for public distribution. Build
Android and iOS from the same reviewed commit and record both artifact hashes.
No release tag should precede successful device validation.

## Changes to exercise

- Taproot is the default receive address. Legacy, P2SH and Bech32 remain available.
- Additional HD addresses can be issued within the recovery gap limit.
- Change addresses follow Bitcoin Core v30 recipient-type priority: Taproot,
  native SegWit, P2SH, then Legacy. Each internal address is reserved atomically
  before signing. Consolidations and cancellation attempts retain Taproot.
- Input selection allows at most 25 percent above the cheapest compared
  candidate, capped at 1,000 extra nitoshis and rounded down. Within that fixed
  ceiling, fewer inputs win, then the smaller sufficient total, then lower fees.
- The financial preview is unsigned. Changed inputs, outputs or fees require
  another confirmation before signing.
- Signed transactions and retry state survive locking and application restart.
- One transaction window follows sending, planned retries, server acceptance,
  mempool observation, confirmation and unresolved outcomes.
- Closing, locking or restarting does not automatically reopen the window.
  Signed transaction recovery remains durable and independent of visibility.
- Cancellation attempts send the funds to a new internal address. The original
  can still confirm first. The compact window identifies the confirmed winner.
  The manual acceleration button has been removed.
- Post-broadcast observation makes up to three read attempts, spaced three
  seconds apart. These reads never sign or broadcast another transaction.
- New receive addresses become usable after local reservation and derivation.
  Their network refresh is queued independently, including during another scan.

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
  invented network estimate. Existing signed acceleration records can still
  recover, but the interface offers cancellation only.
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
SQLite bridge on Android and iOS. Integration tests exercise the real Rust C ABI
for all four change families, their later spending and cancellation. Local tests
do not establish network acceptance of the final device builds.

The earlier npm audit timeout was resolved. The latest raw production audit on
4 September 2026 returned zero known vulnerabilities. A future timeout remains
unverified, never zero vulnerabilities. The workflow audit gate is unchanged.

No local regtest node is used, at the owner's request. No workflow is launched
as part of this preparation.

## Final Android and iOS campaign

- [ ] Upgrade an existing 1.3.1 test wallet without reimporting its phrase.
      Unlock by password and biometrics. Check historical balances and history.
- [ ] Create and import wallets. Verify Taproot default, all four address types,
      QR codes, distinct empty HD addresses and recovery near the gap boundary.
- [ ] Receive and spend using all four families. Send to multiple recipients.
      Check amounts, fees, automatic change type and internal transaction
      formatting, including mixed recipient families.
- [ ] With spendable coins of 2000, 0.1 and 200 NITO, send 0.09 NITO. At equal
      input cost the 0.1 coin must be selected. A large payment must not collect
      small coins unnecessarily. Check exact fees and the Max button.
- [ ] Compare a smaller input with slightly higher fees against a larger cheaper
      input. The smaller input is allowed up to the fixed 25 percent / 1,000
      nitoshi ceiling, but never one nitoshi above it. Verify the reviewed fee.
- [ ] Confirm that each consolidation transaction uses a different internal
      Taproot address. Closing its window must remain effective for later
      transactions in the same batch.
- [ ] Interrupt after reservation, signing, persistence and network acceptance.
      Lock and restart. Confirm that saved signed transactions resume once,
      without a second payment or reuse of an internal index.
- [ ] Hide and reopen the tracking window while writes or refreshes are in
      flight. Lock and restart. The window must stay closed while signed
      transactions resume. Verify that old saved visibility is ignored.
- [ ] Observe all seven tracking states, including a failed final retry. Restore
      the network after a lost broadcast response and check idempotent recovery.
- [ ] Simulate delayed indexing and failed post-broadcast reads. Verify three
      attempts spaced three seconds apart, no duplicate broadcasts, and no
      transaction-failed message when only observation is unavailable.
- [ ] Issue multiple receive addresses while a scan is active. Copy and create
      become available as soon as the local address is displayed. Their scan
      must not be lost and the recovery gap limit must remain enforced.
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
