import { describe, expect, it } from 'vitest';

import {
  syncRequestAfterInitialSubscriptions,
  syncRequestForAddressStatus,
  syncRequestForBlockStatus,
  WalletSubscriptionRunGuard,
} from './walletSubscriptionPolicy';

describe('wallet subscription synchronization policy', () => {
  it('invalidates abandoned subscription reads without hiding current failures', () => {
    const guard = new WalletSubscriptionRunGuard();
    const abandonedRun = guard.capture();

    expect(guard.isCurrent(abandonedRun)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(abandonedRun)).toBe(false);

    const activeRun = guard.capture();
    expect(guard.isCurrent(activeRun)).toBe(true);
  });

  it('requests an authoritative refresh for any used-address status change', () => {
    expect(syncRequestForAddressStatus(true)).toEqual({ force: true, silent: true, rescanGap: false });
    expect(syncRequestForAddressStatus(false)).toEqual({ force: true, silent: true, rescanGap: true });
  });

  it('refreshes authoritatively for pending confirmations and every reorg signal', () => {
    expect(syncRequestForBlockStatus({
      announcedHeight: 101,
      currentHeight: 100,
      hasPendingWork: true,
    })).toEqual({ force: true, silent: true });
    expect(syncRequestForBlockStatus({
      announcedHeight: 100,
      currentHeight: 100,
      hasPendingWork: false,
    })).toEqual({ force: true, silent: true });
    expect(syncRequestForBlockStatus({
      announcedHeight: 99,
      currentHeight: 100,
      hasPendingWork: false,
    })).toEqual({ force: true, silent: true });
  });

  it('refreshes used addresses once after subscriptions are restored at the same height', () => {
    expect(syncRequestAfterInitialSubscriptions(true)).toEqual({ force: true, silent: true });
    expect(syncRequestAfterInitialSubscriptions(false)).toBeNull();
  });
});
