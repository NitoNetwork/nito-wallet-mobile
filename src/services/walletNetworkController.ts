import {
  ElectrumSessionUnhealthyError,
  isElectrumTransactionNotFoundError,
  type NitoElectrumClient,
} from '../network/electrum';
import type { NetworkState, Wallet } from '../ui/types';
import {
  refreshKnownUsedAddresses,
  scanTransparentWallet,
  TransparentScanIncompleteError,
  type TransparentWalletSnapshot,
} from '../wallet/transparentScan';
import { pendingRefreshAddresses } from '../wallet/pendingRefresh';
import {
  buildHistoryExportBatch,
  type CachedTransactionOutput,
  type HistoryExportRecord,
} from './historyExport';
import type { OptionalCacheRead } from './cachePolicy';
import { mapWithConcurrency } from './concurrency';
import { createElectrumClient } from './electrumClientFactory';
import {
  DirtyRequestQueue,
  DirtySyncQueue,
  type DirtySyncOptions,
} from './syncDirtyQueue';
import {
  mergeWalletHistoryPublication,
  needsHistoryEnrichment,
  normalizeWalletHistory,
  type WalletHistoryPublicationMode,
} from './walletHistory';
import {
  WalletSessionGuard,
  type WalletSessionToken,
} from './walletSession';
import type {
  WalletHistoryCache,
  WalletSnapshotCache,
} from './walletHistoryDb';
import { userFacingErrorMessage } from './walletStorageError';

const COINBASE_MATURITY = 101;
const BROADCAST_RECONCILIATION_CONCURRENCY = 6;

export type WalletSyncOptions = DirtySyncOptions;
export type WalletNetworkHistoryPublicationMode = WalletHistoryPublicationMode | 'replace';

export const createEmptyNetworkState = (): NetworkState => ({
  status: 'idle',
  snapshot: null,
  error: '',
  serverUrl: '',
  height: 0,
  fullHistoryEnabled: false,
});

export const mergeWalletNetworkPublication = (
  current: NetworkState,
  incoming: NetworkState,
  sameWallet = true,
  historyMode: WalletNetworkHistoryPublicationMode = 'partial',
): NetworkState => {
  if (!sameWallet || !current.snapshot || !incoming.snapshot) {
    return incoming;
  }

  return {
    ...incoming,
    snapshot: {
      ...incoming.snapshot,
      history: historyMode === 'replace'
        ? normalizeWalletHistory([...incoming.snapshot.history])
        : mergeWalletHistoryPublication(
            current.snapshot.history,
            incoming.snapshot.history,
            historyMode,
          ),
    },
  };
};

export const toQuickWalletSnapshot = (
  snapshot: TransparentWalletSnapshot,
): TransparentWalletSnapshot => {
  const spendableUtxos = snapshot.utxos.filter((utxo) => (
    utxo.confirmations >= COINBASE_MATURITY
    || (utxo.confirmations > 0 && utxo.isCoinbase === false)
  ));
  const currentUtxoTxids = new Set(spendableUtxos.map((utxo) => utxo.txid));
  const immatureCoinbaseUtxos = snapshot.utxos.filter((utxo) => (
    utxo.isCoinbase === true
    && utxo.confirmations > 0
    && utxo.confirmations < COINBASE_MATURITY
  ));
  const keepCurrentUtxoHistory = (history: TransparentWalletSnapshot['history']) =>
    normalizeWalletHistory(history.filter((entry) => currentUtxoTxids.has(entry.txid)));
  const stripAddressHistory = (address: TransparentWalletSnapshot['addresses'][number]) => ({
    ...address,
    history: keepCurrentUtxoHistory(address.history),
  });

  return {
    ...snapshot,
    spendableSats: spendableUtxos.reduce((total, utxo) => total + utxo.valueSats, 0),
    immatureCoinbaseSats: immatureCoinbaseUtxos.reduce((total, utxo) => total + utxo.valueSats, 0),
    immatureCoinbaseBlocksRemaining: immatureCoinbaseUtxos.length === 0
      ? 0
      : Math.min(...immatureCoinbaseUtxos.map((utxo) => COINBASE_MATURITY - utxo.confirmations)),
    history: keepCurrentUtxoHistory(snapshot.history),
    addresses: snapshot.addresses.map(stripAddressHistory),
    usedAddresses: snapshot.usedAddresses.map(stripAddressHistory),
    spendableAddresses: snapshot.spendableAddresses.map(stripAddressHistory),
  };
};

