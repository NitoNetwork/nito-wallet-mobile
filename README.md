# Nito Wallet

[![Version](assets/version-badge.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Nito Wallet is a non-custodial mobile wallet for Android and iOS. Wallet keys
remain on the device and network access is used only to discover balances,
transactions and new blocks, and to broadcast signed transactions.

## Features

- Create a new 24-word recovery phrase.
- Verify selected recovery words before protecting a newly created wallet.
- Import a valid 12-word or 24-word BIP39 recovery phrase.
- Optionally use a BIP39 passphrase when creating or importing a wallet.
  Creation requires two matching entries. Import requests the exact existing
  passphrase once.
- Back up the passphrase exactly and separately. It is not a thirteenth or
  twenty-fifth recovery word, cannot be recovered if forgotten, and any
  different value opens a different valid wallet without an error.
- Protect wallet secrets with device-backed encrypted storage.
- Unlock with a password and, when enabled, device biometrics.
- Configure automatic locking after 1, 5 or 15 minutes of inactivity.
- Discover standard transparent HD branches with gap-limit scanning.
- Receive with Taproot by default, or select Legacy, P2SH or Bech32.
- Generate additional HD receive addresses with a QR code for each address.
- Send to multiple recipients in one transparent transaction with local signing
  and a review step.
- Consolidate many small outputs into a few equal-value outputs.
- Choose the change address type from recipients, using a new internal address.
- Prefer fewer and smaller sufficient inputs within a fee tolerance of 25 percent,
  capped at 1,000 nitoshis above the cheapest compared selection.
- Resume saved signed transactions after locking or restarting the app.
- Follow sending, mempool observation and confirmation in one session-only window.
- Attempt cancellation of an eligible unconfirmed transaction with RBF.
- Import the full transaction history automatically, with each entry's amount
  and direction (received, sent or internal).
- Manually clear and resynchronize the full transaction history.
- Export the reconstructed history as TSV.
- Replace the official ElectrumX server list with one custom `wss://` server.
- Switch between light and dark themes.
- Protect recovery-phrase displays from screen capture and iOS
  application-switcher previews.
- Use the interface in nine languages.

Private Orchard/Bech32x functionality is intentionally not exposed until its
native implementation and network activation path are production-ready.

## Current release

The release version is defined in [`package.json`](package.json). The Android
workflows independently produce a production-signed APK for direct distribution
and a signed AAB for Google Play. Both reject debug signing. The iOS workflow
produces a direct unsigned device IPA for development sideloading.
App Store distribution requires Apple signing credentials.
Existing vaults remain compatible and continue to use the standard empty BIP39
passphrase without migration or rewriting.

## Development

Requirements:

- Node.js 24.14.0
- npm 11
- Rust 1.97.1
- Python 3 for the real SQLite integration tests
- JDK 17.0.19+10, Android platform 37.0, Build Tools 37.0.0 and NDK 27.1.12297006
  for Android builds
- macOS and Xcode 26.6 for iOS device builds
- Expo SDK 58.0.23 and React Native 0.88.1

Install and run the source checks:

```bash
npm ci
npm run release:check
npx expo install --check
npm run doctor
npm run lint
npm run typecheck
npm test
npm audit
npm run audit:production
npm run audit:ruby-build:self-test
npm run warnings:self-test
npm run warnings:ios-self-test
npm run warnings:ios-pods-self-test
npm run warnings:gradle-self-test
npm run warnings:source
npm run rust:fmt
npm run rust:clippy
npm run rust:test
```

After installing the locked Ruby toolchain with `bundle install`, run the iOS
build-tool dependency audit with `npm run audit:ruby-build`.

Update every public and native version source with one command:

```bash
npm version <major.minor.patch> --no-git-tag-version
```

Use the three manual GitHub Actions workflows for reproducible artifacts:

- `Android APK`
- `Android Play AAB`
- `iOS Device App`

## Security and privacy

Never share a recovery phrase, private key, password or signed credential in an
issue. Read [SECURITY.md](SECURITY.md) before reporting a vulnerability and
[PRIVACY.md](PRIVACY.md) for the wallet data model.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request.

## License and identity

The source code is available under the [MIT License](LICENSE). Please retain
the required license notice and acknowledge the original Nito project. The
project name and logo are covered separately by [TRADEMARKS.md](TRADEMARKS.md).
