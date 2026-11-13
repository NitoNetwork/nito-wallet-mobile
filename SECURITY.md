# Security policy

## Supported versions

Security fixes are applied to the latest published release line. Users should
run the most recent published build.

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

## Optional BIP39 passphrase

New and imported wallets may use an optional BIP39 passphrase. It is not an
extra recovery word. A different passphrase opens a different valid wallet, so
the application cannot detect a typo or recover a forgotten value.

Creation requires the passphrase twice and asks the user to confirm a separate
backup. The normalized passphrase is encrypted inside the local vault with the
recovery phrase. It is never displayed again by the application. Existing
vaults remain compatible and use the standard empty BIP39 passphrase.

## Dependency security

The full and production npm dependency audits must report zero known
vulnerabilities. Their release gates do not accept advisory allowlists or
temporary exceptions.

The iOS Ruby build-tool audit currently accepts exactly one dated exception,
`GHSA-8474-xrp6-wh69` (`CVE-2026-126080`) in ActiveSupport 7.2.3.2. CocoaPods
Core 1.17.0 is the latest stable release and requires ActiveSupport below 8,
while the first fixed ActiveSupport 8 release is 8.0.5.2.

Ruby, CocoaPods and ActiveSupport run only while resolving and generating the
iOS native project. They are absent from the APK and IPA. The wallet contains
no Action Cable endpoint and does not pass application input to
`safe_constantize`, so the vulnerable path is not accessible from the shipped
application.

The exception expires on 13 February 2027. The gate also fails if the advisory
disappears, changes dependency or version, or is joined by any other Ruby
advisory. This forces removal or a new documented review when CocoaPods gains a
compatible fixed dependency.
