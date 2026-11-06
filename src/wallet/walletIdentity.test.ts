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
      '',
      createNitoWalletCryptoTestDouble(),
    );

    expect(wallet.walletId).toBe('nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02');
    expect(wallet.walletIdDerivationPath).toBe(LEGACY_WALLET_ID_DERIVATION_PATH);
    expect(wallet.receiveAccountKey).toBe('taproot');
    expect(wallet.receiveIndex).toBe(0);
    expect(wallet.receiveDerivationPath).toBe("m/86'/0'/0'/0/0");
    expect(wallet.receiveAddress.startsWith('nito1p')).toBe(true);
    expect(wallet.primaryAddress).toBe(wallet.receiveAddress);
  });

  it('adapts a 1.3.1 vault payload without rewriting its stored identity', async () => {
    const stored = {
      mnemonic,
      address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      derivationPath: LEGACY_WALLET_ID_DERIVATION_PATH,
    };

    const wallet = await restoreLegacyCompatibleWallet(
      stored,
      'taproot',
      0,
      createNitoWalletCryptoTestDouble(),
    );

    expect(wallet).toEqual({
      mnemonic,
      bip39Passphrase: '',
      walletId: stored.address,
      walletIdDerivationPath: stored.derivationPath,
      primaryAddress: expect.stringMatching(/^nito1p/),
      primaryDerivationPath: "m/86'/0'/0'/0/0",
      primaryIndex: 0,
      receiveAccountKey: 'taproot',
      receiveIndex: 0,
      receiveAddress: expect.stringMatching(/^nito1p/),
      receiveDerivationPath: "m/86'/0'/0'/0/0",
    });
    expect(stored).toEqual({
      mnemonic,
      address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      derivationPath: LEGACY_WALLET_ID_DERIVATION_PATH,
    });
  });

  it('rejects stored public identity data that does not match the recovery material', async () => {
    await expect(restoreLegacyCompatibleWallet(
      {
        mnemonic,
        address: 'nito1qinvalidstoredidentity',
        derivationPath: LEGACY_WALLET_ID_DERIVATION_PATH,
      },
      'taproot',
      0,
      createNitoWalletCryptoTestDouble(),
    )).rejects.toThrow('Stored wallet identity does not match the recovery material.');
  });

  it('derives a separate stable identity for an optional BIP39 passphrase', async () => {
    const crypto = createNitoWalletCryptoTestDouble();
    const plain = await deriveLegacyCompatibleWallet(mnemonic, '', crypto);
    const protectedWallet = await deriveLegacyCompatibleWallet(mnemonic, 'Nito vault', crypto);

    expect(protectedWallet.bip39Passphrase).toBe('Nito vault');
    expect(protectedWallet.walletId).not.toBe(plain.walletId);
    expect(protectedWallet.receiveAddress).not.toBe(plain.receiveAddress);
  });

  it('normalizes equivalent BIP39 passphrases with NFKD', async () => {
    const crypto = createNitoWalletCryptoTestDouble();
    const composed = await deriveLegacyCompatibleWallet(mnemonic, 'é', crypto);
    const decomposed = await deriveLegacyCompatibleWallet(mnemonic, 'e\u0301', crypto);

    expect(composed.walletId).toBe(decomposed.walletId);
    expect(composed.bip39Passphrase).toBe('e\u0301');
  });
});
