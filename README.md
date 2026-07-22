# Nito Wallet

[![Version](https://img.shields.io/github/package-json/v/NitoNetwork/nito-wallet-mobile?label=version)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Nito Wallet is a non-custodial mobile wallet for Android and iOS. Wallet keys
remain on the device and network access is used only to discover balances,
transactions and new blocks, and to broadcast signed transactions.

## Features

- Create a new 24-word recovery phrase.
- Import a valid 12-word or 24-word BIP39 recovery phrase.
- Protect wallet secrets with device-backed encrypted storage.
- Unlock with a password and, when enabled, device biometrics.
- Discover standard transparent HD branches with gap-limit scanning.
- Receive with a Bech32 address and QR code.
- Send transparent transactions with local signing and a review step.
- Track confirmed, pending and optional full transaction history.
- Export reconstructed history as CSV.
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
