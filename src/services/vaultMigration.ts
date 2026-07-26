import type { EncryptedVault } from './vaultCrypto';

export const prepareVaultUpgradeCommit = (
  upgraded: EncryptedVault,
  latest: EncryptedVault | null,
  decryptedWalletAddress: string,
): EncryptedVault | null => {
  if (!latest || latest.address !== decryptedWalletAddress) {
    return null;
  }

  return {
    ...upgraded,
    biometricsEnabled: latest.biometricsEnabled,
    unlockMode: latest.unlockMode ?? upgraded.unlockMode,
  };
};
