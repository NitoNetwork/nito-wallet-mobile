import * as ScreenCapture from 'expo-screen-capture';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setWalletScreenCaptureProtection } from './useWalletScreenProtection';

vi.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: vi.fn(async () => undefined),
  allowScreenCaptureAsync: vi.fn(async () => undefined),
  enableAppSwitcherProtectionAsync: vi.fn(async () => undefined),
  disableAppSwitcherProtectionAsync: vi.fn(async () => undefined),
}));

describe('wallet screen capture protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables protection for sensitive content and removes it afterwards', async () => {
    await setWalletScreenCaptureProtection(true);
    expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith(
      'nito-wallet-sensitive-content',
    );
    expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();

    await setWalletScreenCaptureProtection(false);
    expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalledWith(
      'nito-wallet-sensitive-content',
    );
  });
});
