import type { ElectrumBalance, ElectrumHistoryEntry, ElectrumUtxo } from '../network/electrum';
import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
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


const hydrateLegacyUtxos = async (utxos: ElectrumUtxo[], electrum: ElectrumReader) => {
  if (!electrum.getTransactionHex || utxos.length === 0) {
    return utxos;
  }

  return Promise.all(
    utxos.map(async (utxo) => ({
      ...utxo,
      rawTx: await electrum.getTransactionHex?.(utxo.txid).catch(() => undefined),
    })),
  );
};

const scanDerivedAddress = async (
  derived: DerivedAddress,
  electrum: ElectrumReader,
  includeHistory: boolean,
  previousAddress?: ScannedAddress,
): Promise<ScannedAddress> => {
  const addressHistory = await electrum.getAddressHistory(derived.address).catch(() => [] as ElectrumHistoryEntry[]);
  const used = addressHistory.length > 0;

  if (!used) {
    return {
      ...derived,
      balance: { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 },
      utxos: [],
      history: [],
      used: false,
    };
  }

  const baseUtxos = await electrum.getAddressUtxos(derived.address).catch(() => [] as ElectrumUtxo[]);
  const hydratedUtxos = derived.scriptType === 'p2pkh' ? await hydrateLegacyUtxos(baseUtxos, electrum) : baseUtxos;
  const utxos = await annotateCoinbaseMaturity(
    hydratedUtxos,
    previousAddress?.utxos ?? [],
    async (txid) => {
      const cached = hydratedUtxos.find((utxo) => utxo.txid === txid)?.rawTx;
      if (cached) return cached;
      if (!electrum.getTransactionHex) throw new Error('Transaction lookup unavailable.');
      return electrum.getTransactionHex(txid);
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
  return { ...derived, balance, utxos, history, used };
};

const scanBranch = async (
  mnemonic: string,
  template: AccountTemplate,
  branch: HdBranch,
  electrum: ElectrumReader,
  gapLimit: number,
  includeHistory: boolean,
  crypto: NitoWalletCryptoApi,
  previousSnapshot?: TransparentWalletSnapshot,
) => {
  const addresses: ScannedAddress[] = [];
  const previousBranch = previousSnapshot?.addresses
    .filter((address) => address.accountKey === template.key && address.branch === branch)
    .sort((a, b) => a.index - b.index) ?? [];
  const previousByIndex = new Map(previousBranch.map((address) => [address.index, address]));

  let index = previousBranch.length > 0 ? Math.max(...previousBranch.map((address) => address.index)) + 1 : 0;

  if (previousBranch.length > 0) {
    const refreshed = await Promise.all(previousBranch.map((address) => scanDerivedAddress(address, electrum, includeHistory, address)));
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
    const scannedBatch = await Promise.all(derivedBatch.map((derived) => scanDerivedAddress(derived, electrum, includeHistory)));

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
}: {
  mnemonic: string;
  electrum: ElectrumReader;
  gapLimit?: number;
  includeHistory?: boolean;
  previousSnapshot?: TransparentWalletSnapshot | null;
  crypto?: NitoWalletCryptoApi;
}): Promise<TransparentWalletSnapshot> => {
  const scannedAccounts = await Promise.all(
    ACCOUNT_TEMPLATES.flatMap((template) => [
      scanBranch(mnemonic, template, 'external', electrum, gapLimit, includeHistory, crypto, previousSnapshot ?? undefined),
      scanBranch(mnemonic, template, 'internal', electrum, gapLimit, includeHistory, crypto, previousSnapshot ?? undefined),
    ]),
  );
  const addresses = scannedAccounts.flat();
  return buildSnapshot(addresses, gapLimit);
};

export const refreshKnownUsedAddresses = async ({
  snapshot,
  electrum,
  includeHistory = false,
  onlyAddresses,
}: {
  snapshot: TransparentWalletSnapshot;
  electrum: ElectrumReader;
  includeHistory?: boolean;
  onlyAddresses?: readonly string[];
}): Promise<TransparentWalletSnapshot> => {
  const requestedAddresses = onlyAddresses ? new Set(onlyAddresses) : null;
  const targets = snapshot.addresses.filter((address) =>
    requestedAddresses
      ? requestedAddresses.has(address.address)
      : address.used || address.utxos.length > 0 || address.balance.unconfirmedSats !== 0,
  );
  const refreshed = await Promise.all(
    targets.map((address) => scanDerivedAddress(address, electrum, includeHistory, address)),
  );
  const refreshedByPath = new Map(refreshed.map((address) => [address.path, address]));
  const addresses = snapshot.addresses.map((address) => refreshedByPath.get(address.path) ?? address);

  return buildSnapshot(addresses, snapshot.gapLimit);
};

export const scanP2wpkhAccount = scanTransparentWallet;

export const satoshisToNito = (sats: number) =>
  (sats / 100_000_000).toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
