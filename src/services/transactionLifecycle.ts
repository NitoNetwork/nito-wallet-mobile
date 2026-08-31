import type { ElectrumHistoryEntry } from '../network/electrum';

export type TransactionLifecycleState =
  | 'reserved'
  | 'signed'
  | 'broadcast-uncertain'
  | 'published'
  | 'confirmed';

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
  if (!txid || current === 'reserved' || current === 'signed' || current === 'confirmed') {
    return current;
  }
  const entry = history.find((candidate) => candidate.txid === txid);
  if (!entry) return current;
  return entry.height > 0 ? 'confirmed' : 'published';
};
