import { generate24WordMnemonic, validateNitoMnemonic, mnemonicToSeedHex } from './mnemonic';
import { deriveBech32AddressFromSeed } from './derive';
import { NITO_DERIVATION_PATH } from '../constants/nito';
import type { WalletRecord } from './types';

export function createWallet24Words(): WalletRecord {
  const mnemonic = generate24WordMnemonic();
  return buildFromMnemonic(mnemonic, Date.now());
}

export function buildFromMnemonic(rawMnemonic: string, createdAt = Date.now()): WalletRecord {
  const validation = validateNitoMnemonic(rawMnemonic);
  if (!validation.valid) {
    throw new Error(validation.reason || 'Seed invalide.');
  }

  const seedHex = mnemonicToSeedHex(validation.normalizedMnemonic);
  const derivationPath = NITO_DERIVATION_PATH;
  const address = deriveBech32AddressFromSeed(seedHex, derivationPath);

  return {
    mnemonic: validation.normalizedMnemonic,
    derivationPath,
    address,
    createdAt
  };
}

export function isValidWordCount(wordCount: number): { valid: boolean; reason?: string } {
  if (wordCount !== 12 && wordCount !== 24) {
    return { valid: false, reason: 'Only 12 or 24 words are accepted.' };
  }
  return { valid: true };
}

export function sanitizeImportedMnemonic(rawMnemonic: string): {
  normalized: string;
  wordCount: number;
  valid: boolean;
  reason?: string;
} {
  const validation = validateNitoMnemonic(rawMnemonic);
  return {
    normalized: validation.normalizedMnemonic,
    wordCount: validation.wordCount,
    valid: validation.valid,
    reason: validation.reason
  };
}
