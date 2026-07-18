import * as SecureStore from 'expo-secure-store';
import { VAULT_KEY, VAULT_META_KEY } from '../constants/nito';
import type { VaultEnvelope, VaultMetadata } from '../core/types';

const AUTHENTICATED_VAULT_PROMPT = 'Authenticate to open the Nito vault.';

function vaultStoreOptions(withBiometrics = false): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: withBiometrics,
    authenticationPrompt: AUTHENTICATED_VAULT_PROMPT
  };
}

function metadataStoreOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  };
}

async function loadVaultMetadata(): Promise<VaultMetadata | null> {
  const raw = await SecureStore.getItemAsync(VAULT_META_KEY, metadataStoreOptions());
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as VaultMetadata;
}

export async function hasStoredWallet(): Promise<boolean> {
  const metadata = await loadVaultMetadata();
  return !!metadata?.exists;
}

export async function saveVaultEnvelope(
  vault: VaultEnvelope,
  withBiometrics = false
): Promise<void> {
  const payload = { ...vault, withBiometrics };
  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(payload), vaultStoreOptions(withBiometrics));
  await SecureStore.setItemAsync(
    VAULT_META_KEY,
    JSON.stringify({ exists: true, withBiometrics, updatedAt: Date.now() }),
    metadataStoreOptions()
  );
}

export async function loadVaultEnvelope(): Promise<VaultEnvelope | null> {
  const raw = await SecureStore.getItemAsync(VAULT_KEY, vaultStoreOptions(false));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as VaultEnvelope;
}

export async function getStoredVaultUsesBiometrics(): Promise<boolean> {
  const metadata = await loadVaultMetadata();
  return !!metadata?.withBiometrics;
}

export async function clearStoredWallet(): Promise<void> {
  await SecureStore.deleteItemAsync(VAULT_KEY, vaultStoreOptions(false));
  await SecureStore.deleteItemAsync(VAULT_META_KEY, metadataStoreOptions());
}
