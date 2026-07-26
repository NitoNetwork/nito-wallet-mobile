import type { ElectrumBalance, ElectrumHistoryEntry, ElectrumUtxo } from '../network/electrum';
import { ElectrumSessionUnhealthyError } from '../network/electrum';
import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
import { createConcurrencyLimiter, mapWithConcurrency } from '../services/concurrency';
import type {
  NitoWalletCryptoApi,
  TransparentScriptType as NativeTransparentScriptType,
} from '../native/nitoWalletCryptoContract';
import {
  annotateCoinbaseMaturity,
  getImmatureCoinbaseSummary,
  isTransparentUtxoSpendable,
} from './coinbaseMaturity';

const DEFAULT_GAP_LIMIT = 20;
const SCAN_BATCH_SIZE = 5;
const ELECTRUM_READ_MAX_ATTEMPTS = 3;
const ELECTRUM_READ_RETRY_DELAY_MS = 100;
const SCAN_NETWORK_CONCURRENCY = 6;
const SCAN_COLLECTION_CONCURRENCY = 6;

export type HdBranch = 'external' | 'internal';
export type TransparentScriptType = NativeTransparentScriptType;

type AccountTemplate = {
  key: string;
  label: string;
  accountPath: string;
  scriptType: TransparentScriptType;
  spendable: boolean;
};

const ACCOUNT_TEMPLATES: AccountTemplate[] = [
  { key: 'legacy', label: 'Legacy', accountPath: "m/44'/0'/0'", scriptType: 'p2pkh', spendable: true },
  { key: 'nested', label: 'Nested SegWit', accountPath: "m/49'/0'/0'", scriptType: 'p2sh-p2wpkh', spendable: true },
  { key: 'bech32', label: 'Bech32', accountPath: "m/84'/0'/0'", scriptType: 'p2wpkh', spendable: true },
  { key: 'taproot', label: 'Taproot', accountPath: "m/86'/0'/0'", scriptType: 'p2tr', spendable: true },
];

export type DerivedAddress = {
  accountKey: string;
  accountLabel: string;
  accountPath: string;
  scriptType: TransparentScriptType;
  spendable: boolean;
  branch: HdBranch;
  index: number;
  path: string;
  address: string;
};

export type ScannedAddress = DerivedAddress & {
  balance: ElectrumBalance;
  utxos: ElectrumUtxo[];
  history: ElectrumHistoryEntry[];
  used: boolean;
};

export type TransparentWalletSnapshot = {
  confirmedSats: number;
  unconfirmedSats: number;
  balanceSats: number;
  spendableSats: number;
  immatureCoinbaseSats?: number;
  immatureCoinbaseBlocksRemaining?: number;
  utxos: ElectrumUtxo[];
  history: ElectrumHistoryEntry[];
  addresses: ScannedAddress[];
  usedAddresses: ScannedAddress[];
  spendableAddresses: ScannedAddress[];
  gapLimit: number;
  scannedAt: string;
};

export type ElectrumReader = {
  getAddressBalance(address: string): Promise<ElectrumBalance>;
  getAddressUtxos(address: string): Promise<ElectrumUtxo[]>;
  getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]>;
  getTransactionHex?(txid: string): Promise<string>;
};

export type TransparentScanProgress = (done: number, total: number) => void;

type ElectrumScanOperation = 'history' | 'utxos';
type NetworkTaskRunner = <T>(task: () => Promise<T>) => Promise<T>;
type ScanControl = {
  failure: unknown;
  fail(caught: unknown): void;
};

type ScanProgressTracker = {
  reserve(count: number): void;
  complete(): void;
  finish(total: number): void;
};

const createScanProgressTracker = (
  onProgress?: TransparentScanProgress,
): ScanProgressTracker | undefined => {
  if (!onProgress) return undefined;
  let done = 0;
  let total = 0;

  return {
    reserve(count) {
      total += count;
      onProgress(done, total);
    },
    complete() {
      done += 1;
      onProgress(done, total);
    },
    finish(finalTotal) {
      done = finalTotal;
      total = finalTotal;
      onProgress(done, total);
    },
  };
};

