import type { ElectrumHistoryEntry } from '../network/electrum';

export type TransactionLifecycleState =
  | 'reserved'
  | 'signed'
  | 'broadcast-uncertain'
  | 'published'
  | 'confirmed'
  | 'conflicted';

export type TransactionReplacement = {
  originalLifecycleId: string;
  originalTxid: string;
  mode: 'accelerate' | 'cancel';
};

export type TransactionLifecyclePurpose = 'send' | 'consolidation';

export type TransactionLifecycleRecord = {
  lifecycleId: string;
  walletId: string;
  purpose: TransactionLifecyclePurpose;
  addressIndex: number | null;
  derivationPath: string | null;
  address: string | null;
  state: TransactionLifecycleState;
  txid: string | null;
  rawTxHex: string | null;
  recoveryAttempts: number;
  broadcastInvocations: number;
  nextBroadcastAttemptAt: number | null;
  lastBroadcastAttemptAt: number | null;
  replacement?: TransactionReplacement;
};

export const TRANSACTION_BROADCAST_MAX_ATTEMPTS = 5;
export const TRANSACTION_BROADCAST_RETRY_DELAYS_MS = [
  15_000,
  60_000,
  300_000,
  900_000,
] as const;

export const nextTransactionBroadcastAttemptAt = (
  completedRecoveryAttempts: number,
  now: number,
): number => {
  const delay = TRANSACTION_BROADCAST_RETRY_DELAYS_MS[Math.min(
    completedRecoveryAttempts - 1,
    TRANSACTION_BROADCAST_RETRY_DELAYS_MS.length - 1,
  )];
  if (delay === undefined) {
    throw new Error('Invalid transaction recovery attempt count.');
  }
  return now + delay;
};

const STATE_ORDER: Record<TransactionLifecycleState, number> = {
  reserved: 0,
  signed: 1,
  'broadcast-uncertain': 2,
  published: 3,
  confirmed: 4,
  conflicted: 4,
};

export const assertLifecycleTransition = (
  current: TransactionLifecycleState,
  next: TransactionLifecycleState,
): void => {
  if (STATE_ORDER[next] < STATE_ORDER[current]) {
    throw new Error(`Invalid transaction lifecycle transition from ${current} to ${next}.`);
  }
};

export const reconciledLifecycleState = (
  current: TransactionLifecycleState,
  txid: string | null,
  history: readonly ElectrumHistoryEntry[],
): TransactionLifecycleState => {
  if (!txid || current === 'reserved' || current === 'signed' || current === 'confirmed' || current === 'conflicted') {
    return current;
  }
  const entry = history.find((candidate) => candidate.txid === txid);
  if (!entry) return current;
  return entry.height > 0 ? 'confirmed' : 'published';
};

export const transactionFamilyIds = (
  records: readonly Pick<TransactionLifecycleRecord, 'lifecycleId' | 'replacement'>[], lifecycleId: string,
): Set<string> => {
  const family = new Set([lifecycleId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      const parent = record.replacement?.originalLifecycleId;
      if (!parent || (!family.has(parent) && !family.has(record.lifecycleId))) continue;
      if (!family.has(parent) || !family.has(record.lifecycleId)) changed = true;
      family.add(parent);
      family.add(record.lifecycleId);
    }
  }
  return family;
};

export const hasSignedReplacement = (
  record: Pick<TransactionLifecycleRecord, 'lifecycleId'>,
  records: readonly Pick<TransactionLifecycleRecord, 'state' | 'replacement'>[],
): boolean => records.some((candidate) => candidate.state !== 'reserved'
  && candidate.replacement?.originalLifecycleId === record.lifecycleId);

export const confirmedTransactionFamilyMember = <T extends Pick<TransactionLifecycleRecord, 'lifecycleId' | 'replacement' | 'txid'>>(
  record: T, records: readonly T[], history: readonly ElectrumHistoryEntry[],
): T | undefined => {
  const family = transactionFamilyIds(records, record.lifecycleId);
  const confirmed = new Set(history.filter((entry) => entry.height > 0).map((entry) => entry.txid));
  return records.find((candidate) => family.has(candidate.lifecycleId) && candidate.txid && confirmed.has(candidate.txid));
};
