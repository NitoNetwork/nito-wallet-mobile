import { describe, expect, it } from 'vitest';

import {
  canShowHistoryExport,
  escapeCsvCell,
  formatHomeBalance,
  historyPageFromInput,
  isBalanceDecimals,
  isValidTransactionId,
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
    expect(isBalanceDecimals('4')).toBe(true);
    expect(isBalanceDecimals('6')).toBe(true);
    expect(isBalanceDecimals('8')).toBe(true);
    expect(isBalanceDecimals('3')).toBe(false);
    expect(isBalanceDecimals(null)).toBe(false);
  });

  it('truncates the home balance and marks significant hidden decimals', () => {
    expect(formatHomeBalance(112_345_678, 2)).toEqual({
      text: '1,12… NITO',
      lines: 1,
    });
    expect(formatHomeBalance(112_345_678, 4)).toEqual({
      text: '1\n,1234… NITO',
      lines: 2,
    });
    expect(formatHomeBalance(112_345_678, 8)).toEqual({
      text: '1\n,12345678 NITO',
      lines: 2,
    });
    expect(formatHomeBalance(112_000_000, 2)).toEqual({
      text: '1,12 NITO',
      lines: 1,
    });
    expect(formatHomeBalance(199_999_999, 2).text).toBe('1,99… NITO');
    expect(formatHomeBalance(998_380_428_123_426, 2)).toEqual({
      text: '9 983 804,28… NITO',
      lines: 1,
    });
    expect(formatHomeBalance(998_380_428_123_426, 8)).toEqual({
      text: '9 983 804\n,28123426 NITO',
      lines: 2,
    });
  });
});
