import * as SQLite from 'expo-sqlite';

import type { ElectrumHistoryEntry } from '../network/electrum';
import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
import {
  deriveHdPath,
  type HdAccountKey,
  type HdBranch,
  type HdScanRequirement,
} from '../wallet/hdAddress';
import type {
  TransactionLifecyclePurpose,
  TransactionLifecycleRecord,
  TransactionLifecycleState,
} from './transactionLifecycle';
import {
  assertLifecycleTransition,
  nextTransactionBroadcastAttemptAt,
  reconciledLifecycleState,
  TRANSACTION_BROADCAST_MAX_ATTEMPTS,
  confirmedTransactionFamilyMember,
} from './transactionLifecycle';
import type { CachedTransactionOutput } from './historyExport';
import type { TransactionTrackingData, TransactionTrackingWindowState, TrackedTransaction } from './transactionTracking';
import { isDuplicateColumnError, retrySqliteWrite } from './sqliteReliability';
import { runWalletStorageOperation } from './walletStorageError';
import { normalizeWalletHistory } from './walletHistory';
import { parseWalletSnapshotCache } from './walletSnapshotCache';
import type {
  EnrichedHistoryRecord,
  WalletHistoryPublicationMode,
} from './walletHistory';

export { normalizeWalletHistory } from './walletHistory';
export type { EnrichedHistoryRecord } from './walletHistory';

const DB_NAME = 'nito-wallet-history.db';
const SQLITE_TXID_QUERY_CHUNK_SIZE = 400;
const SQLITE_BOUND_VARIABLE_LIMIT = 999;
const CACHE_INSERT_BINDINGS_PER_ROW = 5;
const CACHE_INSERT_BATCH_SIZE = Math.floor(
  SQLITE_BOUND_VARIABLE_LIMIT / CACHE_INSERT_BINDINGS_PER_ROW,
);

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

