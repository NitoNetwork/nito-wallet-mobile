# Contributing

Contributions that improve correctness, security, accessibility, translations,
performance and platform compatibility are welcome.

## Before opening a pull request

1. Open an issue for changes that alter wallet behavior or network compatibility.
2. Keep each pull request focused and explain user-visible effects.
3. Add or update tests for every behavioral change.
4. Run all TypeScript, JavaScript and Rust quality checks documented in README.
5. Do not commit generated credentials, wallet secrets, device profiles or build artifacts.
6. Update public documentation when behavior, dependencies or release steps change.

## Security-sensitive changes

Changes to key derivation, encryption, signing, transaction serialization,
address discovery or native bridges require deterministic test vectors and a
focused security review. Never use production wallet material in tests.

## Translations

Every public string must use the localization catalog. A new key must be
translated for every supported language and pass the localization audit tests.

## Commit and review expectations

Use clear commits, keep warnings at zero in project-owned code, and resolve all
review findings before merging. By contributing, you agree that your work is
licensed under the repository MIT License.
