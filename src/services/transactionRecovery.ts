import type { TransactionLifecycleRecord } from './transactionLifecycle';
import { reportNonFinancialFailure } from './diagnostics';
import {
  nextTransactionBroadcastAttemptAt,
  TRANSACTION_BROADCAST_MAX_ATTEMPTS,
} from './transactionLifecycle';

export type TransactionBroadcastRecoveryFailure = {
  lifecycleId: string;
  error: unknown;
};

export type TransactionBroadcastRecoveryResult = {
  publishedTxids: string[];
  failures: TransactionBroadcastRecoveryFailure[];
  nextAttemptAt: number | null;
};

type TransactionBroadcastRecoveryPorts = {
  now: number;
  records: readonly TransactionLifecycleRecord[];
  claimAttempt: (
    record: TransactionLifecycleRecord,
    now: number,
  ) => Promise<TransactionLifecycleRecord | null>;
  recordBroadcastInvocation: (
    record: TransactionLifecycleRecord,
    now: number,
  ) => Promise<TransactionLifecycleRecord | null>;
  lookupTransaction: (txid: string) => Promise<void>;
  isTransactionNotFound: (error: unknown) => boolean;
  broadcastTransaction: (rawTxHex: string, expectedTxid: string) => Promise<string>;
  markPublished: (record: TransactionLifecycleRecord) => Promise<void>;
  onRecordChanged?: (record: TransactionLifecycleRecord, active: boolean) => void;
};

const notifyTracking = (
  ports: TransactionBroadcastRecoveryPorts,
  record: TransactionLifecycleRecord,
  active: boolean,
): void => {
  try {
    ports.onRecordChanged?.(record, active);
  } catch (error) {
    // Display observers must never interrupt persistence or network publication.
    reportNonFinancialFailure('transaction tracking observer', error);
  }
};

const earliestTimestamp = (
  current: number | null,
  candidate: number | null,
): number | null => {
  if (candidate === null) return current;
  return current === null ? candidate : Math.min(current, candidate);
};

const lookupAfterBroadcastFailure = async (
  record: TransactionLifecycleRecord,
  ports: TransactionBroadcastRecoveryPorts,
): Promise<boolean> => {
  if (!record.txid) return false;
  try {
    await ports.lookupTransaction(record.txid);
    return true;
  } catch (caught) {
    if (!ports.isTransactionNotFound(caught)) throw caught;
    return false;
  }
};

