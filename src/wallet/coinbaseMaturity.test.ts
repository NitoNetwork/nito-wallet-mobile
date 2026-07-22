import { describe, expect, it, vi } from 'vitest';

import type { ElectrumUtxo } from '../network/electrum';
import {
  annotateCoinbaseMaturity,
  getImmatureCoinbaseSummary,
  isCoinbaseTransactionHex,
  isTransparentUtxoSpendable,
} from './coinbaseMaturity';

const coinbaseTransaction = `0100000001${'00'.repeat(32)}ffffffff0100ffffffff0000000000`;
const regularTransaction = `0100000001${'11'.repeat(32)}000000000100ffffffff0000000000`;

const utxo = (confirmations: number, isCoinbase?: boolean): ElectrumUtxo => ({
  txid: 'ab'.repeat(32),
  vout: 0,
  valueSats: 5_000_000_000,
  height: 1,
  address: 'nito1test',
  confirmations,
  isCoinbase,
});

describe('coinbase maturity', () => {
  it('identifies a coinbase transaction from its null prevout', () => {
    expect(isCoinbaseTransactionHex(coinbaseTransaction)).toBe(true);
    expect(isCoinbaseTransactionHex(regularTransaction)).toBe(false);
  });

  it('locks a coinbase through 100 confirmations', () => {
    expect(isTransparentUtxoSpendable(utxo(100, true))).toBe(false);
    expect(getImmatureCoinbaseSummary([utxo(100, true)])).toEqual({
      amountSats: 5_000_000_000,
      blocksRemaining: 1,
    });
  });

  it('unlocks a coinbase at 101 confirmations', () => {
    expect(isTransparentUtxoSpendable(utxo(101, true))).toBe(true);
  });

  it('keeps a normal confirmed transaction spendable', () => {
    expect(isTransparentUtxoSpendable(utxo(1, false))).toBe(true);
  });

  it('reuses cached coinbase classification without a network request', async () => {
    const loadTransactionHex = vi.fn();
    const [classified] = await annotateCoinbaseMaturity(
      [utxo(2)],
      [utxo(1, true)],
      loadTransactionHex,
    );
    expect(classified?.isCoinbase).toBe(true);
    expect(loadTransactionHex).not.toHaveBeenCalled();
  });

  it('classifies an unknown young transaction using its raw transaction', async () => {
    const [classified] = await annotateCoinbaseMaturity(
      [utxo(1)],
      [],
      async () => coinbaseTransaction,
    );
    expect(classified?.isCoinbase).toBe(true);
  });
});
