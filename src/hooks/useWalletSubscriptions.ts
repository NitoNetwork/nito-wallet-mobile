import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import type { NitoElectrumClient } from '../network/electrum';
import { DirtySyncQueue, type DirtySyncOptions } from '../services/syncDirtyQueue';
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
  walletAddress,
  snapshot,
  clientRef,
  networkRef,
  syncInFlightRef,
  onHeightAdvance,
  requestSync,
  onConnectionError,
}: {
  enabled: boolean;
  walletAddress: string | undefined;
  snapshot: TransparentWalletSnapshot | null;
  clientRef: MutableRefObject<NitoElectrumClient | null>;
  networkRef: MutableRefObject<NetworkState>;
  syncInFlightRef: MutableRefObject<boolean>;
  onHeightAdvance: (height: number) => void;
  requestSync: (options: DirtySyncOptions) => void;
  onConnectionError: (error: unknown) => void;
}) => {
  const statusRef = useRef<Map<string, string | null>>(new Map());
  const unsubscribeRef = useRef<Map<string, () => void>>(new Map());
  const blockHeightUnsubscribeRef = useRef<(() => void) | null>(null);
  const dirtySyncQueueRef = useRef(new DirtySyncQueue());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const requestOrQueueSync = useCallback((options: DirtySyncOptions) => {
    dirtySyncQueueRef.current.request(options, syncInFlightRef.current, requestSync);
  }, [requestSync, syncInFlightRef]);

  const flushPendingSync = useCallback(() => {
    dirtySyncQueueRef.current.flush(syncInFlightRef.current, requestSync);
  }, [requestSync, syncInFlightRef]);

  const clearSubscriptions = useCallback(() => {
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current.clear();
    statusRef.current.clear();
    dirtySyncQueueRef.current.clear();
  }, []);

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
