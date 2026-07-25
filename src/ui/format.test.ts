import { describe, expect, it } from 'vitest';

import { escapeCsvCell, isValidTransactionId, shortAddress, transactionExplorerUrl } from './format';

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
});
