import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteTestConnection } from '../test/sqliteTestConnection';

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
  const [record] = await store.reserveInternalTaprootTransactions({ walletId, purpose: 'send', count: 1, minimumIndex: 0, maximumIndex: 19 });
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

  it('reserves unique indices concurrently and preserves signed data and the window across restart', async () => {
    const records = await Promise.all([reserve(), reserve(), reserve()]);
    expect(records.map((record) => record.addressIndex)).toEqual([0, 1, 2]);
    await store.markTransactionLifecycleSigned(walletId, records[1]!.lifecycleId, txid, '00ff');
    await connection.close();
    connection = sqliteTestConnection(join(directory, 'public.db'));
    vi.resetModules();
    store = await import('./walletHistoryDb');
    expect((await store.loadTransactionLifecycles(walletId))[1]).toMatchObject({ state: 'signed', rawTxHex: '00ff', txid });
    expect((await store.loadTransactionTracking(walletId)).window).toEqual({ lifecycleId: records[1]!.lifecycleId, open: true });
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
    expect((await store.loadTransactionTracking(walletId)).window?.lifecycleId).toBe(left.lifecycleId);
  });

  it('rolls back the relation and signature if opening the tracking window fails', async () => {
    const first = await original();
    const next = await reserve();
    await connection.execAsync(`CREATE TRIGGER fail_tracking BEFORE UPDATE ON wallet_transaction_tracking
      BEGIN SELECT RAISE(ABORT, 'test interruption'); END;`);
    await expect(store.markTransactionLifecycleSigned(walletId, next.lifecycleId, 'cd'.repeat(32), '11ff',
      { originalLifecycleId: first.lifecycleId, originalTxid: txid, mode: 'cancel' })).rejects.toThrow();
    expect(await connection.getAllAsync('SELECT * FROM wallet_transaction_replacements')).toEqual([]);
    expect((await store.loadTransactionLifecycles(walletId))[1]).toMatchObject({ state: 'reserved', rawTxHex: null });
    expect((await reserve()).addressIndex).toBe(2);
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
