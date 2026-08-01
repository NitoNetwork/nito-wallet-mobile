import { describe, expect, it } from 'vitest';

import {
  canShowHistoryExport,
  escapeTsvCell,
  formatHomeBalance,
  historyAmountBreakdown,
  historyPageFromInput,
  isValidTransactionId,
  signedHistoryAmountLines,
  shortAddress,
  transactionExplorerUrl,
} from './format';
import { satoshisToNito } from '../wallet/transparentScan';
import type { LanguageCode } from '../i18n';

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
