import { generateMnemonic, mnemonicToSeedSync, validateMnemonic as bip39ValidateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ALLOWED_WORD_COUNTS, DEFAULT_WORD_COUNT, MNEMONIC_CREATION_STRENGTH } from '../constants/nito';
import type { WordCount } from './types';

function normalizeMnemonic(rawMnemonic: string): string {
  return rawMnemonic
    .normalize('NFKC')
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function generate24WordMnemonic(): string {
  return generateMnemonic(wordlist, MNEMONIC_CREATION_STRENGTH);
}

export function getWordCount(rawMnemonic: string): number {
  const normalized = normalizeMnemonic(rawMnemonic);
  if (!normalized.length) {
    return 0;
  }
  return normalized.split(' ').length;
}

export function validateNitoMnemonic(rawMnemonic: string): {
  valid: boolean;
  normalizedMnemonic: string;
  wordCount: number;
  reason?: string;
} {
  const normalizedMnemonic = normalizeMnemonic(rawMnemonic);
  const wordCount = getWordCount(normalizedMnemonic);
  if (!ALLOWED_WORD_COUNTS.includes(wordCount as WordCount)) {
    return {
      valid: false,
      normalizedMnemonic,
      wordCount,
      reason: `The seed must contain 12 or 24 words. Received: ${wordCount}.`
    };
  }

  const valid = bip39ValidateMnemonic(normalizedMnemonic, wordlist);
  if (!valid) {
    return {
      valid: false,
      normalizedMnemonic,
      wordCount,
      reason: 'La seed n’est pas valide (checksum BIP39 invalide).'
    };
  }

  return { valid: true, normalizedMnemonic, wordCount };
}

export function mnemonicToSeedHex(normalizedMnemonic: string): string {
  const seed = mnemonicToSeedSync(normalizedMnemonic, '');
  return bytesToHex(seed);
}

export function defaultWordCountLabel(): number {
  return DEFAULT_WORD_COUNT;
}
