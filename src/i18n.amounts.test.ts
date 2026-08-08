import { describe, expect, it } from 'vitest';

import type { LanguageCode } from './i18n';
import { formatLocalizedInteger } from './i18n.amounts';

describe('localized integer formatting', () => {
  it('uses the deterministic separator of every supported language', () => {
    const expected: Record<LanguageCode, string> = {
      en: '9,983,804',
      zh: '9,983,804',
      de: '9.983.804',
      es: '9.983.804',
      fr: '9\u202f983\u202f804',
      ja: '9,983,804',
      tr: '9.983.804',
      pt: '9.983.804',
      ru: '9\u202f983\u202f804',
    };

    for (const [language, formatted] of Object.entries(expected)) {
      expect(formatLocalizedInteger(9_983_804, language as LanguageCode)).toBe(formatted);
    }
  });
});
