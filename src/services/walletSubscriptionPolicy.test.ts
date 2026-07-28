import { describe, expect, it } from 'vitest';

import {
  syncRequestAfterInitialSubscriptions,
  syncRequestForAddressStatus,
  syncRequestForBlockStatus,
} from './walletSubscriptionPolicy';

describe('wallet subscription synchronization policy', () => {
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