type HistoryIdentityRow = {
  txid: string;
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

type HdSequenceRow = {
  account_key: string;
  branch: string;
  highest_issued_index: number;
};

type TransactionLifecycleRow = {
  lifecycle_id: string;
  wallet_id: string;
  account_key: string | null;
  branch: string | null;
  purpose: string;
  address_index: number | null;
  derivation_path: string | null;
  address: string | null;
  state: string;
  txid: string | null;
  raw_tx_hex: string | null;
  recovery_attempts: number;
  broadcast_invocations: number;
  next_broadcast_attempt_at: number | null;
  last_broadcast_attempt_at: number | null;
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
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;
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
  if ((version?.user_version ?? 0) < 3) {
    await runWriteTransaction(db, async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS wallet_hd_sequences (
          wallet_id TEXT NOT NULL,
          account_key TEXT NOT NULL,
          branch TEXT NOT NULL,
          highest_issued_index INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (wallet_id, account_key, branch)
        );
        PRAGMA user_version = 3;
      `);
    });
  }
  if ((version?.user_version ?? 0) < 4) {
    await runWriteTransaction(db, async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS wallet_transaction_lifecycle (
          lifecycle_id TEXT PRIMARY KEY NOT NULL,
          wallet_id TEXT NOT NULL,
          account_key TEXT,
          branch TEXT,
          address_index INTEGER,
          derivation_path TEXT,
          address TEXT,
          purpose TEXT NOT NULL,
          state TEXT NOT NULL,
          txid TEXT,
          raw_tx_hex TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (wallet_id, account_key, branch, address_index)
        );
        CREATE INDEX IF NOT EXISTS idx_wallet_transaction_lifecycle_txid
          ON wallet_transaction_lifecycle(wallet_id, txid);
        CREATE INDEX IF NOT EXISTS idx_wallet_transaction_lifecycle_state
          ON wallet_transaction_lifecycle(wallet_id, state);
        PRAGMA user_version = 4;
      `);
    });
  }
  if ((version?.user_version ?? 0) < 5) {
    await runWriteTransaction(db, async () => {
      await db.execAsync(`
        ALTER TABLE wallet_transaction_lifecycle
          ADD COLUMN recovery_attempts INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE wallet_transaction_lifecycle
          ADD COLUMN broadcast_invocations INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE wallet_transaction_lifecycle
          ADD COLUMN next_broadcast_attempt_at INTEGER;
        ALTER TABLE wallet_transaction_lifecycle
          ADD COLUMN last_broadcast_attempt_at INTEGER;
        PRAGMA user_version = 5;
      `);
    });
  }
  if ((version?.user_version ?? 0) < 6) {
    await runWriteTransaction(db, async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS wallet_transaction_tracking (
          wallet_id TEXT PRIMARY KEY NOT NULL,
          lifecycle_id TEXT NOT NULL,
          window_open INTEGER NOT NULL CHECK (window_open IN (0, 1))
        );
        PRAGMA user_version = 6;
      `);
    });
  }
  if ((version?.user_version ?? 0) < 7) {
    await runWriteTransaction(db, async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS wallet_transaction_replacements (
          wallet_id TEXT NOT NULL,
          original_lifecycle_id TEXT NOT NULL,
          original_txid TEXT NOT NULL,
          replacement_lifecycle_id TEXT PRIMARY KEY NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('accelerate', 'cancel')),
          UNIQUE (wallet_id, original_lifecycle_id)
        );
        PRAGMA user_version = 7;
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

const runWriteTransaction = async <T>(
  db: SQLite.SQLiteDatabase,
  operation: () => Promise<T>,
): Promise<T> => runSerializedWrite(db, () => retrySqliteWrite(async () => {
  await db.execAsync('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = await operation();
    await db.execAsync('COMMIT');
    return result;
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

const isHdAccountKey = (value: string): value is HdAccountKey => (
  value === 'legacy'
  || value === 'nested'
  || value === 'bech32'
  || value === 'taproot'
);

const isHdBranch = (value: string): value is HdBranch => (
  value === 'external' || value === 'internal'
);

const validateHdSequenceRow = (row: HdSequenceRow): HdScanRequirement => {
  if (
    !isHdAccountKey(row.account_key)
    || !isHdBranch(row.branch)
    || !Number.isSafeInteger(row.highest_issued_index)
    || row.highest_issued_index < 0
  ) {
    throw new Error('Invalid HD address sequence state.');
  }
  return {
    accountKey: row.account_key,
    branch: row.branch,
    highestIssuedIndex: row.highest_issued_index,
  };
};

export const loadHdAddressRequirements = async (
  walletId: string,
): Promise<HdScanRequirement[]> => runWalletStorageOperation(
  'HD address state read',
  async () => {
    const db = await openHistoryDb();
    const rows = await db.getAllAsync<HdSequenceRow>(
      `SELECT account_key, branch, highest_issued_index
       FROM wallet_hd_sequences
       WHERE wallet_id = ?
       ORDER BY account_key, branch`,
      walletId,
    );
    return rows.map(validateHdSequenceRow);
  },
);

export const loadCurrentHdAddressIndex = async (
  walletId: string,
  accountKey: HdAccountKey,
  branch: HdBranch,
): Promise<number> => runWalletStorageOperation('HD address state read', async () => {
  const db = await openHistoryDb();
  const row = await db.getFirstAsync<HdSequenceRow>(
    `SELECT account_key, branch, highest_issued_index
     FROM wallet_hd_sequences
     WHERE wallet_id = ? AND account_key = ? AND branch = ?`,
    walletId,
    accountKey,
    branch,
  );
  return row ? validateHdSequenceRow(row).highestIssuedIndex : 0;
});

export const reserveNextHdAddressIndex = async ({
  walletId,
  accountKey,
  branch,
  minimumIndex,
  maximumIndex = Number.MAX_SAFE_INTEGER,
}: {
  walletId: string;
  accountKey: HdAccountKey;
  branch: HdBranch;
  minimumIndex: number;
  maximumIndex?: number;
}): Promise<number> => runWalletStorageOperation('HD address reservation write', async () => {
  if (
    !Number.isSafeInteger(minimumIndex)
    || minimumIndex < 0
    || !Number.isSafeInteger(maximumIndex)
    || maximumIndex < 0
  ) {
    throw new Error('Invalid HD address reservation range.');
  }
  const db = await openHistoryDb();
  return runWriteTransaction(db, async () => {
    const current = await db.getFirstAsync<HdSequenceRow>(
      `SELECT account_key, branch, highest_issued_index
       FROM wallet_hd_sequences
       WHERE wallet_id = ? AND account_key = ? AND branch = ?`,
      walletId,
      accountKey,
      branch,
    );
    const currentIndex = current ? validateHdSequenceRow(current).highestIssuedIndex : 0;
    const nextIndex = Math.max(currentIndex + 1, minimumIndex);
    if (nextIndex > maximumIndex) {
      throw new Error('HD_ADDRESS_GAP_LIMIT_REACHED');
    }
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO wallet_hd_sequences
         (wallet_id, account_key, branch, highest_issued_index, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(wallet_id, account_key, branch) DO UPDATE SET
         highest_issued_index = excluded.highest_issued_index,
         updated_at = excluded.updated_at`,
      walletId,
      accountKey,
      branch,
      nextIndex,
      now,
    );
    return nextIndex;
  });
});

const isTransactionLifecycleState = (value: string): value is TransactionLifecycleState => (
  value === 'reserved'
  || value === 'signed'
  || value === 'conflicted'
  || value === 'broadcast-uncertain'
  || value === 'published'
  || value === 'confirmed'
);

const isTransactionLifecyclePurpose = (value: string): value is TransactionLifecyclePurpose => (
  value === 'send' || value === 'consolidation'
);

