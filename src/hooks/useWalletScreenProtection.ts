import * as ScreenCapture from 'expo-screen-capture';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { reportNonFinancialFailure } from '../services/diagnostics';

const SCREEN_CAPTURE_KEY = 'nito-wallet-sensitive-content';

/**
 * Prevents capture for the full app lifetime (FLAG_SECURE on Android) while
 * limiting the iOS app-switcher overlay to screens that display secrets.
 */
export const useWalletScreenProtection = ({
  protectIosAppSwitcher,
}: {
  protectIosAppSwitcher: boolean;
}): void => {
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
    void ScreenCapture.preventScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch((caught) => {
      reportNonFinancialFailure('wallet screen capture protection', caught);
    });

    return () => {
      void ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch((caught) => {
        reportNonFinancialFailure('wallet screen capture protection cleanup', caught);
      });
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      queueAppSwitcherUpdate(protectIosAppSwitcher);
    }
  }, [protectIosAppSwitcher, queueAppSwitcherUpdate]);

  useEffect(() => () => {
    if (Platform.OS === 'ios') {
      queueAppSwitcherUpdate(false);
    }
  }, [queueAppSwitcherUpdate]);
};
