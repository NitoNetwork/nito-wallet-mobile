export const NITO_HRP = 'nito';
export const NITO_DERIVATION_PATH = "m/84'/0'/0'/0/0";
export const MNEMONIC_CREATION_STRENGTH = 256;
export const DEFAULT_WORD_COUNT = 24;
export const ALLOWED_WORD_COUNTS = [12, 24] as const;
export const AUTO_LOCK_TIMEOUT_MS = 300_000;
export const AUTO_LOCK_TIMEOUT_OPTIONS_MS = [
  0,
  60_000,
  AUTO_LOCK_TIMEOUT_MS,
  900_000,
] as const;
export type AutoLockTimeoutMs = (typeof AUTO_LOCK_TIMEOUT_OPTIONS_MS)[number];
export const VAULT_KEY = 'nito-mobile-wallet.v1';
export const VAULT_META_KEY = 'nito-mobile-wallet.meta.v1';
export const VAULT_VERSION = 1;
export const SALT_BYTE_LENGTH = 16;
export const NONCE_BYTE_LENGTH = 24;
export const PASSWORD_MIN_LENGTH = 10;

export const CONSOLIDATION_MIN_UTXOS = 21;
export const CONSOLIDATION_TARGET_OUTPUTS = 9;
export const CONSOLIDATION_MIN_SATS_PER_OUTPUT = 5_000;
export const PBKDF2_ROUNDS = 600_000;
