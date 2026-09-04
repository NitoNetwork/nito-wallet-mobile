export class BiometricUnlockCancelledError extends Error {
  constructor() {
    super('Biometric authentication was cancelled.');
    this.name = 'BiometricUnlockCancelledError';
  }
}

export const readBiometricSecretForUnlock = async (
  read: () => Promise<string | null>,
): Promise<string | null> => {
  try {
    return await read();
  } catch (caught) {
    // Expo SecureStore's KeyChainException (iOS) and AuthenticationException
    // (Android) include these fixed English reasons, even in a localized prompt.
    // Only the authenticated read is wrapped. KDF, SQLite and HD failures after
    // it must retain their identity and must never be reported as cancellation.
    if (caught instanceof Error && /\bUser canceled the (?:operation|authentication)\./.test(caught.message)) {
      throw new BiometricUnlockCancelledError();
    }
    throw caught;
  }
};
