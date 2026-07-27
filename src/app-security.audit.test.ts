/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import appSource from '../App.tsx?raw';
import appStateSecuritySource from './services/appStateSecurity.ts?raw';
import amountFormatSource from './i18n.amounts.ts?raw';
import constantsSource from './constants/nito.ts?raw';
import i18nSource from './i18n.ts?raw';
import completeI18nSource from './i18n.complete.ts?raw';
import formatSource from './ui/format.ts?raw';
import stylesSource from './ui/styles.ts?raw';
import tabsSource from './ui/tabs.tsx?raw';
import sessionSource from './services/session.ts?raw';
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
    expect(appSource).toMatch(
      /const lockWallet = useCallback\(\(\) => \{\s*if \(walletLockAppliedRef\.current\) return;\s*walletLockAppliedRef\.current = true;\s*lockedDuringSessionRef\.current = true;/,
    );
    expect(appSource).toContain('|| lockedDuringSessionRef.current');
    expect(appStateSecuritySource).toContain('&& !lockedDuringSessionRef.current');
  });

  it('locks every wallet background transition independently of the previous state and system prompts', () => {
    expect(appStateSecuritySource).toContain('shouldLockWalletForAppState({');
    expect(appStateSecuritySource).not.toMatch(
      /previousState === 'active'[\s\S]{0,180}lockWallet\(\);/,
    );
  });

  it('registers one AppState listener that reads current security state from refs', () => {
    expect(appSource).toMatch(
      /const subscription = AppState\.addEventListener\(\s*'change',\s*createWalletAppStateChangeHandler\(\{/,
    );
    expect(appSource).toMatch(
      /createWalletAppStateChangeHandler\(\{[\s\S]*?unlockSavedWalletRef,\s*\}\),\s*\);\s*return \(\) => subscription\.remove\(\);\s*\}, \[\]\);/,
    );
    expect(appStateSecuritySource).toContain("walletOpen: screenRef.current === 'wallet'");
    expect(appStateSecuritySource).not.toContain("walletOpen: screen === 'wallet'");
  });

  it('never re-prompts biometrics automatically once the user dismissed it', () => {
    expect(appSource).toContain('biometricDismissedRef.current = true;');
    expect(appSource).toContain('|| biometricDismissedRef.current');
    expect(appStateSecuritySource).toContain('&& !biometricDismissedRef.current');
    expect(appStateSecuritySource).toContain('&& biometricInterruptedRef.current');
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
    expect(appSource).toContain('processHistoryEnrichmentPasses({');
    expect(appSource).toContain("sessionCurrent ? 'failed' : 'interrupted'");
    expect(networkControllerSource).toContain('requestOrQueueEnrichment(');
    expect(appSource).toContain(
      'walletNetworkController.requestOrQueueEnrichment(enrichWalletHistoryRef.current);',
    );
    expect(appSource).toContain(
      'walletNetworkController.finishEnrichment(enrichWalletHistoryRef.current);',
    );
    expect(appSource).toMatch(
      /nextNetwork\.status === 'connected'[\s\S]{0,240}releaseFailedHistoryEnrichmentAttempts\([\s\S]{0,240}requestOrQueueEnrichment\(enrichWalletHistoryRef\.current\)/,
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

  it('keeps field validation beside the edited value and removes recipient review numbering', () => {
    expect(tabsSource).toContain('recipientErrors[recipient.id]?.address');
    expect(tabsSource).toContain('recipientErrors[recipient.id]?.amount');
    expect(tabsSource).toContain('customServerError');
    expect(tabsSource).not.toContain('`${index + 1}. ${satoshisToNito');
    expect(appSource).toContain('setUnlockPasswordError');
    expect(appSource).toContain('setPersistPasswordError');
    expect(appSource).toContain('setImportFieldError');
    expect(appSource).toContain('setSensitivePasswordError');
  });

  it('always arms an inactivity timer with one of the supported non-zero durations', () => {
    expect(constantsSource).not.toMatch(/AUTO_LOCK_TIMEOUT_OPTIONS_MS\s*=\s*\[\s*0,/);
    expect(sessionSource).not.toContain('this.timeoutMs === 0');
    expect(i18nSource).not.toContain('settings.autoLockImmediate');
    expect(completeI18nSource).not.toContain('settings.autoLockImmediate');
  });

  it('keeps advanced security and network settings collapsed until requested', () => {
    expect(tabsSource).toContain(
      'const [autoLockExpanded, setAutoLockExpanded] = useState(false);',
    );
    expect(tabsSource).toContain(
      'const [customElectrumExpanded, setCustomElectrumExpanded] = useState(false);',
    );
    expect(tabsSource).toContain('accessibilityState={{ expanded }}');
    expect(tabsSource).toContain(
      "label={`${t('settings.autoLockTitle')}: ${t(AUTO_LOCK_LABEL_KEYS[settings.autoLockTimeoutMs])}`}",
    );
    expect(tabsSource).toMatch(
      /settings\.onSelectAutoLockTimeout\(option\);\s*setAutoLockExpanded\(false\);/,
    );
    expect(tabsSource).toMatch(
      /electrumServerPreference\.mode === 'custom'\s*\? t\('settings\.customElectrumActive'\)\s*: t\('settings\.customElectrumInactive'\)/,
    );
    expect(tabsSource).toContain(
      "label={`${t('settings.customElectrumTitle')}: ${customElectrumState}`}",
    );
    expect(tabsSource).toMatch(
      /customElectrumExpanded \? \([\s\S]*?settings\.customElectrumRisk[\s\S]*?settings\.customElectrumCertificateWarning/,
    );
  });

  it('colors the connection text from the exact NetworkState status', () => {
    expect(tabsSource).toMatch(
      /NETWORK_STATUS_STYLES[\s\S]*?idle: styles\.networkStatusError[\s\S]*?syncing: styles\.networkStatusSyncing[\s\S]*?connected: styles\.networkStatusConnected[\s\S]*?error: styles\.networkStatusError/,
    );
    expect(tabsSource).toContain('valueStyle={NETWORK_STATUS_STYLES[network.status]}');
    expect(stylesSource).toContain('networkStatusConnected');
    expect(stylesSource).toContain('networkStatusSyncing');
    expect(stylesSource).toContain('networkStatusError');
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
    const loadingOverlay = appSource.indexOf(
      '{shouldShowBlockingLoadingOverlay(pendingAction) ? (',
      scrollViewEnd,
    );
    expect(scrollViewEnd).toBeGreaterThan(0);
    expect(loadingOverlay).toBeGreaterThan(scrollViewEnd);
    expect(appSource).toContain('rotation={loadingRotation}');
    expect(stylesSource).toContain('...StyleSheet.absoluteFill');
    expect(screensSource).toMatch(/LoadingOverlay[\s\S]*?transform: \[\{ rotate: rotation \}\]/);
  });

  it('shows manual history resynchronization in the history tab instead of a blocking overlay', () => {
    expect(appSource).toMatch(
      /runExclusiveAction\('resynchronizeHistory',[\s\S]*?setWalletTab\('history'\);[\s\S]*?syncTransparentNetwork\(true, \{ force: true, rescanGap: true \}\)/,
    );
    expect(appSource).toContain('shouldShowBlockingLoadingOverlay(pendingAction)');
  });

  it('scrolls both prepared transaction reviews into view after layout', () => {
    expect(appSource).toContain('const walletScrollRef = useRef<ScrollView | null>(null);');
    expect(appSource).toContain('walletScrollRef.current?.scrollToEnd({ animated: true });');
    expect(appSource).toContain('onPreparedReviewLayout={scrollToPreparedReview}');
    expect(tabsSource.match(/onLayout=\{onPreparedReviewLayout\}/g)).toHaveLength(2);
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

  it('keeps the main balance fixed at eight decimals without a persisted display preference', () => {
    expect(appSource).not.toContain('useBalanceDecimals');
    expect(tabsSource).not.toContain('balanceDecimals');
    expect(formatSource).not.toContain('BALANCE_DECIMAL_OPTIONS');
    expect(formatSource).not.toContain('markTruncated');
    expect(amountFormatSource).not.toContain('markTruncated');
    expect(i18nSource).not.toContain('security.balanceDecimals');
    expect(stylesSource).not.toContain('balanceDecimals');
  });
});
