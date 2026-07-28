import { reportNonFinancialFailure } from './diagnostics';

export class WalletStorageError extends Error {
  constructor() {
    super('Wallet storage operation failed.');
    this.name = 'WalletStorageError';
  }
}

export const runWalletStorageOperation = async <T>(
  operation: string,
  task: () => Promise<T>,
): Promise<T> => {
  try {
    return await task();
  } catch (caught) {
    if (caught instanceof WalletStorageError) {
      throw caught;
    }
    reportNonFinancialFailure(operation, caught);
    throw new WalletStorageError();
  }
};

export const userFacingErrorMessage = (
  caught: unknown,
  fallback: string,
  walletStorageUnavailable: string,
  operation = 'wallet operation',
): string => {
  if (caught instanceof WalletStorageError) {
    return walletStorageUnavailable;
  }
  reportNonFinancialFailure(operation, caught);
  return fallback;
};
