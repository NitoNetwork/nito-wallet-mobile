import { describe, expect, it } from 'vitest';

import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import {
  deriveLegacyCompatibleWallet,
  LEGACY_WALLET_ID_DERIVATION_PATH,
  restoreLegacyCompatibleWallet,
} from './walletIdentity';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('wallet identity compatibility', () => {
  it('keeps the historical Bech32 index zero as the stable wallet identifier', async () => {
    const wallet = await deriveLegacyCompatibleWallet(
      mnemonic,
      createNitoWalletCryptoTestDouble(),
    );

    expect(wallet.walletId).toBe('nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02');
    expect(wallet.walletIdDerivationPath).toBe(LEGACY_WALLET_ID_DERIVATION_PATH);
    expect(wallet.receiveAddress).toBe(wallet.walletId);
  });

  it('adapts a 1.3.1 vault payload without rewriting its stored identity', () => {
    const stored = {
      mnemonic,
      address: 'nito1qhistoricalwalletid',
      derivationPath: LEGACY_WALLET_ID_DERIVATION_PATH,
    };

    const wallet = restoreLegacyCompatibleWallet(stored);

    expect(wallet).toEqual({
      mnemonic,
      walletId: stored.address,
      walletIdDerivationPath: stored.derivationPath,
      receiveAddress: stored.address,
      receiveDerivationPath: stored.derivationPath,
    });
    expect(stored).toEqual({
      mnemonic,
      address: 'nito1qhistoricalwalletid',
      derivationPath: LEGACY_WALLET_ID_DERIVATION_PATH,
    });
  });
});
