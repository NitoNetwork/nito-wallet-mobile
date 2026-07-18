import { describe, expect, test } from 'vitest';

import {
  defaultWordCountLabel,
  generate24WordMnemonic,
  validateNitoMnemonic
} from './mnemonic';

describe('mnemonic', () => {
  test('generates a 24-word seed by default', () => {
    const mnemonic = generate24WordMnemonic();
    const { valid, wordCount } = validateNitoMnemonic(mnemonic);
    expect(valid).toBe(true);
    expect(wordCount).toBe(defaultWordCountLabel());
  });

  test('validates 12 and 24 word imports precisely', () => {
    const mnemonic12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const mnemonic24 = generate24WordMnemonic();

    expect(validateNitoMnemonic(mnemonic12).valid).toBe(true);
    expect(validateNitoMnemonic(mnemonic24).valid).toBe(true);
  });

  test('rejette les longueurs invalides et les checksums invalides', () => {
    const tooLong = 'abandon '.repeat(13).trim();
    expect(validateNitoMnemonic(tooLong).valid).toBe(false);
    expect(validateNitoMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon wrong').valid).toBe(false);
  });
});
