# Release process

Nito Wallet uses separate manually triggered workflows so Android and iOS can
be built independently.

## Before a release

1. Update the semantic version in application metadata and native build numbers.
2. Update user-facing release notes and public documentation.
3. Run the complete JavaScript, TypeScript and Rust quality gates.
4. Confirm that dependency and credential scans are clean.
5. Build each required platform once from the reviewed release commit.

## Android

Run the `Android APK` workflow. Download the APK artifact, verify its SHA-256
checksum, install it on a physical phone and tablet, and complete the release
test checklist before distribution. The workflow requires the protected
`NITO_ANDROID_KEYSTORE_BASE64`, `NITO_ANDROID_KEYSTORE_PASSWORD`,
`NITO_ANDROID_KEY_ALIAS` and `NITO_ANDROID_KEY_PASSWORD` repository secrets.
It rejects missing credentials and Android Debug certificates.

## iOS

Run the `iOS Device App` workflow. The public workflow produces an unsigned
device IPA suitable for development signing or sideloading. App Store and
TestFlight publication require an Apple Developer team, distribution
certificate and provisioning profile supplied through protected secrets.
Release pages should attach the IPA directly instead of wrapping it in another
archive.

## Publication

Create a release tag, publish checksums with the release artifacts, and link to
the exact source commit. Do not publish an artifact if its workflow, device
tests or security review failed.
