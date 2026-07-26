import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTO_LOCK_TIMEOUT_MS } from '../constants/nito';
import {
  isAutoLockTimeoutMs,
  loadAutoLockTimeoutPreference,
  saveAutoLockTimeoutPreference,
} from './useAutoLockTimeout';

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));
const diagnostics = vi.hoisted(() => ({
  reportNonFinancialFailure: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);
vi.mock('../services/diagnostics', () => diagnostics);

describe('auto-lock timeout preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts only supported persisted values', () => {
    expect(isAutoLockTimeoutMs('0')).toBe(false);
    expect(isAutoLockTimeoutMs('60000')).toBe(true);
    expect(isAutoLockTimeoutMs('300000')).toBe(true);
    expect(isAutoLockTimeoutMs('900000')).toBe(true);
    expect(isAutoLockTimeoutMs('120000')).toBe(false);
    expect(isAutoLockTimeoutMs(null)).toBe(false);
  });

  it('loads a valid value and silently falls back for an invalid value', async () => {
    secureStore.getItemAsync.mockResolvedValueOnce('60000');
    await expect(loadAutoLockTimeoutPreference()).resolves.toBe(60_000);

    secureStore.getItemAsync.mockResolvedValueOnce('invalid');
    await expect(loadAutoLockTimeoutPreference()).resolves.toBe(AUTO_LOCK_TIMEOUT_MS);

    secureStore.getItemAsync.mockResolvedValueOnce('0');
    await expect(loadAutoLockTimeoutPreference()).resolves.toBe(AUTO_LOCK_TIMEOUT_MS);
    expect(diagnostics.reportNonFinancialFailure).not.toHaveBeenCalled();
  });

  it('reports read and write failures without propagating them', async () => {
    const readFailure = new Error('read failed');
    secureStore.getItemAsync.mockRejectedValueOnce(readFailure);
    await expect(loadAutoLockTimeoutPreference()).resolves.toBe(AUTO_LOCK_TIMEOUT_MS);
    expect(diagnostics.reportNonFinancialFailure).toHaveBeenCalledWith(
      'auto-lock timeout preference read',
      readFailure,
    );

    const writeFailure = new Error('write failed');
    secureStore.setItemAsync.mockRejectedValueOnce(writeFailure);
    await expect(saveAutoLockTimeoutPreference(900_000)).resolves.toBeUndefined();
    expect(diagnostics.reportNonFinancialFailure).toHaveBeenCalledWith(
      'auto-lock timeout preference write',
      writeFailure,
    );
  });
});