const createScanControl = (): ScanControl => ({
  failure: undefined,
  fail(caught) {
    if (this.failure === undefined) {
      this.failure = caught;
    }
  },
});

const settleAll = async <T>(tasks: readonly Promise<T>[]): Promise<T[]> => {
  const settled = await Promise.allSettled(tasks);
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) {
    throw failure.reason;
  }
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
};

export class TransparentScanIncompleteError extends Error {
  readonly address: string;
  readonly operation: ElectrumScanOperation;
  readonly attempts: number;
  readonly originalError: Error;

  constructor({
    address,
    operation,
    attempts,
    cause,
  }: {
    address: string;
    operation: ElectrumScanOperation;
    attempts: number;
    cause: unknown;
  }) {
    super(`Transparent wallet scan incomplete: failed to read ${operation} for ${address}.`);
    this.name = 'TransparentScanIncompleteError';
    this.address = address;
    this.operation = operation;
    this.attempts = attempts;
    this.originalError = cause instanceof Error ? cause : new Error(String(cause));
  }
}

const waitBeforeElectrumRetry = (attempt: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ELECTRUM_READ_RETRY_DELAY_MS * attempt);
  });

const readElectrumWithRetry = async <T>({
  address,
  operation,
  read,
}: {
  address: string;
  operation: ElectrumScanOperation;
  read: () => Promise<T>;
}) => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= ELECTRUM_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await read();
    } catch (caught) {
      if (caught instanceof ElectrumSessionUnhealthyError) {
        throw caught;
      }
      lastError = caught;
      if (attempt < ELECTRUM_READ_MAX_ATTEMPTS) {
        await waitBeforeElectrumRetry(attempt);
      }
    }
  }

  throw new TransparentScanIncompleteError({
    address,
    operation,
    attempts: ELECTRUM_READ_MAX_ATTEMPTS,
    cause: lastError,
  });
};

const branchNumber = (branch: HdBranch) => (branch === 'external' ? 0 : 1);

const deriveAddressBatch = async (
  mnemonic: string,
  template: AccountTemplate,
  branch: HdBranch,
  indices: number[],
  crypto: NitoWalletCryptoApi,
): Promise<DerivedAddress[]> => {
  const requests = indices.map((index) => ({
    path: `${template.accountPath}/${branchNumber(branch)}/${index}`,
    scriptType: template.scriptType,
  }));
  const derived = await crypto.deriveAddresses(mnemonic, requests);
  return derived.map((address, offset) => ({
    accountKey: template.key,
    accountLabel: template.label,
    accountPath: template.accountPath,
    scriptType: template.scriptType,
    spendable: template.spendable,
    branch,
    index: indices[offset] ?? 0,
    path: address.path,
    address: address.address,
  }));
};

const buildSnapshot = (addresses: ScannedAddress[], gapLimit: number): TransparentWalletSnapshot => {
  const usedAddresses = addresses.filter((address) => address.used);
  const spendableAddresses = usedAddresses.filter((address) => address.spendable);
  const spendableAddressSet = new Set(spendableAddresses.map((address) => address.address));
  const utxoMap = new Map<string, ElectrumUtxo>();
  const historyMap = new Map<string, ElectrumHistoryEntry>();

  for (const address of usedAddresses) {
    for (const utxo of address.utxos) {
      utxoMap.set(`${utxo.txid}:${utxo.vout}`, utxo);
    }

    for (const entry of address.history) {
      const existing = historyMap.get(entry.txid);
      if (!existing || entry.height > existing.height || (entry.height === existing.height && entry.address < existing.address)) {
        historyMap.set(entry.txid, entry);
      }
    }
  }

  const confirmedSats = addresses.reduce((total, address) => total + address.balance.confirmedSats, 0);
  const unconfirmedSats = addresses.reduce((total, address) => total + address.balance.unconfirmedSats, 0);
  const spendableSats = addresses
    .filter((address) => spendableAddressSet.has(address.address))
    .flatMap((address) => address.utxos)
    .filter(isTransparentUtxoSpendable)
    .reduce((total, utxo) => total + utxo.valueSats, 0);
  const immatureCoinbase = getImmatureCoinbaseSummary([...utxoMap.values()]);

  return {
    confirmedSats,
    unconfirmedSats,
    balanceSats: confirmedSats + unconfirmedSats,
    spendableSats,
    immatureCoinbaseSats: immatureCoinbase.amountSats,
    immatureCoinbaseBlocksRemaining: immatureCoinbase.blocksRemaining,
    utxos: [...utxoMap.values()],
    history: [...historyMap.values()].sort((a, b) => {
      if (a.height !== b.height) {
        return b.height - a.height;
      }

      return a.txid.localeCompare(b.txid);
    }),
    addresses,
    usedAddresses,
    spendableAddresses,
    gapLimit,
    scannedAt: new Date().toISOString(),
  };
};

