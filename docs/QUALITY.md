# Live quality status

[![Android APK](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/android-apk.yml/badge.svg)](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/android-apk.yml)
[![iOS Device App](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/ios-device-app.yml/badge.svg)](https://github.com/NitoNetwork/nito-wallet-mobile/actions/workflows/ios-device-app.yml)

This document intentionally contains no manually maintained test counts. The
workflow badges and generated job summaries are the current source of truth.
Each device workflow runs the same project quality gate before compilation:

- ESLint with zero project warnings;
- strict TypeScript checking;
- unit and integration tests;
- localization completeness and encoding audits;
- production dependency audit;
- Rust formatting, Clippy with warnings denied, and Rust tests;
- native bridge and artifact integrity checks.

A release is acceptable only when the workflow for its platform is green and
the resulting artifact has completed physical-device testing.
