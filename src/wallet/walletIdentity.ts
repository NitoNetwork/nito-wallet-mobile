import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
import type { NitoWalletCryptoApi } from '../native/nitoWalletCryptoContract';

export const LEGACY_WALLET_ID_DERIVATION_PATH = "m/84'/0'/0'/0/0";

export type Wallet = {
  mnemonic: string;
  walletId: string;
  walletIdDerivationPath: string;
  receiveAddress: string;
  receiveDerivationPath: string;
};

type StoredWalletIdentity = {
  mnemonic: string;
  address: string;
  derivationPath: string;
};

export const restoreLegacyCompatibleWallet = (
  stored: StoredWalletIdentity,
): Wallet => ({
  mnemonic: stored.mnemonic,
  walletId: stored.address,
  walletIdDerivationPath: stored.derivationPath,
  // Lot 1 preserves the exact 1.3.1 receive behavior. Lot 2 changes only the
  // visible receive address while keeping walletId stable.
  receiveAddress: stored.address,
  receiveDerivationPath: stored.derivationPath,
});

export const deriveLegacyCompatibleWallet = async (
  mnemonic: string,
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
): Promise<Wallet> => {
  const [derived] = await crypto.deriveAddresses(mnemonic, [{
    path: LEGACY_WALLET_ID_DERIVATION_PATH,
    scriptType: 'p2wpkh',
  }]);
  if (!derived) {
    throw new Error('Unable to derive the stable wallet identity.');
  }

  return restoreLegacyCompatibleWallet({
    mnemonic,
    address: derived.address,
    derivationPath: LEGACY_WALLET_ID_DERIVATION_PATH,
  });
};
