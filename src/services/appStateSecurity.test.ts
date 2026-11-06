import { describe, expect, it, vi } from 'vitest';
import {
  createWalletAppStateChangeHandler,
  lockWalletIfAppStateBackground,
  shouldLockWalletForAppState,
} from './appStateSecurity';

describe('shouldLockWalletForAppState', () => {
  it('locks on background even while a system dialog is active', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'background',
        systemPromptActive: true,
        sensitiveWalletState: true,
      }),
    ).toBe(true);
  });

  it('locks on background without depending on a previous active state', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'background',
        systemPromptActive: false,
        sensitiveWalletState: true,
      }),
    ).toBe(true);
  });

  it('does not lock on inactive while a system dialog is active', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'inactive',
        systemPromptActive: true,
        sensitiveWalletState: true,
      }),
    ).toBe(false);
  });

  it('locks on inactive when no system dialog is active', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'inactive',
        systemPromptActive: false,
        sensitiveWalletState: true,
      }),
    ).toBe(true);
  });

  it('does not lock when the wallet screen is not open', () => {
    expect(
      shouldLockWalletForAppState({
        nextState: 'background',
        systemPromptActive: false,
        sensitiveWalletState: false,
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
      clearTransientSecretsRef: { current: vi.fn() },
      unlockSavedWalletRef: { current: vi.fn() },
    });

    screenRef.current = 'wallet';
    handler('inactive');

    expect(lockWallet).toHaveBeenCalledOnce();
  });

  it('reconciles an unlock that finishes after the app already entered background', () => {
    const appStateRef = { current: 'active' };
    const screenRef = { current: 'unlock' };
    const lockWallet = vi.fn();
    const handler = createWalletAppStateChangeHandler({
      appStateRef,
      screenRef,
      systemPromptActiveRef: { current: false },
      vaultBiometricsEnabledRef: { current: true },
      biometricUnavailableReasonRef: { current: '' },
      biometricInterruptedRef: { current: false },
      biometricDismissedRef: { current: false },
      lockedDuringSessionRef: { current: false },
      lockWalletRef: { current: lockWallet },
      clearTransientSecretsRef: { current: vi.fn() },
      unlockSavedWalletRef: { current: vi.fn() },
    });

    handler('background');
    expect(lockWallet).not.toHaveBeenCalled();

    screenRef.current = 'wallet';
    expect(lockWalletIfAppStateBackground(appStateRef.current, lockWallet)).toBe(true);
    expect(lockWallet).toHaveBeenCalledOnce();
  });

  it('keeps an active wallet entry open', () => {
    const lockWallet = vi.fn();

    expect(lockWalletIfAppStateBackground('active', lockWallet)).toBe(false);
    expect(lockWallet).not.toHaveBeenCalled();
  });

  it('keeps an async wallet entry open while iOS is still inactive after a system prompt', () => {
    const lockWallet = vi.fn();

    expect(lockWalletIfAppStateBackground('inactive', lockWallet)).toBe(false);
    expect(lockWallet).not.toHaveBeenCalled();
  });

  it('locks a biometric unlock that reaches the background', () => {
    const lockWallet = vi.fn();

    expect(lockWalletIfAppStateBackground('background', lockWallet)).toBe(true);
    expect(lockWallet).toHaveBeenCalledOnce();
  });

  it('protects a pending recovery phrase when the persist screen leaves the foreground', () => {
    const lockWallet = vi.fn();
    const handler = createWalletAppStateChangeHandler({
      appStateRef: { current: 'active' },
      screenRef: { current: 'persist' },
      systemPromptActiveRef: { current: false },
      vaultBiometricsEnabledRef: { current: false },
      biometricUnavailableReasonRef: { current: '' },
      biometricInterruptedRef: { current: false },
      biometricDismissedRef: { current: false },
      lockedDuringSessionRef: { current: false },
      lockWalletRef: { current: lockWallet },
      clearTransientSecretsRef: { current: vi.fn() },
      unlockSavedWalletRef: { current: vi.fn() },
    });

    handler('inactive');

    expect(lockWallet).toHaveBeenCalledOnce();
  });

  it('clears an imported phrase when its screen leaves the foreground', () => {
    const clearTransientSecrets = vi.fn();
    const handler = createWalletAppStateChangeHandler({
      appStateRef: { current: 'active' },
      screenRef: { current: 'import' },
      systemPromptActiveRef: { current: false },
      vaultBiometricsEnabledRef: { current: false },
      biometricUnavailableReasonRef: { current: '' },
      biometricInterruptedRef: { current: false },
      biometricDismissedRef: { current: false },
      lockedDuringSessionRef: { current: false },
      lockWalletRef: { current: vi.fn() },
      clearTransientSecretsRef: { current: clearTransientSecrets },
      unlockSavedWalletRef: { current: vi.fn() },
    });

    handler('inactive');

    expect(clearTransientSecrets).toHaveBeenCalledOnce();
  });

  it('clears an optional creation passphrase when landing leaves the foreground', () => {
    const clearTransientSecrets = vi.fn();
    const handler = createWalletAppStateChangeHandler({
      appStateRef: { current: 'active' },
      screenRef: { current: 'landing' },
      systemPromptActiveRef: { current: false },
      vaultBiometricsEnabledRef: { current: false },
      biometricUnavailableReasonRef: { current: '' },
      biometricInterruptedRef: { current: false },
      biometricDismissedRef: { current: false },
      lockedDuringSessionRef: { current: false },
      lockWalletRef: { current: vi.fn() },
      clearTransientSecretsRef: { current: clearTransientSecrets },
      unlockSavedWalletRef: { current: vi.fn() },
    });

    handler('inactive');

    expect(clearTransientSecrets).toHaveBeenCalledOnce();
  });

  it('does not clear an unlock field while the biometric system prompt makes iOS inactive', () => {
    const clearTransientSecrets = vi.fn();
    const handler = createWalletAppStateChangeHandler({
      appStateRef: { current: 'active' },
      screenRef: { current: 'unlock' },
      systemPromptActiveRef: { current: true },
      vaultBiometricsEnabledRef: { current: true },
      biometricUnavailableReasonRef: { current: '' },
      biometricInterruptedRef: { current: false },
      biometricDismissedRef: { current: false },
      lockedDuringSessionRef: { current: false },
      lockWalletRef: { current: vi.fn() },
      clearTransientSecretsRef: { current: clearTransientSecrets },
      unlockSavedWalletRef: { current: vi.fn() },
    });

    handler('inactive');

    expect(clearTransientSecrets).not.toHaveBeenCalled();
  });

  it('abandons dice entropy on background but not on a transient inactive state', () => {
    const clearTransientSecrets = vi.fn();
    const refs = {
      appStateRef: { current: 'active' },
      screenRef: { current: 'dice' },
      systemPromptActiveRef: { current: false },
      vaultBiometricsEnabledRef: { current: false },
      biometricUnavailableReasonRef: { current: '' },
      biometricInterruptedRef: { current: false },
      biometricDismissedRef: { current: false },
      lockedDuringSessionRef: { current: false },
      lockWalletRef: { current: vi.fn() },
      clearTransientSecretsRef: { current: clearTransientSecrets },
      unlockSavedWalletRef: { current: vi.fn() },
    };
    const handler = createWalletAppStateChangeHandler(refs);

    handler('inactive');
    expect(clearTransientSecrets).not.toHaveBeenCalled();

    handler('background');
    expect(clearTransientSecrets).toHaveBeenCalledOnce();
  });
});
