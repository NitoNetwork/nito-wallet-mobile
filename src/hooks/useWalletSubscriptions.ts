import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import type { NitoElectrumClient } from '../network/electrum';
import {
  type WalletNetworkController,
  type WalletSyncOptions,
} from '../services/walletNetworkController';
import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
import { hasPendingWork } from '../wallet/pendingRefresh';
import type { NetworkState } from '../ui/types';
import {
  syncRequestAfterInitialSubscriptions,
  syncRequestForAddressStatus,
  syncRequestForBlockStatus,
  WalletSubscriptionRunGuard,
} from '../services/walletSubscriptionPolicy';

/**
 * Keeps the ElectrumX subscriptions in sync with the scanned addresses: one
 * status subscription per address plus the block-height feed, both re-armed
 * whenever the snapshot changes and torn down when the wallet closes.
 */
export const useWalletSubscriptions = ({
  enabled,
  wallet: { walletId, snapshot },
  electrum: { clientRef, networkRef },
  synchronization: { controller, request: requestSync },
  onHeightAdvance,
  onConnectionError,
}: {
  enabled: boolean;
  wallet: {
    walletId: string | undefined;
    snapshot: TransparentWalletSnapshot | null;
  };
  electrum: {
    clientRef: MutableRefObject<NitoElectrumClient | null>;
    networkRef: MutableRefObject<NetworkState>;
  };
  synchronization: {
    controller: WalletNetworkController;
    request: (options: WalletSyncOptions) => void;
  };
  onHeightAdvance: (height: number) => void;
  onConnectionError: (error: unknown) => void;
}) => {
  const statusRef = useRef<Map<string, string | null>>(new Map());
  const unsubscribeRef = useRef<Map<string, () => void>>(new Map());
  const blockHeightUnsubscribeRef = useRef<(() => void) | null>(null);
  const connectionStateUnsubscribeRef = useRef<(() => void) | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const subscriptionRunGuardRef = useRef(new WalletSubscriptionRunGuard());

  const requestOrQueueSync = useCallback((options: WalletSyncOptions) => {
    controller.requestOrQueueSync(options, requestSync);
  }, [controller, requestSync]);

  const flushPendingSync = useCallback(() => {
    controller.finishSync(requestSync);
  }, [controller, requestSync]);

  const clearSubscriptions = useCallback(() => {
    subscriptionRunGuardRef.current.invalidate();
    blockHeightUnsubscribeRef.current?.();
    blockHeightUnsubscribeRef.current = null;
    connectionStateUnsubscribeRef.current?.();
    connectionStateUnsubscribeRef.current = null;
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current.clear();
    statusRef.current.clear();
    controller.clearPendingSync();
  }, [controller]);

  useEffect(() => {
    blockHeightUnsubscribeRef.current?.();
    blockHeightUnsubscribeRef.current = null;

    const client = clientRef.current;
    if (!enabled || !snapshot || !client) {
      return undefined;
    }

    connectionStateUnsubscribeRef.current?.();
    connectionStateUnsubscribeRef.current = client.subscribeConnectionState((connection) => {
      if (!connection.connected) {
        onConnectionError(connection.error ?? new Error('ElectrumX connection closed.'));
        return;
      }
      if (connection.reconnected) {
        requestOrQueueSync({ force: true, silent: true });
      }
    });

    blockHeightUnsubscribeRef.current = client.subscribeBlockHeight((height) => {
      const current = networkRef.current;
      const currentSnapshot = current.snapshot;
      if (!currentSnapshot) return;

      const syncRequest = syncRequestForBlockStatus({
        announcedHeight: height,
        currentHeight: current.height,
        hasPendingWork: hasPendingWork(currentSnapshot),
      });
      if (!syncRequest) {
        onHeightAdvance(height);
        return;
      }

      requestOrQueueSync(syncRequest);
    });

    return () => {
      blockHeightUnsubscribeRef.current?.();
      blockHeightUnsubscribeRef.current = null;
      connectionStateUnsubscribeRef.current?.();
      connectionStateUnsubscribeRef.current = null;
    };
  }, [
    clientRef,
    enabled,
    networkRef,
    onConnectionError,
    onHeightAdvance,
    requestOrQueueSync,
    snapshot,
  ]);

  useEffect(() => () => {
    clearSubscriptions();
  }, [clearSubscriptions, walletId]);

  useEffect(() => {
    if (!enabled || !snapshot) {
      return undefined;
    }

    let cancelled = false;
    const runGuard = subscriptionRunGuardRef.current;
    const runGeneration = runGuard.capture();
    const runIsCurrent = () => (
      !cancelled
      && runGuard.isCurrent(runGeneration)
    );
    const reportConnectionErrorIfCurrent = (error: unknown) => {
      if (runIsCurrent()) {
        onConnectionError(error);
      }
    };
    const activeAddresses = new Set(snapshot.addresses.map(({ address }) => address));
    for (const [address, unsubscribe] of unsubscribeRef.current) {
      if (!activeAddresses.has(address)) {
        unsubscribe();
        unsubscribeRef.current.delete(address);
        statusRef.current.delete(address);
      }
    }

    const subscribeKnownAddresses = async () => {
      const client = clientRef.current;

      if (!client) {
        return;
      }

      while (refreshPromiseRef.current) {
        const activeRefresh = refreshPromiseRef.current;
        await activeRefresh;
        if (!runIsCurrent()) return;
      }

      const refresh = (async () => {
        let needsAuthoritativeRefresh = false;
        for (const scannedAddress of snapshot.addresses) {
          const address = scannedAddress.address;

          if (!runIsCurrent() || unsubscribeRef.current.has(address)) {
            continue;
          }

          try {
            const subscription = await client.subscribeAddressStatus(address, (nextStatus, changedAddress) => {
              const previousStatus = statusRef.current.get(changedAddress);
              statusRef.current.set(changedAddress, nextStatus);

              if (previousStatus !== undefined && previousStatus !== nextStatus) {
                const knownAddress = networkRef.current.snapshot?.addresses.find(
                  ({ address: candidate }) => candidate === changedAddress,
                );
                requestOrQueueSync(syncRequestForAddressStatus(Boolean(knownAddress?.used)));
              }
            });

            if (!runIsCurrent()) {
              subscription.unsubscribe();
              return;
            }

            statusRef.current.set(address, subscription.status);
            unsubscribeRef.current.set(address, subscription.unsubscribe);
            needsAuthoritativeRefresh ||= scannedAddress.used;
            if (!scannedAddress.used && subscription.status !== null) {
              requestOrQueueSync({ force: true, silent: true, rescanGap: true });
            }
          } catch (error) {
            statusRef.current.delete(address);
            reportConnectionErrorIfCurrent(error);
            return;
          }
        }
        const initialSyncRequest = syncRequestAfterInitialSubscriptions(needsAuthoritativeRefresh);
        if (runIsCurrent() && initialSyncRequest) {
          // The initial status is not an event. Refresh all known used addresses
          // so same-height mempool changes that happened while the app was closed
          // cannot be mistaken for a fresh cache.
          requestOrQueueSync(initialSyncRequest);
        }
      })();
      refreshPromiseRef.current = refresh;
      try {
        await refresh;
      } finally {
        if (refreshPromiseRef.current === refresh) {
          refreshPromiseRef.current = null;
        }
      }
    };

    void subscribeKnownAddresses().catch(reportConnectionErrorIfCurrent);

    return () => {
      cancelled = true;
      runGuard.invalidate();
    };
  }, [clientRef, enabled, networkRef, onConnectionError, requestOrQueueSync, snapshot]);

  return { clearSubscriptions, flushPendingSync };
};
