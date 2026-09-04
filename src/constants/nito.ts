export const AUTO_LOCK_TIMEOUT_MS = 300_000;
export const AUTO_LOCK_TIMEOUT_OPTIONS_MS = [
  60_000,
  AUTO_LOCK_TIMEOUT_MS,
  900_000,
] as const;
export type AutoLockTimeoutMs = (typeof AUTO_LOCK_TIMEOUT_OPTIONS_MS)[number];
export const MAX_SEND_RECIPIENTS = 20;
export const MAX_NITO_AMOUNT_INPUT_LENGTH = 32;
export const MAX_MONEY_SATS = 128_456_589_000_000_000n;
export const VAULT_VERSION = 1 as const;
export const SALT_BYTE_LENGTH = 16;
export const SEED_ENTROPY_BYTE_LENGTH = 32;

/** Policy floor, enforced when a password is chosen. */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Floor for the unlock and sensitive-action prompts. It is deliberately lower
 * than the policy: this check only avoids spending 600 000 PBKDF2 rounds on an
 * obviously empty field, it is not a security gate — an attacker running on
 * their own device is not stopped by a client-side length test.
 *
 * NEVER raise it to PASSWORD_MIN_LENGTH. Doing so would reject a legitimate
 * shorter password from an older vault before decryption is even attempted, and
 * lock its owner out of their funds for no security gain.
 */
export const PASSWORD_UNLOCK_MIN_LENGTH = 8;

export const CONSOLIDATION_MIN_UTXOS = 21;
export const CONSOLIDATION_TARGET_OUTPUTS = 9;
export const CONSOLIDATION_MIN_SATS_PER_OUTPUT = 5_000;
export const PBKDF2_ROUNDS = 600_000;
