import { describe, expect, it } from 'vitest';

import type { ElectrumHistoryEntry, ElectrumVerboseTransaction } from '../network/electrum';
import { buildHistoryExportRecords, historyExportCsvRows } from './historyExport';

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
      counterpartyAddresses: ['recipient-address'],
      amountSats: 700_000_000,
      feeSats: 10_000_000,
    });
    expect(records[1]).toMatchObject({
      direction: 'received',
      counterpartyAddresses: ['external-source'],
      amountSats: 990_000_000,
    });
    const rows = historyExportCsvRows(records);
    expect(rows[0]).not.toContain('explorer_url');
    expect(rows[1]).toContain('recipient-address');
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
});
