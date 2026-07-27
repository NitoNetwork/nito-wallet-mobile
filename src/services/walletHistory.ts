import type { ElectrumHistoryEntry } from '../network/electrum';

export type EnrichedHistoryRecord = {
  txid: string;
  height: number;
  amountSats: number;
  direction: 'received' | 'sent' | 'self';
  feeSats: number;
  counterparty: string;
  blockTime: number | null;
};

const mergeEnrichment = (
  base: ElectrumHistoryEntry,
  other: ElectrumHistoryEntry | undefined,
): ElectrumHistoryEntry => {
  if (!other || base.direction !== undefined) return base;
  if (other.direction === undefined) return base;
  return {
    ...base,
    direction: other.direction,
    amountSats: other.amountSats,
    feeSats: other.feeSats,
    counterparty: other.counterparty,
    blockTime: other.blockTime,
  };
};

export const normalizeWalletHistory = (history: ElectrumHistoryEntry[]) => {
  const byTxid = new Map<string, ElectrumHistoryEntry>();

  for (const entry of history) {
    const existing = byTxid.get(entry.txid);
    const winner = !existing
      || entry.height > existing.height
      || (entry.height === existing.height && entry.address < existing.address)
      ? entry
      : existing;
    const loser = winner === entry ? existing : entry;
    byTxid.set(entry.txid, mergeEnrichment(winner, loser));
  }

  return [...byTxid.values()].sort((a, b) => {
    const aMempool = a.height <= 0;
    const bMempool = b.height <= 0;
    if (aMempool !== bMempool) {
      return aMempool ? -1 : 1;
    }

    if (aMempool && bMempool) {
      return a.txid.localeCompare(b.txid);
    }

    if (a.height !== b.height) {
      return b.height - a.height;
    }

    return a.txid.localeCompare(b.txid);
  });
};
