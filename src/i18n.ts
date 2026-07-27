import { ar } from './i18n/ar';
import { bn } from './i18n/bn';
import { en } from './i18n/en';
import { es } from './i18n/es';
import { fr } from './i18n/fr';
import { hi } from './i18n/hi';
import { pt } from './i18n/pt';
import { ru } from './i18n/ru';
import { zh } from './i18n/zh';

export const LANGUAGES = [
  { code: 'en', short: 'EN', name: 'English' },
  { code: 'zh', short: 'ZH', name: '中文' },
  { code: 'hi', short: 'HI', name: 'हिन्दी' },
  { code: 'es', short: 'ES', name: 'Español' },
  { code: 'fr', short: 'FR', name: 'Français' },
  { code: 'ar', short: 'AR', name: 'العربية' },
  { code: 'bn', short: 'BN', name: 'বাংলা' },
  { code: 'pt', short: 'PT', name: 'Português' },
  { code: 'ru', short: 'RU', name: 'Русский' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export type TranslationKey = keyof typeof en;
export type TranslationSet = Record<TranslationKey, string>;
export type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

/**
 * One flat dictionary per language, no merging. A key therefore has exactly one
 * definition site per language: editing the wrong block, or having a later
 * object silently override an earlier one, is no longer possible.
 */
export const TRANSLATIONS: Record<LanguageCode, TranslationSet> = {
  en, zh, hi, es, fr, ar, bn, pt, ru,
};

/** Language-neutral strings, exempt from the "must differ from English" audit. */
const SHARED_TRANSLATION_KEYS = new Set<TranslationKey>([
  'brand.wallet',
  'import.placeholder',
  'history.mempool',
  'history.loadingCount',
  'actions.ok',
]);

export function auditTranslationCoverage() {
  return LANGUAGES
    .filter((language) => language.code !== DEFAULT_LANGUAGE)
    .flatMap((language) =>
      (Object.keys(en) as TranslationKey[])
        .filter((key) => !SHARED_TRANSLATION_KEYS.has(key))
        .filter((key) => TRANSLATIONS[language.code][key] === TRANSLATIONS[DEFAULT_LANGUAGE][key])
        .map((key) => `${language.code}:${key}`),
    );
}

export function auditTranslationQuality() {
  const corruptedPattern = /\uFFFD|\?{2,}|[\p{L}]\?[\p{L}]|Ã|Â|Ð|Ñ|Ø|Ù|à¤|à¦|åŠ|å®/u;
  return LANGUAGES.flatMap((language) =>
    (Object.keys(en) as TranslationKey[])
      .filter((key) => corruptedPattern.test(TRANSLATIONS[language.code][key]))
      .map((key) => `${language.code}:${key}`),
  );
}

export function makeTranslator(language: LanguageCode): Translator {
  const dictionary = TRANSLATIONS[language] ?? TRANSLATIONS[DEFAULT_LANGUAGE];

  return (key, values = {}) => {
    let text = dictionary[key] ?? TRANSLATIONS[DEFAULT_LANGUAGE][key] ?? key;

    for (const [name, value] of Object.entries(values)) {
      text = text.split(`{${name}}`).join(String(value));
    }

    return text;
  };
}
