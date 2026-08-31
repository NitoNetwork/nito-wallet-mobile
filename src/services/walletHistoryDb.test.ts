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
  getAllAsync: vi.fn(async (_sql: string, ..._params: unknown[]): Promise<unknown[]> => []),
  getFirstAsync: vi.fn(async (sql: string): Promise<unknown> => (
    sql === 'PRAGMA user_version' ? { user_version: 1 } : null
  )),
  runAsync: vi.fn(async (_sql: string, ..._params: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  })),
  prepareAsync: vi.fn(async (_sql: string) => ({
    executeAsync: vi.fn(async (..._params: unknown[]) => ({
      changes: 1,
      lastInsertRowId: 0,
    })),
    finalizeAsync: vi.fn(async () => undefined),
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
    db.prepareAsync.mockImplementation(async () => ({
      executeAsync: vi.fn(async () => ({ changes: 1, lastInsertRowId: 0 })),
      finalizeAsync: vi.fn(async () => undefined),
    }));
  });

  it('migrates version 1 through the public HD address state schema', async () => {
    const {
      loadTransactionOutputCache,
    } = await import('./walletHistoryDb');

    await loadTransactionOutputCache('wallet-address', ['parent']);

    expect(db.execAsync.mock.calls.some(([sql]) => (
      String(sql).includes('CREATE TABLE IF NOT EXISTS wallet_transaction_outputs')
      && String(sql).includes('PRAGMA user_version = 2')
    ))).toBe(true);
    expect(db.execAsync.mock.calls.some(([sql]) => (
      String(sql).includes('CREATE TABLE IF NOT EXISTS wallet_hd_sequences')
      && String(sql).includes('PRAGMA user_version = 3')
    ))).toBe(true);
  });

  it('rejects a structurally incomplete wallet snapshot cache row', async () => {
    const { loadWalletSnapshotCache } = await import('./walletHistoryDb');
    db.getFirstAsync.mockImplementation(async (sql: string) => (
      sql.includes('FROM wallet_snapshot_cache')
        ? { snapshot_json: JSON.stringify({ confirmedSats: 1 }), height: 100 }
        : null
    ));

    await expect(loadWalletSnapshotCache('wallet-address')).rejects.toBeInstanceOf(
      WalletStorageError,
    );
    expect(diagnostics.reportNonFinancialFailure).toHaveBeenCalledWith(
      'wallet snapshot cache read',
      expect.objectContaining({ message: 'Invalid wallet snapshot cache.' }),
    );
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
    expect(db.prepareAsync.mock.calls.some(([sql]) => (
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
    expect(db.runAsync).not.toHaveBeenCalledWith(
      'DELETE FROM wallet_hd_sequences WHERE wallet_id = ?',
      'wallet-address',
    );
  });

  it('purges HD address state only when the wallet itself is deleted', async () => {
    const { clearWalletPublicData } = await import('./walletHistoryDb');
    db.runAsync.mockClear();

    await clearWalletPublicData('wallet-address');

    expect(db.runAsync).toHaveBeenCalledWith(
      'DELETE FROM wallet_hd_sequences WHERE wallet_id = ?',
      'wallet-address',
    );
  });

  it('reserves concurrent HD addresses atomically in order', async () => {
    vi.resetModules();
    let highestIssuedIndex = 0;
    const events: string[] = [];
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql === 'PRAGMA user_version') return { user_version: 3 };
      if (String(sql).includes('FROM wallet_hd_sequences')) {
        return highestIssuedIndex > 0 ? {
          account_key: 'taproot',
          branch: 'external',
          highest_issued_index: highestIssuedIndex,
        } : null;
      }
      return null;
    });
    db.execAsync.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN IMMEDIATE TRANSACTION') events.push('begin');
      if (sql === 'COMMIT') events.push('commit');
    });
    db.runAsync.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (String(sql).includes('INSERT INTO wallet_hd_sequences')) {
        highestIssuedIndex = Number(params[3]);
        events.push(`write:${highestIssuedIndex}`);
      }
      return { changes: 1, lastInsertRowId: 0 };
    });
    sqlite.openDatabaseAsync.mockResolvedValue(db);
    const { reserveNextHdAddressIndex } = await import('./walletHistoryDb');

    const reservations = await Promise.all([
      reserveNextHdAddressIndex({
        walletId: 'wallet-address',
        accountKey: 'taproot',
        branch: 'external',
        minimumIndex: 1,
        maximumIndex: 20,
      }),
      reserveNextHdAddressIndex({
        walletId: 'wallet-address',
        accountKey: 'taproot',
        branch: 'external',
        minimumIndex: 1,
        maximumIndex: 20,
      }),
    ]);

    expect(reservations).toEqual([1, 2]);
    expect(events).toEqual([
      'begin', 'write:1', 'commit',
      'begin', 'write:2', 'commit',
    ]);
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
    )).rejects.toMatchObject({ name: 'WalletStorageError' });

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

  it('preserves inserted and conflict-updated cache content', async () => {
    vi.resetModules();
    type TransactionState = {
      height: number;
      address: string;
      firstSeenAt: string;
      amountSats: number | null;
      direction: string | null;
      feeSats: number | null;
      counterparty: string | null;
      blockTime: number | null;
    };
    const transactions = new Map<string, TransactionState>([
      ['wallet-address:existing', {
        height: 1,
        address: 'old-address',
        firstSeenAt: 'original-first-seen',
        amountSats: 999,
        direction: 'received',
        feeSats: 1,
        counterparty: 'stale-counterparty',
        blockTime: 1_700_000_000,
      }],
      ['wallet-address:stale-mempool', {
        height: 0,
        address: 'mempool-address',
        firstSeenAt: 'mempool-first-seen',
        amountSats: 500,
        direction: 'received',
        feeSats: 0,
        counterparty: 'mempool-counterparty',
        blockTime: null,
      }],
    ]);
    const outputs = new Map<string, number>([
      ['wallet-address:existing:0:wallet-address', 1],
    ]);
    let fullHistoryHeight = 953_000;
    const finalized = vi.fn(async () => undefined);
    const bindingsFrom = (params: unknown[]): unknown[] => (
      params.length === 1 && Array.isArray(params[0]) ? params[0] : params
    );
    const applyEnrichment = (bindings: unknown[]) => {
      const [
        amountSats,
        direction,
        feeSats,
        counterparty,
        blockTime,
        ,
        walletId,
        txid,
        height,
      ] = bindings;
      const key = `${String(walletId)}:${String(txid)}`;
      const existing = transactions.get(key);
      if (existing && existing.height === Number(height)) {
        transactions.set(key, {
          ...existing,
          amountSats: Number(amountSats),
          direction: String(direction),
          feeSats: Number(feeSats),
          counterparty: String(counterparty),
          blockTime: Number(blockTime),
        });
      }
    };

    db.getFirstAsync.mockImplementation(async (sql: string) => (
      sql === 'PRAGMA user_version' ? { user_version: 3 } : null
    ));
    db.getAllAsync.mockImplementation(async (sql: string) => (
      String(sql).includes('SELECT txid FROM wallet_transactions')
        ? [...transactions.entries()]
            .filter(([key]) => key.startsWith('wallet-address:'))
            .map(([key]) => ({ txid: key.slice('wallet-address:'.length) }))
        : []
    ));
    db.runAsync.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const source = String(sql);
      const bindings = bindingsFrom(params);
      if (source.includes('INSERT INTO wallet_transactions')) {
        for (let offset = 0; offset < bindings.length; offset += 5) {
          const [
            walletId,
            txid,
            height,
            address,
            firstSeenAt,
          ] = bindings.slice(offset, offset + 5);
          const key = `${String(walletId)}:${String(txid)}`;
          const existing = transactions.get(key);
          transactions.set(key, existing ? {
            ...existing,
            height: Number(height),
            address: String(address),
            ...(existing.height === Number(height) ? {} : {
              amountSats: null,
              direction: null,
              feeSats: null,
              counterparty: null,
              blockTime: null,
            }),
          } : {
            height: Number(height),
            address: String(address),
            firstSeenAt: String(firstSeenAt),
            amountSats: null,
            direction: null,
            feeSats: null,
            counterparty: null,
            blockTime: null,
          });
        }
      } else if (source.includes('UPDATE wallet_transactions')) {
        applyEnrichment(bindings);
      } else if (source.includes('DELETE FROM wallet_transactions')) {
        const [walletId, ...txids] = bindings.map(String);
        for (const txid of txids) {
          transactions.delete(`${walletId}:${txid}`);
        }
      } else if (source.includes('INSERT INTO wallet_sync_state')) {
        fullHistoryHeight = source.includes('MAX(wallet_sync_state.full_history_height')
          ? Math.max(fullHistoryHeight, Number(bindings[1]))
          : Number(bindings[1]);
      } else if (source.includes('INSERT INTO wallet_transaction_outputs')) {
        for (let offset = 0; offset < bindings.length; offset += 5) {
          const [walletId, txid, outputIndex, valueSats, address] = bindings.slice(
            offset,
            offset + 5,
          );
          outputs.set(
            `${String(walletId)}:${String(txid)}:${Number(outputIndex)}:${String(address)}`,
            Number(valueSats),
          );
        }
      }
      return { changes: 1, lastInsertRowId: 0 };
    });
    db.prepareAsync.mockImplementation(async (sql: string) => ({
      executeAsync: vi.fn(async (...params: unknown[]) => {
        if (String(sql).includes('UPDATE wallet_transactions')) {
          applyEnrichment(bindingsFrom(params));
        }
        return { changes: 1, lastInsertRowId: 0 };
      }),
      finalizeAsync: finalized,
    }));
    sqlite.openDatabaseAsync.mockResolvedValue(db);
    const {
      saveHistoryEnrichmentBatch,
      saveWalletHistoryCache,
    } = await import('./walletHistoryDb');

    await saveWalletHistoryCache(
      'wallet-address',
      [
        { txid: 'existing', height: 30, address: 'updated-address' },
        { txid: 'inserted', height: 20, address: 'inserted-address' },
      ],
      952_900,
      'authoritative',
    );
    expect(transactions.get('wallet-address:existing')).toMatchObject({
      height: 30,
      amountSats: null,
      direction: null,
      feeSats: null,
      counterparty: null,
      blockTime: null,
    });
    expect(transactions.has('wallet-address:stale-mempool')).toBe(false);
    expect(fullHistoryHeight).toBe(952_900);

    await saveHistoryEnrichmentBatch(
      'wallet-address',
      [
        {
          txid: 'existing',
          height: 30,
          blockTime: 1_753_000_001,
          direction: 'sent',
          counterparty: 'external-address',
          amountSats: 123_000_000,
          feeSats: 10_000,
        },
        {
          txid: 'inserted',
          height: 20,
          blockTime: 1_753_000_002,
          direction: 'received',
          counterparty: 'wallet-address',
          amountSats: 456_000_000,
          feeSats: 0,
        },
      ],
      [
        {
          txid: 'existing',
          outputIndex: 0,
          valueSats: 123_000_000,
          address: 'wallet-address',
        },
        {
          txid: 'inserted',
          outputIndex: 1,
          valueSats: 456_000_000,
          address: 'wallet-address',
        },
      ],
    );

    expect(transactions.get('wallet-address:existing')).toEqual({
      height: 30,
      address: 'updated-address',
      firstSeenAt: 'original-first-seen',
      amountSats: 123_000_000,
      direction: 'sent',
      feeSats: 10_000,
      counterparty: 'external-address',
      blockTime: 1_753_000_001,
    });
    expect(transactions.get('wallet-address:inserted')).toEqual({
      height: 20,
      address: 'inserted-address',
      firstSeenAt: expect.any(String),
      amountSats: 456_000_000,
      direction: 'received',
      feeSats: 0,
      counterparty: 'wallet-address',
      blockTime: 1_753_000_002,
    });
    expect(outputs).toEqual(new Map([
      ['wallet-address:existing:0:wallet-address', 123_000_000],
      ['wallet-address:inserted:1:wallet-address', 456_000_000],
    ]));
    expect(fullHistoryHeight).toBe(952_900);
    expect(db.prepareAsync).toHaveBeenCalledTimes(1);
    expect(finalized).toHaveBeenCalledTimes(1);
  });

  it('finalizes a failed enrichment statement and rolls back every retry', async () => {
    vi.resetModules();
    const amounts = new Map([
      ['first', 1],
      ['second', 2],
    ]);
    let snapshot = new Map(amounts);
    let updatesInAttempt = 0;
    const finalizers: ReturnType<typeof vi.fn>[] = [];
    const bindingsFrom = (params: unknown[]): unknown[] => (
      params.length === 1 && Array.isArray(params[0]) ? params[0] : params
    );
    const applyOrFail = async (params: unknown[]) => {
      updatesInAttempt += 1;
      const bindings = bindingsFrom(params);
      if (updatesInAttempt === 2) {
        throw new Error('write interrupted');
      }
      amounts.set(String(bindings[7]), Number(bindings[0]));
      return { changes: 1, lastInsertRowId: 0 };
    };

    db.getFirstAsync.mockImplementation(async (sql: string) => (
      sql === 'PRAGMA user_version' ? { user_version: 3 } : null
    ));
    db.execAsync.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN IMMEDIATE TRANSACTION') {
        snapshot = new Map(amounts);
        updatesInAttempt = 0;
      } else if (sql === 'ROLLBACK') {
        amounts.clear();
        for (const [txid, amount] of snapshot) amounts.set(txid, amount);
      }
    });
    db.runAsync.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (String(sql).includes('UPDATE wallet_transactions')) {
        return applyOrFail(params);
      }
      return { changes: 1, lastInsertRowId: 0 };
    });
    db.prepareAsync.mockImplementation(async () => {
      const finalizeAsync = vi.fn(async () => undefined);
      finalizers.push(finalizeAsync);
      return {
        executeAsync: vi.fn(async (...params: unknown[]) => applyOrFail(params)),
        finalizeAsync,
      };
    });
    sqlite.openDatabaseAsync.mockResolvedValue(db);
    const { saveHistoryEnrichmentBatch } = await import('./walletHistoryDb');

    await expect(saveHistoryEnrichmentBatch(
      'wallet-address',
      [
        { ...enrichedRecord, txid: 'first', amountSats: 100 },
        { ...enrichedRecord, txid: 'second', amountSats: 200 },
      ],
      [],
    )).rejects.toMatchObject({ name: 'WalletStorageError' });

    expect(amounts).toEqual(new Map([
      ['first', 1],
      ['second', 2],
    ]));
    expect(finalizers).toHaveLength(3);
    for (const finalizeAsync of finalizers) {
      expect(finalizeAsync).toHaveBeenCalledTimes(1);
    }
    expect(db.execAsync.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(3);
    expect(db.execAsync.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(0);
  });

  it('chunks history and output inserts below the SQLite binding limit', async () => {
    vi.resetModules();
    db.getFirstAsync.mockImplementation(async (sql: string) => (
      sql === 'PRAGMA user_version' ? { user_version: 3 } : null
    ));
    db.runAsync.mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    sqlite.openDatabaseAsync.mockResolvedValue(db);
    const {
      saveHistoryEnrichmentBatch,
      saveWalletHistoryCache,
    } = await import('./walletHistoryDb');

    await saveWalletHistoryCache(
      'wallet-address',
      Array.from({ length: 400 }, (_, index) => ({
        txid: `transaction-${index}`,
        height: index + 1,
        address: `address-${index % 160}`,
      })),
      952_900,
    );
    const historyInsertCalls = db.runAsync.mock.calls.filter(([sql]) => (
      String(sql).includes('INSERT INTO wallet_transactions')
    ));
    expect(historyInsertCalls).toHaveLength(3);
    expect(String(historyInsertCalls[0]?.[0])).toContain(
      'WHEN wallet_transactions.height = excluded.height THEN wallet_transactions.amount_sats',
    );
    expect(String(historyInsertCalls[0]?.[0])).toContain('height = excluded.height');
    expect(historyInsertCalls.map((call) => {
      const params = call.slice(1);
      return params.length === 1 && Array.isArray(params[0]) ? params[0].length : params.length;
    })).toEqual([995, 995, 10]);

    db.runAsync.mockClear();
    await saveHistoryEnrichmentBatch(
      'wallet-address',
      [],
      Array.from({ length: 205 }, (_, index) => ({
        txid: 'transaction',
        outputIndex: index,
        valueSats: index + 1,
        address: `address-${index}`,
      })),
    );
    const outputInsertCalls = db.runAsync.mock.calls.filter(([sql]) => (
      String(sql).includes('INSERT INTO wallet_transaction_outputs')
    ));
    expect(outputInsertCalls).toHaveLength(2);
    expect(String(outputInsertCalls[0]?.[0])).toContain(
      `ON CONFLICT(wallet_id, txid, output_index, address) DO UPDATE SET
           value_sats = excluded.value_sats`,
    );
    expect(outputInsertCalls.map((call) => {
      const params = call.slice(1);
      return params.length === 1 && Array.isArray(params[0]) ? params[0].length : params.length;
    })).toEqual([995, 30]);
  });

  it('applies connection pragmas before schema work on every reopened connection', async () => {
    vi.resetModules();
    const createConnection = () => ({
      execAsync: vi.fn(async (_sql: string) => undefined),
      getAllAsync: vi.fn(async (_sql: string, ..._params: unknown[]) => []),
      getFirstAsync: vi.fn(async (sql: string) => (
        sql === 'PRAGMA user_version' ? { user_version: 3 } : null
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

  it('upgrades a 1.3.1 version 2 database without rewriting history rows', async () => {
    vi.resetModules();
    const legacyConnection = {
      execAsync: vi.fn(async (_sql: string) => undefined),
      getAllAsync: vi.fn(async (_sql: string, ..._params: unknown[]) => []),
      getFirstAsync: vi.fn(async (sql: string) => (
        sql === 'PRAGMA user_version' ? { user_version: 2 } : null
      )),
      runAsync: vi.fn(async (_sql: string, ..._params: unknown[]) => ({
        changes: 1,
        lastInsertRowId: 0,
      })),
    };
    sqlite.openDatabaseAsync.mockResolvedValue(legacyConnection);
    const { loadHdAddressRequirements } = await import('./walletHistoryDb');

    await expect(loadHdAddressRequirements('wallet-address')).resolves.toEqual([]);

    const migrationSql = legacyConnection.execAsync.mock.calls.map(([sql]) => String(sql));
    expect(migrationSql.some((sql) => (
      sql.includes('CREATE TABLE IF NOT EXISTS wallet_hd_sequences')
      && sql.includes('PRAGMA user_version = 3')
    ))).toBe(true);
    expect(migrationSql.some((sql) => sql.includes('UPDATE wallet_transactions'))).toBe(false);
    expect(legacyConnection.runAsync).not.toHaveBeenCalled();
  });
});
