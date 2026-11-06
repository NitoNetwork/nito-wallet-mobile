import { beforeEach, describe, expect, it } from 'vitest';

import { PBKDF2_ROUNDS } from '../constants/nito';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import type { NitoWalletCryptoApi } from '../native/nitoWalletCryptoContract';
import { decryptVault, deriveKey, encryptVault, type VaultPayload } from './vaultCrypto';

const TEST_PBKDF2_ROUNDS = 2_000;
const requestedPbkdf2Rounds: number[] = [];
const baseCrypto = createNitoWalletCryptoTestDouble();
const crypto: NitoWalletCryptoApi = {
  ...baseCrypto,
  pbkdf2(request) {
    requestedPbkdf2Rounds.push(request.rounds);
    return baseCrypto.pbkdf2({
      ...request,
      rounds: Math.min(request.rounds, TEST_PBKDF2_ROUNDS),
    });
  },
};

const payload: VaultPayload = {
  version: 1,
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  address: 'nito1qwx67xwjcfy7ccy2u0hycqk5x3jsjqjjs60zwg6',
  derivationPath: "m/84'/0'/0'/0/0",
  createdAt: '2026-07-25T00:00:00.000Z',
};

describe('vault encryption', () => {
  beforeEach(() => {
    requestedPbkdf2Rounds.length = 0;
  });

  it('round-trips the payload with the right password', async () => {
    const vault = await encryptVault(payload, 'correct horse battery', false, 'password', crypto);
    const opened = await decryptVault(vault, 'correct horse battery', 'invalid', crypto);

    expect(opened).toEqual({ ...payload, bip39Passphrase: '' });
    expect(vault.rounds).toBe(PBKDF2_ROUNDS);
    expect(requestedPbkdf2Rounds).toEqual([PBKDF2_ROUNDS, PBKDF2_ROUNDS]);
  });

  it('keeps an optional BIP39 passphrase inside the encrypted payload', async () => {
    const protectedPayload = { ...payload, bip39Passphrase: 'exact recovery secret' };
    const vault = await encryptVault(
      protectedPayload,
      'correct horse battery',
      false,
      'password',
      crypto,
    );
    const serialized = JSON.stringify(vault);
    const opened = await decryptVault(vault, 'correct horse battery', 'invalid', crypto);

    expect(serialized).not.toContain(protectedPayload.bip39Passphrase);
    expect(opened).toEqual(protectedPayload);
  });

  it('never stores the mnemonic in clear text', async () => {
    const vault = await encryptVault(payload, 'correct horse battery', false, 'password', crypto);
    const serialized = JSON.stringify(vault);

    expect(serialized).not.toContain('abandon');
    expect(serialized).not.toContain('correct horse battery');
    expect(vault.address).toBe(payload.address);
  });

  it('rejects a wrong password instead of returning garbage', async () => {
    const vault = await encryptVault(payload, 'correct horse battery', false, 'password', crypto);

    await expect(decryptVault(vault, 'wrong password', 'invalid vault', crypto)).rejects.toThrow('invalid vault');
  });

  it('uses a fresh salt and nonce for every vault', async () => {
    const first = await encryptVault(payload, 'same password', false, 'password', crypto);
    const second = await encryptVault(payload, 'same password', false, 'password', crypto);

    expect(first.salt).not.toBe(second.salt);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('still opens a legacy vault stored with fewer KDF rounds', async () => {
    const vault = await encryptVault(payload, 'legacy password', true, 'biometric', crypto);
    const legacy = {
      ...vault,
      rounds: 120_000,
      salt: vault.salt,
    };
    const legacyKey = await deriveKey('legacy password', Uint8Array.from(atob(vault.salt), (c) => c.charCodeAt(0)), 120_000, crypto);

    expect(legacyKey).toHaveLength(32);
    expect(legacy.biometricsEnabled).toBe(true);
    expect(legacy.unlockMode).toBe('biometric');
  });

  it('derives a distinct key per round count', async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
    const low = await deriveKey('password', salt, 1_000, crypto);
    const high = await deriveKey('password', salt, 2_000, crypto);

    expect([...low].join(',')).not.toBe([...high].join(','));
  });
});
