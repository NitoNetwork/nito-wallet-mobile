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

    pbkdf2(request: { password: string; saltBase64: string; rounds: number; outputLength: number }) {
      return invoke<{ keyBase64: string }>('pbkdf2', request);
    },

    deriveAddresses(mnemonic: string, requests: NativeAddressRequest[]) {
      return invoke<NativeDerivedAddress[]>('deriveAddresses', { mnemonic, requests });
    },

    signPsbt(request: { mnemonic: string; psbtBase64: string; signers: NativePsbtSigner[] }) {
      return invoke<{ psbtBase64: string }>('signPsbt', request);
    },
  };
};
