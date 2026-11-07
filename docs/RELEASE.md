# Release process

Nito Wallet uses separate manually triggered workflows so the Android APK,
Google Play AAB and iOS device application can be built independently.

## Before a release

1. Update the semantic version in application metadata and native build numbers.
2. Update user-facing release notes and public documentation.
3. Run `npm run release:check`, `npx expo install --check` and `npm run doctor`.
4. Run the complete JavaScript, TypeScript and Rust quality gates.
5. Require both `npm audit` and `npm run audit:production` to return zero known
   vulnerabilities without an exception.
6. Run the Android and iOS warning-policy self-tests and verify each platform
   build log.
7. Confirm that credential scans are clean.
8. Build each required platform once from the reviewed release commit.

## Android

Run the `Android APK` workflow. Download the APK artifact, verify its SHA-256
checksum, install it on a physical phone and tablet, and complete the release
test checklist before distribution. The workflow requires the protected
`NITO_ANDROID_KEYSTORE_BASE64`, `NITO_ANDROID_KEYSTORE_PASSWORD`,
`NITO_ANDROID_KEY_ALIAS` and `NITO_ANDROID_KEY_PASSWORD` repository secrets.
It rejects missing credentials and Android Debug certificates.

## Google Play

Run the `Android Play AAB` workflow and select the reviewed release tag in its
`source_ref` input. Download the signed AAB and verify its SHA-256 checksum
before uploading it to Google Play. The workflow verifies that the AAB signer
matches the configured Android release keystore and rejects Android Debug
certificates. Google Play App Signing configuration and store declarations are
separate release approvals.

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
