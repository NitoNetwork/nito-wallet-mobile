import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnrichedHistoryRecord } from './walletHistoryDb';

const sqlite = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
}));

vi.mock('expo-sqlite', () => sqlite);

const db = {
  execAsync: vi.fn(async (_sql: string) => undefined),
  getAllAsync: vi.fn(async (_sql: string, ..._params: unknown[]) => []),
  getFirstAsync: vi.fn(async (sql: string) => (
    sql === 'PRAGMA user_version' ? { user_version: 1 } : null
  )),
  runAsync: vi.fn(async (_sql: string, ..._params: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  })),
};

const enrichedRecord: EnrichedHistoryRecord = {
  txid: 'transaction',
  height: 42,
  blockTime: 1_753_000_000,
  direction: 'received',
  counterparty: 'wallet-address',
  amountSats: 90_000_000,
  feeSats: 0,
};

describe('wallet transaction output cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlite.openDatabaseAsync.mockResolvedValue(db);
    db.execAsync.mockResolvedValue(undefined);
    db.getAllAsync.mockResolvedValue([]);
    db.getFirstAsync.mockImplementation(async (sql: string) => (
      sql === 'PRAGMA user_version' ? { user_version: 1 } : null
    ));
    db.runAsync.mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
  });

  it('migrates version 1 with a separate minimal output table', async () => {
    const {
      loadTransactionOutputCache,
    } = await import('./walletHistoryDb');

    await loadTransactionOutputCache('wallet-address', ['parent']);

    expect(db.execAsync.mock.calls.some(([sql]) => (
      String(sql).includes('CREATE TABLE IF NOT EXISTS wallet_transaction_outputs')
      && String(sql).includes('PRAGMA user_version = 2')
    ))).toBe(true);
  });

  it('writes enriched rows and derived outputs in one retried transaction', async () => {
    const {
      saveHistoryEnrichmentBatch,
    } = await import('./walletHistoryDb');
    db.execAsync.mockClear();
    db.runAsync.mockClear();

    await saveHistoryEnrichmentBatch(
      'wallet-address',
      [enrichedRecord],
      [{
        txid: 'transaction',
        outputIndex: 0,
        valueSats: 90_000_000,
        address: 'wallet-address',
      }],
    );

    const transactionCommands = db.execAsync.mock.calls.map(([sql]) => sql);
    expect(transactionCommands).toEqual(['BEGIN IMMEDIATE TRANSACTION', 'COMMIT']);
    expect(db.runAsync.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE wallet_transactions')
    ))).toBe(true);
    expect(db.runAsync.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO wallet_transaction_outputs')
    ))).toBe(true);
  });

  it('purges derived outputs with the wallet history', async () => {
    const { clearWalletHistoryCache } = await import('./walletHistoryDb');
    db.runAsync.mockClear();

    await clearWalletHistoryCache('wallet-address');

    expect(db.runAsync).toHaveBeenCalledWith(
      'DELETE FROM wallet_transaction_outputs WHERE wallet_id = ?',
      'wallet-address',
    );
  });

  it('retries and propagates an output-cache write failure', async () => {
    const { saveHistoryEnrichmentBatch } = await import('./walletHistoryDb');
    db.runAsync.mockRejectedValue(new Error('disk full'));

    await expect(saveHistoryEnrichmentBatch(
      'wallet-address',
      [],
      [{
        txid: 'transaction',
        outputIndex: 0,
        valueSats: 90_000_000,
        address: 'wallet-address',
      }],
    )).rejects.toThrow('disk full');

    expect(db.execAsync.mock.calls.filter(([sql]) => (
      sql === 'BEGIN IMMEDIATE TRANSACTION'
    ))).toHaveLength(3);
    expect(db.execAsync.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(3);
  });
});
