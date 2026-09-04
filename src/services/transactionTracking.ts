import type { ElectrumHistoryEntry } from '../network/electrum';
import type { WalletSessionToken } from './walletSession';
import { confirmedTransactionFamilyMember, TRANSACTION_BROADCAST_MAX_ATTEMPTS, type TransactionLifecycleRecord } from './transactionLifecycle';

// Public display data only. No raw transaction, key, amount or balance is owned here.
export type TrackedTransaction = Pick<TransactionLifecycleRecord,
  'lifecycleId' | 'walletId' | 'purpose' | 'state' | 'txid'
  | 'broadcastInvocations' | 'nextBroadcastAttemptAt' | 'replacement'>;
export type TransactionTrackingWindowState = {
  lifecycleId: string;
  open: boolean;
};
export type TransactionTrackingData = {
  records: TrackedTransaction[];
  window: TransactionTrackingWindowState | null;
};
export type TransactionTrackingStatus =
  | 'signed' | 'broadcasting' | 'scheduled' | 'accepted'
  | 'mempool' | 'confirmed' | 'unresolved';

export const publicTransactionTrackingRecord = (record: TransactionLifecycleRecord): TrackedTransaction => ({
  lifecycleId: record.lifecycleId,
  walletId: record.walletId,
  purpose: record.purpose,
  state: record.state,
  txid: record.txid,
  broadcastInvocations: record.broadcastInvocations,
  nextBroadcastAttemptAt: record.nextBroadcastAttemptAt,
  replacement: record.replacement,
});

export const transactionReplacementOutcome = (
  record: TrackedTransaction, records: readonly TrackedTransaction[], history: readonly ElectrumHistoryEntry[],
): 'original-confirmed' | 'replacement-confirmed' | null => {
  const winner = confirmedTransactionFamilyMember(record, records, history);
  if (!winner || winner.lifecycleId === record.lifecycleId) return null;
  const seen = new Set<string>();
  let parent = record.replacement?.originalLifecycleId;
  while (parent && !seen.has(parent)) {
    if (parent === winner.lifecycleId) return 'original-confirmed';
    seen.add(parent);
    parent = records.find((candidate) => candidate.lifecycleId === parent)?.replacement?.originalLifecycleId;
  }
  return 'replacement-confirmed';
};

export const transactionTrackingStatus = (
  record: TrackedTransaction,
  history: readonly ElectrumHistoryEntry[],
  inFlight: boolean,
): TransactionTrackingStatus => {
  const entry = history.find(({ txid }) => txid === record.txid);
  if (entry && entry.height > 0) return 'confirmed';
  // An optimistic local history row is not proof of a mempool observation.
  if (entry?.networkObserved === true) return 'mempool';
  if (inFlight) return 'broadcasting';
  if (record.state === 'published') return 'accepted';
  // A persisted confirmation cannot overrule a missing/reorganized network snapshot.
  if (record.state === 'confirmed' || record.state === 'conflicted') return 'unresolved';
  if (record.broadcastInvocations >= TRANSACTION_BROADCAST_MAX_ATTEMPTS) return 'unresolved';
  return record.state === 'signed' ? 'signed' : 'scheduled';
};

// Discrete observed milestones, not a timer or an estimated confirmation percentage.
export const transactionTrackingStage = (status: TransactionTrackingStatus): number => (
  status === 'confirmed' ? 4 : status === 'mempool' ? 3 : status === 'accepted' ? 2 : 1
);

type TrackingSnapshot = TransactionTrackingData & {
  walletId: string | null;
  inFlight: ReadonlySet<string>;
  storageError: boolean;
};

const emptyTrackingSnapshot = (): TrackingSnapshot => ({
  walletId: null, records: [], window: null, inFlight: new Set(), storageError: false,
});

/** One observable display owner. Every asynchronous result is session- and revision-guarded. */
export class TransactionTrackingController {
  private snapshot = emptyTrackingSnapshot();
  private revision = 0;
  private windowRevision = 0;
  private windowWrites: Promise<void> = Promise.resolve();
  private windowWriteFailed = false;
  private listeners = new Set<() => void>();

