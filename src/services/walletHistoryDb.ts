import * as SQLite from 'expo-sqlite';

import type { ElectrumHistoryEntry } from '../network/electrum';
import type { TransparentWalletSnapshot } from '../wallet/transparentScan';

const DB_NAME = 'nito-wallet-history.db';

type HistoryRow = {
  txid: string;
  height: number;
  address: string;
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
    return db;
  });

  return dbPromise;
};

export const normalizeWalletHistory = (history: ElectrumHistoryEntry[]) => {
  const byTxid = new Map<string, ElectrumHistoryEntry>();

  for (const entry of history) {
    const existing = byTxid.get(entry.txid);

    if (!existing || entry.height > existing.height || (entry.height === existing.height && entry.address < existing.address)) {
      byTxid.set(entry.txid, entry);
    }
  }

  return [...byTxid.values()].sort((a, b) => {
    if (a.height !== b.height) {
      return b.height - a.height;
    }

    return a.txid.localeCompare(b.txid);
  });
};

export const loadWalletHistoryCache = async (walletId: string): Promise<WalletHistoryCache> => {
  const db = await openHistoryDb();
  const [rows, state] = await Promise.all([
    db.getAllAsync<HistoryRow>(
      'SELECT txid, height, address FROM wallet_transactions WHERE wallet_id = ? ORDER BY height DESC, txid ASC',
      walletId,
    ),
    db.getFirstAsync<SyncStateRow>(
      'SELECT full_history_height FROM wallet_sync_state WHERE wallet_id = ?',
      walletId,
    ),
  ]);

  return {
    history: normalizeWalletHistory(rows),
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

export const clearWalletHistoryCache = async (walletId: string) => {
  const db = await openHistoryDb();
  await db.runAsync('DELETE FROM wallet_transactions WHERE wallet_id = ?', walletId);
  await db.runAsync('DELETE FROM wallet_sync_state WHERE wallet_id = ?', walletId);
  await db.runAsync('DELETE FROM wallet_snapshot_cache WHERE wallet_id = ?', walletId);
};
