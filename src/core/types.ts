export interface WalletRecord {
  mnemonic: string;
  address: string;
  derivationPath: string;
  createdAt: number;
}

export interface VaultEnvelope {
  version: number;
  createdAt: number;
  withBiometrics?: boolean;
  kdf: {
    name: 'pbkdf2-sha256';
    iterations: number;
    salt: string;
  };
  nonce: string;
  ciphertext: string;
}

export interface VaultMetadata {
  exists: boolean;
  withBiometrics: boolean;
  updatedAt: number;
}

export type WordCount = 12 | 24;
