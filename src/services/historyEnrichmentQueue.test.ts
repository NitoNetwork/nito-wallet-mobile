import { describe, expect, it } from 'vitest';

import type { ElectrumHistoryEntry } from '../network/electrum';
import {
  HISTORY_PAGE_SIZE,
  HistoryEnrichmentQueue,
  processHistoryEnrichmentQueue,
} from './historyEnrichmentQueue';

const history = Array.from({ length: 48 }, (_, index): ElectrumHistoryEntry => ({
  txid: `tx-${index}`,
  height: 10_000 - index,
  address: 'wallet-address',
}));

describe('HistoryEnrichmentQueue', () => {
  it('serves the visible page first and reprioritizes a page opened during enrichment', () => {
    const queue = new HistoryEnrichmentQueue(history, {
      initialPage: 2,
      pageSize: HISTORY_PAGE_SIZE,
    });

    expect(queue.takeNext().map((entry) => entry.txid)).toEqual(
      history.slice(24, 36).map((entry) => entry.txid),
    );

    queue.prioritizePage(1);
    expect(queue.takeNext().map((entry) => entry.txid)).toEqual(
      history.slice(12, 24).map((entry) => entry.txid),
    );

    const remaining = [...queue.drain()].flat();
    expect(remaining.map((entry) => entry.txid)).toEqual([
      ...history.slice(0, 12),
      ...history.slice(36, 48),
    ].map((entry) => entry.txid));
    expect(new Set(remaining.map((entry) => entry.txid)).size).toBe(24);
  });

  it('excludes already attempted or enriched entries without duplicating work', () => {
    const attempted = new Set(['tx-1:9999']);
    const mixed = history.slice(0, 14).map((entry, index) => (
      index === 2 ? { ...entry, direction: 'received' as const, amountSats: 1, feeSats: 0 } : entry
    ));
    const queue = new HistoryEnrichmentQueue(mixed, {
      attempted,
      initialPage: 0,
      pageSize: HISTORY_PAGE_SIZE,
    });

    const entries = [...queue.drain()].flat();
    expect(entries.map((entry) => entry.txid)).not.toContain('tx-1');
    expect(entries.map((entry) => entry.txid)).not.toContain('tx-2');
    expect(entries).toHaveLength(12);
    expect(queue.remainingCount).toBe(0);
  });

  it('publishes every chunk and applies a page change before the remaining queue', async () => {
    const queue = new HistoryEnrichmentQueue(history, { initialPage: 0 });
    const enrichedBatches: string[][] = [];
    const publishedBatches: string[][] = [];
    const progress: [number, number][] = [];

    await processHistoryEnrichmentQueue({
      queue,
      enrichBatch: async (batch) => {
        enrichedBatches.push(batch.map((entry) => entry.txid));
        if (enrichedBatches.length === 1) {
          queue.prioritizePage(3);
        }
        return batch.map((entry) => entry.txid);
      },
      publishBatch: async (txids) => {
        publishedBatches.push(txids);
      },
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(enrichedBatches).toEqual([
      history.slice(0, 12).map((entry) => entry.txid),
      history.slice(36, 48).map((entry) => entry.txid),
      history.slice(12, 24).map((entry) => entry.txid),
      history.slice(24, 36).map((entry) => entry.txid),
    ]);
    expect(publishedBatches).toEqual(enrichedBatches);
    expect(progress[0]).toEqual([0, 48]);
    expect(progress.at(-1)).toEqual([48, 48]);
  });

  it('keeps previously published chunks when a later chunk fails', async () => {
    const queue = new HistoryEnrichmentQueue(history.slice(0, 24));
    const publishedBatches: string[][] = [];
    let batchNumber = 0;

    await expect(processHistoryEnrichmentQueue({
      queue,
      enrichBatch: async (batch) => {
        batchNumber += 1;
        if (batchNumber === 2) throw new Error('Electrum read failed');
        return batch.map((entry) => entry.txid);
      },
      publishBatch: async (txids) => {
        publishedBatches.push(txids);
      },
    })).rejects.toThrow('Electrum read failed');

    expect(publishedBatches).toEqual([
      history.slice(0, 12).map((entry) => entry.txid),
    ]);
  });
});