const validateTransactionLifecycleRow = (
  row: TransactionLifecycleRow,
): TransactionLifecycleRecord => {
  if (
    !row.lifecycle_id
    || !isTransactionLifecyclePurpose(row.purpose)
    || !isTransactionLifecycleState(row.state)
    || !Number.isSafeInteger(row.recovery_attempts)
    || row.recovery_attempts < 0
    || !Number.isSafeInteger(row.broadcast_invocations)
    || row.broadcast_invocations < 0
    || (row.next_broadcast_attempt_at !== null && (
      !Number.isSafeInteger(row.next_broadcast_attempt_at)
      || row.next_broadcast_attempt_at < 0
    ))
    || (row.last_broadcast_attempt_at !== null && (
      !Number.isSafeInteger(row.last_broadcast_attempt_at)
      || row.last_broadcast_attempt_at < 0
    ))
    || (row.address_index !== null && (
      row.account_key !== 'taproot'
      || row.branch !== 'internal'
      ||
      !Number.isSafeInteger(row.address_index)
      || row.address_index < 0
      || row.derivation_path !== deriveHdPath('taproot', 'internal', row.address_index)
    ))
    || (row.address_index === null && (
      row.account_key !== null
      || row.branch !== null
      || row.derivation_path !== null
    ))
  ) {
    throw new Error('Invalid transaction lifecycle state.');
  }
  return {
    lifecycleId: row.lifecycle_id,
    walletId: row.wallet_id,
    purpose: row.purpose,
    addressIndex: row.address_index,
    derivationPath: row.derivation_path,
    address: row.address,
    state: row.state,
    txid: row.txid,
    rawTxHex: row.raw_tx_hex,
    recoveryAttempts: row.recovery_attempts,
    broadcastInvocations: row.broadcast_invocations,
    nextBroadcastAttemptAt: row.next_broadcast_attempt_at,
    lastBroadcastAttemptAt: row.last_broadcast_attempt_at,
  };
};

export const reserveInternalTaprootTransactions = async ({
  walletId,
  purpose,
  count,
  minimumIndex,
  maximumIndex,
}: {
  walletId: string;
  purpose: TransactionLifecyclePurpose;
  count: number;
  minimumIndex: number;
  maximumIndex: number;
}): Promise<TransactionLifecycleRecord[]> => runWalletStorageOperation(
  'internal transaction address reservation write',
  async () => {
    if (
      !Number.isSafeInteger(count)
      || count < 1
      || !Number.isSafeInteger(minimumIndex)
      || minimumIndex < 0
      || !Number.isSafeInteger(maximumIndex)
      || maximumIndex < minimumIndex
    ) {
      throw new Error('Invalid internal address reservation range.');
    }
    const db = await openHistoryDb();
    return runWriteTransaction(db, async () => {
      const current = await db.getFirstAsync<HdSequenceRow>(
        `SELECT account_key, branch, highest_issued_index
         FROM wallet_hd_sequences
         WHERE wallet_id = ? AND account_key = 'taproot' AND branch = 'internal'`,
        walletId,
      );
      const currentIndex = current ? validateHdSequenceRow(current).highestIssuedIndex : -1;
      const firstIndex = Math.max(currentIndex + 1, minimumIndex);
      const lastIndex = firstIndex + count - 1;
      if (!Number.isSafeInteger(lastIndex) || lastIndex > maximumIndex) {
        throw new Error('HD_ADDRESS_GAP_LIMIT_REACHED');
      }
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO wallet_hd_sequences
           (wallet_id, account_key, branch, highest_issued_index, updated_at)
         VALUES (?, 'taproot', 'internal', ?, ?)
         ON CONFLICT(wallet_id, account_key, branch) DO UPDATE SET
           highest_issued_index = excluded.highest_issued_index,
           updated_at = excluded.updated_at`,
        walletId,
        lastIndex,
        now,
      );
      const reservations: TransactionLifecycleRecord[] = [];
      for (let addressIndex = firstIndex; addressIndex <= lastIndex; addressIndex += 1) {
        const derivationPath = deriveHdPath('taproot', 'internal', addressIndex);
        const idRow = await db.getFirstAsync<{ lifecycle_id: string }>(
          'SELECT lower(hex(randomblob(16))) AS lifecycle_id',
        );
        if (!idRow?.lifecycle_id) throw new Error('Transaction lifecycle identifier unavailable.');
        await db.runAsync(
          `INSERT INTO wallet_transaction_lifecycle
             (lifecycle_id, wallet_id, account_key, branch, address_index, derivation_path, address,
              purpose, state, txid, raw_tx_hex, created_at, updated_at)
           VALUES (?, ?, 'taproot', 'internal', ?, ?, NULL, ?, 'reserved', NULL, NULL, ?, ?)`,
          idRow.lifecycle_id,
          walletId,
          addressIndex,
          derivationPath,
          purpose,
          now,
          now,
        );
        reservations.push({
          lifecycleId: idRow.lifecycle_id,
          walletId,
          purpose,
          addressIndex,
          derivationPath,
          address: null,
          state: 'reserved',
          txid: null,
          rawTxHex: null,
          recoveryAttempts: 0,
          broadcastInvocations: 0,
          nextBroadcastAttemptAt: null,
          lastBroadcastAttemptAt: null,
        });
      }
      return reservations;
    });
  },
);

export const reserveTransactionWithoutAddress = async (
  walletId: string,
  purpose: TransactionLifecyclePurpose,
): Promise<TransactionLifecycleRecord> => runWalletStorageOperation(
  'transaction reservation write',
  async () => {
    const db = await openHistoryDb();
    return runWriteTransaction(db, async () => {
      const idRow = await db.getFirstAsync<{ lifecycle_id: string }>(
        'SELECT lower(hex(randomblob(16))) AS lifecycle_id',
      );
      if (!idRow?.lifecycle_id) throw new Error('Transaction lifecycle identifier unavailable.');
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO wallet_transaction_lifecycle
           (lifecycle_id, wallet_id, account_key, branch, address_index, derivation_path, address,
            purpose, state, txid, raw_tx_hex, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, ?, 'reserved', NULL, NULL, ?, ?)`,
        idRow.lifecycle_id,
        walletId,
        purpose,
        now,
        now,
      );
      return {
        lifecycleId: idRow.lifecycle_id,
        walletId,
        purpose,
        addressIndex: null,
        derivationPath: null,
        address: null,
        state: 'reserved',
        txid: null,
        rawTxHex: null,
        recoveryAttempts: 0,
        broadcastInvocations: 0,
        nextBroadcastAttemptAt: null,
        lastBroadcastAttemptAt: null,
      };
    });
  },
);

