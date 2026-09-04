import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteTestConnection } from '../test/sqliteTestConnection';
import { HD_ACCOUNT_TEMPLATES, deriveHdPath } from '../wallet/hdAddress';

const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-sqlite', () => sqlite);
vi.mock('./diagnostics', () => ({ reportNonFinancialFailure: vi.fn() }));
let connection: ReturnType<typeof sqliteTestConnection>;
let directory: string;
let store: typeof import('./walletHistoryDb');
const walletId = 'historical-bech32-wallet-id';
const txid = 'ab'.repeat(32);

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nito-rbf-sqlite-'));
  connection = sqliteTestConnection(join(directory, 'public.db'));
  sqlite.openDatabaseAsync.mockImplementation(async () => connection);
  vi.resetModules();
  store = await import('./walletHistoryDb');
});
afterEach(async () => {
  await connection.close();
  if (!directory.startsWith(join(tmpdir(), 'nito-rbf-sqlite-'))) throw new Error('Invalid test cleanup path');
  await rm(directory, { recursive: true });
});

const reserve = async () => {
  const [record] = await store.reserveInternalTransactions({ walletId, purpose: 'send', count: 1, minimumIndex: 0, maximumIndex: 19 });
  await store.attachInternalTransactionAddresses(walletId, [{ lifecycleId: record!.lifecycleId, address: `nito1ptest${record!.addressIndex}` }]);
  return record!;
};
const original = async () => {
  const record = await reserve();
  await store.markTransactionLifecycleSigned(walletId, record.lifecycleId, txid, '00ff');
  await store.markTransactionLifecyclePublished(walletId, record.lifecycleId);
  return record;
};

