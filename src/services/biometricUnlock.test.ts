import { describe, expect, it } from 'vitest';

import { BiometricUnlockCancelledError, readBiometricSecretForUnlock } from './biometricUnlock';
import { WalletStorageError } from './walletStorageError';

describe('biometric unlock error boundary', () => {
  it.each([
    'User canceled the operation.',
    'Could not Authenticate the user: User canceled the authentication. Authentication canceled.',
  ])('recognizes explicit SecureStore prompt cancellation: %s', async (message) => {
    await expect(readBiometricSecretForUnlock(async () => { throw new Error(message); }))
      .rejects.toBeInstanceOf(BiometricUnlockCancelledError);
  });

  it.each([
    new Error('I/O error.'),
    new Error('No keychain is available.'),
    new Error('Could not Authenticate the user: Hardware unavailable.'),
    new Error('Authentication failed.'),
  ])('does not call an authentication or storage failure a cancellation: %s', async (failure) => {
    await expect(readBiometricSecretForUnlock(async () => { throw failure; })).rejects.toBe(failure);
  });

  it('does not classify a missing biometric secret as cancellation', async () => {
    await expect(readBiometricSecretForUnlock(async () => null)).resolves.toBeNull();
  });

  it.each([
    new Error('HD address derivation returned an inconsistent result.'),
    new Error('Native cryptographic operation aborted'),
    new WalletStorageError(),
  ])('preserves a failure after successful authentication: %s', async (failure) => {
    const operation = readBiometricSecretForUnlock(async () => 'test-only').then(() => { throw failure; });
    await expect(operation).rejects.toBe(failure);
    expect(failure).not.toBeInstanceOf(BiometricUnlockCancelledError);
  });
});
