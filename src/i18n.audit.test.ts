import { describe, expect, it } from 'vitest';

import {
  LANGUAGES,
  TRANSLATIONS,
  auditTranslationCoverage,
  auditTranslationQuality,
  makeTranslator,
  type LanguageCode,
} from './i18n';
import { tr } from './i18n/tr';

describe('i18n coverage', () => {
  it.each(LANGUAGES)('resolves the phrase-copy consent and feedback in $code', ({ code }) => {
    for (const key of ['backup.copyPhrase', 'backup.clipboardWarning', 'backup.confirmCopy', 'backup.copied', 'backup.copyFailed'] as const) {
      const value = TRANSLATIONS[code][key];
      expect(Object.hasOwn(TRANSLATIONS[code], key)).toBe(true);
      expect(makeTranslator(code)(key)).toBe(value);
      expect(value.trim().length).toBeGreaterThan(0);
      if (code !== 'en') expect(value).not.toBe(TRANSLATIONS.en[key]);
    }
    expect(makeTranslator(code)('backup.copyPhrase')).toContain('BIP39');
  });

  it.each(LANGUAGES)('defines every compact transaction popup message directly in the $code dictionary', ({ code }) => {
    const keys = [
      'tracking.acceptedHint', 'tracking.mempoolHint', 'tracking.confirmedHint',
      'tracking.hide', 'tracking.observationFailed',
      'rbf.review', 'rbf.cancelHint', 'rbf.confirm',
      'rbf.cancellation', 'rbf.cancelAccepted', 'rbf.cancelMempool',
      'rbf.cancelConfirmed', 'rbf.cancelNotCompleted',
    ] as const;
    for (const key of keys) {
      const dictionary = TRANSLATIONS[code];
      expect(Object.hasOwn(dictionary, key), `${code}:${key}`).toBe(true);
      expect(dictionary[key].trim().length, `${code}:${key}`).toBeGreaterThan(0);
      expect(makeTranslator(code)(key, { height: 1005010 })).toBe(dictionary[key].replaceAll('{height}', '1005010'));
      if (code !== 'en') expect(dictionary[key], `${code}:${key}`).not.toBe(TRANSLATIONS.en[key]);
    }
  });

  it.each(LANGUAGES)('removes obsolete tracking navigation and copy labels from $code', ({ code }) => {
    for (const key of ['tracking.reopen', 'tracking.position', 'tracking.copyTxid', 'tracking.copied', 'tracking.copyFailed']) {
      expect(Object.hasOwn(TRANSLATIONS[code], key), `${code}:${key}`).toBe(false);
    }
  });

  it('does not instruct users to reimport their seed after a biometric unlock failure', () => {
    for (const { code } of LANGUAGES) {
      expect(TRANSLATIONS[code]).not.toHaveProperty('errors.biometricReimport');
      expect(makeTranslator(code)('errors.unlockFailed')).not.toBe('errors.unlockFailed');
    }
  });

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
      de: 'Guthaben NITO',
      es: 'Saldo NITO',
      fr: 'Solde NITO',
      ja: '残高 NITO',
      tr: 'Bakiye NITO',
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
      de: 'Verlauf NITO',
      es: 'Historial NITO',
      fr: 'Historique NITO',
      ja: '履歴 NITO',
      tr: 'Geçmiş NITO',
      pt: 'Histórico NITO',
      ru: 'История NITO',
    } satisfies Record<LanguageCode, string>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      expect(makeTranslator(code)('history.title')).toBe(expected[code]);
    }
  });

  it('resolves the optional physical dice entry in every language', () => {
    const expected = {
      en: 'Add physical dice, optional',
      zh: '添加实体骰子，可选',
      de: 'Physische Würfel hinzufügen, optional',
      es: 'Añadir dados físicos, opcional',
      fr: 'Ajouter des dés physiques, facultatif',
      ja: '物理サイコロを追加、任意',
      tr: 'Fiziksel zar ekle, isteğe bağlı',
      pt: 'Adicionar dados físicos, opcional',
      ru: 'Добавить физические кубики, необязательно',
    } satisfies Record<LanguageCode, string>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      const t = makeTranslator(code);
      expect(t('dice.optionTitle')).toBe(expected[code]);
      expect(t('dice.optionMethod')).toContain('100');
      expect(t('dice.optionMethod')).toContain('20');
      expect(t('dice.why100')).toContain('256');
      expect(t('dice.why100')).toContain('BIP39');
      expect(t('dice.mixExplanation')).toContain('SHA-256');
      expect(t('dice.finalExplanation')).toContain('24');
      expect(t('dice.finalExplanation')).toContain('256');
      expect(t('dice.enterResult', { value: 6 })).toContain('6');
    }
  });

  it('uses neither em dashes nor semicolons in visible translations', () => {
    for (const { code } of LANGUAGES) {
      for (const [key, message] of Object.entries(TRANSLATIONS[code])) {
        expect(message, `${code}:${key}`).not.toMatch(/[—;]/);
      }
    }
  });

  it('removes the obsolete internal-history network-fee label from every language', () => {
    for (const { code } of LANGUAGES) {
      expect(Object.hasOwn(TRANSLATIONS[code], 'history.networkFee'), code).toBe(false);
    }
  });

  it('names the BIP39 phrase explicitly in every language', () => {
    const expected = {
      en: ['Show BIP39 phrase', 'Hide BIP39 phrase'],
      zh: ['显示 BIP39 助记词', '隐藏 BIP39 助记词'],
      de: ['BIP39-Phrase anzeigen', 'BIP39-Phrase verbergen'],
      es: ['Mostrar frase BIP39', 'Ocultar frase BIP39'],
      fr: ['Afficher la phrase BIP39', 'Masquer la phrase BIP39'],
      ja: ['BIP39 フレーズを表示', 'BIP39 フレーズを隠す'],
      tr: ['BIP39 ifadesini göster', 'BIP39 ifadesini gizle'],
      pt: ['Mostrar frase BIP39', 'Ocultar frase BIP39'],
      ru: ['Показать фразу BIP39', 'Скрыть фразу BIP39'],
    } satisfies Record<LanguageCode, [string, string]>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      const t = makeTranslator(code);
      expect([t('actions.showSeed'), t('actions.hideSeed')]).toEqual(expected[code]);
    }
  });

  it('resolves the corrected reward and history copy without placeholder grammar', () => {
    expect(makeTranslator('de')('home.coinbaseBlocksRemaining', { blocks: 3 }))
      .toBe('Nächste Belohnung reift in 3 Blöcken');
    expect(makeTranslator('fr')('home.coinbaseBlocksRemaining', { blocks: 3 }))
      .toBe('La prochaine récompense sera disponible dans 3 blocs');
    expect(makeTranslator('ja')('history.moreOutputs', { count: 3 }))
      .toBe('+ 他 3 件');
  });

  it('uses one BIP39 phrase name throughout the Turkish translation', () => {
    expect(Object.values(tr).filter((message) => /tohum/i.test(message))).toEqual([]);
    expect(makeTranslator('tr')('actions.importSeed')).toBe('BIP39 ifadesini içe aktar');
    expect(makeTranslator('tr')('import.title')).toBe('BIP39 ifadesini içe aktar');
  });

  it('translates the local wallet storage failure in every language', () => {
    const english = makeTranslator('en')('errors.walletStorageUnavailable');

    for (const { code } of [
      { code: 'en' },
      { code: 'zh' },
      { code: 'de' },
      { code: 'es' },
      { code: 'fr' },
      { code: 'ja' },
      { code: 'tr' },
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

  it('translates transparent send domain errors in every language', () => {
    const keys = [
      'errors.sendInsufficientFunds',
      'errors.sendNoSpendableFunds',
      'errors.sendLegacyDataUnavailable',
    ] as const;

    for (const { code } of LANGUAGES) {
      const t = makeTranslator(code);
      for (const key of keys) {
        const message = t(key);
        expect(message).not.toBe(key);
        expect(message).not.toMatch(/Fonds insuffisants|No confirmed UTXO|Montant invalide/);
        if (code !== 'en') {
          expect(message).not.toBe(makeTranslator('en')(key));
        }
      }
    }
  });

  it('resolves the multi-recipient controls in every language', () => {
    const expected = {
      en: 'Add recipient',
      zh: '添加收款人',
      de: 'Empfänger hinzufügen',
      es: 'Añadir destinatario',
      fr: 'Ajouter un destinataire',
      ja: '受取人を追加',
      tr: 'Alıcı ekle',
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
      de: ['Sicherheit', 'Darstellung', 'Netzwerk und Synchronisierung', 'Über', 'Gefahrenzone'],
      es: ['Seguridad', 'Visualización', 'Red y sincronización', 'Acerca de', 'Zona de peligro'],
      fr: ['Sécurité', 'Affichage', 'Réseau et synchronisation', 'À propos', 'Zone de danger'],
      ja: ['セキュリティ', '表示', 'ネットワークと同期', '情報', '危険な操作'],
      tr: ['Güvenlik', 'Görünüm', 'Ağ ve eşitleme', 'Hakkında', 'Tehlikeli bölge'],
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
      de: ['Eigener ElectrumX-Server', 'Zu offiziellen Servern zurückkehren'],
      es: ['Servidor ElectrumX personalizado', 'Volver a servidores oficiales'],
      fr: ['Serveur ElectrumX personnalisé', 'Revenir aux serveurs officiels'],
      ja: ['カスタム ElectrumX サーバー', '公式サーバーに戻す'],
      tr: ['Özel ElectrumX sunucusu', 'Resmi sunuculara dön'],
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
      de: ['Aktiv', 'Inaktiv'],
      es: ['Activo', 'Inactivo'],
      fr: ['Actif', 'Inactif'],
      ja: ['有効', '無効'],
      tr: ['Etkin', 'Etkin değil'],
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
