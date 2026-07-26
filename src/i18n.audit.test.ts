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

  it('resolves every settings section title in every language', () => {
    const expected = {
      en: ['Security', 'Display', 'Network and synchronization', 'About', 'Danger zone'],
      zh: ['安全', '显示', '网络与同步', '关于', '危险区域'],
      hi: ['सुरक्षा', 'प्रदर्शन', 'नेटवर्क और सिंक्रनाइज़ेशन', 'परिचय', 'जोखिम क्षेत्र'],
      es: ['Seguridad', 'Visualización', 'Red y sincronización', 'Acerca de', 'Zona de peligro'],
      fr: ['Sécurité', 'Affichage', 'Réseau et synchronisation', 'À propos', 'Zone de danger'],
      ar: ['الأمان', 'العرض', 'الشبكة والمزامنة', 'حول', 'منطقة الخطر'],
      bn: ['নিরাপত্তা', 'প্রদর্শন', 'নেটওয়ার্ক ও সিঙ্ক্রোনাইজেশন', 'সম্পর্কে', 'বিপজ্জনক এলাকা'],
      pt: ['Segurança', 'Exibição', 'Rede e sincronização', 'Sobre', 'Zona de perigo'],
      ru: ['Безопасность', 'Отображение', 'Сеть и синхронизация', 'О приложении', 'Опасная зона'],
    } satisfies Record<LanguageCode, string[]>;
    const keys = [
      'settings.sectionSecurity',
      'settings.sectionDisplay',
      'settings.sectionNetwork',
      'settings.sectionAbout',
      'settings.sectionDanger',
    ] as const;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      expect(keys.map((key) => makeTranslator(code)(key))).toEqual(expected[code]);
    }
  });
});
