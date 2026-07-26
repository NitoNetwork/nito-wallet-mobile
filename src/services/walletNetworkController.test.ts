import { describe, expect, it, vi } from 'vitest';

import type { NitoElectrumClient } from '../network/electrum';
import type { NetworkState, Wallet } from '../ui/types';
import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
import {
  WalletNetworkController,
  canUseFreshHistoryCache,
  synchronizeWalletNetwork,
} from './walletNetworkController';

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

    controller.startSync();
    controller.requestOrQueueSync({ force: true, silent: true }, requestSync);
    controller.cancel();

    expect(controller.isCurrent(session)).toBe(false);
    expect(controller.isCurrentPrefetch(prefetch)).toBe(false);
    expect(controller.finishSync(requestSync)).toBe(false);
    expect(requestSync).not.toHaveBeenCalled();
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
