import { describe, expect, it, vi } from 'vitest';

import {
  WalletStorageError,
  runWalletStorageOperation,
  userFacingErrorMessage,
} from './walletStorageError';

const diagnostics = vi.hoisted(() => ({
  reportNonFinancialFailure: vi.fn(),
}));

vi.mock('./diagnostics', () => diagnostics);

describe('wallet storage errors', () => {
  it('keeps the driver detail in diagnostics and exposes only the localized message', async () => {
    const driverError = new Error(
      "Call to function 'NativeDatabase.execAsync' has been rejected: cannot start a transaction within a transaction",
    );
    let caught: unknown;

    try {
      await runWalletStorageOperation('wallet history write', async () => {
        throw driverError;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WalletStorageError);
    expect(caught).toMatchObject({
      message: 'Wallet storage operation failed.',
    });
    expect(diagnostics.reportNonFinancialFailure).toHaveBeenCalledWith(
      'wallet history write',
      driverError,
    );
    expect(userFacingErrorMessage(
      caught,
      'Fallback error',
      'Localized storage error',
    )).toBe('Localized storage error');
    expect(userFacingErrorMessage(
      new Error('Ordinary error'),
      'Fallback error',
      'Localized storage error',
    )).toBe('Ordinary error');
  });
});
