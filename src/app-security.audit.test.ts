/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import appSource from '../App.tsx?raw';
import amountFormatSource from './i18n.amounts.ts?raw';
import formatSource from './ui/format.ts?raw';
import stylesSource from './ui/styles.ts?raw';
import tabsSource from './ui/tabs.tsx?raw';
import vaultSource from './services/vault.ts?raw';
import vaultCryptoSource from './services/vaultCrypto.ts?raw';
import screensSource from './ui/screens.tsx?raw';
import subscriptionsSource from './hooks/useWalletSubscriptions.ts?raw';
import transparentScanSource from './wallet/transparentScan.ts?raw';
import coinbaseSource from './wallet/coinbaseMaturity.ts?raw';
import historyDbSource from './services/walletHistoryDb.ts?raw';
import networkControllerSource from './services/walletNetworkController.ts?raw';
import exclusiveActionGateSource from './services/exclusiveActionGate.ts?raw';
import vaultSessionMachineSource from './services/vaultSessionMachine.ts?raw';
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
    expect(appSource).toContain('await deleteBiometricSecret();');
    expect(appSource).toContain("saveVault({ ...vault, biometricsEnabled: false, unlockMode: 'password' })");
  });

  it('keeps the vault at rest encrypted and device-bound', () => {
    expect(vaultCryptoSource).toContain('nacl.secretbox(plaintext, nonce, key)');
    expect(vaultCryptoSource).toContain('rounds: PBKDF2_ROUNDS');
    expect(vaultSource).toMatch(/setItemAsync\(\s*VAULT_KEY[\s\S]*?WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
    expect(vaultSource).toMatch(/setItemAsync\(\s*BIOMETRIC_SECRET_KEY[\s\S]*?requireAuthentication: true/);
    expect(vaultSource).toMatch(/getItemAsync\(BIOMETRIC_SECRET_KEY,[\s\S]*?requireAuthentication: true/);
  });

  it('binds deferred wallet writes to the active wallet session', () => {
    expect(networkControllerSource).toContain('readonly sessions = new WalletSessionGuard();');
    expect(networkControllerSource).toContain('return this.sessions.begin(walletAddress);');
    expect(networkControllerSource).toMatch(/cancel\(\): void \{[\s\S]*?this\.sessions\.invalidate\(\);/);
    expect(appSource).toContain('walletNetworkController.sessions.capture(activeWallet.address)');
    expect(appSource.match(/walletNetworkController\.isCurrent\(session\)/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
    expect(appSource).toContain('startBroadcastReconciliation([txid], session)');
    expect(appSource).toContain('startBroadcastReconciliation(txids, session)');
    expect(appSource).toMatch(
      /reconcileBroadcasts\(txids, session\)\.catch\(reportNetworkFailure\)/,
    );
  });

  it('bounds broadcast reconciliation and exposes transparent scan progress', () => {
    expect(networkControllerSource).toMatch(
      /mapWithConcurrency\(txids, BROADCAST_RECONCILIATION_CONCURRENCY,/,
    );
    expect(networkControllerSource).toMatch(/scanWalletNetwork\(\{[\s\S]*?onProgress,/);
    expect(networkControllerSource).toContain('ports.setHistoryProgress({ done, total });');
  });

  it('never disguises a failed financial read or write as complete data', () => {
    expect(networkControllerSource).not.toMatch(/options\.silent[\s\S]{0,300}status: 'connected'/);
    expect(networkControllerSource).not.toContain('client.connect().catch(() => undefined)');
    expect(appSource).not.toMatch(/saveEnrichedHistoryRecords\([\s\S]{0,700}\.catch\(\(\) => undefined\)/);
    expect(transparentScanSource).not.toContain('.catch(() => undefined)');
    expect(coinbaseSource).not.toMatch(/catch\s*\{\s*return utxo;/);
    expect(historyDbSource).not.toMatch(
      /ALTER TABLE wallet_transactions ADD COLUMN \$\{column\};`\)\.catch\(\(\) => undefined\)/,
    );
    expect(historyDbSource).toContain('retrySqliteWrite');
    expect(networkControllerSource).toMatch(/cacheReadFailed[\s\S]*?scanTransparentWallet/);
    expect(networkControllerSource).toMatch(
      /caught instanceof ElectrumSessionUnhealthyError[\s\S]*?await client\.connect\(\)[\s\S]*?return scan\(\)/,
    );
    expect(networkControllerSource).toMatch(/network: preloaded \? \{\s*status: 'syncing'/);
  });

  it('keeps confirmed transactions visible when enrichment is unavailable', () => {
    expect(tabsSource).toContain('const historyEntries = network.snapshot?.history ?? [];');
  });

  it('reports subscription read failures instead of dropping the subscription silently', () => {
    expect(subscriptionsSource).toContain('onConnectionError');
    expect(subscriptionsSource).toMatch(/catch \(error\) \{[\s\S]*?onConnectionError\(error\);/);
  });

  it('queues Electrum events received during synchronization and serializes subscription refreshes', () => {
    expect(networkControllerSource).toContain('private readonly dirty = new DirtySyncQueue()');
    expect(networkControllerSource).toContain('this.dirty.request(options, this.syncing, requestSync)');
    expect(subscriptionsSource).toContain('flushPendingSync');
    expect(subscriptionsSource).toContain('synchronization: { controller, request: requestSync }');
    expect(subscriptionsSource).toMatch(/const activeRefresh = refreshPromiseRef\.current;[\s\S]*?await activeRefresh;/);
    expect(appSource).toContain('subscriptionSyncFlushRef.current();');
  });

  it('honors forced gap rescans, implements pending-only refresh and clears the QR retry timer', () => {
    expect(networkControllerSource).toMatch(
      /!options\.force[\s\S]{0,100}!options\.rescanGap[\s\S]{0,200}cacheAlreadyFresh/,
    );
    expect(networkControllerSource).toContain('pendingRefreshAddresses');
    expect(appSource).toContain('qrRetryTimerRef');
    expect(appSource).toContain('clearTimeout(qrRetryTimerRef.current)');
  });

  it('keeps exclusive actions and vault transitions in testable state machines', () => {
    expect(exclusiveActionGateSource).toContain('if (this.current !== null)');
    expect(exclusiveActionGateSource).toMatch(/finally \{[\s\S]*?this\.current = null;/);
    expect(vaultSessionMachineSource).toContain("status: 'absent' | 'locked' | 'unlocked'");
    expect(vaultSessionMachineSource).toContain('requirePersistedVault(state)');
    expect(appSource).toContain('applyVaultTransition');
  });

  it('never lets a prepared multi-recipient send coexist with a prepared consolidation', () => {
    expect(appSource).toMatch(
      /const prepareTransparentSend = async \(\) => \{\s*await runExclusiveAction\('prepare'/,
    );
    expect(appSource).toMatch(
      /const prepareTransparentConsolidation = async \(\) => \{\s*await runExclusiveAction\('consolidate'/,
    );
    expect(appSource).toMatch(
      /const prepareTransparentSend[\s\S]*?setPreparedConsolidation\(null\);\s*setPreparedTx\(tx\);/,
    );
    expect(appSource).toMatch(
      /const prepareTransparentConsolidation[\s\S]*?setPreparedTx\(null\);\s*setPreparedConsolidation\(plan\);/,
    );
  });

  it('never recreates or replaces a vault after a stale PBKDF2 upgrade', () => {
    expect(appSource).toContain(
      'const upgradeCommit = prepareVaultUpgradeCommit(upgraded, latest, payload.address);',
    );
    expect(appSource).toMatch(/if \(!upgradeCommit\) \{\s*return;\s*\}\s*await saveVault\(upgradeCommit\);/);
  });

  it('renders blocking work above the scroll view with a rotating Nito logo', () => {
    const scrollViewEnd = appSource.indexOf('</ScrollView>');
    const loadingOverlay = appSource.indexOf('{pendingAction ? (', scrollViewEnd);
    expect(scrollViewEnd).toBeGreaterThan(0);
    expect(loadingOverlay).toBeGreaterThan(scrollViewEnd);
    expect(appSource).toContain('rotation={loadingRotation}');
    expect(stylesSource).toContain('...StyleSheet.absoluteFill');
    expect(screensSource).toMatch(/LoadingOverlay[\s\S]*?transform: \[\{ rotate: rotation \}\]/);
  });

  it('clips the QR background and preserves splash artwork proportions', () => {
    expect(tabsSource).toContain('quietZone={12}');
    expect(stylesSource).toMatch(/qrPlaceholder:[\s\S]*?overflow: 'hidden'/);
    expect(expoConfig).toContain('"expo-splash-screen"');
    expect(expoConfig).toContain('resizeMode: "contain"');
  });

  it('formats wallet amounts without relying on device Intl or a hard-coded locale', () => {
    expect(amountFormatSource).not.toContain('toLocaleString');
    expect(formatSource).not.toContain("toLocaleString('fr-FR')");
    expect(transparentScanSource).not.toContain("toLocaleString('fr-FR')");
    expect(amountFormatSource).toContain("hi: { groupSeparator: ',', decimalSeparator: '.', grouping: 'indian' }");
    expect(amountFormatSource).toContain("fr: { groupSeparator: '\\u202f'");
  });
});
