import {
  ElectrumSessionUnhealthyError,
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
import { normalizeWalletHistory } from './walletHistory';
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
): NetworkState => {
  if (!sameWallet || !current.snapshot || !incoming.snapshot) {
    return incoming;
  }

  return {
    ...incoming,
    snapshot: {
      ...incoming.snapshot,
      history: normalizeWalletHistory([
        ...current.snapshot.history,
        ...incoming.snapshot.history,
      ]),
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
  wantsFullHistory,
  cacheAlreadyFresh,
  hasSnapshot,
  heightUnchanged,
  options,
}: {
  cacheReadFailed: boolean;
  wantsFullHistory: boolean;
  cacheAlreadyFresh: boolean;
  hasSnapshot: boolean;
  heightUnchanged: boolean;
  options: WalletSyncOptions;
}): boolean => (
  !cacheReadFailed
  && !options.force
  && !options.rescanGap
  && wantsFullHistory
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
    if (!record || entry.direction !== undefined || record.blockHeight !== entry.height) {
      return entry;
    }
    return {
      ...entry,
      direction: record.direction,
      amountSats: record.amountSats,
      feeSats: record.feeSats,
      counterparty: record.counterparty,
      blockTime: record.blockTime ?? undefined,
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
  wantsFullHistory,
  options,
  onProgress,
  isCurrent,
}: {
  wallet: Wallet;
  currentNetwork: NetworkState;
  client: NitoElectrumClient;
  cacheReadFailed: boolean;
  cacheAlreadyFresh: boolean;
  wantsFullHistory: boolean;
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
        includeHistory: wantsFullHistory,
        onlyAddresses,
        onProgress,
      })
    : scanTransparentWallet({
        mnemonic: wallet.mnemonic,
        electrum: client,
        gapLimit: 20,
        includeHistory: wantsFullHistory && (
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
  fullHistoryByDefault: boolean;
  readHistoryCache: (walletAddress: string) => Promise<OptionalCacheRead<WalletHistoryCache>>;
  saveHistory: (
    walletAddress: string,
    history: TransparentWalletSnapshot['history'],
    height: number,
  ) => Promise<void>;
  saveSnapshot: (
    walletAddress: string,
    snapshot: TransparentWalletSnapshot,
    height: number,
  ) => Promise<void>;
  publishNetwork: (network: NetworkState) => void;
  setError: (message: string) => void;
  setStatus: (message: string) => void;
  setHistorySyncing: (syncing: boolean) => void;
  setHistoryProgress: (progress: { done: number; total: number } | null) => void;
  setBalanceRefreshing: (refreshing: boolean) => void;
  finishSync: () => void;
  messages: {
    noActiveWallet: string;
    networkUnavailable: string;
    walletStorageUnavailable: string;
    syncing: string;
    syncingHistory: string;
    walletSynced: string;
  };
};

export const synchronizeWalletNetwork = async (
  ports: WalletNetworkSyncPorts,
  includeHistory = false,
  options: WalletSyncOptions = {},
): Promise<void> => {
  const activeWallet = ports.getWallet();
  const currentNetwork = ports.getNetwork();
  const publishNetwork = (incoming: NetworkState) => {
    ports.publishNetwork(mergeWalletNetworkPublication(
      ports.getNetwork(),
      incoming,
    ));
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
    const wantsFullHistory = (
      ports.fullHistoryByDefault
      || includeHistory
      || cache.fullHistoryHeight > 0
    );
    if (wantsFullHistory) ports.setHistorySyncing(true);
    const cacheAlreadyFresh = (
      !cacheReadFailed
      && wantsFullHistory
      && knownHeight > 0
      && cache.fullHistoryHeight >= knownHeight
    );
    const heightUnchanged = (
      knownHeight > 0
      && currentNetwork.height >= knownHeight
      && Boolean(currentNetwork.snapshot)
    );

    if (
      !cacheReadFailed
      && !options.force
      && !options.rescanGap
      && !wantsFullHistory
      && heightUnchanged
    ) {
      requireConnectedSession();
      if (!ports.controller.isCurrent(session)) return;
      publishNetwork({
        ...currentNetwork,
        status: 'connected',
        error: '',
        serverUrl,
        height: Math.max(currentNetwork.height, knownHeight),
        fullHistoryEnabled: currentNetwork.fullHistoryEnabled || cache.fullHistoryHeight > 0,
      });
      if (!options.silent) ports.setStatus(ports.messages.walletSynced);
      return;
    }

    if (canUseFreshHistoryCache({
      cacheReadFailed,
      wantsFullHistory,
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
      if (!options.silent) ports.setStatus(ports.messages.walletSynced);
      return;
    }

    if (!ports.controller.isCurrent(session)) return;
    if (!options.silent) {
      ports.setStatus(wantsFullHistory ? ports.messages.syncingHistory : ports.messages.syncing);
      publishNetwork({
        ...ports.getNetwork(),
        status: 'syncing',
        error: '',
        serverUrl,
        height: Math.max(ports.getNetwork().height, knownHeight),
        fullHistoryEnabled: wantsFullHistory || ports.getNetwork().fullHistoryEnabled,
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
      wantsFullHistory,
      options,
      onProgress,
      isCurrent: () => ports.controller.isCurrent(session),
    });
    if (!ports.controller.isCurrent(session)) return;
    requireConnectedSession();
    const mergedHistory = normalizeWalletHistory([
      ...cache.history,
      ...(ports.getNetwork().snapshot?.history ?? []),
      ...snapshot.history,
    ]);
    if (wantsFullHistory) {
      snapshot = { ...snapshot, history: mergedHistory };
      if (!cacheAlreadyFresh || options.force || options.rescanGap) {
        requireConnectedSession();
        await ports.saveHistory(activeWallet.address, mergedHistory, knownHeight);
        if (!ports.controller.isCurrent(session)) return;
      }
    }
    if (!ports.controller.isCurrent(session)) return;
    requireConnectedSession();
    const nextNetwork: NetworkState = {
      status: 'connected',
      snapshot,
      error: '',
      serverUrl,
      height: knownHeight,
      fullHistoryEnabled: wantsFullHistory,
    };
    await ports.saveSnapshot(activeWallet.address, toQuickWalletSnapshot(snapshot), knownHeight);
    if (!ports.controller.isCurrent(session)) return;
    requireConnectedSession();
    publishNetwork(nextNetwork);
    if (!options.silent) ports.setStatus(ports.messages.walletSynced);
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
    await mapWithConcurrency(txids, BROADCAST_RECONCILIATION_CONCURRENCY, async (txid) => {
      await client.getTransactionHex(txid);
    });
    if (!isCurrent()) return false;
    return true;
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
