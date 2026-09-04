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
workflow produces a production-signed APK and rejects debug signing. The iOS
workflow produces a direct unsigned device IPA for development sideloading;
App Store distribution requires Apple signing credentials.

## Development

Requirements:

- Node.js 24
- npm 11
- Rust 1.97
- Python 3 for the real SQLite integration tests
- Android SDK and JDK 17 for Android builds
- macOS and Xcode 26 for iOS device builds

Install and run the source checks:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm audit --omit=dev
cargo fmt --manifest-path native/nito-wallet-crypto/Cargo.toml --check
cargo clippy --manifest-path native/nito-wallet-crypto/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path native/nito-wallet-crypto/Cargo.toml --all-features
```

Update every public and native version source with one command:

```bash
npm version <major.minor.patch> --no-git-tag-version
```

Use the two manual GitHub Actions workflows for reproducible device artifacts:

- `Android APK`
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
