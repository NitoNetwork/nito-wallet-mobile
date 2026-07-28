import { describe, expect, it, vi } from 'vitest';

import type { NitoElectrumClient } from '../network/electrum';
import type { NetworkState, Wallet } from '../ui/types';
import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
import {
  WalletNetworkController,
  canUseFreshHistoryCache,
  mergeHistoryEnrichment,
  mergeWalletNetworkPublication,
  synchronizeWalletNetwork,
} from './walletNetworkController';
import { WalletStorageError } from './walletStorageError';

const transparentScanMocks = vi.hoisted(() => ({
  refreshKnownUsedAddresses: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('../wallet/transparentScan', async (importOriginal) => {
  const original = await importOriginal<typeof import('../wallet/transparentScan')>();
  return {
    ...original,
    refreshKnownUsedAddresses: transparentScanMocks.refreshKnownUsedAddresses,
  };
});

const wallet: Wallet = {
  mnemonic: 'test mnemonic',
  address: 'wallet-a',
  derivationPath: "m/84'/0'/0'/0/0",
};
const snapshot: TransparentWalletSnapshot = {
  confirmedSats: 0,
  unconfirmedSats: 0,
  balanceSats: 0,
  spendableSats: 0,
  utxos: [],
  history: [],
  addresses: [],
  usedAddresses: [],
  spendableAddresses: [],
  gapLimit: 20,
  scannedAt: '2026-07-26T00:00:00.000Z',
};
const network: NetworkState = {
  status: 'syncing',
  snapshot,
  error: '',
  serverUrl: '',
  height: 100,
  fullHistoryEnabled: true,
};
const messages = {
  noActiveWallet: 'no wallet',
  networkUnavailable: 'network unavailable',
  walletStorageUnavailable: 'localized storage unavailable',
  syncing: 'syncing',
  syncingHistory: 'syncing history',
  walletSynced: 'synced',
};
const client = {
  connected: true,
  blockHeight: 100,
  currentServerUrl: 'wss://electrum.nito.network:50004',
  connect: vi.fn(async () => undefined),
} as unknown as NitoElectrumClient;

describe('WalletNetworkController', () => {
  it('cancels stale sessions, prefetches and deferred synchronization together', () => {
    const controller = new WalletNetworkController();
    const session = controller.beginWalletSession('wallet-a');
    const prefetch = controller.beginPrefetch();
    const requestSync = vi.fn();
    const requestEnrichment = vi.fn();

    controller.startSync();
    controller.startEnrichment();
    controller.requestOrQueueSync({ force: true, silent: true }, requestSync);
    controller.requestOrQueueEnrichment(requestEnrichment);
    controller.cancel();

    expect(controller.isCurrent(session)).toBe(false);
    expect(controller.isCurrentPrefetch(prefetch)).toBe(false);
    expect(controller.finishSync(requestSync)).toBe(false);
    expect(controller.finishEnrichment(requestEnrichment)).toBe(false);
    expect(requestSync).not.toHaveBeenCalled();
    expect(requestEnrichment).not.toHaveBeenCalled();
  });

  it('guarantees a trailing synchronization for a current session', () => {
    const controller = new WalletNetworkController();
    const requestSync = vi.fn();

    controller.beginWalletSession('wallet-a');
    controller.startSync();
    controller.requestOrQueueSync({ force: true, rescanGap: true }, requestSync);

    expect(controller.finishSync(requestSync)).toBe(true);
    expect(requestSync).toHaveBeenCalledWith({ force: true, rescanGap: true });
  });

  it('replays one enrichment request received while enrichment is active', () => {
    const controller = new WalletNetworkController();
    const requestEnrichment = vi.fn();

    controller.beginWalletSession('wallet-a');
    controller.startEnrichment();
    controller.requestOrQueueEnrichment(requestEnrichment);
    controller.requestOrQueueEnrichment(requestEnrichment);

    expect(requestEnrichment).not.toHaveBeenCalled();
    expect(controller.finishEnrichment(requestEnrichment)).toBe(true);
    expect(requestEnrichment).toHaveBeenCalledTimes(1);
    expect(controller.finishEnrichment(requestEnrichment)).toBe(false);
  });

  it('does not write or publish after the active wallet changes during a cache read', async () => {
    const controller = new WalletNetworkController();
    controller.beginWalletSession(wallet.address);
    const saveHistory = vi.fn();
    const saveSnapshot = vi.fn();
    const publishNetwork = vi.fn();
    const finishSync = vi.fn();

    await synchronizeWalletNetwork({
      controller,
      getWallet: () => wallet,
      getNetwork: () => network,
      getClient: () => client,
      setClient: vi.fn(),
      actionPending: () => false,
      fullHistoryByDefault: true,
      readHistoryCache: async () => {
        controller.beginWalletSession('wallet-b');
        return { status: 'hit', value: { history: [], fullHistoryHeight: 100 } };
      },
      saveHistory,
      saveSnapshot,
      publishNetwork,
      setError: vi.fn(),
      setStatus: vi.fn(),
      setHistorySyncing: vi.fn(),
      setHistoryProgress: vi.fn(),
      setBalanceRefreshing: vi.fn(),
      finishSync,
      messages,
    });

    expect(saveHistory).not.toHaveBeenCalled();
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(publishNetwork).not.toHaveBeenCalled();
    expect(finishSync).not.toHaveBeenCalled();
  });

  it('publishes a complete fresh-cache snapshot for the current session', async () => {
    const controller = new WalletNetworkController();
    controller.beginWalletSession(wallet.address);
    const publishNetwork = vi.fn();
    const settlement: string[] = [];
    const finishSync = vi.fn(() => {
      settlement.push('finish');
      controller.finishSync(vi.fn());
    });

    await synchronizeWalletNetwork({
      controller,
      getWallet: () => wallet,
      getNetwork: () => network,
      getClient: () => client,
      setClient: vi.fn(),
      actionPending: () => false,
      fullHistoryByDefault: true,
      readHistoryCache: async () => ({
        status: 'hit',
        value: { history: [], fullHistoryHeight: 100 },
      }),
      saveHistory: vi.fn(),
      saveSnapshot: vi.fn(async () => undefined),
      publishNetwork,
      setError: vi.fn(),
      setStatus: vi.fn(),
      setHistorySyncing: (value) => {
        if (!value) settlement.push('history-idle');
      },
      setHistoryProgress: (value) => {
        if (value === null) settlement.push('progress-clear');
      },
      setBalanceRefreshing: (value) => {
        if (!value) settlement.push('balance-idle');
      },
      finishSync,
      messages,
    });

    expect(publishNetwork).toHaveBeenCalledWith(expect.objectContaining({
      status: 'connected',
      snapshot,
      serverUrl: 'wss://electrum.nito.network:50004',
      height: 100,
    }));
    expect(finishSync).toHaveBeenCalledOnce();
    expect(controller.syncInFlight).toBe(false);
    expect(settlement).toEqual([
      'history-idle',
      'progress-clear',
      'balance-idle',
      'finish',
    ]);
  });

  it('preserves cached wallet data when a saved custom server is unreachable', async () => {
    const controller = new WalletNetworkController();
    controller.beginWalletSession(wallet.address);
    let currentNetwork = network;
    const publishNetwork = vi.fn((next: NetworkState) => {
      currentNetwork = next;
    });
    const customUrl = 'wss://offline.example.org:50005';
    const offlineClient = {
      connected: false,
      blockHeight: 0,
      currentServerUrl: customUrl,
      connect: vi.fn(async () => {
        throw new Error(`ElectrumX server unavailable: ${customUrl}`);
      }),
    } as unknown as NitoElectrumClient;

    await synchronizeWalletNetwork({
      controller,
      getWallet: () => wallet,
      getNetwork: () => currentNetwork,
      getClient: () => offlineClient,
      setClient: vi.fn(),
      actionPending: () => false,
      fullHistoryByDefault: true,
      readHistoryCache: vi.fn(),
      saveHistory: vi.fn(),
      saveSnapshot: vi.fn(),
      publishNetwork,
      setError: vi.fn(),
      setStatus: vi.fn(),
      setHistorySyncing: vi.fn(),
      setHistoryProgress: vi.fn(),
      setBalanceRefreshing: vi.fn(),
      finishSync: () => controller.finishSync(vi.fn()),
      messages,
    });

    expect(currentNetwork).toMatchObject({
      status: 'error',
      snapshot,
      serverUrl: customUrl,
    });
    expect(currentNetwork.error).toContain(customUrl);
  });

  it('never exposes a raw SQLite driver error during synchronization', async () => {
    const controller = new WalletNetworkController();
    controller.beginWalletSession(wallet.address);
    const setError = vi.fn();
    const publishNetwork = vi.fn();

    await synchronizeWalletNetwork({
      controller,
      getWallet: () => wallet,
      getNetwork: () => network,
      getClient: () => client,
      setClient: vi.fn(),
      actionPending: () => false,
      fullHistoryByDefault: true,
      readHistoryCache: async () => ({
        status: 'hit',
        value: { history: [], fullHistoryHeight: 100 },
      }),
      saveHistory: vi.fn(),
      saveSnapshot: vi.fn(async () => {
        throw new WalletStorageError();
      }),
      publishNetwork,
      setError,
      setStatus: vi.fn(),
      setHistorySyncing: vi.fn(),
      setHistoryProgress: vi.fn(),
      setBalanceRefreshing: vi.fn(),
      finishSync: () => controller.finishSync(vi.fn()),
      messages,
    });

    expect(setError).toHaveBeenCalledWith(messages.walletStorageUnavailable);
    expect(publishNetwork).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'error',
      error: messages.walletStorageUnavailable,
    }));
    expect(setError).not.toHaveBeenCalledWith(expect.stringContaining('transaction within'));
  });

  it('preserves enrichment published while a synchronization scan is in flight', async () => {
    const controller = new WalletNetworkController();
    controller.beginWalletSession(wallet.address);
    const txid = 'a'.repeat(64);
    const rawEntry = { txid, height: 100, address: wallet.address };
    const enrichedEntry = {
      ...rawEntry,
      direction: 'received' as const,
      amountSats: 123_456_789,
      feeSats: 1_234,
      counterparty: 'sender-address',
      blockTime: 1_753_000_000,
    };
    const scanSnapshot = { ...snapshot, history: [rawEntry] };
    let currentNetwork: NetworkState = {
      ...network,
      snapshot: scanSnapshot,
    };
    let releaseScan: () => void = () => undefined;
    let markScanStarted: () => void = () => undefined;
    const scanStarted = new Promise<void>((resolve) => {
      markScanStarted = resolve;
    });
    const scanReleased = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    transparentScanMocks.refreshKnownUsedAddresses.mockImplementationOnce(async () => {
      markScanStarted();
      await scanReleased;
      return scanSnapshot;
    });

    const synchronization = synchronizeWalletNetwork({
      controller,
      getWallet: () => wallet,
      getNetwork: () => currentNetwork,
      getClient: () => client,
      setClient: vi.fn(),
      actionPending: () => false,
      fullHistoryByDefault: true,
      readHistoryCache: async () => ({
        status: 'hit',
        value: { history: [rawEntry], fullHistoryHeight: 0 },
      }),
      saveHistory: vi.fn(),
      saveSnapshot: vi.fn(),
      publishNetwork: (next) => {
        currentNetwork = next;
      },
      setError: vi.fn(),
      setStatus: vi.fn(),
      setHistorySyncing: vi.fn(),
      setHistoryProgress: vi.fn(),
      setBalanceRefreshing: vi.fn(),
      finishSync: () => controller.finishSync(vi.fn()),
      messages,
    }, true, { force: true });

    await scanStarted;
    currentNetwork = {
      ...currentNetwork,
      snapshot: { ...scanSnapshot, history: [enrichedEntry] },
    };
    releaseScan();
    await synchronization;

    expect(currentNetwork.snapshot?.history).toEqual([
      expect.objectContaining({
        txid,
        direction: 'received',
        amountSats: 123_456_789,
        feeSats: 1_234,
        counterparty: 'sender-address',
        blockTime: 1_753_000_000,
      }),
    ]);
  });
});