export const attachInternalTransactionAddresses = async (
  walletId: string,
  addresses: readonly { lifecycleId: string; address: string }[],
): Promise<void> => runWalletStorageOperation('internal transaction address write', async () => {
  const db = await openHistoryDb();
  await runWriteTransaction(db, async () => {
    const now = new Date().toISOString();
    for (const item of addresses) {
      const result = await db.runAsync(
        `UPDATE wallet_transaction_lifecycle
         SET address = ?, updated_at = ?
         WHERE lifecycle_id = ? AND wallet_id = ? AND state = 'reserved'`,
        item.address,
        now,
        item.lifecycleId,
        walletId,
      );
      if (result.changes !== 1) throw new Error('Reserved internal address was not found.');
    }
  });
});

const transitionTransactionLifecycle = async ({
  walletId,
  lifecycleId,
  state,
  txid,
  rawTxHex,
  replacement,
}: {
  walletId: string;
  lifecycleId: string;
  state: TransactionLifecycleState;
  txid?: string;
  rawTxHex?: string;
  replacement?: TransactionLifecycleRecord['replacement'];
}): Promise<void> => runWalletStorageOperation('transaction lifecycle write', async () => {
  const db = await openHistoryDb();
  await runWriteTransaction(db, async () => {
    const row = await db.getFirstAsync<TransactionLifecycleRow>(
      `SELECT lifecycle_id, wallet_id, account_key, branch, purpose, address_index, derivation_path, address, state, txid, raw_tx_hex,
              recovery_attempts, broadcast_invocations,
              next_broadcast_attempt_at, last_broadcast_attempt_at
       FROM wallet_transaction_lifecycle
       WHERE lifecycle_id = ? AND wallet_id = ?`,
      lifecycleId,
      walletId,
    );
    if (!row) throw new Error('Transaction lifecycle reservation was not found.');
    const current = validateTransactionLifecycleRow(row);
    assertLifecycleTransition(current.state, state);
    if (replacement) {
      if (state !== 'signed' || current.state !== 'reserved' || replacement.originalLifecycleId === lifecycleId
        || !['accelerate', 'cancel'].includes(replacement.mode)) throw new Error('Invalid replacement transition.');
      const original = await db.getFirstAsync<{ txid: string; state: string }>(
        'SELECT txid, state FROM wallet_transaction_lifecycle WHERE wallet_id = ? AND lifecycle_id = ?',
        walletId, replacement.originalLifecycleId,
      );
      if (!original || original.txid !== replacement.originalTxid
        || !['published', 'broadcast-uncertain'].includes(original.state)) throw new Error('Original transaction is no longer replaceable.');
      await db.runAsync(
        `INSERT INTO wallet_transaction_replacements
         (wallet_id, original_lifecycle_id, original_txid, replacement_lifecycle_id, mode) VALUES (?, ?, ?, ?, ?)`,
        walletId, replacement.originalLifecycleId, replacement.originalTxid, lifecycleId, replacement.mode,
      );
    }
    const nextTxid = txid ?? current.txid;
    const nextRawTxHex = rawTxHex ?? current.rawTxHex;
    if (state !== 'reserved' && (!nextTxid || !nextRawTxHex)) {
      throw new Error('Signed transaction lifecycle data is incomplete.');
    }
    await db.runAsync(
      `UPDATE wallet_transaction_lifecycle
       SET state = ?, txid = ?, raw_tx_hex = ?, updated_at = ?
       WHERE lifecycle_id = ? AND wallet_id = ?`,
      state,
      nextTxid,
      nextRawTxHex,
      new Date().toISOString(),
      lifecycleId,
      walletId,
    );
    // The signed payload and its restorable window commit together.
    if (state === 'signed') {
      await writeTransactionTrackingWindow(db, walletId, { lifecycleId, open: true });
    }
  });
});

