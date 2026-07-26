import type {
  ElectrumHistoryEntry,
  ElectrumVerboseTransaction,
} from '../network/electrum';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';

export type HistoryExportDirection = 'received' | 'sent' | 'self';

export type HistoryExportRecord = {
  txid: string;
  status: 'confirmed' | 'pending';
  blockHeight: number;
  blockTime: number | null;
  direction: HistoryExportDirection;
  counterparty: string;
  amountSats: number;
  feeSats: number;
};

type VerboseTransactionReader = {
  getVerboseTransaction(txid: string): Promise<ElectrumVerboseTransaction>;
};

export const DEFAULT_HISTORY_CONCURRENCY = 6;
export const DEFAULT_HISTORY_INPUT_CONCURRENCY = 4;

const outputAddresses = (output: ElectrumVerboseTransaction['vout'][number]) => {
  const addresses = [...(output.scriptPubKey?.addresses ?? [])];
  if (output.scriptPubKey?.address) {
    addresses.unshift(output.scriptPubKey.address);
  }
  return [...new Set(addresses.map((address) => address.trim()).filter(Boolean))];
};

const outputValueSats = (output: ElectrumVerboseTransaction['vout'][number]) =>
  Math.round(Number(output.value) * 100_000_000);

const formatSats = (sats: number) => {
  const safeSats = Math.max(0, Math.trunc(sats));
  const whole = Math.floor(safeSats / 100_000_000);
  const fraction = String(safeSats % 100_000_000).padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
};

const buildHistoryExportRecord = async (
  entry: ElectrumHistoryEntry,
  owned: Set<string>,
  getTransaction: (txid: string) => Promise<ElectrumVerboseTransaction>,
  inputConcurrency: number,
): Promise<HistoryExportRecord> => {
  const transaction = await getTransaction(entry.txid);
  const currentOutputs = transaction.vout.map((output) => ({
    addresses: outputAddresses(output),
    valueSats: outputValueSats(output),
  }));
  const walletOutputSats = currentOutputs
    .filter((output) => output.addresses.some((address) => owned.has(address)))
    .reduce((total, output) => total + output.valueSats, 0);
  const externalOutputs = currentOutputs.filter(
    (output) => output.addresses.length > 0 && output.addresses.every((address) => !owned.has(address)),
  );

  let totalInputSats = 0;
  let walletInputSats = 0;

  const resolvedInputs = await mapWithConcurrency(transaction.vin, inputConcurrency, async (input) => {
    if (!input.txid || typeof input.vout !== 'number') return;
    const previous = await getTransaction(input.txid);
    const previousOutput = previous.vout.find((output, index) => (output.n ?? index) === input.vout);
    if (!previousOutput) return;
    const valueSats = outputValueSats(previousOutput);
    const addresses = outputAddresses(previousOutput);
    return {
      valueSats,
      owned: addresses.some((address) => owned.has(address)),
    };
  });
  for (const input of resolvedInputs) {
    if (!input) continue;
    totalInputSats += input.valueSats;
    if (input.owned) walletInputSats += input.valueSats;
  }

  const totalOutputSats = currentOutputs.reduce((total, output) => total + output.valueSats, 0);
  const externalOutputSats = externalOutputs.reduce((total, output) => total + output.valueSats, 0);
  const isSent = walletInputSats > 0 && externalOutputSats > 0;
  const direction: HistoryExportDirection = isSent ? 'sent' : walletInputSats > 0 ? 'self' : 'received';
  const ownedOutputAddress = currentOutputs
    .flatMap((output) => output.addresses)
    .find((address) => owned.has(address)) ?? '';
  const counterparty = isSent
    ? [...new Set(externalOutputs.flatMap((output) => output.addresses))][0] ?? ''
    : ownedOutputAddress;
  const blockTime = transaction.blocktime ?? transaction.time ?? null;

  return {
    txid: entry.txid,
    status: entry.height > 0 ? 'confirmed' : 'pending',
    blockHeight: entry.height,
    blockTime: typeof blockTime === 'number' && blockTime > 0 ? blockTime : null,
    direction,
    counterparty,
    amountSats: isSent ? externalOutputSats : walletOutputSats,
    feeSats: walletInputSats > 0 ? Math.max(0, totalInputSats - totalOutputSats) : 0,
  };
};

export const buildHistoryExportRecords = async ({
  history,
  walletAddresses,
  reader,
  concurrency = DEFAULT_HISTORY_CONCURRENCY,
  inputConcurrency = DEFAULT_HISTORY_INPUT_CONCURRENCY,
  onProgress,
}: {
  history: ElectrumHistoryEntry[];
  walletAddresses: string[];
  reader: VerboseTransactionReader;
  concurrency?: number;
  inputConcurrency?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<HistoryExportRecord[]> => {
  const owned = new Set(walletAddresses);
  const cache = new Map<string, Promise<ElectrumVerboseTransaction>>();
  const transactionLimiter = createConcurrencyLimiter(concurrency);
  const getTransaction = (txid: string) => {
    const cached = cache.get(txid);
    if (cached) return cached;
    const request = transactionLimiter.run(() => reader.getVerboseTransaction(txid));
    cache.set(txid, request);
    return request;
  };

  let completed = 0;
  return mapWithConcurrency(history, concurrency, async (entry) => {
    const record = await buildHistoryExportRecord(entry, owned, getTransaction, inputConcurrency);
    completed += 1;
    onProgress?.(completed, history.length);
    return record;
  });
};

const formatUtcDate = (blockTime: number | null) => {
  if (blockTime === null) return '';
  return new Date(blockTime * 1000).toISOString().replace('.000Z', 'Z');
};

export const historyRecordsFromEntries = (entries: ElectrumHistoryEntry[]): HistoryExportRecord[] =>
  entries.flatMap((entry) => {
    if (entry.direction === undefined) return [];
    return [{
      txid: entry.txid,
      status: entry.height > 0 ? 'confirmed' : 'pending',
      blockHeight: entry.height,
      blockTime: entry.blockTime ?? null,
      direction: entry.direction,
      counterparty: entry.counterparty ?? '',
      amountSats: entry.amountSats ?? 0,
      feeSats: entry.feeSats ?? 0,
    } satisfies HistoryExportRecord];
  });

export const historyExportCsvRows = (records: HistoryExportRecord[]) => [
  ['date', 'direction', 'amount_nito', 'fee_nito', 'status', 'block_height', 'address', 'txid'],
  ...records.map((record) => [
    formatUtcDate(record.blockTime),
    record.direction,
    formatSats(record.amountSats),
    formatSats(record.feeSats),
    record.status,
    record.blockHeight,
    record.counterparty,
    record.txid,
  ]),
];