export const deriveP2wpkhAddress = async (
  mnemonic: string,
  branch: HdBranch,
  index: number,
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
): Promise<DerivedAddress> => {
  const bech32Template = ACCOUNT_TEMPLATES.find((template) => template.scriptType === 'p2wpkh');

  if (!bech32Template) {
    throw new Error('Bech32 configuration unavailable.');
  }

  const [derived] = await deriveAddressBatch(mnemonic, bech32Template, branch, [index], crypto);
  if (!derived) {
    throw new Error('Bech32 address derivation returned no result.');
  }
  return derived;
};


const hydrateLegacyUtxos = async (
  utxos: ElectrumUtxo[],
  electrum: ElectrumReader,
  runNetworkTask: NetworkTaskRunner,
) => {
  if (!electrum.getTransactionHex || utxos.length === 0) {
    return utxos;
  }

  return mapWithConcurrency(
    utxos,
    SCAN_COLLECTION_CONCURRENCY,
    async (utxo) => ({
      ...utxo,
      rawTx: await runNetworkTask(() => electrum.getTransactionHex!(utxo.txid)),
    }),
  );
};

const scanDerivedAddressUnchecked = async (
  derived: DerivedAddress,
  electrum: ElectrumReader,
  includeHistory: boolean,
  runNetworkTask: NetworkTaskRunner,
  progress?: ScanProgressTracker,
  previousAddress?: ScannedAddress,
): Promise<ScannedAddress> => {
  const addressHistory = await readElectrumWithRetry({
    address: derived.address,
    operation: 'history',
    read: () => runNetworkTask(() => electrum.getAddressHistory(derived.address)),
  });
  const used = addressHistory.length > 0;

  if (!used) {
    progress?.complete();
    return {
      ...derived,
      balance: { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 },
      utxos: [],
      history: [],
      used: false,
    };
  }

  const baseUtxos = await readElectrumWithRetry({
    address: derived.address,
    operation: 'utxos',
    read: () => runNetworkTask(() => electrum.getAddressUtxos(derived.address)),
  });
  const hydratedUtxos = derived.scriptType === 'p2pkh'
    ? await hydrateLegacyUtxos(baseUtxos, electrum, runNetworkTask)
    : baseUtxos;
  const utxos = await annotateCoinbaseMaturity(
    hydratedUtxos,
    previousAddress?.utxos ?? [],
    async (txid) => {
      const cached = hydratedUtxos.find((utxo) => utxo.txid === txid)?.rawTx;
      if (cached) return cached;
      if (!electrum.getTransactionHex) throw new Error('Transaction lookup unavailable.');
      return runNetworkTask(() => electrum.getTransactionHex!(txid));
    },
  );
  const confirmedSats = utxos
    .filter((utxo) => utxo.confirmations > 0)
    .reduce((total, utxo) => total + utxo.valueSats, 0);
  const unconfirmedSats = utxos
    .filter((utxo) => utxo.confirmations <= 0)
    .reduce((total, utxo) => total + utxo.valueSats, 0);
  const balance: ElectrumBalance = {
    confirmedSats,
    unconfirmedSats,
    totalSats: confirmedSats + unconfirmedSats,
  };
  const spendableUtxoTxids = new Set(
    utxos.filter(isTransparentUtxoSpendable).map((utxo) => utxo.txid),
  );
  const history = includeHistory
    ? addressHistory
    : addressHistory.filter((entry) => spendableUtxoTxids.has(entry.txid));
  progress?.complete();
  return { ...derived, balance, utxos, history, used };
};