export const markTransactionLifecycleSigned = (
  walletId: string,
  lifecycleId: string,
  txid: string,
  rawTxHex: string,
  replacement?: TransactionLifecycleRecord['replacement'],
): Promise<void> => transitionTransactionLifecycle({
  walletId,
  lifecycleId,
  state: 'signed',
  txid,
  rawTxHex,
  replacement,
});

export const markTransactionLifecycleBroadcastUncertain = (
  walletId: string,
  lifecycleId: string,
): Promise<void> => transitionTransactionLifecycle({
  walletId,
  lifecycleId,
  state: 'broadcast-uncertain',
});

export const claimTransactionLifecycleBroadcastAttempt = async (
  walletId: string,
  lifecycleId: string,
  now: number,
): Promise<TransactionLifecycleRecord | null> => runWalletStorageOperation(
  'transaction broadcast attempt write',
  async () => {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('Invalid transaction broadcast attempt time.');
    }
    const db = await openHistoryDb();
    return runWriteTransaction(db, async () => {
      const row = await db.getFirstAsync<TransactionLifecycleRow>(
        `SELECT lifecycle_id, wallet_id, account_key, branch, purpose, address_index, derivation_path, address, state, txid, raw_tx_hex,
                recovery_attempts, broadcast_invocations,
                next_broadcast_attempt_at, last_broadcast_attempt_at
         FROM wallet_transaction_lifecycle
         WHERE lifecycle_id = ? AND wallet_id = ?`,
        lifecycleId,
        walletId,
      );
      if (!row) return null;
      const current = validateTransactionLifecycleRow(row);
      if (
        (current.state !== 'signed' && current.state !== 'broadcast-uncertain')
        || !current.txid
        || !current.rawTxHex
        || current.broadcastInvocations >= TRANSACTION_BROADCAST_MAX_ATTEMPTS
        || (
          current.state === 'broadcast-uncertain'
          && current.nextBroadcastAttemptAt !== null
          && current.nextBroadcastAttemptAt > now
        )
      ) {
        return null;
      }
      const recoveryAttempts = current.recoveryAttempts + 1;
      const nextBroadcastAttemptAt = nextTransactionBroadcastAttemptAt(recoveryAttempts, now);
      const result = await db.runAsync(
        `UPDATE wallet_transaction_lifecycle
         SET state = 'broadcast-uncertain', recovery_attempts = ?,
             next_broadcast_attempt_at = ?, updated_at = ?
         WHERE lifecycle_id = ? AND wallet_id = ?
           AND state = ? AND recovery_attempts = ?`,
        recoveryAttempts,
        nextBroadcastAttemptAt,
        new Date(now).toISOString(),
        lifecycleId,
        walletId,
        current.state,
        current.recoveryAttempts,
      );
      if (result.changes !== 1) return null;
      return {
        ...current,
        state: 'broadcast-uncertain',
        recoveryAttempts,
        nextBroadcastAttemptAt,
      };
    });
  },
);

