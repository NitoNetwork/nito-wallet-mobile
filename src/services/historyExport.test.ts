import { describe, expect, it } from 'vitest';

import type { ElectrumVerboseTransaction } from '../network/electrum';
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
});
