import { NativeModules } from 'react-native';

import {
  createNitoWalletCryptoBridge,
  type NitoWalletCryptoNativeModule,
} from './nitoWalletCryptoContract';

export const nitoWalletCrypto = createNitoWalletCryptoBridge(
  NativeModules.NitoWalletCrypto as NitoWalletCryptoNativeModule | undefined,
);