export const recordTransactionLifecycleBroadcastInvocation = async (
  walletId: string,
  lifecycleId: string,
  now: number,
): Promise<TransactionLifecycleRecord | null> => runWalletStorageOperation(
  'transaction broadcast invocation write',
  async () => {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('Invalid transaction broadcast invocation time.');
    }
    const db = await openHistoryDb();
    return runWriteTransaction(db, async () => {
      const replacement = await db.getFirstAsync<{ replacement_lifecycle_id: string }>(
        'SELECT replacement_lifecycle_id FROM wallet_transaction_replacements WHERE wallet_id = ? AND original_lifecycle_id = ?',
        walletId, lifecycleId,
      );
      if (replacement) return null;
      const row = await db.getFirstAsync<TransactionLifecycleRow>(
        `SELECT lifecycle_id, wallet_id, account_key, branch, purpose, address_index, derivation_path, address, state, txid, raw_tx_hex,
                recovery_attempts, broadcast_invocations,
                next_broadcast_attempt_at, last_broadcast_attempt_at
         FROM wallet_transaction_lifecycle
         WHERE lifecycle_id = ? AND wallet_id = ?`,
        lifecycleId,
        walletId,
      );
      if (!row) return null;
      const current = validateTransactionLifecycleRow(row);
      if (
        current.state !== 'broadcast-uncertain'
        || !current.txid
        || !current.rawTxHex
        || current.broadcastInvocations >= TRANSACTION_BROADCAST_MAX_ATTEMPTS
      ) {
        return null;
      }
      const broadcastInvocations = current.broadcastInvocations + 1;
      const result = await db.runAsync(
        `UPDATE wallet_transaction_lifecycle
         SET broadcast_invocations = ?, last_broadcast_attempt_at = ?, updated_at = ?
         WHERE lifecycle_id = ? AND wallet_id = ?
           AND state = 'broadcast-uncertain' AND broadcast_invocations = ?`,
        broadcastInvocations,
        now,
        new Date(now).toISOString(),
        lifecycleId,
        walletId,
        current.broadcastInvocations,
      );
      if (result.changes !== 1) return null;
      return { ...current, broadcastInvocations, lastBroadcastAttemptAt: now };
    });
  },
);

export const markTransactionLifecyclePublished = (
  walletId: string,
  lifecycleId: string,
): Promise<void> => transitionTransactionLifecycle({
  walletId,
  lifecycleId,
  state: 'published',
});

export const markTransactionLifecycleConflicted = (walletId: string, lifecycleId: string): Promise<void> => (
  transitionTransactionLifecycle({ walletId, lifecycleId, state: 'conflicted' })
);

export const loadTransactionLifecycles = async (
  walletId: string,
): Promise<TransactionLifecycleRecord[]> => runWalletStorageOperation(
  'transaction lifecycle read',
  async () => {
    const db = await openHistoryDb();
    const rows = await db.getAllAsync<TransactionLifecycleRow>(
      `SELECT lifecycle_id, wallet_id, account_key, branch, purpose, address_index, derivation_path, address, state, txid, raw_tx_hex,
              recovery_attempts, broadcast_invocations,
              next_broadcast_attempt_at, last_broadcast_attempt_at
       FROM wallet_transaction_lifecycle
       WHERE wallet_id = ?
       ORDER BY address_index`,
      walletId,
    );
    const replacements = await readTransactionReplacements(db, walletId);
    return rows.map((row) => ({ ...validateTransactionLifecycleRow(row), replacement: replacements.get(row.lifecycle_id) }));
  },
);

const readTransactionReplacements = async (db: SQLite.SQLiteDatabase, walletId: string) => {
  const rows = await db.getAllAsync<{
    original_lifecycle_id: string; original_txid: string; replacement_lifecycle_id: string; mode: 'accelerate' | 'cancel';
  }>('SELECT original_lifecycle_id, original_txid, replacement_lifecycle_id, mode FROM wallet_transaction_replacements WHERE wallet_id = ?', walletId);
  return new Map(rows.map((row) => {
    if (!row.original_lifecycle_id || !row.replacement_lifecycle_id || !/^[a-f0-9]{64}$/i.test(row.original_txid)
      || !['accelerate', 'cancel'].includes(row.mode)) throw new Error('Invalid persisted transaction replacement.');
    return [row.replacement_lifecycle_id, { originalLifecycleId: row.original_lifecycle_id, originalTxid: row.original_txid, mode: row.mode }] as const;
  }));
};

const writeTransactionTrackingWindow = async (
  db: SQLite.SQLiteDatabase,
  walletId: string,
  window: TransactionTrackingWindowState,
): Promise<void> => {
  await db.runAsync(
    `INSERT INTO wallet_transaction_tracking (wallet_id, lifecycle_id, window_open)
     VALUES (?, ?, ?)
     ON CONFLICT(wallet_id) DO UPDATE SET
       lifecycle_id = excluded.lifecycle_id, window_open = excluded.window_open`,
    walletId, window.lifecycleId, window.open ? 1 : 0,
  );
};

export const saveTransactionTrackingWindow = async (
  walletId: string,
  window: TransactionTrackingWindowState,
): Promise<void> => runWalletStorageOperation('transaction tracking window write', async () => {
  const db = await openHistoryDb();
  await runWriteTransaction(db, async () => {
    const record = await db.getFirstAsync<{ lifecycle_id: string }>(
      `SELECT lifecycle_id FROM wallet_transaction_lifecycle
       WHERE wallet_id = ? AND lifecycle_id = ? AND state != 'reserved'`,
      walletId, window.lifecycleId,
    );
    // Never recreate tracking state after wallet deletion.
    if (!record) throw new Error('Tracked transaction was not found.');
    await writeTransactionTrackingWindow(db, walletId, window);
  });
});

