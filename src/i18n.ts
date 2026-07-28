import { en } from './i18n/en';
import { es } from './i18n/es';
import { fr } from './i18n/fr';
import { de } from './i18n/de';
import { ja } from './i18n/ja';
import { tr } from './i18n/tr';
import { pt } from './i18n/pt';
import { ru } from './i18n/ru';
import { zh } from './i18n/zh';

export const LANGUAGES = [
  { code: 'en', short: 'EN', name: 'English' },
  { code: 'zh', short: 'ZH', name: '中文' },
  { code: 'de', short: 'DE', name: 'Deutsch' },
  { code: 'es', short: 'ES', name: 'Español' },
  { code: 'fr', short: 'FR', name: 'Français' },
  { code: 'ja', short: 'JA', name: '日本語' },
  { code: 'tr', short: 'TR', name: 'Türkçe' },
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
  en, zh, de, es, fr, ja, tr, pt, ru,
};

/** Language-neutral strings, exempt from the "must differ from English" audit. */
const SHARED_TRANSLATION_KEYS = new Set<TranslationKey>([
  'brand.wallet',
  'import.placeholder',
  'history.mempool',
  // 'Block' is the same word in English and German.
  'history.block',
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
