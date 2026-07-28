import type {
  ElectrumHistoryEntry,
  ElectrumVerboseTransaction,
} from '../network/electrum';
import type { LanguageCode } from '../i18n';
import { formatNitoDateTime } from '../i18n.datetime';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import { reportNonFinancialFailure } from './diagnostics';

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

export type CachedTransactionOutput = {
  txid: string;
  outputIndex: number;
  valueSats: number;
  address: string;
};

export type HistoryExportBatch = {
  records: HistoryExportRecord[];
  outputs: CachedTransactionOutput[];
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

const outputKey = (txid: string, outputIndex: number) => `${txid}:${outputIndex}`;
const cachedOutputKey = (output: CachedTransactionOutput) => (
  `${outputKey(output.txid, output.outputIndex)}:${output.address}`
);

const transactionOutputs = (
  txid: string,
  transaction: ElectrumVerboseTransaction,
): CachedTransactionOutput[] => transaction.vout.flatMap((output, index) => {
  const addresses = outputAddresses(output);
  return (addresses.length > 0 ? addresses : ['']).map((address) => ({
    txid,
    outputIndex: output.n ?? index,
    valueSats: outputValueSats(output),
    address,
  }));
});

const validateCachedOutput = (output: CachedTransactionOutput) => {
  if (
    !output.txid
    || !Number.isInteger(output.outputIndex)
    || output.outputIndex < 0
    || !Number.isSafeInteger(output.valueSats)
    || output.valueSats < 0
    || typeof output.address !== 'string'
  ) {
    throw new Error('Invalid transaction output cache row.');
  }
};

const indexOutputs = (
  rows: readonly CachedTransactionOutput[],
  target: Map<string, CachedTransactionOutput[]>,
) => {
  for (const row of rows) {
    validateCachedOutput(row);
    const key = outputKey(row.txid, row.outputIndex);
    const existing = target.get(key) ?? [];
    if (
      existing.length > 0
      && existing.some((entry) => entry.valueSats !== row.valueSats)
    ) {
      throw new Error(`Conflicting transaction output cache rows for ${key}.`);
    }
    if (!existing.some((entry) => entry.address === row.address)) {
      existing.push(row);
      target.set(key, existing);
    }
  }
};

const formatSats = (sats: number) => {
  const safeSats = Math.max(0, Math.trunc(sats));
  const whole = Math.floor(safeSats / 100_000_000);
  const fraction = String(safeSats % 100_000_000).padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
};

const buildHistoryExportRecord = (
  entry: ElectrumHistoryEntry,
  owned: Set<string>,
  transaction: ElectrumVerboseTransaction,
  resolvedOutputs: ReadonlyMap<string, CachedTransactionOutput[]>,
): HistoryExportRecord => {
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

  for (const input of transaction.vin) {
    if (input.coinbase) continue;
    if (!input.txid || typeof input.vout !== 'number') {
      throw new Error(`Incomplete transaction input in ${entry.txid}.`);
    }
    const previousOutputs = resolvedOutputs.get(outputKey(input.txid, input.vout));
    if (!previousOutputs || previousOutputs.length === 0) {
      throw new Error(`Missing parent output ${input.txid}:${input.vout}.`);
    }
    const valueSats = previousOutputs[0]!.valueSats;
    totalInputSats += valueSats;
    if (previousOutputs.some(({ address }) => owned.has(address))) {
      walletInputSats += valueSats;
    }
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

type BuildHistoryExportBatchOptions = {
  history: ElectrumHistoryEntry[];
  walletAddresses: string[];
  reader: VerboseTransactionReader;
  concurrency?: number;
  inputConcurrency?: number;
  loadCachedOutputs?: (
    txids: readonly string[],
  ) => Promise<readonly CachedTransactionOutput[]>;
  onCacheReadError?: (caught: unknown) => void;
  onProgress?: (done: number, total: number) => void;
};

export const buildHistoryExportBatch = async ({
  history,
  walletAddresses,
  reader,
  concurrency = DEFAULT_HISTORY_CONCURRENCY,
  inputConcurrency = DEFAULT_HISTORY_INPUT_CONCURRENCY,
  loadCachedOutputs,
  onCacheReadError,
  onProgress,
}: BuildHistoryExportBatchOptions): Promise<HistoryExportBatch> => {
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

  const currentTransactions = await mapWithConcurrency(
    history,
    concurrency,
    async (entry) => ({
      entry,
      transaction: await getTransaction(entry.txid),
    }),
  );
  const resolvedOutputs = new Map<string, CachedTransactionOutput[]>();
  const outputsToPersist = new Map<string, CachedTransactionOutput>();
  const addNetworkOutputs = (txid: string, transaction: ElectrumVerboseTransaction) => {
    const outputs = transactionOutputs(txid, transaction);
    indexOutputs(outputs, resolvedOutputs);
    outputs.forEach((output) => outputsToPersist.set(cachedOutputKey(output), output));
  };
  currentTransactions.forEach(({ entry, transaction }) => {
    addNetworkOutputs(entry.txid, transaction);
  });

  const parentReferences = new Map<string, { txid: string; outputIndex: number }>();
  currentTransactions.forEach(({ entry, transaction }) => {
    transaction.vin.forEach((input) => {
      if (input.coinbase) return;
      if (!input.txid || typeof input.vout !== 'number') {
        throw new Error(`Incomplete transaction input in ${entry.txid}.`);
      }
      parentReferences.set(outputKey(input.txid, input.vout), {
        txid: input.txid,
        outputIndex: input.vout,
      });
    });
  });

  const unresolvedReferences = () => [...parentReferences.entries()]
    .filter(([key]) => !resolvedOutputs.has(key))
    .map(([, reference]) => reference);
  const uncachedReferences = unresolvedReferences();
  if (loadCachedOutputs && uncachedReferences.length > 0) {
    try {
      const cachedOutputs = await loadCachedOutputs(
        [...new Set(uncachedReferences.map(({ txid }) => txid))],
      );
      const validatedCachedOutputs = new Map<string, CachedTransactionOutput[]>();
      indexOutputs(cachedOutputs, validatedCachedOutputs);
      indexOutputs(
        [...validatedCachedOutputs.values()].flat(),
        resolvedOutputs,
      );
    } catch (caught) {
      (onCacheReadError ?? ((error) => {
        reportNonFinancialFailure('transaction output cache read', error);
      }))(caught);
    }
  }

  const unresolvedKeys = new Set(
    unresolvedReferences().map(({ txid, outputIndex }) => outputKey(txid, outputIndex)),
  );
  await mapWithConcurrency(currentTransactions, concurrency, async ({ transaction }) => {
    const missingForTransaction = [
      ...new Set(transaction.vin.flatMap((input) => (
        input.txid
        && typeof input.vout === 'number'
        && unresolvedKeys.has(outputKey(input.txid, input.vout))
          ? [input.txid]
          : []
      ))),
    ];
    await mapWithConcurrency(missingForTransaction, inputConcurrency, async (txid) => {
      addNetworkOutputs(txid, await getTransaction(txid));
    });
  });

  let completed = 0;
  const records = currentTransactions.map(({ entry, transaction }) => {
    const record = buildHistoryExportRecord(entry, owned, transaction, resolvedOutputs);
    completed += 1;
    onProgress?.(completed, history.length);
    return record;
  });

  return {
    records,
    outputs: [...outputsToPersist.values()],
  };
};

export const buildHistoryExportRecords = async (
  options: BuildHistoryExportBatchOptions,
): Promise<HistoryExportRecord[]> => {
  const { records } = await buildHistoryExportBatch(options);
  return records;
};

const formatExportDate = (blockTime: number | null, language: LanguageCode) => {
  if (blockTime === null) return '';
  return formatNitoDateTime(blockTime, language);
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

export const historyExportTsvRows = (
  records: HistoryExportRecord[],
  language: LanguageCode,
) => [
  ['date', 'direction', 'amount_nito', 'fee_nito', 'status', 'block_height', 'address', 'txid'],
  ...records.map((record) => [
    formatExportDate(record.blockTime, language),
    record.direction,
    formatSats(record.amountSats),
    formatSats(record.feeSats),
    record.status,
    record.blockHeight,
    record.counterparty,
    record.txid,
  ]),
];
