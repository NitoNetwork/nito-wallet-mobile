# Security policy

## Supported versions

Security fixes are applied to the latest 1.2.x release line. Users should run
the most recent published build.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Email
help@nito.network with the subject `Nito Wallet security report` and include:

- the affected version and platform;
- a clear description and reproduction steps;
- the expected security impact;
- any suggested mitigation.

Never include a real recovery phrase, private key, wallet password, signing
certificate or production credential. Use a disposable test wallet.

We will acknowledge a valid report, coordinate remediation, and credit the
reporter when requested. Please allow a reasonable remediation period before
public disclosure.

## Security boundaries

Nito Wallet is non-custodial. Losing the recovery phrase can permanently remove
access to funds, and publishing it gives anyone control of the wallet. Network
transactions cannot be reversed by the maintainers.

## Unpatched build-tool advisories

An audit exception is accepted only for a build dependency that is absent from
the delivered application, never for code embedded in the APK or IPA.

The current exception covers `image-size`, pulled into the build toolchain by
Expo through `@expo/metro` and Metro. All published versions are affected by two
denial-of-service advisories in the ICNS, JXL and HEIF readers
(`GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq`). The package has published no
release since April 2025, and npm's only proposed remediation is to downgrade
Expo from version 57 to version 53.

`image-size` is not included in the APK or IPA, and this repository contains
only PNG and SVG image assets, so the affected readers are not invoked. The
exception expires after November 8, 2026. Starting November 9, 2026, the build
fails regardless of the audit result and requires a new review.
