import type { ElectrumHistoryEntry } from '../network/electrum';

export const HISTORY_PAGE_SIZE = 12;

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
      if (entry.direction !== undefined || attempted.has(key) || seen.has(key)) {
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
