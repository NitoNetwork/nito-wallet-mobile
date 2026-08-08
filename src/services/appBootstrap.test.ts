import { describe, expect, it, vi } from 'vitest';

import { loadWalletBootstrapState } from './appBootstrap';

const createLoaders = () => ({
  loadVault: vi.fn(async () => ({ address: 'wallet-address' })),
  probeNativeCrypto: vi.fn(async () => undefined),
  hasBiometricHardware: vi.fn(async () => true),
  isBiometricEnrolled: vi.fn(async () => true),
  getBiometricMethod: vi.fn(async () => 'Face ID'),
  loadRefreshCooldown: vi.fn(async () => '123'),
  loadElectrumPreference: vi.fn(async () => ({ mode: 'official' })),
  reportAncillaryFailure: vi.fn(),
});

describe('wallet bootstrap', () => {
  it('does not start optional initialization when the authoritative vault read fails', async () => {
    const loaders = createLoaders();
    loaders.loadVault.mockRejectedValueOnce(new Error('secure storage unavailable'));

    await expect(loadWalletBootstrapState(loaders)).rejects.toThrow('secure storage unavailable');
    expect(loaders.hasBiometricHardware).not.toHaveBeenCalled();
    expect(loaders.probeNativeCrypto).not.toHaveBeenCalled();
    expect(loaders.isBiometricEnrolled).not.toHaveBeenCalled();
    expect(loaders.getBiometricMethod).not.toHaveBeenCalled();
    expect(loaders.loadRefreshCooldown).not.toHaveBeenCalled();
    expect(loaders.loadElectrumPreference).not.toHaveBeenCalled();
  });

  it('fails initialization when the native entropy probe fails', async () => {
    const loaders = createLoaders();
    loaders.probeNativeCrypto.mockRejectedValueOnce(new Error('native entropy unavailable'));

    await expect(loadWalletBootstrapState(loaders)).rejects.toThrow('native entropy unavailable');
    expect(loaders.hasBiometricHardware).not.toHaveBeenCalled();
    expect(loaders.isBiometricEnrolled).not.toHaveBeenCalled();
    expect(loaders.getBiometricMethod).not.toHaveBeenCalled();
    expect(loaders.loadRefreshCooldown).not.toHaveBeenCalled();
    expect(loaders.loadElectrumPreference).not.toHaveBeenCalled();
  });

  it('keeps an existing vault authoritative when optional initialization fails', async () => {
    const loaders = createLoaders();
    loaders.hasBiometricHardware.mockRejectedValueOnce(new Error('native biometric failure'));
    loaders.loadElectrumPreference.mockRejectedValueOnce(new Error('preference failure'));

    const state = await loadWalletBootstrapState(loaders);

    expect(state.vault).toEqual({ address: 'wallet-address' });
    expect(state.hasBiometricHardware).toBeUndefined();
    expect(state.isBiometricEnrolled).toBe(true);
    expect(state.electrumPreference).toBeUndefined();
    expect(loaders.reportAncillaryFailure).toHaveBeenCalledTimes(2);
  });
});