const scanDerivedAddress = (
  derived: DerivedAddress,
  electrum: ElectrumReader,
  includeHistory: boolean,
  runNetworkTask: NetworkTaskRunner,
  control: ScanControl,
  progress?: ScanProgressTracker,
  previousAddress?: ScannedAddress,
): Promise<ScannedAddress> => {
  if (control.failure !== undefined) {
    return Promise.reject(control.failure);
  }
  return scanDerivedAddressUnchecked(
    derived,
    electrum,
    includeHistory,
    runNetworkTask,
    progress,
    previousAddress,
  ).catch((caught) => {
    control.fail(caught);
    throw caught;
  });
};

const scanBranch = async (
  mnemonic: string,
  template: AccountTemplate,
  branch: HdBranch,
  electrum: ElectrumReader,
  gapLimit: number,
  includeHistory: boolean,
  crypto: NitoWalletCryptoApi,
  runNetworkTask: NetworkTaskRunner,
  control: ScanControl,
  progress?: ScanProgressTracker,
  previousSnapshot?: TransparentWalletSnapshot,
) => {
  const addresses: ScannedAddress[] = [];
  const previousBranch = previousSnapshot?.addresses
    .filter((address) => address.accountKey === template.key && address.branch === branch)
    .sort((a, b) => a.index - b.index) ?? [];
  const previousByIndex = new Map(previousBranch.map((address) => [address.index, address]));

  let index = previousBranch.length > 0 ? Math.max(...previousBranch.map((address) => address.index)) + 1 : 0;

  if (previousBranch.length > 0) {
    progress?.reserve(previousBranch.length);
    const refreshed = await mapWithConcurrency(
      previousBranch,
      SCAN_COLLECTION_CONCURRENCY,
      (address) => scanDerivedAddress(
        address,
        electrum,
        includeHistory,
        runNetworkTask,
        control,
        progress,
        address,
      ),
    );
    addresses.push(...refreshed);

    const sorted = [...refreshed].sort((a, b) => a.index - b.index);
    const lastUsed = sorted.reduce((last, address) => (address.used ? address.index : last), -1);
    const highestScanned = sorted.at(-1)?.index ?? -1;

    if (lastUsed >= 0 && highestScanned - lastUsed >= gapLimit) {
      return sorted;
    }

    if (lastUsed === -1 && sorted.length >= gapLimit) {
      return sorted;
    }
  }

  let consecutiveEmpty = (() => {
    if (addresses.length === 0) {
      return 0;
    }

    const sorted = [...addresses].sort((a, b) => a.index - b.index);
    let count = 0;

    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const current = sorted[i];

      if (!current || current.used) {
        break;
      }

      count += 1;
    }

    return count;
  })();

  while (consecutiveEmpty < gapLimit) {
    const batchSize = Math.min(SCAN_BATCH_SIZE, gapLimit - consecutiveEmpty);
    const batchIndices = Array.from({ length: batchSize }, (_, offset) => index + offset);
    const missingIndices = batchIndices.filter((candidate) => !previousByIndex.has(candidate));
    const freshlyDerived = missingIndices.length > 0
      ? await deriveAddressBatch(mnemonic, template, branch, missingIndices, crypto)
      : [];
    const freshByIndex = new Map(freshlyDerived.map((address) => [address.index, address]));
    const derivedBatch = batchIndices.map((candidate) => {
      const derived = previousByIndex.get(candidate) ?? freshByIndex.get(candidate);
      if (!derived) {
        throw new Error(`Address derivation returned no result for index ${candidate}.`);
      }
      return derived;
    });
    progress?.reserve(derivedBatch.length);
    const scannedBatch = await settleAll(
      derivedBatch.map((derived) => scanDerivedAddress(
        derived,
        electrum,
        includeHistory,
        runNetworkTask,
        control,
        progress,
      )),
    );

    addresses.push(...scannedBatch);
    const lastUsedOffset = scannedBatch.reduce((last, address, offset) => (address.used ? offset : last), -1);
    consecutiveEmpty = lastUsedOffset === -1 ? consecutiveEmpty + scannedBatch.length : scannedBatch.length - lastUsedOffset - 1;
    index += scannedBatch.length;
  }

  return addresses.sort((a, b) => a.index - b.index);
};

