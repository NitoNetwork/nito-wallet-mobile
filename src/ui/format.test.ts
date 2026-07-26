import { describe, expect, it } from 'vitest';

import {
  canShowHistoryExport,
  escapeCsvCell,
  formatHomeBalance,
  historyAmountBreakdown,
  historyPageFromInput,
  isBalanceDecimals,
  isValidTransactionId,
  signedHistoryAmountLines,
  shortAddress,
  transactionExplorerUrl,
} from './format';

describe('ui format helpers', () => {
  it('escapes CSV cells by doubling quotes and wrapping', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell(42)).toBe('"42"');
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

  it('validates the supported balance decimal preferences', () => {
    expect(isBalanceDecimals('2')).toBe(true);
    expect(isBalanceDecimals('8')).toBe(true);
    expect(isBalanceDecimals('4')).toBe(false);
    expect(isBalanceDecimals('6')).toBe(false);
    expect(isBalanceDecimals('3')).toBe(false);
    expect(isBalanceDecimals(null)).toBe(false);
  });

  it('truncates the home balance and marks significant hidden decimals', () => {
    expect(formatHomeBalance(112_345_678, 2)).toEqual({
      text: '1,12…',
    });
    expect(formatHomeBalance(112_345_678, 8)).toEqual({
      text: '1,12345678',
    });
    expect(formatHomeBalance(112_000_000, 2)).toEqual({
      text: '1,12',
    });
    expect(formatHomeBalance(199_999_999, 2).text).toBe('1,99…');
    expect(formatHomeBalance(998_380_428_123_426, 2)).toEqual({
      text: '9 983 804,28…',
    });
    expect(formatHomeBalance(998_380_428_123_426, 8)).toEqual({
      text: '9 983 804,28123426',
    });
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
    expect(signedHistoryAmountLines('self', ['1', '2'])).toEqual([
      '+1',
      '+2',
    ]);
    expect(signedHistoryAmountLines('sent', ['1', '2'])).toEqual([
      '−1',
      '−2',
    ]);
  });
});
