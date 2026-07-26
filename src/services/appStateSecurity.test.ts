import { describe, expect, it } from 'vitest';
import { shouldLockWalletForAppState } from './appStateSecurity';

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
});
