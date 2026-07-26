import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import type { NitoElectrumClient } from '../network/electrum';
import {
  type WalletNetworkController,
  type WalletSyncOptions,
} from '../services/walletNetworkController';
import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
import { hasPendingWork, pendingRefreshAddresses } from '../wallet/pendingRefresh';
import type { NetworkState } from '../ui/types';

/**
 * Keeps the ElectrumX subscriptions in sync with the scanned addresses: one
 * status subscription per address plus the block-height feed, both re-armed
 * whenever the snapshot changes and torn down when the wallet closes.
 */
export const useWalletSubscriptions = ({
  enabled,
  wallet: { address: walletAddress, snapshot },
  electrum: { clientRef, networkRef },
  synchronization: { controller, request: requestSync },
  onHeightAdvance,
  onConnectionError,
}: {
  enabled: boolean;
  wallet: {
    address: string | undefined;
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
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const requestOrQueueSync = useCallback((options: WalletSyncOptions) => {
    controller.requestOrQueueSync(options, requestSync);
  }, [controller, requestSync]);

  const flushPendingSync = useCallback(() => {
    controller.finishSync(requestSync);
  }, [controller, requestSync]);

  const clearSubscriptions = useCallback(() => {
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

    blockHeightUnsubscribeRef.current = client.subscribeBlockHeight((height) => {
      const current = networkRef.current;
      const currentSnapshot = current.snapshot;
      if (!currentSnapshot || height <= current.height) return;

      if (!hasPendingWork(currentSnapshot)) {
        onHeightAdvance(height);
        return;
      }

      requestOrQueueSync({
        force: true,
        silent: true,
        pendingOnly: true,
        onlyAddresses: pendingRefreshAddresses(currentSnapshot),
      });
    });

    return () => {
      blockHeightUnsubscribeRef.current?.();
      blockHeightUnsubscribeRef.current = null;
    };
  }, [clientRef, enabled, networkRef, onHeightAdvance, requestOrQueueSync, snapshot]);

  useEffect(() => () => {
    clearSubscriptions();
  }, [clearSubscriptions, walletAddress]);

  useEffect(() => {
    if (!enabled || !snapshot) {
      return undefined;
    }

    let cancelled = false;
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
        if (cancelled) return;
      }

      const refresh = (async () => {
        for (const scannedAddress of snapshot.addresses) {
          const address = scannedAddress.address;

          if (cancelled || unsubscribeRef.current.has(address)) {
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
                requestOrQueueSync({
                  force: true,
                  silent: true,
                  onlyAddresses: knownAddress?.used ? [changedAddress] : undefined,
                  rescanGap: !knownAddress?.used,
                });
              }
            });

            if (cancelled) {
              subscription.unsubscribe();
              return;
            }

            statusRef.current.set(address, subscription.status);
            unsubscribeRef.current.set(address, subscription.unsubscribe);
            if (!scannedAddress.used && subscription.status !== null) {
              requestOrQueueSync({ force: true, silent: true, rescanGap: true });
            }
          } catch (error) {
            statusRef.current.delete(address);
            onConnectionError(error);
            return;
          }
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

    void subscribeKnownAddresses().catch(onConnectionError);

    return () => {
      cancelled = true;
    };
  }, [clientRef, enabled, networkRef, onConnectionError, requestOrQueueSync, snapshot]);

  return { clearSubscriptions, flushPendingSync };
};