export const loadTransactionTracking = async (
  walletId: string,
): Promise<TransactionTrackingData> => runWalletStorageOperation('transaction tracking read', async () => {
  const db = await openHistoryDb();
  const rows = await db.getAllAsync<Pick<TransactionLifecycleRow,
    'lifecycle_id' | 'wallet_id' | 'purpose' | 'state' | 'txid' | 'broadcast_invocations' | 'next_broadcast_attempt_at'>>(
    `SELECT lifecycle_id, wallet_id, purpose, state, txid, broadcast_invocations, next_broadcast_attempt_at
     FROM wallet_transaction_lifecycle WHERE wallet_id = ? AND state != 'reserved'
     ORDER BY created_at DESC, lifecycle_id DESC`,
    walletId,
  );
  const window = await db.getFirstAsync<{ lifecycle_id: string; window_open: number }>(
    'SELECT lifecycle_id, window_open FROM wallet_transaction_tracking WHERE wallet_id = ?',
    walletId,
  );
  if (window && (
    typeof window.lifecycle_id !== 'string'
    || (window.window_open !== 0 && window.window_open !== 1)
  )) throw new Error('Invalid transaction tracking window.');
  const replacements = await readTransactionReplacements(db, walletId);
  return {
    records: rows.map((row): TrackedTransaction => {
      if (
        typeof row.lifecycle_id !== 'string' || !row.lifecycle_id
        || row.wallet_id !== walletId
        || (row.purpose !== 'send' && row.purpose !== 'consolidation')
        || !['signed', 'broadcast-uncertain', 'published', 'confirmed', 'conflicted'].includes(row.state)
        || typeof row.txid !== 'string' || !/^[a-f0-9]{64}$/i.test(row.txid)
        || !Number.isSafeInteger(row.broadcast_invocations) || row.broadcast_invocations < 0
        || (row.next_broadcast_attempt_at !== null && (
          !Number.isSafeInteger(row.next_broadcast_attempt_at) || row.next_broadcast_attempt_at < 0
        ))
      ) throw new Error('Invalid public transaction tracking data.');
      return {
        lifecycleId: row.lifecycle_id, walletId: row.wallet_id, purpose: row.purpose,
        state: row.state as TrackedTransaction['state'], txid: row.txid,
        broadcastInvocations: row.broadcast_invocations,
        nextBroadcastAttemptAt: row.next_broadcast_attempt_at,
        replacement: replacements.get(row.lifecycle_id),
      };
    }),
    window: window ? { lifecycleId: window.lifecycle_id, open: window.window_open === 1 } : null,
  };
});

