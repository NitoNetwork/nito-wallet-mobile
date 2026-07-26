import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';

import {
  AUTO_LOCK_TIMEOUT_MS,
  AUTO_LOCK_TIMEOUT_OPTIONS_MS,
  type AutoLockTimeoutMs,
} from '../constants/nito';
import { reportNonFinancialFailure } from '../services/diagnostics';

const AUTO_LOCK_TIMEOUT_PREFERENCE_KEY = 'nito.wallet.autoLockTimeout.v1';

export const isAutoLockTimeoutMs = (
  value: string | null,
): value is `${AutoLockTimeoutMs}` =>
  AUTO_LOCK_TIMEOUT_OPTIONS_MS.some((option) => String(option) === value);

export const loadAutoLockTimeoutPreference = async (): Promise<AutoLockTimeoutMs> => {
  try {
    const saved = await SecureStore.getItemAsync(AUTO_LOCK_TIMEOUT_PREFERENCE_KEY);
    return isAutoLockTimeoutMs(saved)
      ? Number(saved) as AutoLockTimeoutMs
      : AUTO_LOCK_TIMEOUT_MS;
  } catch (caught) {
    reportNonFinancialFailure('auto-lock timeout preference read', caught);
    return AUTO_LOCK_TIMEOUT_MS;
  }
};

export const saveAutoLockTimeoutPreference = async (
  timeoutMs: AutoLockTimeoutMs,
): Promise<void> => {
  try {
    await SecureStore.setItemAsync(AUTO_LOCK_TIMEOUT_PREFERENCE_KEY, String(timeoutMs));
  } catch (caught) {
    reportNonFinancialFailure('auto-lock timeout preference write', caught);
  }
};

export const useAutoLockTimeout = () => {
  const [autoLockTimeoutMs, setAutoLockTimeoutMs] = useState<AutoLockTimeoutMs>(
    AUTO_LOCK_TIMEOUT_MS,
  );

  useEffect(() => {
    let mounted = true;
    void loadAutoLockTimeoutPreference().then((saved) => {
      if (mounted) {
        setAutoLockTimeoutMs(saved);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const selectAutoLockTimeout = useCallback((next: AutoLockTimeoutMs) => {
    setAutoLockTimeoutMs(next);
    void saveAutoLockTimeoutPreference(next);
  }, []);

  return { autoLockTimeoutMs, selectAutoLockTimeout };
};
