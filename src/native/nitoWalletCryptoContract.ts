export type TransparentScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';

export type NativeAddressRequest = {
  path: string;
  scriptType: TransparentScriptType;
};

export type NativeDerivedAddress = NativeAddressRequest & {
  address: string;
  publicKeyHex: string;
  scriptHex: string;
  redeemScriptHex?: string;
  tapInternalKeyHex?: string;
};

export type NativePsbtSigner = {
  txid: string;
  vout: number;
  path: string;
  scriptType: TransparentScriptType;
};

export type NitoWalletCryptoNativeModule = {
  invoke(operation: string, requestJson: string): Promise<string>;
};

type NativeEnvelope<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string } };

export class NitoWalletCryptoUnavailableError extends Error {
  code = 'NITO_WALLET_CRYPTO_UNAVAILABLE';

  constructor() {
    super('The native Nito Wallet Rust cryptographic core is not linked.');
  }
}

export type NitoWalletCryptoApi = ReturnType<typeof createNitoWalletCryptoBridge>;

export const normalizeBip39Passphrase = (passphrase: string): string =>
  passphrase.normalize('NFKD');

export const createNitoWalletCryptoBridge = (nativeModule?: NitoWalletCryptoNativeModule | null) => {
  const invoke = async <T>(operation: string, request: unknown): Promise<T> => {
    if (!nativeModule) {
      throw new NitoWalletCryptoUnavailableError();
    }
    const raw = await nativeModule.invoke(operation, JSON.stringify(request));
    const envelope = JSON.parse(raw) as NativeEnvelope<T>;
    if (!envelope.ok) {
      const error = new Error(envelope.error.message) as Error & { code?: string };
      error.code = envelope.error.code;
      throw error;
    }
    return envelope.result;
  };

  return {
    isAvailable: () => Boolean(nativeModule),

    randomBytes(length: number) {
      return invoke<{ bytesBase64: string }>('randomBytes', { length });
    },

    generateMnemonic(additionalEntropyBase64?: string) {
      return invoke<{ mnemonic: string }>(
        'generateMnemonic',
        additionalEntropyBase64 === undefined ? {} : { additionalEntropyBase64 },
      );
    },

    pbkdf2(request: { password: string; saltBase64: string; rounds: number; outputLength: number }) {
      return invoke<{ keyBase64: string }>('pbkdf2', request);
    },

    deriveAddresses(
      mnemonic: string,
      requests: NativeAddressRequest[],
      bip39Passphrase = '',
    ) {
      return invoke<NativeDerivedAddress[]>('deriveAddresses', {
        mnemonic,
        bip39Passphrase: normalizeBip39Passphrase(bip39Passphrase),
        requests,
      });
    },

    signPsbt(request: {
      mnemonic: string;
      bip39Passphrase?: string;
      psbtBase64: string;
      signers: NativePsbtSigner[];
    }) {
      return invoke<{ psbtBase64: string }>('signPsbt', {
        ...request,
        bip39Passphrase: normalizeBip39Passphrase(request.bip39Passphrase ?? ''),
      });
    },
  };
};

export const bindBip39Passphrase = (
  crypto: NitoWalletCryptoApi,
  passphrase: string,
): NitoWalletCryptoApi => {
  const normalized = normalizeBip39Passphrase(passphrase);
  return {
    ...crypto,
    deriveAddresses: (mnemonic, requests) => (
      crypto.deriveAddresses(mnemonic, requests, normalized)
    ),
    signPsbt: (request) => crypto.signPsbt({
      ...request,
      bip39Passphrase: normalized,
    }),
  };
};
