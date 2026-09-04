import { describe, expect, it } from 'vitest';

import type { ElectrumHistoryEntry, ElectrumVerboseTransaction } from '../network/electrum';
import {
  HistoryEnrichmentQueue,
  processHistoryEnrichmentQueue,
} from './historyEnrichmentQueue';
import {
  buildHistoryExportBatch,
  buildHistoryExportRecords,
  type CachedTransactionOutput,
  type HistoryExportRecord,
} from './historyExport';

const MEASUREMENT_SIZE = 1_450;
const MEASUREMENT_BLOCK_TIME = 1_700_000_000;

const createMeasurementFixture = () => {
  let requests = 0;
  const history: ElectrumHistoryEntry[] = Array.from(
    { length: MEASUREMENT_SIZE },
    (_, index) => ({
      txid: `tx-${index}`,
      height: MEASUREMENT_SIZE - index,
      address: 'wallet-address',
    }),
  );
  const reader = {
    async getVerboseTransaction(txid: string): Promise<ElectrumVerboseTransaction> {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (txid.startsWith('tx-')) {
        return {
          blocktime: MEASUREMENT_BLOCK_TIME - Number(txid.slice(3)) * 60,
          vin: [{ txid: `parent-${txid.slice(3)}`, vout: 0 }],
          vout: [{ n: 0, value: 0.99, scriptPubKey: { address: 'wallet-address' } }],
        };
      }
      return {
        vin: [{ coinbase: '00' }],
        vout: [{ n: 0, value: 1, scriptPubKey: { address: 'external-address' } }],
      };
    },
  };

  return { history, reader, requestCount: () => requests };
};

describe.runIf(process.env.NITO_MEASURE_HISTORY === '1')('history enrichment measurement', () => {
  it('records the one-shot reference cost before page-first enrichment', async () => {
    const fixture = createMeasurementFixture();
    const startedAt = performance.now();
    const records = await buildHistoryExportRecords({
      history: fixture.history,
      walletAddresses: ['wallet-address'],
      reader: fixture.reader,
    });
    const totalMs = Math.round(performance.now() - startedAt);

    console.info(JSON.stringify({
      mode: 'one-shot-reference',
      transactions: records.length,
      requests: fixture.requestCount(),
      firstVisibleRowsMs: totalMs,
      totalMs,
    }));
    expect(records).toHaveLength(MEASUREMENT_SIZE);
  }, 30_000);

  it('records the page-first cold and warm output-cache costs', async () => {
    const fixture = createMeasurementFixture();
    const queue = new HistoryEnrichmentQueue(fixture.history);
    const outputCache = new Map<string, CachedTransactionOutput>();
    const recordCache = new Map<string, HistoryExportRecord>();
    const loadCachedOutputs = async (txids: readonly string[]) => {
      const requested = new Set(txids);
      return [...outputCache.values()].filter(({ txid }) => requested.has(txid));
    };
    const persistOutputs = (outputs: readonly CachedTransactionOutput[]) => {
      outputs.forEach((output) => {
        outputCache.set(
          `${output.txid}:${output.outputIndex}:${output.address}`,
          output,
        );
      });
    };
    const startedAt = performance.now();
    let firstVisibleRowsMs = 0;
    let recordCount = 0;

    await processHistoryEnrichmentQueue({
      queue,
      enrichBatch: (batch) => buildHistoryExportBatch({
        history: batch,
        walletAddresses: ['wallet-address'],
        reader: fixture.reader,
        loadCachedOutputs,
      }),
      publishBatch: async ({ records, outputs }) => {
        recordCount += records.length;
        records.forEach((record) => recordCache.set(record.txid, record));
        persistOutputs(outputs);
        if (firstVisibleRowsMs === 0) {
          firstVisibleRowsMs = Math.round(performance.now() - startedAt);
        }
      },
    });
    const totalMs = Math.round(performance.now() - startedAt);

    console.info(JSON.stringify({
      mode: 'page-first-cold-output-cache',
      transactions: recordCount,
      requests: fixture.requestCount(),
      firstVisibleRowsMs,
      totalMs,
    }));
    expect(recordCount).toBe(MEASUREMENT_SIZE);
    expect(firstVisibleRowsMs).toBeLessThan(totalMs);

    // A warm confirmed cache includes the date returned by the cold pass.
    // Missing dates must still trigger enrichment, even with known amounts.
    const enrichedHistory = fixture.history.map((entry, index) => {
      const record = recordCache.get(entry.txid)!;
      expect(record.blockTime).toBe(MEASUREMENT_BLOCK_TIME - index * 60);
      return {
        ...entry,
        direction: record.direction,
        amountSats: record.amountSats,
        feeSats: record.feeSats,
        counterparty: record.counterparty,
        blockTime: record.blockTime ?? undefined,
        provisional: false,
      };
    });
    const actualWarmQueue = new HistoryEnrichmentQueue(enrichedHistory);
    expect(actualWarmQueue.remainingCount).toBe(0);
    const warmRequestsBefore = fixture.requestCount();
    const warmStartedAt = performance.now();
    let warmRecordCount = 0;
    await processHistoryEnrichmentQueue({
      queue: actualWarmQueue,
      enrichBatch: (batch) => buildHistoryExportBatch({
        history: batch,
        walletAddresses: ['wallet-address'],
        reader: fixture.reader,
        loadCachedOutputs,
      }),
      publishBatch: async ({ records }) => {
        warmRecordCount += records.length;
      },
    });
    const warmRequests = fixture.requestCount() - warmRequestsBefore;
    console.info(JSON.stringify({
      mode: 'second-app-enrichment',
      transactions: warmRecordCount,
      requests: warmRequests,
      firstVisibleRowsMs: 0,
      totalMs: Math.round(performance.now() - warmStartedAt),
    }));
    expect(warmRecordCount).toBe(0);
    expect(warmRequests).toBe(0);

    const forcedWarmFixture = createMeasurementFixture();
    const forcedWarmQueue = new HistoryEnrichmentQueue(forcedWarmFixture.history);
    const forcedWarmStartedAt = performance.now();
    await processHistoryEnrichmentQueue({
      queue: forcedWarmQueue,
      enrichBatch: (batch) => buildHistoryExportBatch({
        history: batch,
        walletAddresses: ['wallet-address'],
        reader: forcedWarmFixture.reader,
        loadCachedOutputs,
      }),
      publishBatch: async ({ outputs }) => {
        persistOutputs(outputs);
      },
    });
    const forcedWarmTotalMs = Math.round(performance.now() - forcedWarmStartedAt);
    console.info(JSON.stringify({
      mode: 'forced-reenrichment-warm-output-cache',
      transactions: MEASUREMENT_SIZE,
      requests: forcedWarmFixture.requestCount(),
      totalMs: forcedWarmTotalMs,
    }));
    expect(forcedWarmFixture.requestCount()).toBe(MEASUREMENT_SIZE);
  }, 40_000);
});