export const prepareWalletEntry = ({
  pendingNetwork,
  wallet,
  cachedNetwork,
  cachedHistory,
}: {
  pendingNetwork: ({ address: string } & WalletSnapshotCache) | null;
  wallet: Wallet;
  cachedNetwork?: WalletSnapshotCache | null;
  cachedHistory?: WalletHistoryCache | null;
}) => {
  const pendingPreload = pendingNetwork?.address === wallet.address ? pendingNetwork : null;
  const fullHistoryEnabled = (cachedHistory?.fullHistoryHeight ?? 0) > 0;
  const quickCachedSnapshot = cachedNetwork
    ? toQuickWalletSnapshot(cachedNetwork.snapshot)
    : null;
  const cachedQuickNetwork = cachedNetwork && quickCachedSnapshot
    ? {
        ...cachedNetwork,
        snapshot: fullHistoryEnabled
          ? {
              ...quickCachedSnapshot,
              history: normalizeWalletHistory([
                ...(cachedHistory?.history ?? []),
                ...quickCachedSnapshot.history,
              ]),
            }
          : quickCachedSnapshot,
      }
    : null;
  const preloaded = pendingPreload
    ? { ...pendingPreload, snapshot: toQuickWalletSnapshot(pendingPreload.snapshot) }
    : cachedQuickNetwork;

  return {
    pendingPreload,
    usedPreload: Boolean(preloaded),
    network: preloaded ? {
      status: 'syncing',
      snapshot: preloaded.snapshot,
      error: '',
      serverUrl: '',
      height: preloaded.height,
      fullHistoryEnabled,
    } satisfies NetworkState : { ...createEmptyNetworkState(), status: 'syncing' as const },
  };
};

export const canUseFreshHistoryCache = ({
  cacheReadFailed,
  cacheAlreadyFresh,
  hasSnapshot,
  heightUnchanged,
  options,
}: {
  cacheReadFailed: boolean;
  cacheAlreadyFresh: boolean;
  hasSnapshot: boolean;
  heightUnchanged: boolean;
  options: WalletSyncOptions;
}): boolean => (
  !cacheReadFailed
  && !options.force
  && !options.rescanGap
  && cacheAlreadyFresh
  && hasSnapshot
  && heightUnchanged
);

export const prefetchWalletSnapshot = async (
  wallet: Wallet,
  client: NitoElectrumClient,
): Promise<WalletSnapshotCache> => {
  await client.connect();
  const snapshot = await scanTransparentWallet({
    mnemonic: wallet.mnemonic,
    electrum: client,
    gapLimit: 20,
    includeHistory: false,
  });
  if (!client.connected) {
    throw new ElectrumSessionUnhealthyError(
      new Error('ElectrumX connection closed before scan completion.'),
    );
  }
  return { snapshot, height: client.blockHeight };
};

export const enrichHistorySnapshot = async ({
  snapshot,
  pending,
  client,
  loadCachedOutputs,
  onCacheReadError,
  onProgress,
}: {
  snapshot: TransparentWalletSnapshot;
  pending: TransparentWalletSnapshot['history'];
  client: NitoElectrumClient;
  loadCachedOutputs?: (
    txids: readonly string[],
  ) => Promise<readonly CachedTransactionOutput[]>;
  onCacheReadError?: (caught: unknown) => void;
  onProgress: (done: number, total: number) => void;
}): Promise<{
  snapshot: TransparentWalletSnapshot;
  records: HistoryExportRecord[];
  outputs: CachedTransactionOutput[];
}> => {
  await client.connect();
  const { records, outputs } = await buildHistoryExportBatch({
    history: pending,
    walletAddresses: snapshot.addresses.map((address) => address.address),
    reader: client,
    loadCachedOutputs,
    onCacheReadError,
    onProgress,
  });
  if (!client.connected) {
    throw new ElectrumSessionUnhealthyError(
      new Error('ElectrumX connection closed before history enrichment completed.'),
    );
  }
  return { records, outputs, snapshot: mergeHistoryEnrichment(snapshot, records) };
};

