import { describe, expect, it } from 'vitest';

import {
  initialVaultSession,
  transitionVaultSession,
} from './vaultSessionMachine';

describe('vault session transitions', () => {
  it('moves through load, unlock, biometric changes, lock and deletion', () => {
    const loaded = transitionVaultSession(initialVaultSession, {
      type: 'load',
      vault: { unlockMode: 'biometric', biometricsEnabled: true },
    });
    expect(loaded).toEqual({
      status: 'locked',
      unlockMode: 'biometric',
      biometricsEnabled: true,
    });

    const unlocked = transitionVaultSession(loaded, { type: 'unlock' });
    expect(unlocked.status).toBe('unlocked');

    const disabled = transitionVaultSession(unlocked, { type: 'disable-biometrics' });
    expect(disabled).toEqual({
      status: 'unlocked',
      unlockMode: 'password',
      biometricsEnabled: false,
    });

    expect(transitionVaultSession(disabled, { type: 'lock' }).status).toBe('locked');
    expect(transitionVaultSession(disabled, { type: 'delete' })).toEqual(initialVaultSession);
  });

  it('cannot unlock or enable biometrics without a persisted vault', () => {
    expect(() => transitionVaultSession(initialVaultSession, { type: 'unlock' }))
      .toThrow('persisted vault');
    expect(() => transitionVaultSession(initialVaultSession, { type: 'enable-biometrics' }))
      .toThrow('persisted vault');
  });

  it('keeps password encryption authoritative when quick biometrics are enabled', () => {
    const persisted = transitionVaultSession(initialVaultSession, { type: 'persist' });

    expect(transitionVaultSession(persisted, { type: 'enable-biometrics' })).toEqual({
      status: 'unlocked',
      unlockMode: 'password',
      biometricsEnabled: true,
    });
  });
});
