import { describe, expect, it, vi } from 'vitest';

import type { ElectrumHistoryEntry, ElectrumVerboseTransaction } from '../network/electrum';
import { formatNitoDateTime } from '../i18n.datetime';
import {
  buildHistoryExportBatch,
  buildHistoryExportRecords,
  historyExportTsvRows,
  historyRecordsFromEntries,
} from './historyExport';

const output = (value: number, address: string, n = 0) => ({
  n,
  value,
  scriptPubKey: { address },
});

describe('wallet history export', () => {
  it('resolves sent and received counterparties, amounts and fees without explorer links', async () => {
    const transactions: Record<string, ElectrumVerboseTransaction> = {
      externalParent: { vin: [{ coinbase: '01' }], vout: [output(10, 'external-source')] },
      received: {
        vin: [{ txid: 'externalParent', vout: 0 }],
        vout: [output(9.9, 'wallet-address')],
      },
      walletParent: { vin: [{ coinbase: '02' }], vout: [output(10, 'wallet-address')] },
      sent: {
        vin: [{ txid: 'walletParent', vout: 0 }],
        vout: [output(7, 'recipient-address'), output(2.9, 'wallet-address', 1)],
      },
    };
    const reader = {
      async getVerboseTransaction(txid: string) {
        const transaction = transactions[txid];
        if (!transaction) throw new Error(`Missing transaction ${txid}`);
        return transaction;
      },
    };

    const records = await buildHistoryExportRecords({
      history: [
        { txid: 'sent', height: 20, address: 'wallet-address' },
        { txid: 'received', height: 10, address: 'wallet-address' },
      ],
      walletAddresses: ['wallet-address'],
      reader,
    });

    expect(records[0]).toMatchObject({
      direction: 'sent',
      counterparty: 'recipient-address',
      amountSats: 700_000_000,
      feeSats: 10_000_000,
    });
    expect(records[1]).toMatchObject({
      direction: 'received',
      counterparty: 'wallet-address',
      amountSats: 990_000_000,
    });
    const rows = historyExportTsvRows(records, 'en');
    expect(rows[0]).toEqual([
      'date',
      'direction',
      'amount_nito',
      'fee_nito',
      'wallet_effect_nito',
      'status',
      'block_height',
      'address',
      'txid',
    ]);
    expect(rows[1]?.slice(1, 5)).toEqual(['sent', '7', '0.1', '-7.1']);
    expect(rows[2]?.slice(1, 5)).toEqual(['received', '9.9', '0', '9.9']);
    expect(rows.every((row) => row.length === rows[0]!.length)).toBe(true);
  });

  it('reports the real amount moved by an internal transaction', async () => {
    const transactions: Record<string, ElectrumVerboseTransaction> = {
      walletParent: { vin: [{ coinbase: '01' }], vout: [output(10, 'wallet-address')] },
      consolidation: {
        blocktime: 1_753_000_000,
        vin: [{ txid: 'walletParent', vout: 0 }],
        vout: [output(9.5, 'wallet-address')],
      },
    };
    const reader = {
      async getVerboseTransaction(txid: string) {
        const transaction = transactions[txid];
        if (!transaction) throw new Error(`Missing transaction ${txid}`);
        return transaction;
      },
    };

    const [record] = await buildHistoryExportRecords({
      history: [{ txid: 'consolidation', height: 42, address: 'wallet-address' }],
      walletAddresses: ['wallet-address'],
      reader,
    });

    expect(record).toMatchObject({ direction: 'self', amountSats: 950_000_000, feeSats: 50_000_000 });
    const row = historyExportTsvRows([record!], 'en')[1];
    expect(row?.slice(1, 5)).toEqual(['self', '0', '0.5', '-0.5']);
    // Exported block times intentionally follow the device timezone.
    expect(row?.[0]).toBe(
      formatNitoDateTime(record!.blockTime!, 'en'),
    );
  });

  it('does not classify a transaction with an external input as internal', async () => {
    const transactions: Record<string, ElectrumVerboseTransaction> = {
      walletParent: { vin: [{ coinbase: '01' }], vout: [output(4, 'wallet-address')] },
      externalParent: { vin: [{ coinbase: '02' }], vout: [output(6, 'external-source')] },
      mixedInputs: {
        vin: [
          { txid: 'walletParent', vout: 0 },
          { txid: 'externalParent', vout: 0 },
        ],
        vout: [output(9.9, 'wallet-address')],
      },
    };

    const [record] = await buildHistoryExportRecords({
      history: [{ txid: 'mixedInputs', height: 43, address: 'wallet-address' }],
      walletAddresses: ['wallet-address'],
      reader: {
        async getVerboseTransaction(txid: string) {
          const transaction = transactions[txid];
          if (!transaction) throw new Error(`Missing transaction ${txid}`);
          return transaction;
        },
      },
    });

    expect(record).toMatchObject({
      direction: 'received',
      amountSats: 990_000_000,
      feeSats: 10_000_000,
    });
  });

  it('rebuilds records from cached entries without any network call', () => {
    const records = historyRecordsFromEntries([
      { txid: 'a', height: 10, address: 'wallet-address' },
      {
        txid: 'b',
        height: 20,
        address: 'wallet-address',
        direction: 'received',
        amountSats: 500,
        feeSats: 0,
        counterparty: 'sender',
        blockTime: 1_753_000_000,
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ txid: 'b', direction: 'received', counterparty: 'sender' });
  });

  it('fetches transactions concurrently, preserves order and reports progress', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const reader = {
      async getVerboseTransaction(txid: string): Promise<ElectrumVerboseTransaction> {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { vin: [{ coinbase: '00' }], vout: [{ n: 0, value: 1, scriptPubKey: { address: 'wallet-address' } }] };
      },
    };
    const history: ElectrumHistoryEntry[] = Array.from({ length: 12 }, (_, index) => ({
      txid: `tx-${index}`,
      height: index + 1,
      address: 'wallet-address',
    }));

    const progress: number[] = [];
    const records = await buildHistoryExportRecords({
      history,
      walletAddresses: ['wallet-address'],
      reader,
      concurrency: 4,
      onProgress: (done) => progress.push(done),
    });

    expect(records.map((record) => record.txid)).toEqual(history.map((entry) => entry.txid));
    expect(maxInFlight).toBeGreaterThan(1);
    expect(progress[progress.length - 1]).toBe(12);
  });

  it('bounds input transaction reads for a transaction with many inputs', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const inputCount = 21;
    const reader = {
      async getVerboseTransaction(txid: string): Promise<ElectrumVerboseTransaction> {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        if (txid === 'large-send') {
          return {
            vin: Array.from({ length: inputCount }, (_, index) => ({
              txid: `parent-${index}`,
              vout: 0,
            })),
            vout: [output(20, 'recipient')],
          };
        }
        return { vin: [{ coinbase: '00' }], vout: [output(1, 'wallet-address')] };
      },
    };

    const records = await buildHistoryExportRecords({
      history: [{ txid: 'large-send', height: 50, address: 'wallet-address' }],
      walletAddresses: ['wallet-address'],
      reader,
      concurrency: 6,
      inputConcurrency: 4,
    });

    expect(records).toHaveLength(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('resolves parent outputs from persistent cache before requesting the network', async () => {
    const requested: string[] = [];
    const reader = {
      async getVerboseTransaction(txid: string): Promise<ElectrumVerboseTransaction> {
        requested.push(txid);
        if (txid !== 'received') throw new Error(`Unexpected network request for ${txid}`);
        return {
          vin: [{ txid: 'cached-parent', vout: 0 }],
          vout: [output(0.9, 'wallet-address')],
        };
      },
    };

    const batch = await buildHistoryExportBatch({
      history: [{ txid: 'received', height: 20, address: 'wallet-address' }],
      walletAddresses: ['wallet-address'],
      reader,
      loadCachedOutputs: async () => [{
        txid: 'cached-parent',
        outputIndex: 0,
        valueSats: 100_000_000,
        address: 'external-source',
      }],
    });

    expect(requested).toEqual(['received']);
    expect(batch.records[0]).toMatchObject({
      direction: 'received',
      amountSats: 90_000_000,
    });
    expect(batch.outputs).toEqual(expect.arrayContaining([
      {
        txid: 'received',
        outputIndex: 0,
        valueSats: 90_000_000,
        address: 'wallet-address',
      },
    ]));
  });

  it('reports a cache read failure and falls back to complete network data', async () => {
    const requested: string[] = [];
    const onCacheReadError = vi.fn();
    const transactions: Record<string, ElectrumVerboseTransaction> = {
      received: {
        vin: [{ txid: 'network-parent', vout: 0 }],
        vout: [output(0.9, 'wallet-address')],
      },
      'network-parent': {
        vin: [{ coinbase: '00' }],
        vout: [output(1, 'external-source')],
      },
    };

    const batch = await buildHistoryExportBatch({
      history: [{ txid: 'received', height: 20, address: 'wallet-address' }],
      walletAddresses: ['wallet-address'],
      reader: {
        async getVerboseTransaction(txid: string) {
          requested.push(txid);
          const transaction = transactions[txid];
          if (!transaction) throw new Error(`Missing transaction ${txid}`);
          return transaction;
        },
      },
      loadCachedOutputs: async () => {
        throw new Error('SQLite read failed');
      },
      onCacheReadError,
    });

    expect(onCacheReadError).toHaveBeenCalledOnce();
    expect(requested).toEqual(['received', 'network-parent']);
    expect(batch.records).toHaveLength(1);
  });

  it('never publishes a record when a required parent output is missing', async () => {
    const transactions: Record<string, ElectrumVerboseTransaction> = {
      received: {
        vin: [{ txid: 'parent', vout: 9 }],
        vout: [output(0.9, 'wallet-address')],
      },
      parent: {
        vin: [{ coinbase: '00' }],
        vout: [output(1, 'external-source')],
      },
    };

    await expect(buildHistoryExportBatch({
      history: [{ txid: 'received', height: 20, address: 'wallet-address' }],
      walletAddresses: ['wallet-address'],
      reader: {
        async getVerboseTransaction(txid: string) {
          const transaction = transactions[txid];
          if (!transaction) throw new Error(`Missing transaction ${txid}`);
          return transaction;
        },
      },
    })).rejects.toThrow('Missing parent output parent:9');
  });
});
