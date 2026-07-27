import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';

import { reportNonFinancialFailure } from '../services/diagnostics';
import { DEFAULT_THEME, isThemeName, type ThemeName } from '../ui/theme';

const THEME_PREFERENCE_KEY = 'nito.wallet.theme.v1';

export const loadThemePreference = async (): Promise<ThemeName> => {
  try {
    const saved = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
    return isThemeName(saved) ? saved : DEFAULT_THEME;
  } catch (caught) {
    reportNonFinancialFailure('theme preference read', caught);
    return DEFAULT_THEME;
  }
};

export const saveThemePreference = async (theme: ThemeName): Promise<void> => {
  try {
    await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, theme);
  } catch (caught) {
    reportNonFinancialFailure('theme preference write', caught);
  }
};

export const useThemePreference = () => {
  const [theme, setTheme] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    let mounted = true;
    void loadThemePreference().then((saved) => {
      if (mounted) setTheme(saved);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const selectTheme = useCallback((next: ThemeName) => {
    setTheme(next);
    void saveThemePreference(next);
  }, []);

  return { theme, selectTheme };
};
