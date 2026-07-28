import * as ScreenCapture from 'expo-screen-capture';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { reportNonFinancialFailure } from '../services/diagnostics';

const SCREEN_CAPTURE_KEY = 'nito-wallet-sensitive-content';

export const setWalletScreenCaptureProtection = async (enabled: boolean): Promise<void> => {
  if (enabled) {
    await ScreenCapture.preventScreenCaptureAsync(SCREEN_CAPTURE_KEY);
  } else {
    await ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY);
  }
};

/**
 * Protects only screens that visibly expose the recovery phrase. Both capture
 * blocking and the iOS app-switcher overlay follow the same narrow scope.
 */
export const useWalletScreenProtection = ({
  protectRecoveryPhrase,
}: {
  protectRecoveryPhrase: boolean;
}): void => {
  const screenCaptureUpdateRef = useRef<Promise<void>>(Promise.resolve());
  const queueScreenCaptureUpdate = useCallback((enabled: boolean) => {
    screenCaptureUpdateRef.current = screenCaptureUpdateRef.current
      .then(() => setWalletScreenCaptureProtection(enabled))
      .catch((caught) => {
        reportNonFinancialFailure('wallet screen capture protection', caught);
      });
  }, []);
  const appSwitcherUpdateRef = useRef<Promise<void>>(Promise.resolve());
  const queueAppSwitcherUpdate = useCallback((enabled: boolean) => {
    appSwitcherUpdateRef.current = appSwitcherUpdateRef.current
      .then(() => (
        enabled
          ? ScreenCapture.enableAppSwitcherProtectionAsync(1)
          : ScreenCapture.disableAppSwitcherProtectionAsync()
      ))
      .catch((caught) => {
        reportNonFinancialFailure('wallet app switcher protection', caught);
      });
  }, []);

  useEffect(() => {
    queueScreenCaptureUpdate(protectRecoveryPhrase);
  }, [protectRecoveryPhrase, queueScreenCaptureUpdate]);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      queueAppSwitcherUpdate(protectRecoveryPhrase);
    }
  }, [protectRecoveryPhrase, queueAppSwitcherUpdate]);

  useEffect(() => () => {
    queueScreenCaptureUpdate(false);
    if (Platform.OS === 'ios') {
      queueAppSwitcherUpdate(false);
    }
  }, [queueAppSwitcherUpdate, queueScreenCaptureUpdate]);
};
