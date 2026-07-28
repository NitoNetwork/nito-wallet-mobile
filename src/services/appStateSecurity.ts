export interface AppStateLockContext {
  nextState: string;
  systemPromptActive: boolean;
  sensitiveWalletState: boolean;
}

interface MutableValue<T> {
  current: T;
}

export interface WalletAppStateChangeRefs {
  appStateRef: MutableValue<string>;
  screenRef: MutableValue<string>;
  systemPromptActiveRef: MutableValue<boolean>;
  vaultBiometricsEnabledRef: MutableValue<boolean>;
  biometricUnavailableReasonRef: MutableValue<string>;
  biometricInterruptedRef: MutableValue<boolean>;
  biometricDismissedRef: MutableValue<boolean>;
  lockedDuringSessionRef: MutableValue<boolean>;
  lockWalletRef: MutableValue<() => void>;
  clearTransientSecretsRef: MutableValue<() => void>;
  unlockSavedWalletRef: MutableValue<(useBiometrics?: boolean, auto?: boolean) => Promise<void>>;
}

export const shouldLockWalletForAppState = ({
  nextState,
  systemPromptActive,
  sensitiveWalletState,
}: AppStateLockContext): boolean => (
  sensitiveWalletState
  && (
    nextState === 'background'
    || (nextState === 'inactive' && !systemPromptActive)
  )
);

export const lockWalletIfAppStateBackground = (
  appState: string,
  lockWallet: () => void,
): boolean => {
  if (!shouldLockWalletForAppState({
    nextState: appState,
    // A post-async `inactive` value can be the stale transition left by an
    // iOS system prompt. Only a confirmed background state is reconciled here.
    systemPromptActive: true,
    sensitiveWalletState: true,
  })) {
    return false;
  }
  lockWallet();
  return true;
};

export const createWalletAppStateChangeHandler = ({
  appStateRef,
  screenRef,
  systemPromptActiveRef,
  vaultBiometricsEnabledRef,
  biometricUnavailableReasonRef,
  biometricInterruptedRef,
  biometricDismissedRef,
  lockedDuringSessionRef,
  lockWalletRef,
  clearTransientSecretsRef,
  unlockSavedWalletRef,
}: WalletAppStateChangeRefs) => (nextState: string): void => {
  const previousState = appStateRef.current;
  appStateRef.current = nextState;
  if (
    (screenRef.current === 'unlock' || screenRef.current === 'import')
    && (
      nextState === 'background'
      || (nextState === 'inactive' && !systemPromptActiveRef.current)
    )
  ) {
    clearTransientSecretsRef.current();
  }
  if (shouldLockWalletForAppState({
    nextState,
    systemPromptActive: systemPromptActiveRef.current,
    sensitiveWalletState: screenRef.current === 'wallet' || screenRef.current === 'persist',
  })) {
    lockWalletRef.current();
  }
  if (nextState !== 'active' && systemPromptActiveRef.current) {
    biometricInterruptedRef.current = true;
  }
  if (
    previousState === 'background'
    && nextState === 'active'
    && screenRef.current === 'unlock'
    && vaultBiometricsEnabledRef.current
    && !biometricUnavailableReasonRef.current
    && !systemPromptActiveRef.current
    && biometricInterruptedRef.current
    && !biometricDismissedRef.current
    && !lockedDuringSessionRef.current
  ) {
    biometricInterruptedRef.current = false;
    void unlockSavedWalletRef.current(true, true);
  }
};
