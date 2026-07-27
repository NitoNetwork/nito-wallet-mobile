import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnrichedHistoryRecord } from './walletHistoryDb';
import { WalletStorageError } from './walletStorageError';

const sqlite = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
}));
const diagnostics = vi.hoisted(() => ({
  reportNonFinancialFailure: vi.fn(),
}));

vi.mock('expo-sqlite', () => sqlite);
vi.mock('./diagnostics', () => diagnostics);

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
    )).rejects.toBeInstanceOf(WalletStorageError);

    expect(db.execAsync.mock.calls.filter(([sql]) => (
      sql === 'BEGIN IMMEDIATE TRANSACTION'
    ))).toHaveLength(3);
    expect(db.execAsync.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(3);
    expect(diagnostics.reportNonFinancialFailure).toHaveBeenCalledWith(
      'wallet history enrichment write',
      expect.objectContaining({ message: 'disk full' }),
    );
  });

  it('serializes simultaneous transactions on the shared connection', async () => {
    const { clearWalletHistoryCache } = await import('./walletHistoryDb');
    const events: string[] = [];
    let transactionOpen = false;
    let transactionId = 0;
    let activeTransactionId = 0;
    let releaseFirstWrite: () => void = () => undefined;
    let markFirstWriteEntered: () => void = () => undefined;
    const firstWriteEntered = new Promise<void>((resolve) => {
      markFirstWriteEntered = resolve;
    });
    const firstWriteReleased = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });

    db.execAsync.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN IMMEDIATE TRANSACTION') {
        if (transactionOpen) {
          events.push('overlap');
          throw new Error('cannot start a transaction within a transaction');
        }
        transactionOpen = true;
        activeTransactionId = transactionId + 1;
        transactionId = activeTransactionId;
        events.push(`begin:${activeTransactionId}`);
      } else if (sql === 'COMMIT') {
        events.push(`commit:${activeTransactionId}`);
        transactionOpen = false;
        activeTransactionId = 0;
      } else if (sql === 'ROLLBACK') {
        events.push(`rollback:${activeTransactionId}`);
        transactionOpen = false;
        activeTransactionId = 0;
      }
    });
    let firstRun = true;
    db.runAsync.mockImplementation(async () => {
      if (firstRun) {
        firstRun = false;
        markFirstWriteEntered();
        await firstWriteReleased;
      }
      return { changes: 1, lastInsertRowId: 0 };
    });

    const first = clearWalletHistoryCache('wallet-a');
    await firstWriteEntered;
    const second = clearWalletHistoryCache('wallet-b');
    await Promise.resolve();
    await Promise.resolve();
    const successfulBeginsBeforeRelease = events.filter((event) => event.startsWith('begin:')).length;
    releaseFirstWrite();

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(successfulBeginsBeforeRelease).toBe(1);
    expect(events).toEqual(['begin:1', 'commit:1', 'begin:2', 'commit:2']);
  });

  it('applies connection pragmas before schema work on every reopened connection', async () => {
    vi.resetModules();
    const createConnection = () => ({
      execAsync: vi.fn(async (_sql: string) => undefined),
      getAllAsync: vi.fn(async (_sql: string, ..._params: unknown[]) => []),
      getFirstAsync: vi.fn(async (sql: string) => (
        sql === 'PRAGMA user_version' ? { user_version: 2 } : null
      )),
      runAsync: vi.fn(async (_sql: string, ..._params: unknown[]) => ({
        changes: 1,
        lastInsertRowId: 0,
      })),
    });
    const failedConnection = createConnection();
    const reopenedConnection = createConnection();
    failedConnection.execAsync.mockRejectedValue(new Error('initialization failed'));
    sqlite.openDatabaseAsync
      .mockResolvedValueOnce(failedConnection)
      .mockResolvedValueOnce(reopenedConnection);
    const { loadTransactionOutputCache } = await import('./walletHistoryDb');

    await expect(
      loadTransactionOutputCache('wallet-address', ['first']),
    ).rejects.toMatchObject({ name: 'WalletStorageError' });
    await expect(
      loadTransactionOutputCache('wallet-address', ['second']),
    ).resolves.toEqual([]);

    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(2);
    for (const connection of [failedConnection, reopenedConnection]) {
      const initializationSql = String(connection.execAsync.mock.calls[0]?.[0]);
      const walIndex = initializationSql.indexOf('PRAGMA journal_mode = WAL');
      const busyTimeoutIndex = initializationSql.indexOf('PRAGMA busy_timeout = 5000');
      const synchronousIndex = initializationSql.indexOf('PRAGMA synchronous = NORMAL');
      const schemaIndex = initializationSql.indexOf('CREATE TABLE');

      expect(walIndex).toBeGreaterThanOrEqual(0);
      expect(busyTimeoutIndex).toBeGreaterThan(walIndex);
      expect(synchronousIndex).toBeGreaterThan(busyTimeoutIndex);
      expect(schemaIndex).toBeGreaterThan(synchronousIndex);
    }
  });
});
