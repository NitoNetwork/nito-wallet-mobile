import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
import {
  bindBip39Passphrase,
  normalizeBip39Passphrase,
  type NitoWalletCryptoApi,
} from '../native/nitoWalletCryptoContract';
import {
  DEFAULT_RECEIVE_ACCOUNT_KEY,
  deriveHdAddress,
  type HdAccountKey,
} from './hdAddress';

export const LEGACY_WALLET_ID_DERIVATION_PATH = "m/84'/0'/0'/0/0";

export type Wallet = {
  mnemonic: string;
  bip39Passphrase: string;
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
  bip39Passphrase?: string;
  address: string;
  derivationPath: string;
};

export const restoreLegacyCompatibleWallet = (
  stored: StoredWalletIdentity,
  receiveAccountKey: HdAccountKey = DEFAULT_RECEIVE_ACCOUNT_KEY,
  receiveIndex = 0,
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
): Promise<Wallet> => {
  const bip39Passphrase = normalizeBip39Passphrase(stored.bip39Passphrase ?? '');
  const walletCrypto = bindBip39Passphrase(crypto, bip39Passphrase);
  return Promise.all([
    walletCrypto.deriveAddresses(stored.mnemonic, [{
      path: stored.derivationPath,
      scriptType: 'p2wpkh',
    }]),
    deriveHdAddress(
      stored.mnemonic,
      receiveAccountKey,
      'external',
      receiveIndex,
      walletCrypto,
    ),
  ]).then(([identities, receive]) => {
    if (identities[0]?.address !== stored.address) {
      throw new Error('Stored wallet identity does not match the recovery material.');
    }
    return {
      mnemonic: stored.mnemonic,
      bip39Passphrase,
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
    };
  });
};

export const deriveLegacyCompatibleWallet = async (
  mnemonic: string,
  bip39Passphrase = '',
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
): Promise<Wallet> => {
  const normalizedPassphrase = normalizeBip39Passphrase(bip39Passphrase);
  const walletCrypto = bindBip39Passphrase(crypto, normalizedPassphrase);
  const [derived] = await walletCrypto.deriveAddresses(mnemonic, [{
    path: LEGACY_WALLET_ID_DERIVATION_PATH,
    scriptType: 'p2wpkh',
  }]);
  if (!derived) {
    throw new Error('Unable to derive the stable wallet identity.');
  }

  return restoreLegacyCompatibleWallet({
    mnemonic,
    bip39Passphrase: normalizedPassphrase,
    address: derived.address,
    derivationPath: LEGACY_WALLET_ID_DERIVATION_PATH,
  }, DEFAULT_RECEIVE_ACCOUNT_KEY, 0, crypto);
};

export const cryptoForWallet = (
  wallet: Pick<Wallet, 'bip39Passphrase'>,
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
): NitoWalletCryptoApi => bindBip39Passphrase(crypto, wallet.bip39Passphrase);