export const mergeHistoryEnrichment = (
  snapshot: TransparentWalletSnapshot,
  records: readonly HistoryExportRecord[],
): TransparentWalletSnapshot => {
  const byTxid = new Map(records.map((record) => [record.txid, record]));
  const history = snapshot.history.map((entry) => {
    const record = byTxid.get(entry.txid);
    if (!record || !needsHistoryEnrichment(entry) || record.blockHeight !== entry.height) {
      return entry;
    }
    // Enrichment at the entry's own height is authoritative: it clears the
    // provisional mark carried over from a mempool sighting.
    return {
      ...entry,
      direction: record.direction,
      amountSats: record.amountSats,
      feeSats: record.feeSats,
      counterparty: record.counterparty,
      blockTime: record.blockTime ?? undefined,
      provisional: record.blockHeight > 0 ? undefined : entry.provisional,
    };
  });
  return { ...snapshot, history };
};

export const scanWalletNetwork = async ({
  wallet,
  currentNetwork,
  client,
  cacheReadFailed,
  cacheAlreadyFresh,
  options,
  onProgress,
  isCurrent,
}: {
  wallet: Wallet;
  currentNetwork: NetworkState;
  client: NitoElectrumClient;
  cacheReadFailed: boolean;
  cacheAlreadyFresh: boolean;
  options: WalletSyncOptions;
  onProgress: (done: number, total: number) => void;
  isCurrent: () => boolean;
}): Promise<TransparentWalletSnapshot> => {
  const onlyAddresses = options.pendingOnly && currentNetwork.snapshot
    ? [...new Set([
        ...(options.onlyAddresses ?? []),
        ...pendingRefreshAddresses(currentNetwork.snapshot),
      ])]
    : options.onlyAddresses;
  const scan = () => currentNetwork.snapshot && !options.rescanGap && !cacheReadFailed
    ? refreshKnownUsedAddresses({
        snapshot: currentNetwork.snapshot,
        electrum: client,
        includeHistory: true,
        onlyAddresses,
        onProgress,
      })
    : scanTransparentWallet({
        mnemonic: wallet.mnemonic,
        electrum: client,
        gapLimit: 20,
        includeHistory: (
          !cacheAlreadyFresh || Boolean(options.force) || Boolean(options.rescanGap)
        ),
        previousSnapshot: currentNetwork.snapshot,
        onProgress,
      });

  try {
    return await scan();
  } catch (caught) {
    if (!(caught instanceof ElectrumSessionUnhealthyError)) throw caught;
    await client.connect();
    if (!isCurrent()) throw caught;
    return scan();
  }
};

type WalletNetworkSyncPorts = {
  controller: WalletNetworkController;
  getWallet: () => Wallet | null;
  getNetwork: () => NetworkState;
  getClient: () => NitoElectrumClient | null;
  setClient: (client: NitoElectrumClient) => void;
  actionPending: () => boolean;
  readHistoryCache: (walletAddress: string) => Promise<OptionalCacheRead<WalletHistoryCache>>;
  saveHistory: (
    walletAddress: string,
    history: TransparentWalletSnapshot['history'],
    height: number,
    historyMode: WalletHistoryPublicationMode,
  ) => Promise<void>;
  saveSnapshot: (
    walletAddress: string,
    snapshot: TransparentWalletSnapshot,
    height: number,
  ) => Promise<void>;
  publishNetwork: (
    network: NetworkState,
    historyMode?: WalletHistoryPublicationMode,
  ) => void;
  setError: (message: string) => void;
  setHistorySyncing: (syncing: boolean) => void;
  setHistoryProgress: (progress: { done: number; total: number } | null) => void;
  setBalanceRefreshing: (refreshing: boolean) => void;
  finishSync: () => void;
  messages: {
    noActiveWallet: string;
    networkUnavailable: string;
    walletStorageUnavailable: string;
  };
};