describe('fresh history cache policy', () => {
  const fresh = {
    cacheReadFailed: false,
    wantsFullHistory: true,
    cacheAlreadyFresh: true,
    hasSnapshot: true,
    heightUnchanged: true,
  };

  it('never bypasses a forced refresh or a gap rescan', () => {
    expect(canUseFreshHistoryCache({ ...fresh, options: { force: true } })).toBe(false);
    expect(canUseFreshHistoryCache({ ...fresh, options: { rescanGap: true } })).toBe(false);
    expect(canUseFreshHistoryCache({ ...fresh, options: {} })).toBe(true);
  });
});

describe('wallet network publication invariant', () => {
  const txid = 'f'.repeat(64);
  const enrichedEntry = {
    txid,
    height: 100,
    address: wallet.address,
    direction: 'sent' as const,
    amountSats: 42_000_000,
    feeSats: 12_345,
    counterparty: 'recipient-address',
    blockTime: 1_753_000_123,
  };
  const enrichedNetwork: NetworkState = {
    ...network,
    snapshot: { ...snapshot, history: [enrichedEntry] },
  };

  it.each([
    ['scan', { ...network, status: 'connected' as const }],
    ['subscription', { ...network, height: 101 }],
    ['network failure', { ...network, status: 'error' as const, error: 'offline' }],
    ['optimistic broadcast', {
      ...network,
      snapshot: {
        ...snapshot,
        history: [
          { txid, height: 100, address: wallet.address },
          { txid: 'b'.repeat(64), height: 0, address: wallet.address },
        ],
      },
    }],
  ])('does not lose enrichment when publishing from %s', (_source, incoming) => {
    const published = mergeWalletNetworkPublication(enrichedNetwork, incoming);

    expect(published.snapshot?.history.find((entry) => entry.txid === txid)).toMatchObject({
      direction: 'sent',
      amountSats: 42_000_000,
      feeSats: 12_345,
      counterparty: 'recipient-address',
      blockTime: 1_753_000_123,
    });
  });

  it('keeps mempool enrichment through republication and confirmation', () => {
    const mempool = {
      ...enrichedEntry,
      height: 0,
      blockTime: undefined,
    };
    const initial: NetworkState = {
      ...network,
      snapshot: { ...snapshot, history: [mempool] },
    };
    const republished = mergeWalletNetworkPublication(initial, {
      ...network,
      snapshot: {
        ...snapshot,
        history: [{ txid, height: 0, address: wallet.address }],
      },
    });
    const confirmed = mergeWalletNetworkPublication(republished, {
      ...network,
      height: 101,
      snapshot: {
        ...snapshot,
        history: [{ txid, height: 101, address: wallet.address }],
      },
    });

    expect(confirmed.snapshot?.history).toEqual([
      expect.objectContaining({
        txid,
        height: 101,
        direction: 'sent',
        amountSats: 42_000_000,
        feeSats: 12_345,
        counterparty: 'recipient-address',
      }),
    ]);
  });

  it('lets only an authoritative publication remove stale mempool and apply a lower height', () => {
    const staleMempool = {
      txid: 'c'.repeat(64),
      height: 0,
      address: wallet.address,
    };
    const current: NetworkState = {
      ...enrichedNetwork,
      snapshot: {
        ...snapshot,
        history: [
          { ...enrichedEntry, height: 105 },
          staleMempool,
        ],
      },
    };
    const incoming: NetworkState = {
      ...network,
      snapshot: {
        ...snapshot,
        history: [{ txid, height: 103, address: wallet.address }],
      },
    };

    const partial = mergeWalletNetworkPublication(current, incoming);
    expect(partial.snapshot?.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ txid, height: 105 }),
      staleMempool,
    ]));

    const authoritative = mergeWalletNetworkPublication(
      current,
      incoming,
      true,
      'authoritative',
    );
    expect(authoritative.snapshot?.history).toEqual([
      expect.objectContaining({
        txid,
        height: 103,
        direction: 'sent',
        amountSats: 42_000_000,
        feeSats: 12_345,
        counterparty: 'recipient-address',
        provisional: true,
      }),
    ]);
  });

  it('clears provisional data only after enrichment at a confirmed height', () => {
    const provisional = {
      ...enrichedEntry,
      height: 0,
      provisional: true,
    };
    const mempoolSnapshot = mergeHistoryEnrichment(
      { ...snapshot, history: [provisional] },
      [{
        txid,
        status: 'pending',
        blockHeight: 0,
        blockTime: null,
        direction: 'sent',
        counterparty: 'recipient-address',
        amountSats: 42_000_000,
        feeSats: 12_345,
      }],
    );
    expect(mempoolSnapshot.history[0]?.provisional).toBe(true);

    const confirmedBase = mergeWalletNetworkPublication(
      { ...network, snapshot: mempoolSnapshot },
      {
        ...network,
        snapshot: {
          ...snapshot,
          history: [{ txid, height: 103, address: wallet.address }],
        },
      },
      true,
      'authoritative',
    );
    const confirmed = mergeHistoryEnrichment(
      confirmedBase.snapshot!,
      [{
        txid,
        status: 'confirmed',
        blockHeight: 103,
        blockTime: 1_753_000_456,
        direction: 'sent',
        counterparty: 'recipient-address',
        amountSats: 42_000_000,
        feeSats: 12_345,
      }],
    );

    expect(confirmed.history[0]).toMatchObject({
      txid,
      height: 103,
      direction: 'sent',
      amountSats: 42_000_000,
      blockTime: 1_753_000_456,
    });
    expect(confirmed.history[0]?.provisional).toBeUndefined();
  });

  it('never carries history across different wallet owners', () => {
    const incoming: NetworkState = {
      ...network,
      snapshot: {
        ...snapshot,
        history: [{ txid: 'b'.repeat(64), height: 200, address: 'wallet-b' }],
      },
    };

    expect(mergeWalletNetworkPublication(enrichedNetwork, incoming, false)).toBe(incoming);
  });
});
