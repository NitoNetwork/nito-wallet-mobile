import { describe, expect, test } from 'vitest';
import { deriveBech32AddressFromSeed } from './derive';
import { generate24WordMnemonic, mnemonicToSeedHex } from './mnemonic';

const FIXED_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WEB_WALLET_BECH32_ADDRESS = 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02';

describe('derive', () => {
  test('derives the exact Bech32 address used by the Nito web wallet', () => {
    const seedHex = mnemonicToSeedHex(FIXED_MNEMONIC);
    const first = deriveBech32AddressFromSeed(seedHex);
    const second = deriveBech32AddressFromSeed(seedHex);
    expect(first).toBe(second);
    expect(first).toBe(WEB_WALLET_BECH32_ADDRESS);
  });

  test('a different seed gives a different address', () => {
    const seedA = mnemonicToSeedHex(FIXED_MNEMONIC);
    const seedB = mnemonicToSeedHex(generate24WordMnemonic());
    const a = deriveBech32AddressFromSeed(seedA);
    const b = deriveBech32AddressFromSeed(seedB);
    expect(a.length).toBeGreaterThan(40);
    expect(a).not.toBe(b);
  });
});