export const synchronizeWalletNetwork = async (
  ports: WalletNetworkSyncPorts,
  includeHistory = false,
  options: WalletSyncOptions = {},
): Promise<void> => {
  const activeWallet = ports.getWallet();
  const currentNetwork = ports.getNetwork();
  const publishNetwork = (
    incoming: NetworkState,
    historyMode: WalletHistoryPublicationMode = 'partial',
  ) => {
    const merged = mergeWalletNetworkPublication(
      ports.getNetwork(),
      incoming,
      true,
      historyMode,
    );
    if (historyMode === 'authoritative') {
      ports.publishNetwork(merged, historyMode);
    } else {
      ports.publishNetwork(merged);
    }
  };
  if (!activeWallet) {
    ports.setError(ports.messages.noActiveWallet);
    return;
  }
  const session = ports.controller.sessions.capture(activeWallet.address);
  if (!session) return;
  if ((ports.actionPending() && !options.force) || !ports.controller.startSync()) return;
  if (!includeHistory) ports.setBalanceRefreshing(true);

  try {
    const client = ports.getClient() ?? createElectrumClient();
    ports.setClient(client);
    await client.connect();
    const serverUrl = client.currentServerUrl;
    const requireConnectedSession = () => {
      if (!client.connected) {
        throw new ElectrumSessionUnhealthyError(
          new Error('ElectrumX connection closed before synchronization completed.'),
        );
      }
    };
    if (!ports.controller.isCurrent(session)) return;
    const knownHeight = client.blockHeight || currentNetwork.height;
    const cacheRead = await ports.readHistoryCache(activeWallet.address);
    const cacheReadFailed = cacheRead.status === 'failed';
    const cache = cacheRead.status === 'hit'
      ? cacheRead.value
      : { history: [], fullHistoryHeight: 0 };
    if (!ports.controller.isCurrent(session)) return;
    if (ports.getNetwork().serverUrl !== serverUrl) {
      publishNetwork({
        ...ports.getNetwork(),
        serverUrl,
      });
    }
    // Complete history is a product invariant: every successful wallet sync
    // refreshes or reuses an authoritative history instead of opting out.
    ports.setHistorySyncing(true);
    const cacheAlreadyFresh = (
      !cacheReadFailed
      && knownHeight > 0
      && cache.fullHistoryHeight === knownHeight
    );
    const heightUnchanged = (
      knownHeight > 0
      && currentNetwork.height === knownHeight
      && Boolean(currentNetwork.snapshot)
    );

    if (canUseFreshHistoryCache({
      cacheReadFailed,
      cacheAlreadyFresh,
      hasSnapshot: Boolean(currentNetwork.snapshot),
      heightUnchanged,
      options,
    }) && currentNetwork.snapshot) {
      requireConnectedSession();
      if (!ports.controller.isCurrent(session)) return;
      const snapshot = {
        ...currentNetwork.snapshot,
        history: normalizeWalletHistory([...cache.history, ...currentNetwork.snapshot.history]),
      };
      const nextNetwork: NetworkState = {
        ...currentNetwork,
        status: 'connected',
        snapshot,
        error: '',
        serverUrl,
        height: knownHeight,
        fullHistoryEnabled: true,
      };
      await ports.saveSnapshot(activeWallet.address, toQuickWalletSnapshot(snapshot), knownHeight);
      if (!ports.controller.isCurrent(session)) return;
      requireConnectedSession();
      publishNetwork(nextNetwork);
      return;
    }

    if (!ports.controller.isCurrent(session)) return;
    if (!options.silent) {
      publishNetwork({
        ...ports.getNetwork(),
        status: 'syncing',
        error: '',
        serverUrl,
        height: Math.max(ports.getNetwork().height, knownHeight),
        fullHistoryEnabled: true,
      });
    }
    const onProgress = (done: number, total: number) => {
      if (ports.controller.isCurrent(session)) {
        ports.setHistoryProgress({ done, total });
      }
    };
    let snapshot = await scanWalletNetwork({
      wallet: activeWallet,
      currentNetwork,
      client,
      cacheReadFailed,
      cacheAlreadyFresh,
      options,
      onProgress,
      isCurrent: () => ports.controller.isCurrent(session),
    });
    if (!ports.controller.isCurrent(session)) return;
    requireConnectedSession();
    const historyMode: WalletHistoryPublicationMode = (
      !options.pendingOnly
      && options.onlyAddresses === undefined
    ) ? 'authoritative' : 'partial';
    const previousHistory = normalizeWalletHistory([
      ...cache.history,
      ...(ports.getNetwork().snapshot?.history ?? []),
    ]);
    const mergedHistory = mergeWalletHistoryPublication(
      previousHistory,
      snapshot.history,
      historyMode,
    );
    snapshot = { ...snapshot, history: mergedHistory };
    if (!cacheAlreadyFresh || options.force || options.rescanGap) {
      requireConnectedSession();
      await ports.saveHistory(
        activeWallet.address,
        mergedHistory,
        historyMode === 'authoritative' ? knownHeight : cache.fullHistoryHeight,
        historyMode,
      );
      if (!ports.controller.isCurrent(session)) return;
    }
    if (!ports.controller.isCurrent(session)) return;
    requireConnectedSession();
    const nextNetwork: NetworkState = {
      status: 'connected',
      snapshot,
      error: '',
      serverUrl,
      height: knownHeight,
      fullHistoryEnabled: true,
    };
    await ports.saveSnapshot(activeWallet.address, toQuickWalletSnapshot(snapshot), knownHeight);
    if (!ports.controller.isCurrent(session)) return;
    requireConnectedSession();
    publishNetwork(nextNetwork, historyMode);
  } catch (caught) {
    if (!ports.controller.isCurrent(session)) return;
    const fallbackNetwork = ports.getNetwork();
    const client = ports.getClient();
    if (caught instanceof TransparentScanIncompleteError && client?.connected) {
      client.disconnect(new ElectrumSessionUnhealthyError(caught));
    }
    const message = userFacingErrorMessage(
      caught,
      ports.messages.networkUnavailable,
      ports.messages.walletStorageUnavailable,
    );
    publishNetwork({
      status: 'error',
      snapshot: fallbackNetwork.snapshot,
      error: message,
      serverUrl: client?.currentServerUrl ?? fallbackNetwork.serverUrl,
      height: client?.blockHeight || fallbackNetwork.height || 0,
      fullHistoryEnabled: fallbackNetwork.fullHistoryEnabled,
    });
    ports.setError(message);
  } finally {
    if (ports.controller.isCurrent(session)) {
      ports.setHistorySyncing(false);
      ports.setHistoryProgress(null);
      if (!includeHistory) ports.setBalanceRefreshing(false);
      ports.finishSync();
    }
  }
};