export const recoverPersistedTransactionBroadcasts = async (
  ports: TransactionBroadcastRecoveryPorts,
): Promise<TransactionBroadcastRecoveryResult> => {
  const publishedTxids: string[] = [];
  const failures: TransactionBroadcastRecoveryFailure[] = [];
  let nextAttemptAt: number | null = null;
  let consolidationBlocked = false;

  for (const record of ports.records) {
    if (record.purpose === 'consolidation' && consolidationBlocked) continue;
    if (
      (record.state !== 'signed' && record.state !== 'broadcast-uncertain')
      || !record.txid
      || !record.rawTxHex
      || record.broadcastInvocations >= TRANSACTION_BROADCAST_MAX_ATTEMPTS
    ) {
      if (
        record.purpose === 'consolidation'
        && (record.state === 'signed' || record.state === 'broadcast-uncertain')
      ) {
        consolidationBlocked = true;
      }
      continue;
    }
    if (
      record.state === 'broadcast-uncertain'
      && record.nextBroadcastAttemptAt !== null
      && record.nextBroadcastAttemptAt > ports.now
    ) {
      nextAttemptAt = earliestTimestamp(nextAttemptAt, record.nextBroadcastAttemptAt);
      if (record.purpose === 'consolidation') consolidationBlocked = true;
      continue;
    }

    let claimed: TransactionLifecycleRecord | null = null;
    try {
      claimed = await ports.claimAttempt(record, ports.now);
      if (!claimed || !claimed.txid || !claimed.rawTxHex) {
        nextAttemptAt = earliestTimestamp(
          nextAttemptAt,
          record.nextBroadcastAttemptAt
            ?? nextTransactionBroadcastAttemptAt(record.recoveryAttempts + 1, ports.now),
        );
        if (record.purpose === 'consolidation') consolidationBlocked = true;
        continue;
      }

      let found = false;
      notifyTracking(ports, claimed, true);
      try {
        await ports.lookupTransaction(claimed.txid);
        found = true;
      } catch (caught) {
        if (!ports.isTransactionNotFound(caught)) throw caught;
      }

      if (!found) {
        try {
          const broadcastable = await ports.recordBroadcastInvocation(claimed, ports.now);
          if (!broadcastable || !broadcastable.txid || !broadcastable.rawTxHex) {
            nextAttemptAt = earliestTimestamp(nextAttemptAt, claimed.nextBroadcastAttemptAt);
            if (record.purpose === 'consolidation') consolidationBlocked = true;
            continue;
          }
          claimed = broadcastable;
          notifyTracking(ports, claimed, true);
          await ports.broadcastTransaction(broadcastable.rawTxHex, broadcastable.txid);
        } catch (caught) {
          try {
            if (await lookupAfterBroadcastFailure(claimed, ports)) {
              await ports.markPublished(claimed);
              publishedTxids.push(record.txid);
              claimed = { ...claimed, state: 'published' };
              continue;
            }
          } catch (reconciliationError) {
            failures.push({ lifecycleId: claimed.lifecycleId, error: caught });
            failures.push({ lifecycleId: claimed.lifecycleId, error: reconciliationError });
            nextAttemptAt = earliestTimestamp(nextAttemptAt, claimed.nextBroadcastAttemptAt);
            if (record.purpose === 'consolidation') consolidationBlocked = true;
            continue;
          }
          failures.push({ lifecycleId: claimed.lifecycleId, error: caught });
          nextAttemptAt = earliestTimestamp(nextAttemptAt, claimed.nextBroadcastAttemptAt);
          if (record.purpose === 'consolidation') consolidationBlocked = true;
          continue;
        }
      }

      await ports.markPublished(claimed);
      publishedTxids.push(record.txid);
      claimed = { ...claimed, state: 'published' };
    } catch (caught) {
      failures.push({ lifecycleId: record.lifecycleId, error: caught });
      nextAttemptAt = earliestTimestamp(
        nextAttemptAt,
        claimed?.nextBroadcastAttemptAt
          ?? record.nextBroadcastAttemptAt
          ?? nextTransactionBroadcastAttemptAt(record.recoveryAttempts + 1, ports.now),
      );
      if (record.purpose === 'consolidation') consolidationBlocked = true;
    } finally {
      if (claimed) notifyTracking(ports, claimed, false);
    }
  }

  return { publishedTxids, failures, nextAttemptAt };
};

export class TransactionBroadcastRetryScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  schedule(at: number | null, callback: () => void, now = Date.now()): void {
    this.cancel();
    if (at === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      callback();
    }, Math.max(0, at - now));
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export const processPersistentTransactionSequence = async <TItem, TSigned>({
  items,
  sign,
  persistSigned,
  broadcastPersisted,
  afterPublished,
}: {
  items: readonly TItem[];
  sign: (item: TItem, index: number) => Promise<TSigned>;
  persistSigned: (item: TItem, signed: TSigned, index: number) => Promise<void>;
  broadcastPersisted: (item: TItem, signed: TSigned, index: number) => Promise<void>;
  afterPublished: (item: TItem, signed: TSigned, index: number) => Promise<void>;
}): Promise<void> => {
  for (const [index, item] of items.entries()) {
    const signed = await sign(item, index);
    await persistSigned(item, signed, index);
    await broadcastPersisted(item, signed, index);
    await afterPublished(item, signed, index);
  }
};
