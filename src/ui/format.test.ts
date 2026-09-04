import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  canShowHistoryExport,
  escapeTsvCell,
  formatHomeBalance,
  formatHistoryDetails,
  historyAmountBreakdown,
  historyPageFromInput,
  isValidTransactionId,
  signedHistoryAmountLines,
  shortAddress,
  transactionExplorerUrl,
} from './format';
import { satoshisToNito } from '../wallet/transparentScan';
import { makeTranslator, type LanguageCode } from '../i18n';

describe('ui format helpers', () => {
  it('quotes a tab cell only when the value would break the table', () => {
    expect(escapeTsvCell('a,b')).toBe('a,b');
    expect(escapeTsvCell(42)).toBe('42');
    expect(escapeTsvCell('2026-07-28T12:22:00Z')).toBe('2026-07-28T12:22:00Z');
    expect(escapeTsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeTsvCell('a\tb')).toBe('"a\tb"');
    expect(escapeTsvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('shortens an address keeping head and tail', () => {
    expect(shortAddress('nito1qexampleaddress0000000000end12345')).toBe('nito1qexample...end12345');
  });

  it('accepts only 64-hex transaction ids', () => {
    expect(isValidTransactionId('a'.repeat(64))).toBe(true);
    expect(isValidTransactionId('A'.repeat(64))).toBe(true);
    expect(isValidTransactionId('a'.repeat(63))).toBe(false);
    expect(isValidTransactionId('g'.repeat(64))).toBe(false);
    expect(isValidTransactionId('../evil')).toBe(false);
  });

  it('builds a lowercase explorer url', () => {
    expect(transactionExplorerUrl('AB'.repeat(32))).toBe(
      `https://mempool-explorer.nito.network/tx/${'ab'.repeat(32)}`,
    );
  });

  it('shows history export only for a complete and idle history snapshot', () => {
    const completeState = {
      entries: [{ direction: 'received' }, { direction: 'sent' }, { direction: 'self' }],
      historyProgress: null,
      historySyncing: false,
      networkStatus: 'ready',
    };

    expect(canShowHistoryExport(completeState)).toBe(true);
    expect(canShowHistoryExport({ ...completeState, entries: [{ direction: undefined }] })).toBe(false);
    expect(canShowHistoryExport({
      ...completeState,
      entries: [{ direction: 'received', provisional: true }],
    })).toBe(false);
    expect(canShowHistoryExport({ ...completeState, entries: [] })).toBe(false);
    expect(canShowHistoryExport({ ...completeState, historyProgress: { done: 1, total: 2 } })).toBe(false);
    expect(canShowHistoryExport({ ...completeState, historySyncing: true })).toBe(false);
    expect(canShowHistoryExport({ ...completeState, networkStatus: 'syncing' })).toBe(false);
  });

  it('converts direct history page input to a clamped zero-based page', () => {
    expect(historyPageFromInput('3', 8)).toBe(2);
    expect(historyPageFromInput(' 8 ', 8)).toBe(7);
    expect(historyPageFromInput('0', 8)).toBe(0);
    expect(historyPageFromInput('-4', 8)).toBe(0);
    expect(historyPageFromInput('999', 8)).toBe(7);
    expect(historyPageFromInput('', 8)).toBeNull();
    expect(historyPageFromInput('abc', 8)).toBeNull();
    expect(historyPageFromInput('1.5', 8)).toBeNull();
  });

  it('always shows the home balance with all eight decimals', () => {
    expect(formatHomeBalance(112_345_678, 'fr')).toEqual({
      text: '1,12345678',
    });
    expect(formatHomeBalance(112_000_000, 'fr')).toEqual({
      text: '1,12000000',
    });
    expect(formatHomeBalance(199_999_999, 'fr').text).toBe('1,99999999');
    expect(formatHomeBalance(998_380_428_123_426, 'fr')).toEqual({
      text: '9\u202f983\u202f804,28123426',
    });
  });

  it('formats the same reference amount deterministically in all nine languages', () => {
    const expected = {
      en: '9,983,804.28123426',
      zh: '9,983,804.28123426',
      de: '9.983.804,28123426',
      es: '9.983.804,28123426',
      fr: '9\u202f983\u202f804,28123426',
      ja: '9,983,804.28123426',
      tr: '9.983.804,28123426',
      pt: '9.983.804,28123426',
      ru: '9\u202f983\u202f804,28123426',
    } satisfies Record<LanguageCode, string>;

    for (const code of Object.keys(expected) as LanguageCode[]) {
      expect(formatHomeBalance(998_380_428_123_426, code).text).toBe(expected[code]);
      expect(satoshisToNito(998_380_428_123_426, code)).toBe(expected[code]);
    }
  });

  it('splits a self transaction with two owned outputs in output-index order', () => {
    expect(historyAmountBreakdown({
      direction: 'self',
      totalSats: 110_931_158_680_130,
      outputs: [
        { outputIndex: 1, valueSats: 110_931_048_680_130, address: 'owned' },
        { outputIndex: 0, valueSats: 110_000_000, address: 'owned' },
      ],
      walletAddresses: ['owned'],
    })).toEqual({
      amountsSats: [110_000_000, 110_931_048_680_130],
      hiddenOutputCount: 0,
    });
  });

  it('keeps the current total display for a single relevant output', () => {
    expect(historyAmountBreakdown({
      direction: 'received',
      totalSats: 25_000_000,
      outputs: [
        { outputIndex: 0, valueSats: 25_000_000, address: 'owned' },
      ],
      walletAddresses: ['owned'],
    })).toEqual({
      amountsSats: [25_000_000],
      hiddenOutputCount: 0,
    });
  });

  it('shows external recipients but excludes change from a multi-recipient send', () => {
    expect(historyAmountBreakdown({
      direction: 'sent',
      totalSats: 300_000_000,
      outputs: [
        { outputIndex: 2, valueSats: 200_000_000, address: 'external-b' },
        { outputIndex: 0, valueSats: 900_000_000, address: 'owned-change' },
        { outputIndex: 3, valueSats: 0, address: '' },
        { outputIndex: 1, valueSats: 100_000_000, address: 'external-a' },
      ],
      walletAddresses: ['owned-change'],
    })).toEqual({
      amountsSats: [100_000_000, 200_000_000],
      hiddenOutputCount: 0,
    });
  });

  it('falls back to the current total when no output cache is available', () => {
    expect(historyAmountBreakdown({
      direction: 'received',
      totalSats: 42_000_000,
      outputs: [],
      walletAddresses: ['owned'],
    })).toEqual({
      amountsSats: [42_000_000],
      hiddenOutputCount: 0,
    });
  });

  it('limits a multi-output history row to four amounts', () => {
    expect(historyAmountBreakdown({
      direction: 'received',
      totalSats: 21_000_000,
      outputs: [5, 4, 3, 2, 1].map((outputIndex) => ({
        outputIndex,
        valueSats: outputIndex * 1_000_000,
        address: 'owned',
      })),
      walletAddresses: ['owned'],
    })).toEqual({
      amountsSats: [1_000_000, 2_000_000, 3_000_000, 4_000_000],
      hiddenOutputCount: 1,
    });
  });

  it('prefixes every displayed history amount according to its direction', () => {
    expect(signedHistoryAmountLines('received', ['1', '2', '3'])).toEqual([
      '+1',
      '+2',
      '+3',
    ]);
    expect(signedHistoryAmountLines('sent', ['1', '2'])).toEqual([
      '−1',
      '−2',
    ]);
  });
});

describe('internal transaction fee line', () => {
  it('shows only the exact network fee for an internal transaction', () => {
    expect(signedHistoryAmountLines('self', ['1,1', '1 109 310,48680130'], '0,00012345'))
      .toEqual(['−0,00012345']);
  });

  it('leaves sends and receipts unchanged', () => {
    expect(signedHistoryAmountLines('sent', ['1,2'])).toEqual(['−1,2']);
    expect(signedHistoryAmountLines('received', ['1,1'])).toEqual(['+1,1']);
  });

  it('does not invent an internal amount when the fee is unavailable', () => {
    expect(signedHistoryAmountLines('self', ['1,2'], null)).toEqual([]);
  });
});

describe('shared history date, direction and block layout', () => {
  // Construct a local instant so these exact strings also hold on UTC CI runners.
  const blockTime = new Date(2026, 8, 4, 16, 30, 0).getTime() / 1000;

  it('shows the dated internal example while retaining only its network fee', () => {
    const entry = { direction: 'self' as const, blockTime, height: 1005112 };
    const amount = signedHistoryAmountLines('self', ['1', '999999'], '0,00000308');
    expect([...amount, formatHistoryDetails(entry, 'fr', makeTranslator('fr'))].join('\n'))
      .toBe('−0,00000308\n16h30 · 04/09/2026 · Interne\nBloc 1005112');
  });

  const expected = {
    en: ['4:30 PM · 09/04/2026', 'Received', 'Sent', 'Internal', 'Block 1005112'],
    zh: ['16:30 · 2026/09/04', '已收', '已发', '内部', '区块 1005112'],
    de: ['16:30 · 04.09.2026', 'Empfangen', 'Gesendet', 'Intern', 'Block 1005112'],
    es: ['16:30 · 04/09/2026', 'Recibido', 'Enviado', 'Interno', 'Bloque 1005112'],
    fr: ['16h30 · 04/09/2026', 'Reçu', 'Envoyé', 'Interne', 'Bloc 1005112'],
    ja: ['16:30 · 2026/09/04', '受取', '送金', '内部', 'ブロック 1005112'],
    tr: ['16:30 · 04.09.2026', 'Alındı', 'Gönderildi', 'Dahili', 'Blok 1005112'],
    pt: ['16:30 · 04/09/2026', 'Recebido', 'Enviado', 'Interno', 'Bloco 1005112'],
    ru: ['16:30 · 04.09.2026', 'Получено', 'Отправлено', 'Внутренний', 'Блок 1005112'],
  } satisfies Record<LanguageCode, readonly string[]>;

  it.each(Object.keys(expected) as LanguageCode[])('uses the same dated two-line layout for all directions in %s', (language) => {
    const [date, received, sent, self, block] = expected[language];
    const t = makeTranslator(language);
    for (const [direction, label] of [['received', received], ['sent', sent], ['self', self]] as const) {
      const entry = Object.freeze({ direction, blockTime, height: 1005112 });
      expect(formatHistoryDetails(entry, language, t)).toBe(`${date} · ${label}\n${block}`);
    }
  });

  it.each([0, -1])('shows mempool height %s on its own line without inventing a date', (height) => {
    expect(formatHistoryDetails({ direction: 'self', height }, 'fr', makeTranslator('fr')))
      .toBe('Interne\nMempool');
  });

  it('keeps a mined row undated until its real timestamp is recovered', () => {
    expect(formatHistoryDetails({ direction: 'self', height: 1005112 }, 'fr', makeTranslator('fr')))
      .toBe('Interne\nBloc 1005112');
    expect(formatHistoryDetails({ height: 1005112 }, 'fr', makeTranslator('fr')))
      .toBe('Bloc 1005112');
  });

  it('uses the shared formatter in the real history row without a separate internal branch', () => {
    const source = readFileSync(new URL('./tabs.tsx', import.meta.url), 'utf8');
    expect(source.includes('{formatHistoryDetails(entry, language, t)}')).toBe(true);
    expect(source.includes("entry.direction !== 'self' && entry.blockTime")).toBe(false);
  });
});
