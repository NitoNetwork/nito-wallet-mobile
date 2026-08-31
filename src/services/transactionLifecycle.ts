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
