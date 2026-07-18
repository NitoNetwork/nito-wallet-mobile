import type {
  ElectrumHistoryEntry,
  ElectrumVerboseTransaction,
} from '../network/electrum';

export type HistoryExportDirection = 'received' | 'sent' | 'self';

export type HistoryExportRecord = {
  txid: string;
  status: 'confirmed' | 'pending';
  blockHeight: number;
  direction: HistoryExportDirection;
  counterpartyAddresses: string[];
  walletAddresses: string[];
  amountSats: number;
  feeSats: number;
};

type VerboseTransactionReader = {
  getVerboseTransaction(txid: string): Promise<ElectrumVerboseTransaction>;
};

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

export const buildHistoryExportRecords = async ({
  history,
  walletAddresses,
  reader,
}: {
  history: ElectrumHistoryEntry[];
  walletAddresses: string[];
  reader: VerboseTransactionReader;
}): Promise<HistoryExportRecord[]> => {
  const owned = new Set(walletAddresses);
  const cache = new Map<string, Promise<ElectrumVerboseTransaction>>();
  const getTransaction = (txid: string) => {
    const cached = cache.get(txid);
    if (cached) return cached;
    const request = reader.getVerboseTransaction(txid);
    cache.set(txid, request);
    return request;
  };

  const records: HistoryExportRecord[] = [];

  for (const entry of history) {
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
    const externalInputAddresses = new Set<string>();
    const walletInputAddresses = new Set<string>();

    await Promise.all(transaction.vin.map(async (input) => {
      if (!input.txid || typeof input.vout !== 'number') return;
      const previous = await getTransaction(input.txid);
      const previousOutput = previous.vout.find((output, index) => (output.n ?? index) === input.vout);
      if (!previousOutput) return;
      const valueSats = outputValueSats(previousOutput);
      const addresses = outputAddresses(previousOutput);
      totalInputSats += valueSats;
      if (addresses.some((address) => owned.has(address))) {
        walletInputSats += valueSats;
        addresses.filter((address) => owned.has(address)).forEach((address) => walletInputAddresses.add(address));
      } else {
        addresses.forEach((address) => externalInputAddresses.add(address));
      }
    }));

    const totalOutputSats = currentOutputs.reduce((total, output) => total + output.valueSats, 0);
    const externalOutputSats = externalOutputs.reduce((total, output) => total + output.valueSats, 0);
    const walletOutputAddresses = currentOutputs
      .flatMap((output) => output.addresses)
      .filter((address) => owned.has(address));
    const isSent = walletInputSats > 0 && externalOutputSats > 0;
    const direction: HistoryExportDirection = isSent ? 'sent' : walletInputSats > 0 ? 'self' : 'received';

    records.push({
      txid: entry.txid,
      status: entry.height > 0 ? 'confirmed' : 'pending',
      blockHeight: entry.height,
      direction,
      counterpartyAddresses: isSent
        ? [...new Set(externalOutputs.flatMap((output) => output.addresses))]
        : [...externalInputAddresses],
      walletAddresses: [...new Set([...walletInputAddresses, ...walletOutputAddresses])],
      amountSats: isSent ? externalOutputSats : direction === 'received' ? walletOutputSats : 0,
      feeSats: walletInputSats > 0 ? Math.max(0, totalInputSats - totalOutputSats) : 0,
    });
  }

  return records;
};

export const historyExportCsvRows = (records: HistoryExportRecord[]) => [
  ['txid', 'status', 'block_height', 'direction', 'counterparty_addresses', 'wallet_addresses', 'amount_nito', 'fee_nito'],
  ...records.map((record) => [
    record.txid,
    record.status,
    record.blockHeight,
    record.direction,
    record.counterpartyAddresses.join(' | '),
    record.walletAddresses.join(' | '),
    formatSats(record.amountSats),
    formatSats(record.feeSats),
  ]),
];
