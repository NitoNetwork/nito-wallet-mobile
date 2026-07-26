import { describe, expect, it } from 'vitest';

import type { EncryptedVault } from './vaultCrypto';
import { prepareVaultUpgradeCommit } from './vaultMigration';

const makeVault = (
  address: string,
  overrides: Partial<EncryptedVault> = {},
): EncryptedVault => ({
  version: 1,
  kdf: 'pbkdf2-sha256',
  rounds: 1,
  salt: 'salt',
  nonce: 'nonce',
  ciphertext: 'ciphertext',
  address,
  derivationPath: "m/84'/0'/0'/0/0",
  createdAt: '2026-01-01T00:00:00.000Z',
  biometricsEnabled: false,
  unlockMode: 'password',
  ...overrides,
});

describe('prepareVaultUpgradeCommit', () => {
  const upgraded = makeVault('wallet-a', {
    rounds: 600_000,
    salt: 'upgraded-salt',
    ciphertext: 'upgraded-ciphertext',
  });

  it('rejects the upgrade when the vault was deleted while PBKDF2 was running', () => {
    expect(prepareVaultUpgradeCommit(upgraded, null, 'wallet-a')).toBeNull();
  });

  it('rejects the upgrade when another vault replaced the decrypted wallet', () => {
    expect(prepareVaultUpgradeCommit(upgraded, makeVault('wallet-b'), 'wallet-a')).toBeNull();
  });

  it('commits only the reread vault and preserves its current unlock preferences', () => {
    const latest = makeVault('wallet-a', {
      biometricsEnabled: true,
      unlockMode: 'biometric',
    });

    expect(prepareVaultUpgradeCommit(upgraded, latest, 'wallet-a')).toEqual({
      ...upgraded,
      biometricsEnabled: true,
      unlockMode: 'biometric',
    });
  });

  it('keeps the upgraded unlock mode when a legacy reread vault has no mode', () => {
    const latest = makeVault('wallet-a', { unlockMode: undefined });

    expect(prepareVaultUpgradeCommit(upgraded, latest, 'wallet-a')?.unlockMode).toBe('password');
  });
});
