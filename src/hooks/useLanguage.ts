import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DEFAULT_LANGUAGE, LANGUAGES, makeTranslator, type LanguageCode } from '../i18n';
import { reportNonFinancialFailure } from '../services/diagnostics';

const LANGUAGE_PREFERENCE_KEY = 'nito.wallet.language.v1';

export const isLanguageCode = (value: string | null): value is LanguageCode =>
  LANGUAGES.some((entry) => entry.code === value);

export const detectSystemLanguage = (): LanguageCode => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const primaryLanguage = locale.toLowerCase().replace('_', '-').split('-', 1)[0] ?? '';
    return isLanguageCode(primaryLanguage) ? primaryLanguage : DEFAULT_LANGUAGE;
  } catch (caught) {
    reportNonFinancialFailure('system language detection', caught);
    return DEFAULT_LANGUAGE;
  }
};

export const useLanguage = () => {
  const [language, setLanguage] = useState<LanguageCode>(detectSystemLanguage);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    void SecureStore.getItemAsync(LANGUAGE_PREFERENCE_KEY)
      .then((saved) => {
        if (mounted && isLanguageCode(saved)) {
          setLanguage(saved);
        }
      })
      .catch((caught) => {
        reportNonFinancialFailure('language preference read', caught);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const t = useMemo(() => makeTranslator(language), [language]);
  const selected = useMemo(
    () => LANGUAGES.find((entry) => entry.code === language) ?? LANGUAGES[0],
    [language],
  );

  const select = useCallback((next: LanguageCode) => {
    setLanguage(next);
    setPickerOpen(false);
    void SecureStore.setItemAsync(LANGUAGE_PREFERENCE_KEY, next).catch((caught) => {
      reportNonFinancialFailure('language preference write', caught);
    });
  }, []);

  const togglePicker = useCallback(() => setPickerOpen((current) => !current), []);

  return { language, t, selected, pickerOpen, togglePicker, select };
};
