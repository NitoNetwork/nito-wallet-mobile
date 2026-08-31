import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
import type { NitoWalletCryptoApi } from '../native/nitoWalletCryptoContract';
import {
  DEFAULT_RECEIVE_ACCOUNT_KEY,
  deriveHdAddress,
  type HdAccountKey,
} from './hdAddress';

export const LEGACY_WALLET_ID_DERIVATION_PATH = "m/84'/0'/0'/0/0";

export type Wallet = {
  mnemonic: string;
  walletId: string;
  walletIdDerivationPath: string;
  primaryAddress: string;
  primaryDerivationPath: string;
  primaryIndex: number;
  receiveAccountKey: HdAccountKey;
  receiveIndex: number;
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
  receiveAccountKey: HdAccountKey = DEFAULT_RECEIVE_ACCOUNT_KEY,
  receiveIndex = 0,
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
): Promise<Wallet> => deriveHdAddress(
  stored.mnemonic,
  receiveAccountKey,
  'external',
  receiveIndex,
  crypto,
).then((receive) => ({
  mnemonic: stored.mnemonic,
  walletId: stored.address,
  walletIdDerivationPath: stored.derivationPath,
  primaryAddress: receiveAccountKey === DEFAULT_RECEIVE_ACCOUNT_KEY
    ? receive.address
    : stored.address,
  primaryDerivationPath: receiveAccountKey === DEFAULT_RECEIVE_ACCOUNT_KEY
    ? receive.path
    : stored.derivationPath,
  primaryIndex: receiveAccountKey === DEFAULT_RECEIVE_ACCOUNT_KEY ? receiveIndex : 0,
  receiveAccountKey,
  receiveIndex,
  receiveAddress: receive.address,
  receiveDerivationPath: receive.path,
}));

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
  }, DEFAULT_RECEIVE_ACCOUNT_KEY, 0, crypto);
};
