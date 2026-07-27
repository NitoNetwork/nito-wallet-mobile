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

  it('names the BIP39 phrase explicitly in every language', () => {
    const expected = {
      en: ['Show BIP39 phrase', 'Hide BIP39 phrase'],
      zh: ['显示 BIP39 助记词', '隐藏 BIP39 助记词'],
      hi: ['BIP39 वाक्यांश दिखाएँ', 'BIP39 वाक्यांश छिपाएँ'],
      es: ['Mostrar frase BIP39', 'Ocultar frase BIP39'],
      fr: ['Afficher la phrase BIP39', 'Masquer la phrase BIP39'],
      ar: ['عرض عبارة BIP39', 'إخفاء عبارة BIP39'],
      bn: ['BIP39 বাক্যাংশ দেখান', 'BIP39 বাক্যাংশ লুকান'],
      pt: ['Mostrar frase BIP39', 'Ocultar frase BIP39'],
      ru: ['Показать фразу BIP39', 'Скрыть фразу BIP39'],
    } satisfies Record<LanguageCode, [string, string]>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      const t = makeTranslator(code);
      expect([t('actions.showSeed'), t('actions.hideSeed')]).toEqual(expected[code]);
    }
  });

  it('translates the local wallet storage failure in every language', () => {
    const english = makeTranslator('en')('errors.walletStorageUnavailable');

    for (const { code } of [
      { code: 'en' },
      { code: 'zh' },
      { code: 'hi' },
      { code: 'es' },
      { code: 'fr' },
      { code: 'ar' },
      { code: 'bn' },
      { code: 'pt' },
      { code: 'ru' },
    ] as const) {
      const message = makeTranslator(code)('errors.walletStorageUnavailable');
      expect(message).not.toContain('SQLite');
      expect(message).not.toContain('NativeDatabase');
      if (code !== 'en') {
        expect(message).not.toBe(english);
      }
    }
  });

  it('resolves the multi-recipient controls in every language', () => {
    const expected = {
      en: 'Add recipient',
      zh: '添加收款人',
      hi: 'प्राप्तकर्ता जोड़ें',
      es: 'Añadir destinatario',
      fr: 'Ajouter un destinataire',
      ar: 'إضافة مستلم',
      bn: 'প্রাপক যোগ করুন',
      pt: 'Adicionar destinatário',
      ru: 'Добавить получателя',
    } satisfies Record<LanguageCode, string>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      const t = makeTranslator(code);
      expect(t('send.addRecipient')).toBe(expected[code]);
      expect(t('send.totalWithFees', { amount: '1' })).toContain('1');
      if (code !== 'en') {
        expect(t('send.duplicateRecipientWarning')).not.toBe(
          makeTranslator('en')('send.duplicateRecipientWarning'),
        );
      }
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

  it('resolves custom Electrum recovery controls in every language', () => {
    const expected = {
      en: ['Custom ElectrumX server', 'Return to official servers'],
      zh: ['自定义 ElectrumX 服务器', '恢复官方服务器'],
      hi: ['कस्टम ElectrumX सर्वर', 'आधिकारिक सर्वर बहाल करें'],
      es: ['Servidor ElectrumX personalizado', 'Volver a servidores oficiales'],
      fr: ['Serveur ElectrumX personnalisé', 'Revenir aux serveurs officiels'],
      ar: ['خادم ElectrumX مخصص', 'العودة إلى الخوادم الرسمية'],
      bn: ['কাস্টম ElectrumX সার্ভার', 'অফিসিয়াল সার্ভারে ফিরুন'],
      pt: ['Servidor ElectrumX personalizado', 'Voltar aos servidores oficiais'],
      ru: ['Пользовательский сервер ElectrumX', 'Вернуться к официальным серверам'],
    } satisfies Record<LanguageCode, string[]>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      const t = makeTranslator(code);
      expect([
        t('settings.customElectrumTitle'),
        t('actions.useOfficialElectrum'),
      ]).toEqual(expected[code]);
      expect(t('settings.customElectrumCertificateWarning')).toContain('wss://');
      expect(t('settings.customElectrumRisk')).toContain('BIP143');
      expect(t('settings.customElectrumRisk')).toContain('IP');
      expect(t('settings.customElectrumRisk')).not.toBe('settings.customElectrumRisk');
    }

    const englishWarning = makeTranslator('en')('settings.customElectrumRisk');
    [
      'false balance',
      'hide incoming transactions',
      'prevent spending',
      'confirmation that does not exist',
      'all wallet addresses',
      'cannot steal funds',
      'signing stays local',
      'input amounts in the signature',
    ].forEach((requiredMeaning) => {
      expect(englishWarning).toContain(requiredMeaning);
    });
  });

  it('states whether the custom Electrum server is active in every language', () => {
    const expected = {
      en: ['Active', 'Inactive'],
      zh: ['已启用', '未启用'],
      hi: ['सक्रिय', 'निष्क्रिय'],
      es: ['Activo', 'Inactivo'],
      fr: ['Actif', 'Inactif'],
      ar: ['نشط', 'غير نشط'],
      bn: ['সক্রিয়', 'নিষ্ক্রিয়'],
      pt: ['Ativo', 'Inativo'],
      ru: ['Активен', 'Неактивен'],
    } satisfies Record<LanguageCode, string[]>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      const t = makeTranslator(code);
      expect([
        t('settings.customElectrumActive'),
        t('settings.customElectrumInactive'),
      ]).toEqual(expected[code]);
    }
  });
});
