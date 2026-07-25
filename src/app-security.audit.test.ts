/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import appSource from '../App.tsx?raw';
import stylesSource from './ui/styles.ts?raw';
import tabsSource from './ui/tabs.tsx?raw';
import expoConfig from '../app.config.js?raw';

describe('mobile wallet UX and security invariants', () => {
  it('keeps password encryption when biometric quick unlock is enabled', () => {
    expect(appSource).toContain('await saveBiometricSecret(password);');
    expect(appSource).toContain('void unlockSavedWallet(false);');
    expect(appSource).toContain('void unlockSavedWallet(true);');
  });

  it('never enables biometrics without an explicit opt-in backed by the password', () => {
    expect(appSource).not.toContain('const [persistWithBiometrics');
    expect(appSource).toContain("setSensitiveAction('enableBiometrics');");
    expect(appSource).toContain('await enableBiometricUnlock(vaultSecret);');
    expect(appSource).toMatch(/encryptVault\(\s*\{[\s\S]*?\},\s*persistPassword,\s*false,\s*'password',/);
  });

  it('only offers biometrics inside the authenticated persist flow', () => {
    expect(appSource).toContain('const askBiometricOptIn = () =>');
    expect(appSource).toContain('cancelable: false');
    expect(appSource).toMatch(/await askBiometricOptIn\(\)\) \{[\s\S]*?enableBiometricUnlock\(persistPassword, walletToPersist\.mnemonic\)/);
    expect(appSource).toMatch(/enableBiometricUnlock\(persistPassword[\s\S]*?setPersistPassword\(''\);/);
    expect(appSource).toContain('disableDeviceFallback: true');
    expect(appSource).toContain('if (!persistingMnemonic && !walletRef.current) {');
  });

  it('never unlocks itself right after the wallet was locked', () => {
    expect(appSource).toMatch(/const lockWallet = useCallback\(\(\) => \{\s*lockedDuringSessionRef\.current = true;/);
    expect(appSource).toContain('|| lockedDuringSessionRef.current');
    expect(appSource).toContain('&& !lockedDuringSessionRef.current');
  });

  it('never re-prompts biometrics automatically once the user dismissed it', () => {
    expect(appSource).toContain('biometricDismissedRef.current = true;');
    expect(appSource).toContain('|| biometricDismissedRef.current');
    expect(appSource).toContain('&& !biometricDismissedRef.current');
    expect(appSource).toContain('&& biometricInterruptedRef.current');
    expect(appSource).toMatch(/if \(auto\) \{\s*return;/);
  });

  it('clears the typed vault password when the wallet locks', () => {
    expect(appSource).toMatch(/const lockWallet = useCallback\(\(\) => \{[\s\S]*?setSensitivePassword\(''\);/);
  });

  it('lets the user turn biometric unlock off again without losing the vault', () => {
    expect(appSource).toContain('const disableBiometricUnlock = async ()');
    expect(appSource).toContain('SecureStore.deleteItemAsync(BIOMETRIC_SECRET_KEY)');
    expect(appSource).toContain("saveVault({ ...vault, biometricsEnabled: false, unlockMode: 'password' })");
  });

  it('renders blocking work above the scroll view with a rotating Nito logo', () => {
    const scrollViewEnd = appSource.indexOf('</ScrollView>');
    const loadingOverlay = appSource.indexOf('{pendingAction ? (', scrollViewEnd);
    expect(scrollViewEnd).toBeGreaterThan(0);
    expect(loadingOverlay).toBeGreaterThan(scrollViewEnd);
    expect(stylesSource).toContain('...StyleSheet.absoluteFill');
    expect(appSource).toContain('transform: [{ rotate: loadingRotation }]');
  });

  it('clips the QR background and preserves splash artwork proportions', () => {
    expect(tabsSource).toContain('quietZone={12}');
    expect(stylesSource).toMatch(/qrPlaceholder:[\s\S]*?overflow: 'hidden'/);
    expect(expoConfig).toContain('"expo-splash-screen"');
    expect(expoConfig).toContain('resizeMode: "contain"');
  });
});
