import * as SQLite from 'expo-sqlite';

import type { ElectrumHistoryEntry } from '../network/electrum';
import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
import { normalizeWalletHistory } from './walletHistory';
import type { EnrichedHistoryRecord } from './walletHistory';

export { normalizeWalletHistory } from './walletHistory';
export type { EnrichedHistoryRecord } from './walletHistory';

const DB_NAME = 'nito-wallet-history.db';

type HistoryRow = {
  txid: string;
  height: number;
  address: string;
  amount_sats: number | null;
  direction: string | null;
  fee_sats: number | null;
  counterparty: string | null;
  block_time: number | null;
};


type SyncStateRow = {
  full_history_height: number;
};

type SnapshotRow = {
  snapshot_json: string;
  height: number;
};

export type WalletHistoryCache = {
  history: ElectrumHistoryEntry[];
  fullHistoryHeight: number;
};

export type WalletSnapshotCache = {
  snapshot: TransparentWalletSnapshot;
  height: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const openHistoryDb = async () => {
  dbPromise ??= SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS wallet_sync_state (
        wallet_id TEXT PRIMARY KEY NOT NULL,
        full_history_height INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        wallet_id TEXT NOT NULL,
        txid TEXT NOT NULL,
        height INTEGER NOT NULL,
        address TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        PRIMARY KEY (wallet_id, txid)
      );
      CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_height
        ON wallet_transactions(wallet_id, height DESC);
      CREATE TABLE IF NOT EXISTS wallet_snapshot_cache (
        wallet_id TEXT PRIMARY KEY NOT NULL,
        snapshot_json TEXT NOT NULL,
        height INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);

    for (const column of [
      'amount_sats INTEGER',
      'direction TEXT',
      'fee_sats INTEGER',
      'enriched_at TEXT',
      'counterparty TEXT',
      'block_time INTEGER',
    ]) {
      await db.execAsync(`ALTER TABLE wallet_transactions ADD COLUMN ${column};`).catch(() => undefined);
    }

    try {
      const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if ((version?.user_version ?? 0) < 1) {
        await db.execAsync(
          `UPDATE wallet_transactions
           SET amount_sats = NULL, direction = NULL, fee_sats = NULL, counterparty = NULL, enriched_at = NULL
           WHERE direction IS NOT NULL AND block_time IS NULL`,
        );
        await db.execAsync('PRAGMA user_version = 1');
      }
    } catch {
      // Version bump is retried on the next launch if the migration failed.
    }

    return db;
  });

  return dbPromise;
};

export const loadWalletHistoryCache = async (walletId: string): Promise<WalletHistoryCache> => {
  const db = await openHistoryDb();
  const [rows, state] = await Promise.all([
    db.getAllAsync<HistoryRow>(
      'SELECT txid, height, address, amount_sats, direction, fee_sats, counterparty, block_time FROM wallet_transactions WHERE wallet_id = ? ORDER BY height DESC, txid ASC',
      walletId,
    ),
    db.getFirstAsync<SyncStateRow>(
      'SELECT full_history_height FROM wallet_sync_state WHERE wallet_id = ?',
      walletId,
    ),
  ]);

  const history: ElectrumHistoryEntry[] = rows.map((row) => {
    const entry: ElectrumHistoryEntry = { txid: row.txid, height: row.height, address: row.address };
    if (row.direction === 'received' || row.direction === 'sent' || row.direction === 'self') {
      entry.direction = row.direction;
      entry.amountSats = row.amount_sats ?? 0;
      entry.feeSats = row.fee_sats ?? 0;
      entry.counterparty = row.counterparty ?? '';
      if (row.block_time !== null) entry.blockTime = row.block_time;
    }
    return entry;
  });

  return {
    history: normalizeWalletHistory(history),
    fullHistoryHeight: state?.full_history_height ?? 0,
  };
};

export const loadWalletSnapshotCache = async (walletId: string): Promise<WalletSnapshotCache | null> => {
  const db = await openHistoryDb();
  const row = await db.getFirstAsync<SnapshotRow>(
    'SELECT snapshot_json, height FROM wallet_snapshot_cache WHERE wallet_id = ?',
    walletId,
  );

  if (!row) {
    return null;
  }

  return {
    snapshot: JSON.parse(row.snapshot_json) as TransparentWalletSnapshot,
    height: row.height,
  };
};

export const saveWalletSnapshotCache = async (
  walletId: string,
  snapshot: TransparentWalletSnapshot,
  height: number,
) => {
  const db = await openHistoryDb();
  await db.runAsync(
    `INSERT INTO wallet_snapshot_cache (wallet_id, snapshot_json, height, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(wallet_id) DO UPDATE SET
       snapshot_json = excluded.snapshot_json,
       height = excluded.height,
       updated_at = excluded.updated_at`,
    walletId,
    JSON.stringify(snapshot),
    Math.max(0, height),
    new Date().toISOString(),
  );
};

export const saveWalletHistoryCache = async (
  walletId: string,
  history: ElectrumHistoryEntry[],
  fullHistoryHeight: number,
) => {
  const db = await openHistoryDb();
  const now = new Date().toISOString();
  const normalized = normalizeWalletHistory(history);

  await db.execAsync('BEGIN IMMEDIATE TRANSACTION');
  try {
    for (const entry of normalized) {
      await db.runAsync(
        `INSERT INTO wallet_transactions (wallet_id, txid, height, address, first_seen_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(wallet_id, txid) DO UPDATE SET
           height = excluded.height,
           address = excluded.address`,
        walletId,
        entry.txid,
        entry.height,
        entry.address,
        now,
      );
    }

    await db.runAsync(
      `INSERT INTO wallet_sync_state (wallet_id, full_history_height, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(wallet_id) DO UPDATE SET
         full_history_height = MAX(wallet_sync_state.full_history_height, excluded.full_history_height),
         updated_at = excluded.updated_at`,
      walletId,
      Math.max(0, fullHistoryHeight),
      now,
    );

    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

export const saveEnrichedHistoryRecords = async (
  walletId: string,
  records: EnrichedHistoryRecord[],
) => {
  if (records.length === 0) return;
  const db = await openHistoryDb();
  const now = new Date().toISOString();

  await db.execAsync('BEGIN IMMEDIATE TRANSACTION');
  try {
    for (const record of records) {
      await db.runAsync(
        `UPDATE wallet_transactions
         SET amount_sats = ?, direction = ?, fee_sats = ?, counterparty = ?, block_time = ?, enriched_at = ?
         WHERE wallet_id = ? AND txid = ? AND height = ?`,
        Math.max(0, Math.trunc(record.amountSats)),
        record.direction,
        Math.max(0, Math.trunc(record.feeSats)),
        record.counterparty,
        record.blockTime,
        now,
        walletId,
        record.txid,
        record.height,
      );
    }
    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

export const clearWalletHistoryCache = async (walletId: string) => {
  const db = await openHistoryDb();
  await db.runAsync('DELETE FROM wallet_transactions WHERE wallet_id = ?', walletId);
  await db.runAsync('DELETE FROM wallet_sync_state WHERE wallet_id = ?', walletId);
  await db.runAsync('DELETE FROM wallet_snapshot_cache WHERE wallet_id = ?', walletId);
};
