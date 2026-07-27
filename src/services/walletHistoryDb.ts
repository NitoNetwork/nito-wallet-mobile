import * as SQLite from 'expo-sqlite';

import type { ElectrumHistoryEntry } from '../network/electrum';
import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
import type { CachedTransactionOutput } from './historyExport';
import { isDuplicateColumnError, retrySqliteWrite } from './sqliteReliability';
import { runWalletStorageOperation } from './walletStorageError';
import { normalizeWalletHistory } from './walletHistory';
import type { EnrichedHistoryRecord } from './walletHistory';

export { normalizeWalletHistory } from './walletHistory';
export type { EnrichedHistoryRecord } from './walletHistory';

const DB_NAME = 'nito-wallet-history.db';
const SQLITE_TXID_QUERY_CHUNK_SIZE = 400;

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

type TransactionOutputRow = {
  txid: string;
  output_index: number;
  value_sats: number;
  address: string;
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
const writeQueues = new WeakMap<SQLite.SQLiteDatabase, Promise<void>>();

const initializeHistoryDb = async () => {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await retrySqliteWrite(() => db.execAsync(`
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
    `));

  for (const column of [
    'amount_sats INTEGER',
    'direction TEXT',
    'fee_sats INTEGER',
    'enriched_at TEXT',
    'counterparty TEXT',
    'block_time INTEGER',
  ]) {
    await retrySqliteWrite(async () => {
      try {
        await db.execAsync(`ALTER TABLE wallet_transactions ADD COLUMN ${column};`);
      } catch (caught) {
        if (!isDuplicateColumnError(caught)) {
          throw caught;
        }
      }
    });
  }

  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((version?.user_version ?? 0) < 1) {
    await retrySqliteWrite(async () => {
      await db.execAsync(
        `UPDATE wallet_transactions
         SET amount_sats = NULL, direction = NULL, fee_sats = NULL, counterparty = NULL, enriched_at = NULL
         WHERE direction IS NOT NULL AND block_time IS NULL`,
      );
      await db.execAsync('PRAGMA user_version = 1');
    });
  }
  if ((version?.user_version ?? 0) < 2) {
    await runWriteTransaction(db, async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS wallet_transaction_outputs (
          wallet_id TEXT NOT NULL,
          txid TEXT NOT NULL,
          output_index INTEGER NOT NULL,
          value_sats INTEGER NOT NULL,
          address TEXT NOT NULL,
          PRIMARY KEY (wallet_id, txid, output_index, address)
        );
        CREATE INDEX IF NOT EXISTS idx_wallet_transaction_outputs_wallet_txid
          ON wallet_transaction_outputs(wallet_id, txid);
        PRAGMA user_version = 2;
      `);
    });
  }

  return db;
};

const openHistoryDb = async () => {
  dbPromise ??= initializeHistoryDb().catch((caught) => {
    dbPromise = null;
    throw caught;
  });

  return dbPromise;
};

export const loadTransactionOutputCache = async (
  walletId: string,
  txids: readonly string[],
): Promise<CachedTransactionOutput[]> => runWalletStorageOperation(
  'transaction output cache read',
  async () => {
    const uniqueTxids = [...new Set(txids.filter(Boolean))];
    if (uniqueTxids.length === 0) return [];

    const db = await openHistoryDb();
    const outputs: CachedTransactionOutput[] = [];
    for (let offset = 0; offset < uniqueTxids.length; offset += SQLITE_TXID_QUERY_CHUNK_SIZE) {
      const chunk = uniqueTxids.slice(offset, offset + SQLITE_TXID_QUERY_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = await db.getAllAsync<TransactionOutputRow>(
        `SELECT txid, output_index, value_sats, address
         FROM wallet_transaction_outputs
         WHERE wallet_id = ? AND txid IN (${placeholders})
         ORDER BY txid, output_index, address`,
        walletId,
        ...chunk,
      );
      outputs.push(...rows.map((row) => ({
        txid: row.txid,
        outputIndex: row.output_index,
        valueSats: row.value_sats,
        address: row.address,
      })));
    }
    return outputs;
  },
);

const runSerializedWrite = async <T>(
  db: SQLite.SQLiteDatabase,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = writeQueues.get(db) ?? Promise.resolve();
  const pending = previous.then(operation, operation);
  writeQueues.set(db, pending.then(
    () => undefined,
    () => undefined,
  ));
  return pending;
};

const runWriteTransaction = async (
  db: SQLite.SQLiteDatabase,
  operation: () => Promise<void>,
) => runSerializedWrite(db, () => retrySqliteWrite(async () => {
  await db.execAsync('BEGIN IMMEDIATE TRANSACTION');
  try {
    await operation();
    await db.execAsync('COMMIT');
  } catch (caught) {
    try {
      await db.execAsync('ROLLBACK');
    } catch (rollbackError) {
      const primary = caught instanceof Error ? caught : new Error(String(caught));
      const rollback = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      throw new Error(`${primary.message} Rollback failed: ${rollback.message}`);
    }
    throw caught;
  }
}));

export const loadWalletHistoryCache = async (
  walletId: string,
): Promise<WalletHistoryCache> => runWalletStorageOperation('wallet history cache read', async () => {
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
      if (row.amount_sats === null || row.fee_sats === null) {
        throw new Error(`Incomplete enriched history cache row for ${row.txid}.`);
      }
      entry.direction = row.direction;
      entry.amountSats = row.amount_sats;
      entry.feeSats = row.fee_sats;
      entry.counterparty = row.counterparty ?? '';
      if (row.block_time !== null) entry.blockTime = row.block_time;
    }
    return entry;
  });

  return {
    history: normalizeWalletHistory(history),
    fullHistoryHeight: state?.full_history_height ?? 0,
  };
});

export const loadWalletSnapshotCache = async (
  walletId: string,
): Promise<WalletSnapshotCache | null> => runWalletStorageOperation(
  'wallet snapshot cache read',
  async () => {
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
  },
);

export const saveWalletSnapshotCache = async (
  walletId: string,
  snapshot: TransparentWalletSnapshot,
  height: number,
): Promise<void> => runWalletStorageOperation('wallet snapshot cache write', async () => {
  const db = await openHistoryDb();
  await runSerializedWrite(db, () => retrySqliteWrite(() => db.runAsync(
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
  )));
});

export const saveWalletHistoryCache = async (
  walletId: string,
  history: ElectrumHistoryEntry[],
  fullHistoryHeight: number,
): Promise<void> => runWalletStorageOperation('wallet history cache write', async () => {
  const db = await openHistoryDb();
  const now = new Date().toISOString();
  const normalized = normalizeWalletHistory(history);

  await runWriteTransaction(db, async () => {
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
  });
});

export const saveHistoryEnrichmentBatch = async (
  walletId: string,
  records: EnrichedHistoryRecord[],
  outputs: readonly CachedTransactionOutput[],
): Promise<void> => runWalletStorageOperation('wallet history enrichment write', async () => {
  if (records.length === 0 && outputs.length === 0) return;
  const db = await openHistoryDb();
  const now = new Date().toISOString();

  await runWriteTransaction(db, async () => {
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
    for (const output of outputs) {
      if (
        !output.txid
        || !Number.isInteger(output.outputIndex)
        || output.outputIndex < 0
        || !Number.isSafeInteger(output.valueSats)
        || output.valueSats < 0
      ) {
        throw new Error('Invalid transaction output cache write.');
      }
      await db.runAsync(
        `INSERT INTO wallet_transaction_outputs
           (wallet_id, txid, output_index, value_sats, address)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(wallet_id, txid, output_index, address) DO UPDATE SET
           value_sats = excluded.value_sats`,
        walletId,
        output.txid,
        output.outputIndex,
        output.valueSats,
        output.address,
      );
    }
  });
});

export const saveEnrichedHistoryRecords = async (
  walletId: string,
  records: EnrichedHistoryRecord[],
) => saveHistoryEnrichmentBatch(walletId, records, []);

export const clearWalletHistoryCache = async (walletId: string): Promise<void> => (
  runWalletStorageOperation('wallet history cache clear', async () => {
    const db = await openHistoryDb();
    await runWriteTransaction(db, async () => {
      await db.runAsync('DELETE FROM wallet_transaction_outputs WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_transactions WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_sync_state WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_snapshot_cache WHERE wallet_id = ?', walletId);
    });
  })
);
