# 1.5.0 candidate checklist

This is a development candidate, not approval for public distribution. Build
Android and iOS from the same reviewed commit and record both artifact hashes.
Do not create a release tag before successful physical-device validation.

## Main changes to exercise

- Expo SDK 58, React Native 0.88 and their native dependencies are aligned to
  the current stable versions selected by Expo.
- A BIP39 passphrase is optional during wallet creation and import. It is not a
  thirteenth or twenty-fifth recovery word. The same recovery phrase with a
  different passphrase derives a different wallet.
- Creation asks for the optional passphrase twice. Import asks once and warns
  that a typo derives another valid wallet.
- The passphrase is normalized with BIP39 NFKD rules, encrypted in the existing
  local vault and cleared from transient state on lock or backgrounding.
- Existing wallets without a passphrase continue to use the historical empty
  BIP39 passphrase. Their vault format, wallet identifier and funds are not
  migrated or rewritten.

## Dependency and build controls

- `npm ci` must reproduce all ten dependency patches required by the SDK 58
  build from the lockfile.
- `npx expo install --check` and Expo Doctor must pass.
- Raw full and production npm audits must both return zero known
  vulnerabilities. An unavailable audit is unverified, never zero.
- `npm ls image-size` must show no installed package.
- JavaScript, TypeScript and all Nito-owned native code must remain warning-free.
- The dated Gradle compatibility policy must accept only the documented Expo
  SDK 58 and Android Gradle Plugin diagnostics and reject any additional one.
- The generated Android wrapper must remain Gradle 9.6.1 until Expo and React
  Native build plugins support the Kotlin metadata embedded by newer Gradle.
- The Android workflow must install platform 37.0, Build Tools 37.0.0 and NDK
  27.1.12297006 through the pinned Android CLI and verify their package metadata.
- Rust formatting, Clippy with warnings denied and all Rust tests must pass.
- The merged Android manifest must contain no storage, media, overlay or package
  installation permission.
- Android lint, Android unit tests and the production-signed release APK must
  complete from the same commit. iOS must build from that same commit.

## Wallet compatibility and cryptography

- [ ] Upgrade an existing 1.4.1 wallet. Unlock it with password and biometrics
      without reimporting the recovery phrase. Verify balances, history and all
      previously issued receive addresses.
- [ ] Create a wallet without a passphrase. Confirm the same historical address
      derivation and normal send, consolidation and cancellation behavior.
- [ ] Create a wallet with a passphrase. Confirm that both entries must match
      before the wallet can be protected.
- [ ] Import the same recovery phrase with an empty passphrase and with two
      different passphrases. Confirm that all three wallets derive different
      expected identities where applicable.
- [ ] Test composed and decomposed Unicode forms that normalize to the same
      passphrase. Confirm the resulting wallet identity is identical.
- [ ] Lock and background the application while entering a passphrase. Return
      to the flow and confirm that the transient value was erased.
- [ ] Confirm the passphrase is never displayed by the recovery phrase reveal
      or copied with the recovery phrase.
- [ ] Receive and spend with Legacy, P2SH, Bech32 and Taproot. Repeat sending,
      multi-send, consolidation and RBF cancellation from a passphrase wallet.
- [ ] Restore a passphrase wallet on another test device using the exact phrase
      and passphrase. Confirm the same addresses and balance after scanning.
- [ ] Enter a wrong passphrase during a disposable restore and confirm that it
      derives a different wallet without modifying an existing vault.

## Regression campaign

- [ ] Verify password and biometric unlock before and after application restart.
- [ ] Exercise receive-address reuse, new empty HD addresses and the recovery
      gap boundary in all four address families.
- [ ] Send one and multiple payments. Verify input selection, automatic change
      type, fees, unsigned review and final transaction details.
- [ ] Interrupt after reservation, signing, persistence and network acceptance.
      Confirm idempotent recovery without a duplicate payment or reused index.
- [ ] Test both cancellation races. Confirm that the popup identifies whether
      the replacement or the original transaction was confirmed.
- [ ] Check small screens, both themes, all nine languages and screen-capture
      protection while recovery words are visible.
- [ ] Verify the final APK and IPA hashes, install both artifacts on physical
      devices and repeat the critical unlock, restore, receive and send paths.
