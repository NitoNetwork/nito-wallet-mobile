import { describe, expect, it, vi } from 'vitest';

import { WalletSessionGuard } from './walletSession';

describe('WalletSessionGuard', () => {
  it('rejects deferred writes from a replaced wallet session', () => {
    const sessions = new WalletSessionGuard();
    const firstSession = sessions.begin('wallet-a');
    const deferredWrite = vi.fn();

    sessions.begin('wallet-b');

    expect(sessions.runIfCurrent(firstSession, deferredWrite)).toBe(false);
    expect(deferredWrite).not.toHaveBeenCalled();
  });

  it('rejects deferred writes after locking and tokens from a reopened wallet', () => {
    const sessions = new WalletSessionGuard();
    const firstSession = sessions.begin('wallet-a');

    sessions.invalidate();
    expect(sessions.isCurrent(firstSession)).toBe(false);

    const reopenedSession = sessions.begin('wallet-a');
    expect(sessions.isCurrent(firstSession)).toBe(false);
    expect(sessions.isCurrent(reopenedSession)).toBe(true);
  });

  it('captures only the expected active wallet', () => {
    const sessions = new WalletSessionGuard();
    const currentSession = sessions.begin('wallet-a');

    expect(sessions.capture('wallet-b')).toBeNull();
    expect(sessions.capture('wallet-a')).toEqual(currentSession);
  });
});
