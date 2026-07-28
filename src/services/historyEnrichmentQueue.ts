import {
  isElectrumTransactionNotFoundError,
  type ElectrumHistoryEntry,
} from '../network/electrum';
import { needsHistoryEnrichment } from './walletHistory';

export const HISTORY_PAGE_SIZE = 12;
const HISTORY_ENRICHMENT_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000];

export const historyEnrichmentKey = (
  entry: Pick<ElectrumHistoryEntry, 'txid' | 'height'>,
) => `${entry.txid}:${entry.height}`;

type HistoryEnrichmentQueueOptions = {
  attempted?: ReadonlySet<string>;
  initialPage?: number;
  pageSize?: number;
};

type QueuedHistoryEntry = {
  entry: ElectrumHistoryEntry;
  index: number;
};

export class HistoryEnrichmentQueue {
  private readonly pageSize: number;
  private remaining: QueuedHistoryEntry[];
  private priorityPage: number | null;

  constructor(
    history: readonly ElectrumHistoryEntry[],
    {
      attempted = new Set<string>(),
      initialPage = 0,
      pageSize = HISTORY_PAGE_SIZE,
    }: HistoryEnrichmentQueueOptions = {},
  ) {
    this.pageSize = Math.max(1, Math.trunc(pageSize));
    this.priorityPage = Math.max(0, Math.trunc(initialPage));
    const seen = new Set<string>();
    this.remaining = history.flatMap((entry, index) => {
      const key = historyEnrichmentKey(entry);
      if (!needsHistoryEnrichment(entry) || attempted.has(key) || seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [{ entry, index }];
    });
  }

  get remainingCount(): number {
    return this.remaining.length;
  }

  prioritizePage(page: number): void {
    this.priorityPage = Math.max(0, Math.trunc(page));
  }

  takeNext(): ElectrumHistoryEntry[] {
    if (this.remaining.length === 0) return [];

    let selected: QueuedHistoryEntry[] = [];
    if (this.priorityPage !== null) {
      const start = this.priorityPage * this.pageSize;
      const end = start + this.pageSize;
      selected = this.remaining.filter(({ index }) => index >= start && index < end);
      this.priorityPage = null;
    }
    if (selected.length === 0) {
      selected = this.remaining.slice(0, this.pageSize);
    }
    const pending = selected[0]!.entry.height <= 0;
    selected = selected.filter(({ entry }) => (entry.height <= 0) === pending);

    const selectedKeys = new Set(selected.map(({ entry }) => historyEnrichmentKey(entry)));
    this.remaining = this.remaining.filter(
      ({ entry }) => !selectedKeys.has(historyEnrichmentKey(entry)),
    );
    return selected.map(({ entry }) => entry);
  }

  *drain(): Generator<ElectrumHistoryEntry[]> {
    while (this.remaining.length > 0) {
      yield this.takeNext();
    }
  }
}

export const processHistoryEnrichmentQueue = async <Result>({
  queue,
  enrichBatch,
  publishBatch,
  onBatchStart,
  onBatchPublished,
  onProgress,
}: {
  queue: HistoryEnrichmentQueue;
  enrichBatch: (
    batch: ElectrumHistoryEntry[],
    onBatchProgress: (done: number) => void,
  ) => Promise<Result>;
  publishBatch: (result: Result, batch: ElectrumHistoryEntry[]) => Promise<void>;
  onBatchStart?: (batch: ElectrumHistoryEntry[]) => void;
  onBatchPublished?: (batch: ElectrumHistoryEntry[]) => void;
  onProgress?: (done: number, total: number) => void;
}): Promise<void> => {
  const total = queue.remainingCount;
  let completed = 0;
  onProgress?.(completed, total);

  while (queue.remainingCount > 0) {
    const batch = queue.takeNext();
    if (batch.length === 0) break;
    onBatchStart?.(batch);
    const result = await enrichBatch(batch, (done) => {
      onProgress?.(Math.min(total, completed + Math.max(0, done)), total);
    });
    await publishBatch(result, batch);
    completed += batch.length;
    onBatchPublished?.(batch);
    onProgress?.(completed, total);
  }
};

export const processHistoryEnrichmentPasses = async <Pass>({
  createPass,
  processPass,
}: {
  createPass: () => Pass | null;
  processPass: (pass: Pass) => Promise<void>;
}): Promise<void> => {
  while (true) {
    const pass = createPass();
    if (!pass) return;
    await processPass(pass);
  }
};

export type HistoryEnrichmentFailure = {
  attempts: number;
  retryAt: number | null;
};

export type HistoryEnrichmentFailures = Map<string, HistoryEnrichmentFailure>;

export type HistoryEnrichmentBatchOutcome =
  | 'published'
  | 'failed'
  | 'retryable-failure'
  | 'interrupted';

const retryDelayMs = (attempts: number): number => (
  HISTORY_ENRICHMENT_RETRY_DELAYS_MS[
    Math.min(Math.max(0, attempts - 1), HISTORY_ENRICHMENT_RETRY_DELAYS_MS.length - 1)
  ]!
);

export const isRetryableHistoryEnrichmentFailure = (
  caught: unknown,
  batch: readonly Pick<ElectrumHistoryEntry, 'height'>[],
): boolean => (
  batch.length > 0
  && batch.every((entry) => entry.height <= 0)
  && isElectrumTransactionNotFoundError(caught)
);

export const recordHistoryEnrichmentBatchOutcome = (
  attempted: Set<string>,
  failed: HistoryEnrichmentFailures,
  keys: readonly string[],
  outcome: HistoryEnrichmentBatchOutcome,
  now = Date.now(),
): void => {
  if (outcome === 'interrupted') {
    keys.forEach((key) => {
      attempted.delete(key);
      failed.delete(key);
    });
    return;
  }
  keys.forEach((key) => {
    attempted.add(key);
    if (outcome === 'published') {
      failed.delete(key);
      return;
    }
    const attempts = (failed.get(key)?.attempts ?? 0) + 1;
    failed.set(key, {
      attempts,
      retryAt: outcome === 'retryable-failure'
        ? now + retryDelayMs(attempts)
        : null,
    });
  });
};

export const releaseFailedHistoryEnrichmentAttempts = (
  attempted: Set<string>,
  failed: HistoryEnrichmentFailures,
): number => {
  const released = failed.size;
  failed.forEach((_, key) => attempted.delete(key));
  failed.clear();
  return released;
};

const releaseDueHistoryEnrichmentAttempts = (
  attempted: Set<string>,
  failed: HistoryEnrichmentFailures,
  now: number,
): number => {
  let released = 0;
  failed.forEach((failure, key) => {
    if (failure.retryAt === null || failure.retryAt > now) return;
    attempted.delete(key);
    failed.set(key, { ...failure, retryAt: null });
    released += 1;
  });
  return released;
};

export const pruneHistoryEnrichmentFailures = (
  attempted: Set<string>,
  failed: HistoryEnrichmentFailures,
  pendingKeys: ReadonlySet<string>,
): void => {
  failed.forEach((_, key) => {
    if (pendingKeys.has(key)) return;
    attempted.delete(key);
    failed.delete(key);
  });
};

type RetryTimer = ReturnType<typeof setTimeout>;

export class HistoryEnrichmentRetryScheduler {
  private timer: RetryTimer | null = null;

  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(
    attempted: Set<string>,
    failed: HistoryEnrichmentFailures,
    onRetry: () => void,
    canRetry: () => boolean = () => true,
  ): void {
    this.cancel();
    const retryTimes = [...failed.values()].flatMap(
      ({ retryAt }) => retryAt === null ? [] : [retryAt],
    );
    if (retryTimes.length === 0) return;
    const delayMs = Math.max(0, Math.min(...retryTimes) - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!canRetry()) return;
      const released = releaseDueHistoryEnrichmentAttempts(
        attempted,
        failed,
        Date.now(),
      );
      if (released > 0) onRetry();
      this.schedule(attempted, failed, onRetry, canRetry);
    }, delayMs);
  }
}
