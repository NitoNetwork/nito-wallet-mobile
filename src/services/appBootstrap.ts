export interface WalletBootstrapLoaders<Vault, BiometricMethod, ElectrumPreference> {
  loadVault: () => Promise<Vault | null>;
  hasBiometricHardware: () => Promise<boolean>;
  isBiometricEnrolled: () => Promise<boolean>;
  getBiometricMethod: () => Promise<BiometricMethod>;
  loadRefreshCooldown: () => Promise<string | null>;
  loadElectrumPreference: () => Promise<ElectrumPreference>;
  reportAncillaryFailure: (operation: string, error: unknown) => void;
}

export interface WalletBootstrapState<Vault, BiometricMethod, ElectrumPreference> {
  vault: Vault | null;
  hasBiometricHardware: boolean | undefined;
  isBiometricEnrolled: boolean | undefined;
  biometricMethod: BiometricMethod | undefined;
  savedRefreshCooldown: string | null | undefined;
  electrumPreference: ElectrumPreference | undefined;
}

const settledValue = <T>(
  result: PromiseSettledResult<T>,
  operation: string,
  reportFailure: (operation: string, error: unknown) => void,
): T | undefined => {
  if (result.status === 'fulfilled') {
    return result.value;
  }

  reportFailure(operation, result.reason);
  return undefined;
};

/**
 * The vault read is deliberately awaited before any optional startup work.
 * A vault read failure must never be indistinguishable from an absent vault.
 */
export const loadWalletBootstrapState = async <Vault, BiometricMethod, ElectrumPreference>(
  loaders: WalletBootstrapLoaders<Vault, BiometricMethod, ElectrumPreference>,
): Promise<WalletBootstrapState<Vault, BiometricMethod, ElectrumPreference>> => {
  const vault = await loaders.loadVault();
  const [
    hardwareResult,
    enrollmentResult,
    methodResult,
    cooldownResult,
    electrumPreferenceResult,
  ] = await Promise.allSettled([
    loaders.hasBiometricHardware(),
    loaders.isBiometricEnrolled(),
    loaders.getBiometricMethod(),
    loaders.loadRefreshCooldown(),
    loaders.loadElectrumPreference(),
  ]);

  return {
    vault,
    hasBiometricHardware: settledValue(
      hardwareResult,
      'biometric hardware check',
      loaders.reportAncillaryFailure,
    ),
    isBiometricEnrolled: settledValue(
      enrollmentResult,
      'biometric enrollment check',
      loaders.reportAncillaryFailure,
    ),
    biometricMethod: settledValue(
      methodResult,
      'biometric method check',
      loaders.reportAncillaryFailure,
    ),
    savedRefreshCooldown: settledValue(
      cooldownResult,
      'balance refresh cooldown read',
      loaders.reportAncillaryFailure,
    ),
    electrumPreference: settledValue(
      electrumPreferenceResult,
      'electrum server preference read',
      loaders.reportAncillaryFailure,
    ),
  };
};