export const reconcileTransactionLifecycles = async (
  walletId: string,
  history: readonly ElectrumHistoryEntry[],
): Promise<void> => runWalletStorageOperation('transaction lifecycle reconciliation', async () => {
  const db = await openHistoryDb();
  await runWriteTransaction(db, async () => {
    const rows = await db.getAllAsync<TransactionLifecycleRow>(
      `SELECT lifecycle_id, wallet_id, account_key, branch, purpose, address_index, derivation_path, address, state, txid, raw_tx_hex,
              recovery_attempts, broadcast_invocations,
              next_broadcast_attempt_at, last_broadcast_attempt_at
       FROM wallet_transaction_lifecycle
       WHERE wallet_id = ? AND state != 'reserved'`,
      walletId,
    );
    const now = new Date().toISOString();
    const replacements = await readTransactionReplacements(db, walletId);
    const records = rows.map((row) => ({ ...validateTransactionLifecycleRow(row), replacement: replacements.get(row.lifecycle_id) }));
    for (const current of records) {
      const winner = confirmedTransactionFamilyMember(current, records, history);
      const next = winner
        ? winner.lifecycleId === current.lifecycleId ? 'confirmed' : 'conflicted'
        : reconciledLifecycleState(current.state, current.txid, history);
      if (next === current.state) continue;
      assertLifecycleTransition(current.state, next);
      await db.runAsync(
        `UPDATE wallet_transaction_lifecycle
         SET state = ?, updated_at = ?
         WHERE lifecycle_id = ? AND wallet_id = ?`,
        next,
        now,
        current.lifecycleId,
        walletId,
      );
    }
  });
});

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
    if (!Number.isSafeInteger(row.height) || row.height < 0) {
      throw new Error('Invalid wallet snapshot cache height.');
    }

    return {
      snapshot: parseWalletSnapshotCache(row.snapshot_json),
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
  historyMode: WalletHistoryPublicationMode = 'partial',
): Promise<void> => runWalletStorageOperation('wallet history cache write', async () => {
  const db = await openHistoryDb();
  const now = new Date().toISOString();
  const normalized = normalizeWalletHistory(history);

  await runWriteTransaction(db, async () => {
    for (let offset = 0; offset < normalized.length; offset += CACHE_INSERT_BATCH_SIZE) {
      const batch = normalized.slice(offset, offset + CACHE_INSERT_BATCH_SIZE);
      const values = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const bindings: SQLite.SQLiteBindValue[] = [];
      for (const entry of batch) {
        bindings.push(
          walletId,
          entry.txid,
          entry.height,
          entry.address,
          now,
        );
      }
      await db.runAsync(
        `INSERT INTO wallet_transactions
           (wallet_id, txid, height, address, first_seen_at)
         VALUES ${values}
         ON CONFLICT(wallet_id, txid) DO UPDATE SET
           amount_sats = CASE
             WHEN wallet_transactions.height = excluded.height THEN wallet_transactions.amount_sats
             ELSE NULL
           END,
           direction = CASE
             WHEN wallet_transactions.height = excluded.height THEN wallet_transactions.direction
             ELSE NULL
           END,
           fee_sats = CASE
             WHEN wallet_transactions.height = excluded.height THEN wallet_transactions.fee_sats
             ELSE NULL
           END,
           counterparty = CASE
             WHEN wallet_transactions.height = excluded.height THEN wallet_transactions.counterparty
             ELSE NULL
           END,
           block_time = CASE
             WHEN wallet_transactions.height = excluded.height THEN wallet_transactions.block_time
             ELSE NULL
           END,
           enriched_at = CASE
             WHEN wallet_transactions.height = excluded.height THEN wallet_transactions.enriched_at
             ELSE NULL
           END,
           height = excluded.height,
           address = excluded.address`,
        bindings,
      );
    }

    if (historyMode === 'authoritative') {
      const currentTxids = new Set(normalized.map((entry) => entry.txid));
      const storedHistory = await db.getAllAsync<HistoryIdentityRow>(
        'SELECT txid FROM wallet_transactions WHERE wallet_id = ?',
        walletId,
      );
      const staleTxids = storedHistory
        .map((row) => row.txid)
        .filter((txid) => !currentTxids.has(txid));
      for (
        let offset = 0;
        offset < staleTxids.length;
        offset += SQLITE_TXID_QUERY_CHUNK_SIZE
      ) {
        const chunk = staleTxids.slice(offset, offset + SQLITE_TXID_QUERY_CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(', ');
        await db.runAsync(
          `DELETE FROM wallet_transactions
           WHERE wallet_id = ? AND txid IN (${placeholders})`,
          walletId,
          ...chunk,
        );
      }
    }

    const watermarkUpdate = historyMode === 'authoritative'
      ? 'excluded.full_history_height'
      : 'MAX(wallet_sync_state.full_history_height, excluded.full_history_height)';
    await db.runAsync(
      `INSERT INTO wallet_sync_state (wallet_id, full_history_height, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(wallet_id) DO UPDATE SET
         full_history_height = ${watermarkUpdate},
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
    if (records.length > 0) {
      const statement = await db.prepareAsync(
        `UPDATE wallet_transactions
         SET amount_sats = ?, direction = ?, fee_sats = ?, counterparty = ?, block_time = ?, enriched_at = ?
         WHERE wallet_id = ? AND txid = ? AND height = ?`,
      );
      try {
        for (const record of records) {
          await statement.executeAsync(
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
      } finally {
        await statement.finalizeAsync();
      }
    }

    for (let offset = 0; offset < outputs.length; offset += CACHE_INSERT_BATCH_SIZE) {
      const batch = outputs.slice(offset, offset + CACHE_INSERT_BATCH_SIZE);
      const values = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const bindings: SQLite.SQLiteBindValue[] = [];
      for (const output of batch) {
        if (
          !output.txid
          || !Number.isInteger(output.outputIndex)
          || output.outputIndex < 0
          || !Number.isSafeInteger(output.valueSats)
          || output.valueSats < 0
        ) {
          throw new Error('Invalid transaction output cache write.');
        }
        bindings.push(
          walletId,
          output.txid,
          output.outputIndex,
          output.valueSats,
          output.address,
        );
      }
      await db.runAsync(
        `INSERT INTO wallet_transaction_outputs
           (wallet_id, txid, output_index, value_sats, address)
         VALUES ${values}
         ON CONFLICT(wallet_id, txid, output_index, address) DO UPDATE SET
           value_sats = excluded.value_sats`,
        bindings,
      );
    }
  });
});

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

export const clearWalletPublicData = async (walletId: string): Promise<void> => (
  runWalletStorageOperation('wallet public data clear', async () => {
    const db = await openHistoryDb();
    await runWriteTransaction(db, async () => {
      await db.runAsync('DELETE FROM wallet_transaction_outputs WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_transactions WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_sync_state WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_snapshot_cache WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_hd_sequences WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_transaction_lifecycle WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_transaction_tracking WHERE wallet_id = ?', walletId);
      await db.runAsync('DELETE FROM wallet_transaction_replacements WHERE wallet_id = ?', walletId);
    });
  })
);
