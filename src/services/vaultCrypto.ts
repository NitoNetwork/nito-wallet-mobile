import nacl from 'tweetnacl';

import { PBKDF2_ROUNDS, SALT_BYTE_LENGTH, VAULT_VERSION } from '../constants/nito';
import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
import type { NitoWalletCryptoApi } from '../native/nitoWalletCryptoContract';
import { decodeUtf8 } from '../security/utf8';

export type VaultPayload = {
  version: 1;
  mnemonic: string;
  address: string;
  derivationPath: string;
  createdAt: string;
};

export type EncryptedVault = {
  version: 1;
  kdf: 'pbkdf2-sha256';
  rounds: number;
  salt: string;
  nonce: string;
  ciphertext: string;
  address: string;
  derivationPath: string;
  createdAt: string;
  biometricsEnabled: boolean;
  unlockMode?: 'password' | 'biometric';
};

export const uint8ArrayToBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
export const base64ToUint8Array = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export const deriveKey = async (
  password: string,
  salt: Uint8Array,
  rounds = PBKDF2_ROUNDS,
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
) => {
  const { keyBase64 } = await crypto.pbkdf2({
    password,
    saltBase64: uint8ArrayToBase64(salt),
    rounds,
    outputLength: 32,
  });
  return base64ToUint8Array(keyBase64);
};

export const encryptVault = async (
  payload: VaultPayload,
  password: string,
  biometricsEnabled: boolean,
  unlockMode: 'password' | 'biometric' = 'password',
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
): Promise<EncryptedVault> => {
  const salt = nacl.randomBytes(SALT_BYTE_LENGTH);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = await deriveKey(password, salt, PBKDF2_ROUNDS, crypto);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = nacl.secretbox(plaintext, nonce, key);

  return {
    version: VAULT_VERSION,
    kdf: 'pbkdf2-sha256',
    rounds: PBKDF2_ROUNDS,
    salt: uint8ArrayToBase64(salt),
    nonce: uint8ArrayToBase64(nonce),
    ciphertext: uint8ArrayToBase64(ciphertext),
    address: payload.address,
    derivationPath: payload.derivationPath,
    createdAt: payload.createdAt,
    biometricsEnabled,
    unlockMode,
  };
};

export const decryptVault = async (
  vault: EncryptedVault,
  password: string,
  invalidMessage = 'Invalid password or corrupted vault.',
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
): Promise<VaultPayload> => {
  const key = await deriveKey(password, base64ToUint8Array(vault.salt), vault.rounds || PBKDF2_ROUNDS, crypto);
  const plaintext = nacl.secretbox.open(
    base64ToUint8Array(vault.ciphertext),
    base64ToUint8Array(vault.nonce),
    key,
  );

  if (!plaintext) {
    throw new Error(invalidMessage);
  }

  return JSON.parse(decodeUtf8(plaintext)) as VaultPayload;
};