export const scanTransparentWallet = async ({
  mnemonic,
  electrum,
  gapLimit = DEFAULT_GAP_LIMIT,
  includeHistory = false,
  previousSnapshot,
  crypto = nitoWalletCrypto,
  onProgress,
  maxConcurrentNetworkRequests = SCAN_NETWORK_CONCURRENCY,
}: {
  mnemonic: string;
  electrum: ElectrumReader;
  gapLimit?: number;
  includeHistory?: boolean;
  previousSnapshot?: TransparentWalletSnapshot | null;
  crypto?: NitoWalletCryptoApi;
  onProgress?: TransparentScanProgress;
  maxConcurrentNetworkRequests?: number;
}): Promise<TransparentWalletSnapshot> => {
  const control = createScanControl();
  const networkLimiter = createConcurrencyLimiter(maxConcurrentNetworkRequests);
  const runNetworkTask: NetworkTaskRunner = (task) => networkLimiter.run(() => {
    if (control.failure !== undefined) {
      return Promise.reject(control.failure);
    }
    return task();
  });
  const progress = createScanProgressTracker(onProgress);
  const scannedAccounts = await settleAll(
    ACCOUNT_TEMPLATES.flatMap((template) => [
      scanBranch(
        mnemonic,
        template,
        'external',
        electrum,
        gapLimit,
        includeHistory,
        crypto,
        runNetworkTask,
        control,
        progress,
        previousSnapshot ?? undefined,
      ),
      scanBranch(
        mnemonic,
        template,
        'internal',
        electrum,
        gapLimit,
        includeHistory,
        crypto,
        runNetworkTask,
        control,
        progress,
        previousSnapshot ?? undefined,
      ),
    ]),
  );
  const addresses = scannedAccounts.flat();
  progress?.finish(addresses.length);
  return buildSnapshot(addresses, gapLimit);
};

export const refreshKnownUsedAddresses = async ({
  snapshot,
  electrum,
  includeHistory = false,
  onlyAddresses,
  onProgress,
}: {
  snapshot: TransparentWalletSnapshot;
  electrum: ElectrumReader;
  includeHistory?: boolean;
  onlyAddresses?: readonly string[];
  onProgress?: TransparentScanProgress;
}): Promise<TransparentWalletSnapshot> => {
  const requestedAddresses = onlyAddresses ? new Set(onlyAddresses) : null;
  const targets = snapshot.addresses.filter((address) =>
    requestedAddresses
      ? requestedAddresses.has(address.address)
      : address.used || address.utxos.length > 0 || address.balance.unconfirmedSats !== 0,
  );
  const control = createScanControl();
  const networkLimiter = createConcurrencyLimiter(SCAN_NETWORK_CONCURRENCY);
  const runNetworkTask: NetworkTaskRunner = (task) => networkLimiter.run(() => {
    if (control.failure !== undefined) {
      return Promise.reject(control.failure);
    }
    return task();
  });
  const progress = createScanProgressTracker(onProgress);
  progress?.reserve(targets.length);
  const refreshed = await mapWithConcurrency(
    targets,
    SCAN_COLLECTION_CONCURRENCY,
    (address) => scanDerivedAddress(
      address,
      electrum,
      includeHistory,
      runNetworkTask,
      control,
      progress,
      address,
    ),
  );
  const refreshedByPath = new Map(refreshed.map((address) => [address.path, address]));
  const addresses = snapshot.addresses.map((address) => refreshedByPath.get(address.path) ?? address);

  progress?.finish(targets.length);
  return buildSnapshot(addresses, snapshot.gapLimit);
};

export const scanP2wpkhAccount = scanTransparentWallet;

export const satoshisToNito = (sats: number) =>
  (sats / 100_000_000).toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
