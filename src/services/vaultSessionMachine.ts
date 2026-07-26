export type VaultUnlockMode = 'password' | 'biometric';

export type VaultSessionState = Readonly<{
  status: 'absent' | 'locked' | 'unlocked';
  unlockMode: VaultUnlockMode;
  biometricsEnabled: boolean;
}>;

type PersistedVaultMetadata = {
  unlockMode?: VaultUnlockMode;
  biometricsEnabled?: boolean;
};

export type VaultSessionEvent =
  | { type: 'load'; vault: PersistedVaultMetadata | null }
  | { type: 'persist' }
  | { type: 'unlock' }
  | { type: 'lock' }
  | { type: 'enable-biometrics' }
  | { type: 'disable-biometrics' }
  | { type: 'delete' };

export const initialVaultSession: VaultSessionState = Object.freeze({
  status: 'absent',
  unlockMode: 'password',
  biometricsEnabled: false,
});

const requirePersistedVault = (state: VaultSessionState): void => {
  if (state.status === 'absent') {
    throw new Error('This transition requires a persisted vault.');
  }
};

export const transitionVaultSession = (
  state: VaultSessionState,
  event: VaultSessionEvent,
): VaultSessionState => {
  if (event.type === 'load') {
    if (!event.vault) return initialVaultSession;
    const biometricsEnabled = Boolean(
      event.vault.biometricsEnabled || event.vault.unlockMode === 'biometric',
    );
    return {
      status: 'locked',
      unlockMode: event.vault.unlockMode === 'biometric' ? 'biometric' : 'password',
      biometricsEnabled,
    };
  }

  if (event.type === 'delete') return initialVaultSession;
  if (event.type === 'persist') {
    return { status: 'unlocked', unlockMode: 'password', biometricsEnabled: false };
  }
  if (event.type === 'lock') {
    return state.status === 'absent' ? state : { ...state, status: 'locked' };
  }

  requirePersistedVault(state);

  if (event.type === 'unlock') return { ...state, status: 'unlocked' };
  if (event.type === 'enable-biometrics') {
    return { ...state, biometricsEnabled: true };
  }
  return { ...state, unlockMode: 'password', biometricsEnabled: false };
};
