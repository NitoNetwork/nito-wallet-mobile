import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { reportNonFinancialFailure } from '../services/diagnostics';

const SCREEN_CAPTURE_KEY = 'nito-wallet-sensitive-content';

/**
 * Protects wallet content for the full app lifetime. Android uses FLAG_SECURE;
 * iOS additionally receives a privacy overlay for app-switcher snapshots.
 */
export const useWalletScreenProtection = (): void => {
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await ScreenCapture.preventScreenCaptureAsync(SCREEN_CAPTURE_KEY);
        if (mounted && Platform.OS === 'ios') {
          await ScreenCapture.enableAppSwitcherProtectionAsync(1);
        }
      } catch (caught) {
        reportNonFinancialFailure('wallet screen capture protection', caught);
      }
    })();

    return () => {
      mounted = false;
      void ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch((caught) => {
        reportNonFinancialFailure('wallet screen capture protection cleanup', caught);
      });
      if (Platform.OS === 'ios') {
        void ScreenCapture.disableAppSwitcherProtectionAsync().catch((caught) => {
          reportNonFinancialFailure('wallet app switcher protection cleanup', caught);
        });
      }
    };
  }, []);
};
