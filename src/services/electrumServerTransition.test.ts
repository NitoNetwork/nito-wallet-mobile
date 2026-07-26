import { describe, expect, it, vi } from 'vitest';

import type { NitoElectrumClient } from '../network/electrum';
import { invalidateElectrumRuntimeForServerChange } from './electrumServerTransition';
import { WalletNetworkController } from './walletNetworkController';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

describe('Electrum server transition', () => {
  it('invalidates every old network task and both kinds of prepared transaction', () => {
    const controller = new WalletNetworkController();
    const staleSession = controller.beginWalletSession('wallet-a');
    const stalePrefetch = controller.beginPrefetch();
    controller.startSync();
    controller.startEnrichment();
    const disconnect = vi.fn();
    const clearClient = vi.fn();
    const clearPreparedTransaction = vi.fn();
    const clearPreparedConsolidation = vi.fn();
    const clearDeferredNetworkWork = vi.fn();

    invalidateElectrumRuntimeForServerChange({
      client: { disconnect } as unknown as NitoElectrumClient,
      controller,
      walletAddress: 'wallet-a',
      clearClient,
      clearPreparedTransaction,
      clearPreparedConsolidation,
      clearDeferredNetworkWork,
    });

    expect(controller.isCurrent(staleSession)).toBe(false);
    expect(controller.isCurrentPrefetch(stalePrefetch)).toBe(false);
    expect(controller.sessions.capture('wallet-a')).not.toBeNull();
    expect(controller.syncInFlight).toBe(false);
    expect(controller.enrichmentInFlight).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(clearClient).toHaveBeenCalledOnce();
    expect(clearPreparedTransaction).toHaveBeenCalledOnce();
    expect(clearPreparedConsolidation).toHaveBeenCalledOnce();
    expect(clearDeferredNetworkWork).toHaveBeenCalledOnce();
  });
});