  constructor(private readonly ports: {
    isCurrent: (session: WalletSessionToken) => boolean;
    read: (walletId: string) => Promise<TransactionTrackingData>;
    writeWindow: (walletId: string, window: TransactionTrackingWindowState) => Promise<void>;
    reportError: (error: unknown) => void;
  }) {}

  getSnapshot = (): TrackingSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(snapshot: TrackingSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  reset(): void {
    this.revision += 1;
    this.windowRevision += 1;
    this.windowWriteFailed = false;
    // Accepted public display choices still persist across a lock. A new session
    // waits for them before restoring, but their callbacks cannot publish into it.
    this.publish(emptyTrackingSnapshot());
  }

  async restore(session: WalletSessionToken): Promise<void> {
    if (!this.ports.isCurrent(session)) return;
    this.reset();
    this.publish({ ...emptyTrackingSnapshot(), walletId: session.walletId });
    await this.refresh(session);
  }

  async refresh(session: WalletSessionToken): Promise<void> {
    if (!this.ports.isCurrent(session)) return;
    const revision = ++this.revision;
    try {
      // SQLite reads may run during writes. Wait for the user's preceding choices
      // to commit before reading their selection or visibility back from storage.
      await this.windowWrites;
      if (!this.ports.isCurrent(session) || revision !== this.revision) return;
      const data = await this.ports.read(session.walletId);
      if (!this.ports.isCurrent(session) || revision !== this.revision) return;
      const records = data.records.filter((record) => (
        record.walletId === session.walletId && record.state !== 'reserved' && record.txid
      ));
      // Upgrade from lot 3: restore ongoing transactions even without a saved window yet.
      const fallback = records.find(({ state }) => state !== 'confirmed') ?? records[0];
      const selected = records.find(({ lifecycleId }) => lifecycleId === data.window?.lifecycleId);
      const window = selected ? data.window : fallback ? {
        lifecycleId: fallback.lifecycleId,
        open: data.window?.open ?? fallback.state !== 'confirmed',
      } : null;
      this.publish({
        ...this.snapshot, walletId: session.walletId, records,
        // A failed save is not permission to undo the visible user action.
        window: this.windowWriteFailed ? this.snapshot.window : window,
        storageError: this.windowWriteFailed,
      });
    } catch (error) {
      if (!this.ports.isCurrent(session) || revision !== this.revision) return;
      this.ports.reportError(error);
      this.publish({ ...this.snapshot, storageError: true });
    }
  }

  update(session: WalletSessionToken, record: TransactionLifecycleRecord, active: boolean): void {
    if (!this.ports.isCurrent(session) || record.walletId !== session.walletId) return;
    this.revision += 1;
    const publicRecord = publicTransactionTrackingRecord(record);
    const records = this.snapshot.records.some(({ lifecycleId }) => lifecycleId === record.lifecycleId)
      ? this.snapshot.records.map((current) => current.lifecycleId === record.lifecycleId ? publicRecord : current)
      : [publicRecord, ...this.snapshot.records];
    const inFlight = new Set(this.snapshot.inFlight);
    if (active) inFlight.add(record.lifecycleId);
    else inFlight.delete(record.lifecycleId);
    this.publish({ ...this.snapshot, walletId: session.walletId, records, inFlight });
  }

  async setWindow(session: WalletSessionToken, window: TransactionTrackingWindowState): Promise<void> {
    if (!this.ports.isCurrent(session)) return;
    this.revision += 1;
    const windowRevision = ++this.windowRevision;
    // Update the one window immediately, but report a failed persistence explicitly.
    this.publish({ ...this.snapshot, window });
    this.windowWrites = this.windowWrites.then(async () => {
      try {
        await this.ports.writeWindow(session.walletId, window);
        if (!this.ports.isCurrent(session) || windowRevision !== this.windowRevision) return;
        this.windowWriteFailed = false;
        this.publish({ ...this.snapshot, storageError: false });
      } catch (error) {
        if (!this.ports.isCurrent(session)) return;
        this.ports.reportError(error);
        if (windowRevision !== this.windowRevision) return;
        this.windowWriteFailed = true;
        this.publish({ ...this.snapshot, storageError: true });
      }
    });
    await this.windowWrites;
  }
}
