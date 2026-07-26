export interface AppStateLockContext {
  nextState: string;
  systemPromptActive: boolean;
  walletOpen: boolean;
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
  unlockSavedWalletRef: MutableValue<(useBiometrics?: boolean, auto?: boolean) => Promise<void>>;
}

export const shouldLockWalletForAppState = ({
  nextState,
  systemPromptActive,
  walletOpen,
}: AppStateLockContext): boolean => (
  walletOpen
  && (
    nextState === 'background'
    || (nextState === 'inactive' && !systemPromptActive)
  )
);

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
  unlockSavedWalletRef,
}: WalletAppStateChangeRefs) => (nextState: string): void => {
  const previousState = appStateRef.current;
  appStateRef.current = nextState;
  if (shouldLockWalletForAppState({
    nextState,
    systemPromptActive: systemPromptActiveRef.current,
    walletOpen: screenRef.current === 'wallet',
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
