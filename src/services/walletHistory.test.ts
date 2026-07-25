import { describe, expect, it } from 'vitest';

import type { ElectrumHistoryEntry } from '../network/electrum';
import { normalizeWalletHistory } from './walletHistory';

const cached: ElectrumHistoryEntry = {
  txid: 'a'.repeat(64),
  height: 100,
  address: 'nito1qcache',
  direction: 'received',
  amountSats: 120_000,
  feeSats: 0,
};

const freshScan: ElectrumHistoryEntry = {
  txid: 'a'.repeat(64),
  height: 100,
  address: 'nito1qcache',
};

describe('normalizeWalletHistory', () => {
  it('keeps enriched amount/direction when a fresh unenriched scan is merged in', () => {
    const merged = normalizeWalletHistory([freshScan, cached]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ direction: 'received', amountSats: 120_000 });
  });

  it('drops enrichment when the height changed (reorg / confirmation)', () => {
    const reorged: ElectrumHistoryEntry = { ...freshScan, height: 101 };
    const merged = normalizeWalletHistory([cached, reorged]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.height).toBe(101);
    expect(merged[0]?.direction).toBeUndefined();
  });

  it('deduplicates and sorts by descending height then txid', () => {
    const merged = normalizeWalletHistory([
      { txid: 'b'.repeat(64), height: 50, address: 'x' },
      { txid: 'c'.repeat(64), height: 200, address: 'y' },
      { txid: 'b'.repeat(64), height: 50, address: 'x' },
    ]);
    expect(merged.map((entry) => entry.height)).toEqual([200, 50]);
  });
});
