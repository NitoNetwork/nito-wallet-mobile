import { describe, expect, it } from 'vitest';

import {
  auditTranslationCoverage,
  auditTranslationQuality,
  makeTranslator,
  type LanguageCode,
} from './i18n';

describe('i18n coverage', () => {
  it('does not fall back to English for critical visible wallet copy', () => {
    expect(auditTranslationCoverage()).toEqual([]);
  });

  it('contains no visibly corrupted public translation', () => {
    expect(auditTranslationQuality()).toEqual([]);
  });

  it('resolves the NITO balance title in every language', () => {
    const expected = {
      en: 'Balance NITO',
      zh: '余额 NITO',
      hi: 'शेष राशि NITO',
      es: 'Saldo NITO',
      fr: 'Solde NITO',
      ar: 'الرصيد NITO',
      bn: 'ব্যালেন্স NITO',
      pt: 'Saldo NITO',
      ru: 'Баланс NITO',
    } satisfies Record<LanguageCode, string>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      expect(makeTranslator(code)('home.title')).toBe(expected[code]);
    }
  });

  it('resolves the NITO history title in every language', () => {
    const expected = {
      en: 'History NITO',
      zh: '历史 NITO',
      hi: 'इतिहास NITO',
      es: 'Historial NITO',
      fr: 'Historique NITO',
      ar: 'السجل NITO',
      bn: 'ইতিহাস NITO',
      pt: 'Histórico NITO',
      ru: 'История NITO',
    } satisfies Record<LanguageCode, string>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      expect(makeTranslator(code)('history.title')).toBe(expected[code]);
    }
  });
});