describe('real SQLite transaction lifecycle and replacement persistence', () => {
  it('migrates a 1.3.1 public history without changing its historical wallet identity or values', async () => {
    await connection.execAsync(`
      CREATE TABLE wallet_transactions (wallet_id TEXT NOT NULL, txid TEXT NOT NULL, height INTEGER NOT NULL,
        address TEXT NOT NULL, first_seen_at TEXT NOT NULL, amount_sats INTEGER, direction TEXT, fee_sats INTEGER,
        enriched_at TEXT, counterparty TEXT, block_time INTEGER, PRIMARY KEY(wallet_id, txid));
      CREATE TABLE wallet_transaction_outputs (wallet_id TEXT NOT NULL, txid TEXT NOT NULL, output_index INTEGER NOT NULL,
        value_sats INTEGER NOT NULL, address TEXT NOT NULL, PRIMARY KEY(wallet_id,txid,output_index,address));
      PRAGMA user_version = 2;
    `);
    await connection.runAsync('INSERT INTO wallet_transactions VALUES (?, ?, 42, ?, ?, 123, ?, 4, ?, ?, 100)',
      walletId, txid, walletId, 'date', 'self', 'date', walletId);
    const before = await connection.getAllAsync('SELECT * FROM wallet_transactions');
    expect(await store.loadTransactionLifecycles(walletId)).toEqual([]);
    expect(await connection.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 7 });
    expect(await connection.getAllAsync('SELECT * FROM wallet_transactions')).toEqual(before);
    expect((await store.loadWalletHistoryCache(walletId)).history[0]).toMatchObject({ txid, amountSats: 123, feeSats: 4 });
  });

  it('reserves unique indices concurrently and preserves signatures without restoring a popup', async () => {
    const records = await Promise.all([reserve(), reserve(), reserve()]);
    expect(records.map((record) => record.addressIndex)).toEqual([0, 1, 2]);
    await store.markTransactionLifecycleSigned(walletId, records[1]!.lifecycleId, txid, '00ff');
    await connection.close();
    connection = sqliteTestConnection(join(directory, 'public.db'));
    vi.resetModules();
    store = await import('./walletHistoryDb');
    expect((await store.loadTransactionLifecycles(walletId))[1]).toMatchObject({ state: 'signed', rawTxHex: '00ff', txid });
    expect((await store.loadTransactionTracking(walletId)).window).toBeNull();
    expect((await reserve()).addressIndex).toBe(3);
  });

  it('commits only one competing signed replacement and prevents the old transaction from broadcasting', async () => {
    const first = await original();
    const [left, right] = await Promise.all([reserve(), reserve()]);
    const replacement = { originalLifecycleId: first.lifecycleId, originalTxid: txid, mode: 'accelerate' as const };
    const results = await Promise.allSettled([
      store.markTransactionLifecycleSigned(walletId, left.lifecycleId, 'cd'.repeat(32), '11ff', replacement),
      store.markTransactionLifecycleSigned(walletId, right.lifecycleId, 'ef'.repeat(32), '22ff', replacement),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    const records = await store.loadTransactionLifecycles(walletId);
    expect(records[1]).toMatchObject({ state: 'signed', replacement });
    expect(records[2]).toMatchObject({ state: 'reserved', rawTxHex: null });
    expect(await store.recordTransactionLifecycleBroadcastInvocation(walletId, first.lifecycleId, 1000)).toBeNull();
    expect((await store.loadTransactionTracking(walletId)).records.map((record) => record.lifecycleId)).toContain(left.lifecycleId);
  });

  it('rolls back the replacement relation if persisting its signature fails', async () => {
    const first = await original();
    const next = await reserve();
    await connection.execAsync(`CREATE TRIGGER fail_signature BEFORE UPDATE ON wallet_transaction_lifecycle
      WHEN NEW.state = 'signed'
      BEGIN SELECT RAISE(ABORT, 'test interruption'); END;`);
    await expect(store.markTransactionLifecycleSigned(walletId, next.lifecycleId, 'cd'.repeat(32), '11ff',
      { originalLifecycleId: first.lifecycleId, originalTxid: txid, mode: 'cancel' })).rejects.toThrow();
    expect(await connection.getAllAsync('SELECT * FROM wallet_transaction_replacements')).toEqual([]);
    expect((await store.loadTransactionLifecycles(walletId))[1]).toMatchObject({ state: 'reserved', rawTxHex: null });
    expect((await reserve()).addressIndex).toBe(2);
  });

  it('reserves and restores independent durable sequences for all four change families without touching legacy data', async () => {
    const legacy = await reserve();
    await store.markTransactionLifecycleSigned(walletId, legacy.lifecycleId, txid, '00ff');
    const before = (await store.loadTransactionLifecycles(walletId))[0];
    const results = await Promise.all(HD_ACCOUNT_TEMPLATES.flatMap(({ key }) => [0, 1].map(async () => {
      const [record] = await store.reserveInternalTransactions({ walletId, accountKey: key, purpose: 'send', count: 1, minimumIndex: 0, maximumIndex: 19 });
      return { key, record: record! };
    })));
    for (const { key } of HD_ACCOUNT_TEMPLATES) {
      expect(results.filter((item) => item.key === key).map((item) => item.record.addressIndex))
        .toEqual(key === 'taproot' ? [1, 2] : [0, 1]);
    }
    await connection.close();
    connection = sqliteTestConnection(join(directory, 'public.db'));
    vi.resetModules();
    store = await import('./walletHistoryDb');
    const restored = await store.loadTransactionLifecycles(walletId);
    expect(restored.find((record) => record.lifecycleId === legacy.lifecycleId)).toEqual(before);
    for (const { key, record } of results) {
      expect(restored.find((item) => item.lifecycleId === record.lifecycleId)?.derivationPath)
        .toBe(deriveHdPath(key, 'internal', record.addressIndex!));
    }
    // Existing persisted UI rows cannot reopen the new session-local window.
    await connection.runAsync('INSERT INTO wallet_transaction_tracking VALUES (?, ?, 1)', walletId, legacy.lifecycleId);
    expect((await store.loadTransactionTracking(walletId)).window).toBeNull();
  });

  it.each(HD_ACCOUNT_TEMPLATES)('enforces the durable gap limit and validates the internal path for $key', async ({ key }) => {
    const args = { walletId, accountKey: key, purpose: 'send' as const, count: 2, minimumIndex: 0, maximumIndex: 1 };
    const records = await store.reserveInternalTransactions(args);
    await expect(store.reserveInternalTransactions({ ...args, count: 1 })).rejects.toThrow();
    expect(await store.loadTransactionLifecycles(walletId)).toHaveLength(2);
    expect((await store.loadHdAddressRequirements(walletId)).find((item) => item.accountKey === key)?.highestIssuedIndex).toBe(1);
    await connection.runAsync('UPDATE wallet_transaction_lifecycle SET derivation_path = ? WHERE lifecycle_id = ?',
      deriveHdPath(key, 'external', 0), records[0]!.lifecycleId);
    await expect(store.loadTransactionLifecycles(walletId)).rejects.toThrow();
  });

  it.each(['original', 'replacement'])('reconciles %s winning without ever writing a balance', async (winner) => {
    const first = await original();
    const next = await reserve();
    const replacementTxid = 'cd'.repeat(32);
    await store.markTransactionLifecycleSigned(walletId, next.lifecycleId, replacementTxid, '11ff',
      { originalLifecycleId: first.lifecycleId, originalTxid: txid, mode: 'cancel' });
    await store.reconcileTransactionLifecycles(walletId, [{ txid: winner === 'original' ? txid : replacementTxid, height: 100, address: walletId }]);
    const records = await store.loadTransactionLifecycles(walletId);
    expect(records.map((record) => record.state)).toEqual(winner === 'original' ? ['confirmed', 'conflicted'] : ['conflicted', 'confirmed']);
    expect(await store.claimTransactionLifecycleBroadcastAttempt(walletId, next.lifecycleId, 1000)).toBeNull();
    expect(await connection.getAllAsync('SELECT * FROM wallet_snapshot_cache')).toEqual([]);
    expect(await connection.getAllAsync('SELECT * FROM wallet_transactions')).toEqual([]);
  });

  it('deletes the public relations and prevents an interrupted signer from recreating the deleted wallet', async () => {
    const first = await original();
    const next = await reserve();
    await store.clearWalletPublicData(walletId);
    await expect(store.markTransactionLifecycleSigned(walletId, next.lifecycleId, 'cd'.repeat(32), '11ff',
      { originalLifecycleId: first.lifecycleId, originalTxid: txid, mode: 'cancel' })).rejects.toThrow();
    expect(await store.loadTransactionLifecycles(walletId)).toEqual([]);
    expect(await connection.getAllAsync('SELECT * FROM wallet_transaction_replacements')).toEqual([]);
  });
});
