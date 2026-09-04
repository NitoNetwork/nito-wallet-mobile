import { describe, expect, it } from 'vitest';

import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import {
  assertGapSafeIssuedIndex,
  deriveHdAddress,
  HD_ACCOUNT_TEMPLATES,
} from './hdAddress';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('HD address policy', () => {
  it.each([
    { scriptType: undefined },
    { scriptType: 'p2wpkh' as const },
    { path: "m/86'/0'/0'/0/99" },
    { address: '' },
  ])('rejects a missing or inconsistent native address field: %j', async (override) => {
    const crypto = createNitoWalletCryptoTestDouble();
    const invalid = {
      ...crypto,
      deriveAddresses: async (...args: Parameters<typeof crypto.deriveAddresses>) => (
        (await crypto.deriveAddresses(...args)).map((address) => ({ ...address, ...override }))
      ),
    };
    // Deliberately malformed native JSON is outside the static TypeScript contract.
    await expect(deriveHdAddress(mnemonic, 'taproot', 'external', 0, invalid as typeof crypto))
      .rejects.toThrow('HD address derivation returned an inconsistent result.');
  });

  it('derives all four account-zero receive families with Taproot available', async () => {
    const crypto = createNitoWalletCryptoTestDouble();
    const derived = await Promise.all(HD_ACCOUNT_TEMPLATES.map((template) => (
      deriveHdAddress(mnemonic, template.key, 'external', 0, crypto)
    )));

    expect(derived.map((address) => address.path)).toEqual([
      "m/44'/0'/0'/0/0",
      "m/49'/0'/0'/0/0",
      "m/84'/0'/0'/0/0",
      "m/86'/0'/0'/0/0",
    ]);
    expect(derived.map((address) => address.scriptType)).toEqual([
      'p2pkh',
      'p2sh-p2wpkh',
      'p2wpkh',
      'p2tr',
    ]);
    expect(derived[3]?.address.startsWith('nito1p')).toBe(true);
  });

  it('never issues beyond the seed-restorable gap window', () => {
    const sequence = { accountKey: 'taproot' as const, branch: 'external' as const };
    const addresses = [{ ...sequence, index: 4, used: true }];

    expect(() => assertGapSafeIssuedIndex({ addresses, sequence, index: 24 })).not.toThrow();
    expect(() => assertGapSafeIssuedIndex({ addresses, sequence, index: 25 }))
      .toThrow('HD_ADDRESS_GAP_LIMIT_REACHED');
  });
});
