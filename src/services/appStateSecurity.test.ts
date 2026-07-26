import { describe, expect, it, vi } from 'vitest';
import {
  createWalletAppStateChangeHandler,
  shouldLockWalletForAppState,
} from './appStateSecurity';

describe('shouldLockWalletForAppState', () => {
  it('locks on background even while a system dialog is active', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'background',
        systemPromptActive: true,
        walletOpen: true,
      }),
    ).toBe(true);
  });

  it('locks on background without depending on a previous active state', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'background',
        systemPromptActive: false,
        walletOpen: true,
      }),
    ).toBe(true);
  });

  it('does not lock on inactive while a system dialog is active', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'inactive',
        systemPromptActive: true,
        walletOpen: true,
      }),
    ).toBe(false);
  });

  it('locks on inactive when no system dialog is active', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'inactive',
        systemPromptActive: false,
        walletOpen: true,
      }),
    ).toBe(true);
  });

  it('does not lock when the wallet screen is not open', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'background',
        systemPromptActive: false,
        walletOpen: false,
      }),
    ).toBe(false);
  });

  it('uses the current screen when an event arrives before any effect can be rerun', () => {
    const screenRef = { current: 'unlock' };
    const lockWallet = vi.fn();
    const handler = createWalletAppStateChangeHandler({
      appStateRef: { current: 'active' },
      screenRef,
      systemPromptActiveRef: { current: false },
      vaultBiometricsEnabledRef: { current: true },
      biometricUnavailableReasonRef: { current: '' },
      biometricInterruptedRef: { current: false },
      biometricDismissedRef: { current: false },
      lockedDuringSessionRef: { current: false },
      lockWalletRef: { current: lockWallet },
      unlockSavedWalletRef: { current: vi.fn() },
    });

    screenRef.current = 'wallet';
    handler('inactive');

    expect(lockWallet).toHaveBeenCalledOnce();
  });
});
