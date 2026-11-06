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

The production dependency audit must report zero known vulnerabilities. Release
gates do not accept advisory allowlists or temporary audit exceptions.
