import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import type { NitoElectrumClient } from '../network/electrum';
import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
import type { NetworkState } from '../ui/types';

const COINBASE_MATURITY = 101;

type SyncOptions = {
  force?: boolean;
  silent?: boolean;
  pendingOnly?: boolean;
  onlyAddresses?: readonly string[];
  rescanGap?: boolean;
};

const hasPendingWork = (snapshot: TransparentWalletSnapshot) =>
  snapshot.unconfirmedSats !== 0
  || (snapshot.immatureCoinbaseSats ?? 0) > 0
  || snapshot.history.some((entry) => entry.height <= 0)
  || snapshot.utxos.some((utxo) => (
    utxo.confirmations > 0
    && utxo.confirmations < COINBASE_MATURITY
    && utxo.isCoinbase !== false
  ));

const isUnsettled = (utxo: { confirmations: number; isCoinbase?: boolean }) =>
  utxo.confirmations <= 0
  || (utxo.confirmations > 0 && utxo.confirmations < COINBASE_MATURITY && utxo.isCoinbase !== false);

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
}: {
  enabled: boolean;
  walletAddress: string | undefined;
  snapshot: TransparentWalletSnapshot | null;
  clientRef: MutableRefObject<NitoElectrumClient | null>;
  networkRef: MutableRefObject<NetworkState>;
  syncInFlightRef: MutableRefObject<boolean>;
  onHeightAdvance: (height: number) => void;
  requestSync: (options: SyncOptions) => void;
}) => {
  const statusRef = useRef<Map<string, string | null>>(new Map());
  const unsubscribeRef = useRef<Map<string, () => void>>(new Map());
  const blockHeightUnsubscribeRef = useRef<(() => void) | null>(null);
  const refreshInFlightRef = useRef(false);

  const clearSubscriptions = useCallback(() => {
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current.clear();
    statusRef.current.clear();
    refreshInFlightRef.current = false;
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

      if (!syncInFlightRef.current) {
        requestSync({
          force: true,
          silent: true,
          pendingOnly: true,
          onlyAddresses: currentSnapshot.addresses
            .filter((address) => address.utxos.some(isUnsettled))
            .map((address) => address.address),
        });
      }
    });

    return () => {
      blockHeightUnsubscribeRef.current?.();
      blockHeightUnsubscribeRef.current = null;
    };
  }, [clientRef, enabled, networkRef, onHeightAdvance, requestSync, snapshot, syncInFlightRef]);

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

      if (!client || refreshInFlightRef.current) {
        return;
      }

      refreshInFlightRef.current = true;

      try {
        for (const scannedAddress of snapshot.addresses) {
          const address = scannedAddress.address;

          if (cancelled || unsubscribeRef.current.has(address)) {
            continue;
          }

          try {
            const subscription = await client.subscribeAddressStatus(address, (nextStatus, changedAddress) => {
              const previousStatus = statusRef.current.get(changedAddress);
              statusRef.current.set(changedAddress, nextStatus);

              if (previousStatus !== undefined && previousStatus !== nextStatus && !syncInFlightRef.current) {
                const knownAddress = networkRef.current.snapshot?.addresses.find(
                  ({ address: candidate }) => candidate === changedAddress,
                );
                requestSync({
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
            if (!scannedAddress.used && subscription.status !== null && !syncInFlightRef.current) {
              requestSync({ force: true, silent: true, rescanGap: true });
            }
          } catch {
            statusRef.current.delete(address);
          }
        }
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    void subscribeKnownAddresses();

    return () => {
      cancelled = true;
    };
  }, [clientRef, enabled, networkRef, requestSync, snapshot, syncInFlightRef]);

  return { clearSubscriptions };
};
