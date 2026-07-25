import * as SecureStore from 'expo-secure-store';

import type { EncryptedVault } from './vaultCrypto';

export const VAULT_KEY = 'nito.wallet.vault.v1';
export const BIOMETRIC_SECRET_KEY = 'nito.wallet.biometric.secret.v1';

const BIOMETRIC_PROMPT = 'Unlock Nito Wallet';

export * from './vaultCrypto';

export const loadVault = async () => {
  const raw = await SecureStore.getItemAsync(VAULT_KEY);
  return raw ? (JSON.parse(raw) as EncryptedVault) : null;
};

export const saveVault = async (vault: EncryptedVault) => {
  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(vault), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

export const deleteVault = async () => {
  await SecureStore.deleteItemAsync(VAULT_KEY);
};

export const saveBiometricSecret = async (secret: string) => {
  await SecureStore.setItemAsync(BIOMETRIC_SECRET_KEY, secret, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: BIOMETRIC_PROMPT,
  });
};

export const loadBiometricSecret = async () =>
  SecureStore.getItemAsync(BIOMETRIC_SECRET_KEY, {
    requireAuthentication: true,
    authenticationPrompt: BIOMETRIC_PROMPT,
  });

export const deleteBiometricSecret = async () => {
  await SecureStore.deleteItemAsync(BIOMETRIC_SECRET_KEY).catch(() => undefined);
};
