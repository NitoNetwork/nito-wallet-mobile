import { afterEach, describe, expect, it, vi } from 'vitest';

import { ElectrumRpcError, type ElectrumHistoryEntry } from '../network/electrum';
import {
  HISTORY_PAGE_SIZE,
  HistoryEnrichmentQueue,
  HistoryEnrichmentRetryScheduler,
  isRetryableHistoryEnrichmentFailure,
  processHistoryEnrichmentQueue,
  processHistoryEnrichmentPasses,
  pruneHistoryEnrichmentFailures,
  recordHistoryEnrichmentBatchOutcome,
  releaseFailedHistoryEnrichmentAttempts,
} from './historyEnrichmentQueue';
import { needsHistoryEnrichment } from './walletHistory';

const history = Array.from({ length: 48 }, (_, index): ElectrumHistoryEntry => ({
  txid: `tx-${index}`,
  height: 10_000 - index,
  address: 'wallet-address',
}));

afterEach(() => {
  vi.useRealTimers();
});

describe('HistoryEnrichmentQueue', () => {
  it('uses one lifecycle predicate for raw, provisional, and final entries', () => {
    expect(needsHistoryEnrichment(history[0]!)).toBe(true);
    expect(needsHistoryEnrichment({
      ...history[0]!,
      direction: 'received',
      provisional: true,
    })).toBe(true);
    expect(needsHistoryEnrichment({
      ...history[0]!,
      direction: 'received',
      blockTime: 1_700_000_000,
    })).toBe(false);
  });

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
      index === 2
        ? {
            ...entry,
            direction: 'received' as const,
            amountSats: 1,
            feeSats: 0,
            blockTime: 1_700_000_000,
          }
        : entry
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

  it('never mixes pending and confirmed entries in one failure domain', () => {
    const pending = [
      { ...history[0]!, txid: 'pending-sent', height: 0 },
      { ...history[1]!, txid: 'pending-received', height: -1 },
    ];
    const queue = new HistoryEnrichmentQueue([
      ...pending,
      ...history.slice(2, 14),
    ]);

    expect(queue.takeNext()).toEqual(pending);
    expect(queue.takeNext()).toEqual(history.slice(2, 14));
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

  it('automatically enriches an entry added while an earlier pass is in flight', async () => {
    const evolvingHistory = [history[0]!];
    const attempted = new Set<string>();
    const enriched: string[] = [];
    let passCount = 0;

    await processHistoryEnrichmentPasses({
      createPass: () => {
        const queue = new HistoryEnrichmentQueue(evolvingHistory, {
          attempted,
          pageSize: 1,
        });
        return queue.remainingCount > 0 ? { queue } : null;
      },
      processPass: async ({ queue }) => {
        passCount += 1;
        await processHistoryEnrichmentQueue({
          queue,
          enrichBatch: async (batch) => batch,
          publishBatch: async (batch) => {
            enriched.push(...batch.map((entry) => entry.txid));
            recordHistoryEnrichmentBatchOutcome(
              attempted,
              new Map(),
              batch.map((entry) => `${entry.txid}:${entry.height}`),
              'published',
            );
          },
        });
        if (passCount === 1) {
          evolvingHistory.push(history[1]!);
        }
      },
    });

    expect(enriched).toEqual(['tx-0', 'tx-1']);
    expect(passCount).toBe(2);
  });

  it('releases interrupted session keys while retaining genuine failed attempts', () => {
    const interrupted = new Set(['tx-0:10000']);
    const interruptedFailures = new Map([
      ['tx-0:10000', { attempts: 1, retryAt: null }],
    ]);
    recordHistoryEnrichmentBatchOutcome(
      interrupted,
      interruptedFailures,
      ['tx-0:10000'],
      'interrupted',
    );
    expect(interrupted).not.toContain('tx-0:10000');
    expect(interruptedFailures.has('tx-0:10000')).toBe(false);

    const failed = new Set<string>();
    const failedKeys = new Map();
    recordHistoryEnrichmentBatchOutcome(failed, failedKeys, ['tx-1:9999'], 'failed');
    expect(failed).toContain('tx-1:9999');
    expect(failedKeys.has('tx-1:9999')).toBe(true);
    expect(new HistoryEnrichmentQueue([history[1]!], {
      attempted: failed,
    }).remainingCount).toBe(0);
  });

  it('releases only failed entries after a successful Electrum reconnection', () => {
    const attempted = new Set<string>();
    const failed = new Map();

    recordHistoryEnrichmentBatchOutcome(attempted, failed, ['tx-failed:100'], 'failed');
    recordHistoryEnrichmentBatchOutcome(attempted, failed, ['tx-published:99'], 'published');

    expect(releaseFailedHistoryEnrichmentAttempts(attempted, failed)).toBe(1);
    expect(attempted).not.toContain('tx-failed:100');
    expect(attempted).toContain('tx-published:99');
    expect(failed).toEqual(new Map());
  });

  it('retries a permanent failure once per reconnection without looping', () => {
    const attempted = new Set<string>();
    const failed = new Map();
    const key = 'tx-permanent:98';
    let retryCount = 0;

    recordHistoryEnrichmentBatchOutcome(attempted, failed, [key], 'failed');

    for (let reconnection = 0; reconnection < 2; reconnection += 1) {
      const released = releaseFailedHistoryEnrichmentAttempts(attempted, failed);
      expect(released).toBe(1);
      if (released > 0) {
        retryCount += 1;
        recordHistoryEnrichmentBatchOutcome(attempted, failed, [key], 'failed');
      }
      expect(attempted).toContain(key);
      expect(failed.has(key)).toBe(true);
    }

    expect(retryCount).toBe(2);
    expect(attempted).toContain(key);
    expect(failed.has(key)).toBe(true);
  });

  it('retries a freshly broadcast pending entry after backoff without restarting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const attempted = new Set<string>();
    const failed = new Map();
    const scheduler = new HistoryEnrichmentRetryScheduler();
    const pendingEntry = { ...history[0]!, txid: 'fresh-broadcast', height: 0 };
    const key = 'fresh-broadcast:0';
    const enriched: string[] = [];

    recordHistoryEnrichmentBatchOutcome(
      attempted,
      failed,
      [key],
      'retryable-failure',
    );
    scheduler.schedule(attempted, failed, () => {
      const retryQueue = new HistoryEnrichmentQueue([pendingEntry], { attempted });
      const retry = retryQueue.takeNext();
      enriched.push(...retry.map((entry) => entry.txid));
      recordHistoryEnrichmentBatchOutcome(
        attempted,
        failed,
        retry.map((entry) => `${entry.txid}:${entry.height}`),
        'published',
      );
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(enriched).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(enriched).toEqual(['fresh-broadcast']);
    expect(attempted).toContain(key);
    expect(failed).toEqual(new Map());
    scheduler.cancel();
  });

  it('uses growing delays only for transaction-not-found failures in mempool batches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const attempted = new Set<string>();
    const failed = new Map();
    const scheduler = new HistoryEnrichmentRetryScheduler();
    const pending = [{ ...history[0]!, height: 0 }];
    const missing = new ElectrumRpcError('unknown transaction');
    const retries: number[] = [];

    expect(isRetryableHistoryEnrichmentFailure(missing, pending)).toBe(true);
    expect(isRetryableHistoryEnrichmentFailure(new Error('invalid response'), pending)).toBe(false);
    expect(isRetryableHistoryEnrichmentFailure(missing, [history[0]!])).toBe(false);

    const key = `${pending[0]!.txid}:0`;
    recordHistoryEnrichmentBatchOutcome(attempted, failed, [key], 'retryable-failure');
    scheduler.schedule(attempted, failed, () => {
      retries.push(Date.now());
      recordHistoryEnrichmentBatchOutcome(attempted, failed, [key], 'retryable-failure');
      scheduler.schedule(attempted, failed, () => retries.push(Date.now()));
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(retries).toEqual([1_000]);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(retries).toEqual([1_000]);
    await vi.advanceTimersByTimeAsync(1);
    expect(retries).toEqual([1_000, 4_000]);
    scheduler.cancel();

    const permanentAttempted = new Set<string>();
    const permanentFailures = new Map();
    recordHistoryEnrichmentBatchOutcome(
      permanentAttempted,
      permanentFailures,
      ['permanent:0'],
      'failed',
    );
    scheduler.schedule(permanentAttempted, permanentFailures, () => retries.push(Date.now()));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a failed mempool key block an incoming entry or its confirmed form', () => {
    const attempted = new Set<string>();
    const failed = new Map();
    const txid = 'session-transaction';
    recordHistoryEnrichmentBatchOutcome(
      attempted,
      failed,
      [`${txid}:0`],
      'retryable-failure',
    );

    const incoming = { ...history[0]!, txid: 'incoming-transaction', height: 0 };
    const confirmed = { ...history[0]!, txid, height: 10_001 };
    expect(new HistoryEnrichmentQueue([incoming, confirmed], { attempted }).takeNext())
      .toEqual([incoming]);
    expect(new HistoryEnrichmentQueue([confirmed], { attempted }).takeNext())
      .toEqual([confirmed]);

    pruneHistoryEnrichmentFailures(
      attempted,
      failed,
      new Set([`${incoming.txid}:0`, `${confirmed.txid}:${confirmed.height}`]),
    );
    expect(failed.has(`${txid}:0`)).toBe(false);
  });
});