export const reconcileBroadcastTransactions = async ({
  txids,
  client,
  isCurrent,
}: {
  txids: readonly string[];
  client: NitoElectrumClient;
  isCurrent: () => boolean;
}): Promise<boolean> => {
  if (txids.length === 0 || !isCurrent()) return false;
  for (const delayMs of [250, 750, 1_500, 3_000]) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    if (!isCurrent()) return false;
    try {
      await mapWithConcurrency(txids, BROADCAST_RECONCILIATION_CONCURRENCY, async (txid) => {
        await client.getTransactionHex(txid);
      });
      if (!isCurrent()) return false;
      return true;
    } catch (caught) {
      if (!isElectrumTransactionNotFoundError(caught)) {
        throw caught;
      }
      if (!isCurrent()) return false;
    }
  }
  return false;
};

export class WalletNetworkController {
  readonly sessions = new WalletSessionGuard();
  private readonly dirty = new DirtySyncQueue();
  private readonly dirtyEnrichment = new DirtyRequestQueue();
  private prefetchGeneration = 0;
  private syncing = false;
  private enriching = false;

  beginWalletSession(walletAddress: string): WalletSessionToken {
    this.prefetchGeneration += 1;
    this.syncing = false;
    this.enriching = false;
    this.dirty.clear();
    this.dirtyEnrichment.clear();
    return this.sessions.begin(walletAddress);
  }

  cancel(): void {
    this.prefetchGeneration += 1;
    this.syncing = false;
    this.enriching = false;
    this.dirty.clear();
    this.dirtyEnrichment.clear();
    this.sessions.invalidate();
  }

  isCurrent(session: WalletSessionToken | null): session is WalletSessionToken {
    return this.sessions.isCurrent(session);
  }

  beginPrefetch(): number {
    this.prefetchGeneration += 1;
    return this.prefetchGeneration;
  }

  isCurrentPrefetch(generation: number): boolean {
    return generation === this.prefetchGeneration;
  }

  get syncInFlight(): boolean {
    return this.syncing;
  }

  get enrichmentInFlight(): boolean {
    return this.enriching;
  }

  startSync(): boolean {
    if (this.syncing) return false;
    this.syncing = true;
    return true;
  }

  startEnrichment(): boolean {
    if (this.enriching) return false;
    this.enriching = true;
    return true;
  }

  requestOrQueueEnrichment(requestEnrichment: () => void): void {
    this.dirtyEnrichment.request(
      this.enriching,
      requestEnrichment,
    );
  }

  finishEnrichment(requestEnrichment: () => void): boolean {
    this.enriching = false;
    return this.dirtyEnrichment.flush(false, requestEnrichment);
  }

  requestOrQueueSync(
    options: WalletSyncOptions,
    requestSync: (next: WalletSyncOptions) => void,
  ): void {
    this.dirty.request(options, this.syncing, requestSync);
  }

  finishSync(requestSync: (next: WalletSyncOptions) => void): boolean {
    this.syncing = false;
    return this.dirty.flush(false, requestSync);
  }

  clearPendingSync(): void {
    this.dirty.clear();
  }
}
