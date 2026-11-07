# Live quality status

[![Android APK](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/android-apk.yml/badge.svg)](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/android-apk.yml)
[![Android Play AAB](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/android-aab.yml/badge.svg)](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/android-aab.yml)
[![iOS Device App](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/ios-device-app.yml/badge.svg)](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/ios-device-app.yml)

This document intentionally contains no manually maintained test counts. The
workflow badges and generated job summaries are the current source of truth.
Each device and store workflow runs the same project quality gate before compilation:

- ESLint with zero project warnings.
- Strict TypeScript checking.
- Unit and integration tests.
- Localization completeness and encoding audits.
- production dependency audit requiring zero known vulnerabilities, with no
  advisory allowlist or temporary exception.
- raw full dependency audit requiring zero known vulnerabilities.
- Expo SDK dependency alignment and Expo Doctor.
- Rust formatting, Clippy with warnings denied, and Rust tests.
- native bridge and artifact integrity checks.
- merged Android manifest checks rejecting storage, media, overlay and package
  installation permissions.

Android code owned by Nito is compiled with Java and Kotlin warnings denied.
Expo SDK 58 and Android Gradle Plugin 9 still emit seven enumerated build-system
compatibility diagnostics. Current Expo modules and the React Native Gradle
plugin also retain a small set of deprecated compatibility APIs.
The Android log gate also recognizes Metro's exact cold-cache rebuild notice.
The Gradle log gate accepts only the exact package paths and messages documented
in its dated policy, rejects every other warning and expires on 6 February 2027.
Gradle 9.6.1 is the newest compatible wrapper for this SDK because Gradle 9.7
and newer embed Kotlin 2.4 metadata that the Expo 58 and React Native 0.88
build plugins compiled with Kotlin 2.2 cannot read. Android lint therefore
disables only its newer-wrapper recommendation until that dated review.
This policy does not apply to dependency security audits, which require a raw
zero result.

Both Android workflows download a pinned official Android CLI binary, verify
its SHA-256 checksum, installs the exact platform 37.0, Build Tools 37.0.0 and
NDK 27.1.12297006 packages, and verifies their installed metadata before any
project dependency is installed.

Expo SDK 58 currently emits one iOS autolinking diagnostic while CocoaPods
scans the internal `CoreModule` that Expo Modules Core creates directly. The
iOS pod log gate accepts exactly that class, package path and message once. It
rejects every other diagnostic, fails when the upstream message disappears and
expires on 6 February 2027 so the exception must be reviewed or removed.

The Xcode 26.6 dependency patches remove unsupported Swift warning groups,
keep React bridge conformance in a private Expo header and restate the Clipboard
exception sendability contract. The iOS build log gate treats any return of
those corrected diagnostics as a failing regression.

A release is acceptable only when the workflow for its platform is green and
the resulting artifact has completed physical-device testing.
