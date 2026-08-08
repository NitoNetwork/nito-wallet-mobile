/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import appSource from '../App.tsx?raw';
import vaultCryptoSource from './services/vaultCrypto.ts?raw';
import appStateSecuritySource from './services/appStateSecurity.ts?raw';
import amountFormatSource from './i18n.amounts.ts?raw';
import dateFormatSource from './i18n.datetime.ts?raw';
import constantsSource from './constants/nito.ts?raw';
import enI18nSource from './i18n/en.ts?raw';
import frI18nSource from './i18n/fr.ts?raw';
import formatSource from './ui/format.ts?raw';
import componentsSource from './ui/components.tsx?raw';
import stylesSource from './ui/styles.ts?raw';
import tabsSource from './ui/tabs.tsx?raw';
import settingsSource from './ui/settings.tsx?raw';
import themeContextSource from './ui/themeContext.tsx?raw';
import sessionSource from './services/session.ts?raw';
import vaultSource from './services/vault.ts?raw';
import screensSource from './ui/screens.tsx?raw';
import subscriptionsSource from './hooks/useWalletSubscriptions.ts?raw';
import screenProtectionSource from './hooks/useWalletScreenProtection.ts?raw';
import screenProtectionPolicySource from './services/screenProtection.ts?raw';
import transparentScanSource from './wallet/transparentScan.ts?raw';
import coinbaseSource from './wallet/coinbaseMaturity.ts?raw';
import historyDbSource from './services/walletHistoryDb.ts?raw';
import historyEnrichmentQueueSource from './services/historyEnrichmentQueue.ts?raw';
import networkControllerSource from './services/walletNetworkController.ts?raw';
import exclusiveActionGateSource from './services/exclusiveActionGate.ts?raw';
import vaultSessionMachineSource from './services/vaultSessionMachine.ts?raw';
import expoConfig from '../app.config.js?raw';
import androidLintFixesSource from '../plugins/withNitoAndroidLintFixes.cjs?raw';
import nativeCryptoSource from '../native/nito-wallet-crypto/src/lib.rs?raw';
import cargoConfigSource from '../.cargo/config.toml?raw';
import androidWorkflowSource from '../.github/workflows/android-apk.yml?raw';
import iosWorkflowSource from '../.github/workflows/ios-device-app.yml?raw';
import packageJsonSource from '../package.json?raw';
import diceSource from './ui/dice.tsx?raw';
import diceEntropySource from './ui/diceEntropy.ts?raw';

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
    expect(appStateSecuritySource).toMatch(
      /if \(shouldLockWalletForAppState\(\{[\s\S]*?\}\)\) \{\s*lockWalletRef\.current\(\);\s*\}/,
    );
  });

  it('registers one AppState listener that reads current security state from refs', () => {
    expect(appSource).toMatch(
      /const subscription = AppState\.addEventListener\(\s*'change',\s*createWalletAppStateChangeHandler\(\{/,
    );
    expect(appSource).toMatch(
      /createWalletAppStateChangeHandler\(\{[\s\S]*?unlockSavedWalletRef,\s*\}\),\s*\);\s*return \(\) => subscription\.remove\(\);\s*\}, \[\]\);/,
    );
    expect(appStateSecuritySource).toContain(
      "sensitiveWalletState: screenRef.current === 'wallet' || screenRef.current === 'persist'",
    );
    expect(appStateSecuritySource).not.toContain("sensitiveWalletState: screen === 'wallet'");
    expect(appSource).toMatch(
      /setScreen\('wallet'\);\s*if \(lockWalletIfAppStateBackground\(\s*appStateRef\.current,\s*lockWalletRef\.current,\s*\)\) return;/,
    );
    expect(appSource).toMatch(
      /systemPromptActiveRef\.current = true;\s*biometricPromptGuardActive = true;\s*const secret = await loadBiometricSecret\(\);[\s\S]*?enterWallet\([\s\S]*?\} finally \{\s*if \(biometricPromptGuardActive\) \{\s*systemPromptActiveRef\.current = false;/,
    );
  });

  it('requires a visible and verified backup before persisting a created seed', () => {
    expect(appSource).toMatch(
      /const mnemonic = await generateMnemonic24\(userPoolBase64\);[\s\S]*?setPendingWalletRequiresSeedBackup\(true\);/,
    );
    expect(appSource).toMatch(
      /if \(\s*pendingWalletRequiresSeedBackup[\s\S]*?seedBackupConfirmationStep < seedBackupChallenges\.length[\s\S]*?return;/,
    );
    expect(screensSource).toContain('<MnemonicGrid mnemonic={pendingWallet.mnemonic} />');
    expect(settingsSource).toContain('<MnemonicGrid mnemonic={settings.wallet.mnemonic} />');
    expect(componentsSource).toContain('numberSeedBackupWords(mnemonic).map');
    expect(componentsSource).toMatch(
      /<Text[\s\S]*?selectable[\s\S]*?>\s*\{numberedWord\}\s*<\/Text>/,
    );
    expect(screensSource).not.toContain('numberSeedBackupWords');
    expect(settingsSource).not.toContain('numberSeedBackupWords');
    expect(screensSource).toContain("t('persist.seedBackupConfirmInstruction'");
    const persistScreenSource = screensSource.slice(
      screensSource.indexOf('export function PersistScreen'),
      screensSource.indexOf('export function WalletShell'),
    );
    expect(persistScreenSource).not.toContain('<TextInput');
  });

  it('never re-prompts biometrics automatically once the user dismissed it', () => {
    expect(appSource).toContain('biometricDismissedRef.current = true;');
    expect(appSource).toContain('|| biometricDismissedRef.current');
    expect(appStateSecuritySource).toContain('&& !biometricDismissedRef.current');
    expect(appStateSecuritySource).toContain('&& biometricInterruptedRef.current');
    expect(appSource).toMatch(/if \(auto\) \{\s*return;/);
  });

  it('clears the typed vault password when the wallet locks', () => {
    expect(appSource).toMatch(
      /const lockWallet = useCallback\(\(\) => \{[\s\S]*?setUnlockPassword\(''\);[\s\S]*?setPersistPassword\(''\);[\s\S]*?setSensitivePassword\(''\);/,
    );
  });

  it('disconnects Electrum when the wallet locks or is deleted', () => {
    expect(appSource).toMatch(
      /const lockWallet = useCallback\(\(\) => \{[\s\S]*?electrumClientRef\.current\?\.disconnect\(new Error\('Wallet locked\.'\)\);[\s\S]*?electrumClientRef\.current = null;/,
    );
    expect(appSource).toMatch(
      /await deleteVault\(\);[\s\S]*?electrumClientRef\.current\?\.disconnect\(new Error\('Wallet deleted\.'\)\);[\s\S]*?electrumClientRef\.current = null;/,
    );
  });

  it('protects recovery phrase displays without blocking ordinary wallet captures', () => {
    expect(appSource).toContain('protectRecoveryPhrase: shouldProtectRecoveryPhrase({');
    expect(appSource).toContain('seedBackupConfirmationStep < 0');
    expect(appSource).toMatch(
      /if \(nextTab !== 'security'\) \{\s*setShowMnemonic\(false\);/,
    );
    expect(screenProtectionSource).toContain('preventScreenCaptureAsync(SCREEN_CAPTURE_KEY)');
    expect(screenProtectionSource).toContain('enableAppSwitcherProtectionAsync(1)');
    expect(screenProtectionSource).toContain('allowScreenCaptureAsync(SCREEN_CAPTURE_KEY)');
    expect(screenProtectionPolicySource).toContain(
      "screen === 'persist' && createdPhraseVisible",
    );
    expect(screenProtectionPolicySource).toContain(
      "screen === 'wallet' && walletTab === 'security' && settingsPhraseVisible",
    );
    expect(screenProtectionPolicySource).not.toContain("screen === 'import'");
    expect(screenProtectionPolicySource).not.toContain("screen === 'unlock'");
  });

  it('removes unused photo-library permissions without disabling screen protection', () => {
    const blockedPermissions = expoConfig.match(
      /blockedPermissions:\s*\[([\s\S]*?)\]/,
    )?.[1];
    expect(blockedPermissions).toContain('"android.permission.READ_MEDIA_IMAGES"');
    expect(androidLintFixesSource).toContain("'android.permission.READ_MEDIA_IMAGES'");
    expect(androidLintFixesSource).toContain(
      "const isRemovalMarker = permission.$?.['tools:node'] === 'remove';",
    );
    expect(androidLintFixesSource).toContain(
      "permission.$['android:maxSdkVersion'] = '32';",
    );
    expect(androidLintFixesSource).toContain(
      'return isRemovalMarker || !blockedPermissions.has(permissionName);',
    );
    expect(screenProtectionSource).not.toContain('addScreenshotListener');
    expect(screenProtectionSource).not.toContain('useScreenshotListener');
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
    expect(appSource).toContain(
      ": retryableFailure ? 'retryable-failure' : 'failed';",
    );
    expect(appSource).toContain('isRetryableHistoryEnrichmentFailure(caught, activeBatch)');
    expect(appSource).toContain('historyEnrichmentRetryScheduler.schedule(');
    expect(appSource).toMatch(
      /screenRef\.current === 'wallet'[\s\S]{0,160}walletNetworkController\.isCurrent\(session\)/,
    );
    expect(historyEnrichmentQueueSource).toContain(
      'const HISTORY_ENRICHMENT_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000];',
    );
    expect(networkControllerSource).toContain('requestOrQueueEnrichment(');
    expect(appSource).toContain(
      'walletNetworkController.requestOrQueueEnrichment(enrichWalletHistoryRef.current);',
    );
    expect(appSource).toContain(
      'walletNetworkController.finishEnrichment(enrichWalletHistoryRef.current);',
    );
    expect(appSource).toMatch(
      /publishedNetwork\.status === 'connected'[\s\S]{0,240}releaseFailedHistoryEnrichmentAttempts\([\s\S]{0,240}requestOrQueueEnrichment\(enrichWalletHistoryRef\.current\)/,
    );
  });

  it('routes every in-memory network publication through one history-preserving owner', () => {
    expect(appSource.match(/networkRef\.current\s*=/g)).toHaveLength(1);
    expect(appSource.match(/setNetwork\(/g)).toHaveLength(1);
    expect(appSource).toContain('mergeWalletNetworkPublication(');
    expect(networkControllerSource).toContain('mergeWalletNetworkPublication(');
  });

  it('persists mempool enrichment instead of keeping it in memory only', () => {
    expect(appSource).not.toMatch(
      /\.filter\(\(record\) => record\.blockHeight > 0\)/,
    );
  });

  it('bounds broadcast reconciliation and exposes transparent scan progress', () => {
    expect(networkControllerSource).toMatch(
      /mapWithConcurrency\(txids, BROADCAST_RECONCILIATION_CONCURRENCY,/,
    );
    expect(networkControllerSource).toMatch(/scanWalletNetwork\(\{[\s\S]*?onProgress,/);
    expect(networkControllerSource).toContain('ports.setHistoryProgress({ done, total });');
    expect(networkControllerSource).toContain('includeHistory: true');
    expect(networkControllerSource).not.toContain('fullHistoryByDefault');
    expect(appSource).not.toContain('HISTORY_AUTO_IMPORT');
  });

  it('never disguises a failed financial read or write as complete data', () => {
    expect(networkControllerSource).not.toMatch(/options\.silent[\s\S]{0,300}status: 'connected'/);
    expect(networkControllerSource).not.toContain('client.connect().catch(() => undefined)');
    expect(appSource).not.toMatch(/saveHistoryEnrichmentBatch\([\s\S]{0,700}\.catch\(\(\) => undefined\)/);
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
    expect(subscriptionsSource).toMatch(
      /catch \(error\) \{[\s\S]*?reportConnectionErrorIfCurrent\(error\);/,
    );
    expect(subscriptionsSource).toContain('subscriptionRunGuardRef.current.invalidate();');
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
    expect(settingsSource).toContain('customServerError');
    expect(tabsSource).not.toContain('`${index + 1}. ${satoshisToNito');
    expect(appSource).toContain('setUnlockPasswordError');
    expect(appSource).toContain('setPersistPasswordError');
    expect(appSource).toContain('setImportFieldError');
    expect(appSource).toContain('setSensitivePasswordError');
  });

  it('always arms an inactivity timer with one of the supported non-zero durations', () => {
    expect(constantsSource).not.toMatch(/AUTO_LOCK_TIMEOUT_OPTIONS_MS\s*=\s*\[\s*0,/);
    expect(sessionSource).not.toContain('this.timeoutMs === 0');
    expect(enI18nSource).not.toContain('settings.autoLockImmediate');
    expect(frI18nSource).not.toContain('settings.autoLockImmediate');
  });

  it('keeps advanced security and network settings collapsed until requested', () => {
    expect(settingsSource).toContain(
      'const [autoLockExpanded, setAutoLockExpanded] = useState(false);',
    );
    expect(settingsSource).toContain(
      'const [customElectrumExpanded, setCustomElectrumExpanded] = useState(false);',
    );
    expect(settingsSource).toContain('accessibilityState={{ expanded }}');
    expect(settingsSource).toContain(
      "label={`${t('settings.autoLockTitle')}: ${t(AUTO_LOCK_LABEL_KEYS[settings.autoLockTimeoutMs])}`}",
    );
    expect(settingsSource).toMatch(
      /settings\.onSelectAutoLockTimeout\(option\);\s*setAutoLockExpanded\(false\);/,
    );
    expect(settingsSource).toMatch(
      /electrumServerPreference\.mode === 'custom'\s*\? t\('settings\.customElectrumActive'\)\s*: t\('settings\.customElectrumInactive'\)/,
    );
    expect(settingsSource).toContain(
      "label={`${t('settings.customElectrumTitle')}: ${customElectrumState}`}",
    );
    expect(settingsSource).toMatch(
      /customElectrumExpanded \? \([\s\S]*?settings\.customElectrumRisk[\s\S]*?settings\.customElectrumCertificateWarning/,
    );
    expect(
      settingsSource.match(/label=\{t\('actions\.useOfficialElectrum'\)\}/g),
    ).toHaveLength(1);
    expect(settingsSource).toMatch(
      /customElectrumExpanded \? \(\s*<View[^>]*>\s*\{electrumServerPreference\.mode !== 'official' \? \(\s*<>\s*<ActionButton[\s\S]*?actions\.useOfficialElectrum[\s\S]*?electrumServerPreference\.mode === 'recovery'[\s\S]*?settings\.customElectrumRecovery[\s\S]*?settings\.customElectrumHint/,
    );
  });

  it('colors the connection text from the exact NetworkState status', () => {
    expect(settingsSource).toMatch(
      /NETWORK_STATUS_STYLE_KEYS[\s\S]*?idle: 'networkStatusError'[\s\S]*?syncing: 'networkStatusSyncing'[\s\S]*?connected: 'networkStatusConnected'[\s\S]*?error: 'networkStatusError'/,
    );
    expect(settingsSource).toContain('valueStyle={styles[NETWORK_STATUS_STYLE_KEYS[network.status]]}');
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

  it('surfaces failures from every user-triggered asynchronous platform action', () => {
    expect(appSource).toMatch(
      /try \{\s*await deleteBiometricSecret\(\);[\s\S]*?await saveVault\(encrypted\);[\s\S]*?catch \(caught\) \{\s*setError\(translatedErrorMessage\([\s\S]*?errors\.saveFailed/,
    );
    expect(appSource).toMatch(
      /await Clipboard\.setStringAsync\(wallet\.address\);[\s\S]*?catch \(caught\) \{\s*setError\(translatedErrorMessage\([\s\S]*?errors\.addressCopyFailed/,
    );
    expect(appSource).toMatch(
      /await openTransactionExplorer\(txid\);[\s\S]*?catch \(caught\) \{\s*setError\(translatedErrorMessage\([\s\S]*?errors\.explorerUnavailable/,
    );
    expect(appSource).toMatch(
      /await requestCameraPermission\(\);[\s\S]*?catch \(caught\) \{[\s\S]*?setError\(translatedErrorMessage\([\s\S]*?errors\.cameraUnavailable/,
    );
    expect(appSource).not.toContain('void openTransactionExplorer(txid);');
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
    const resyncStart = appSource.indexOf('const resynchronizeWalletHistory = async () =>');
    const resyncEnd = appSource.indexOf('const askResynchronizeWalletHistory = () =>', resyncStart);
    const resyncSource = appSource.slice(resyncStart, resyncEnd);
    const sqliteClear = resyncSource.indexOf('await clearWalletHistoryCache(activeWallet.address);');
    const memoryReset = resyncSource.indexOf("}, activeWallet.address, 'replace');");
    const attemptedReset = resyncSource.indexOf('enrichAttemptedRef.current.clear();');
    const freshScan = resyncSource.indexOf(
      'syncTransparentNetwork(true, { force: true, rescanGap: true })',
    );
    expect(resyncStart).toBeGreaterThanOrEqual(0);
    expect(resyncEnd).toBeGreaterThan(resyncStart);
    expect(sqliteClear).toBeGreaterThanOrEqual(0);
    expect(memoryReset).toBeGreaterThan(sqliteClear);
    expect(attemptedReset).toBeGreaterThan(memoryReset);
    expect(freshScan).toBeGreaterThan(attemptedReset);
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
    for (const interfaceSource of [
      componentsSource,
      screensSource,
      settingsSource,
      tabsSource,
      themeContextSource,
    ]) {
      expect(interfaceSource).not.toMatch(/\.toLocaleString\(/);
    }
    expect(amountFormatSource).toContain("de: { groupSeparator: '.', decimalSeparator: ',' }");
    expect(amountFormatSource).toContain("fr: { groupSeparator: '\\u202f'");
    // Dates share the same rule: a fixed table, never the device locale data.
    // Matching the call form, not the bare word, so the comment that explains
    // why we avoid it does not trip the check.
    expect(dateFormatSource).not.toMatch(/\.toLocale(Date|Time|)String\(/);
    expect(dateFormatSource).not.toMatch(/\bIntl\./);
    expect(dateFormatSource).toContain('NITO_DATE_FORMATS');
  });

  it('keeps the main balance fixed at eight decimals without a persisted display preference', () => {
    expect(appSource).not.toContain('useBalanceDecimals');
    expect(tabsSource).not.toContain('balanceDecimals');
    expect(formatSource).not.toContain('BALANCE_DECIMAL_OPTIONS');
    expect(formatSource).not.toContain('markTruncated');
    expect(amountFormatSource).not.toContain('markTruncated');
    expect(enI18nSource).not.toContain('security.balanceDecimals');
    expect(stylesSource).not.toContain('balanceDecimals');
  });
});

describe('password policy is declared once', () => {
  it('enforces the creation floor from the named constant', () => {
    expect(appSource).toContain('persistPassword.length < PASSWORD_MIN_LENGTH');
    expect(appSource).not.toMatch(/persistPassword\.length < \d/);
  });

  it('keeps the unlock guard below the policy so an older vault is never locked out', () => {
    // Raising this to PASSWORD_MIN_LENGTH would reject a legitimate shorter
    // password before decryption is attempted. It buys no security: a client
    // side length test does not stop an attacker running on their own device.
    const floor = (name: string) => Number(
      constantsSource.match(new RegExp(`${name} = ([0-9]+)`))?.[1],
    );
    expect(floor('PASSWORD_UNLOCK_MIN_LENGTH')).toBeLessThan(floor('PASSWORD_MIN_LENGTH'));
    expect(appSource).not.toMatch(/(unlock|sensitive)Password\.length < \d/i);
  });

  it('derives vault version and salt length from the constants', () => {
    expect(vaultCryptoSource).toContain('randomBytes(SALT_BYTE_LENGTH, crypto)');
    expect(vaultCryptoSource).toContain('version: VAULT_VERSION');
    expect(vaultCryptoSource).not.toContain('randomBytes(16)');
  });

  it('keeps all production entropy behind the guarded Rust OS source', () => {
    expect(appSource).not.toContain('react-native-get-random-values');
    expect(packageJsonSource).not.toContain('react-native-get-random-values');
    expect(appSource).not.toContain('nacl.randomBytes');
    expect(vaultCryptoSource).not.toContain('nacl.randomBytes');
    expect(appSource).not.toContain('getRandomValues');
    expect(vaultCryptoSource).not.toContain('getRandomValues');
    expect(appSource).not.toContain('entropyToMnemonic');
    expect(appSource).toContain('await nitoWalletCrypto.generateMnemonic(userPoolBase64)');
    expect(appSource).toContain('nitoWalletCrypto.isAvailable()');
    expect(appSource).toContain('nitoWalletCrypto.randomBytes(SEED_ENTROPY_BYTE_LENGTH)');
    expect(nativeCryptoSource).toContain('fill_random_with(buffer, getrandom::fill)');

    for (const buildConfiguration of [cargoConfigSource, androidWorkflowSource, iosWorkflowSource]) {
      expect(buildConfiguration).not.toContain('getrandom_backend');
    }
  });

  it('always mixes fresh OS entropy with the optional user pool instead of replacing it', () => {
    const generatorSource = nativeCryptoSource.slice(
      nativeCryptoSource.indexOf('fn generate_mnemonic('),
      nativeCryptoSource.indexOf('fn master_xpriv('),
    );
    expect(generatorSource).toContain(
      'fill_random_with(system_entropy.as_mut(), getrandom::fill)',
    );
    expect(generatorSource).toContain(
      'mixed_entropy[index] = system_entropy[index] ^ mix[index]',
    );
  });

  it('collects dice input before generating one seed and never displays a phrase while rolling', () => {
    expect(appSource).toMatch(/onCreate=\{\(\) => \{[\s\S]*?setScreen\('dice'\);/);
    expect(appSource).toMatch(/if \(screen === 'dice'\) \{[\s\S]*?<DiceEntropyScreen/);
    expect(appSource).toContain('onContinue={(userPoolBase64) => { void createWallet(userPoolBase64); }}');
    expect(diceSource).toContain('onContinue(diceEntropyPoolToBase64(entropyPool))');
    expect(diceSource).not.toContain('MnemonicGrid');
    expect(diceSource).not.toContain('generateMnemonic');
    expect(diceEntropySource).toContain('sha256.create().update(pool).update(sample).digest()');
    expect(diceSource).toContain('packedSample.fill(0)');
    expect(diceSource).toContain('disabled={actionLocked || !hasRolled}');
    expect(appStateSecuritySource).toContain(
      "screenRef.current === 'dice' && nextState === 'background'",
    );
    expect(appSource).toMatch(
      /if \(screenRef\.current === 'dice'\) \{\s*diceEntropyResetRef\.current\(\);\s*setDiceSessionKey\(\(current\) => current \+ 1\);\s*\}/,
    );
    expect(diceSource).toContain('entropyPool.fill(0)');
    expect(diceSource).toContain('rollCounterRef.current = 0');
  });

  it('keeps dice animation on the native driver without frame listeners or effect resets', () => {
    expect(diceSource).toContain('useState(() => new Animated.Value(0))');
    expect(diceSource).not.toContain('faceCursor.addListener');
    expect(diceSource).not.toContain('motionCursor.addListener');
    expect(diceSource).not.toContain('useNativeDriver: false');
    expect(diceSource.match(/useNativeDriver: true/g)?.length).toBe(6);
  });
});

describe('QR scanner does not fight the auto lock', () => {
  it('treats the open camera as a system prompt without weakening background locking', () => {
    // Some Android builds report the app as inactive while the camera is up.
    // Without this the wallet locked under the open scanner, wiped the send
    // draft, and every scan then failed as "invalid address".
    expect(appSource).toMatch(
      /systemPromptActiveRef\.current = true;\s*setQrScannerOpen\(true\);/,
    );
    // Background stays unconditional: the flag only exempts the transient state.
    expect(appStateSecuritySource).toMatch(
      /nextState === 'background'[\s\S]{0,120}nextState === 'inactive' && !systemPromptActive/,
    );
  });

  it('clears the flag on every scanner exit path', () => {
    expect(appSource).toMatch(/const closeQrScanner = \(\) => \{[\s\S]*?systemPromptActiveRef\.current = false;/);
    expect(appSource).toMatch(/const lockWallet = useCallback\(\(\) => \{[\s\S]*?systemPromptActiveRef\.current = false;/);
  });

  it('rearms auto lock after a refused attempt and when the scanner closes', () => {
    expect(appSource).toMatch(
      /new AutoLock\(\(\) => \{\s*if \(systemPromptActiveRef\.current\) return false;\s*lockWallet\(\);\s*return true;/,
    );
    expect(appSource).toMatch(
      /const closeQrScanner = \(\) => \{[\s\S]*?systemPromptActiveRef\.current = false;[\s\S]*?autoLockRef\.current\?\.resetTimer\(\);/,
    );
  });

  it('claims scan events synchronously before updating rendered state', () => {
    expect(appSource).toContain('const qrScanHandledRef = useRef(false);');
    expect(appSource).toMatch(
      /const handleQrScan = \(value: string\) => \{\s*if \(qrScanHandledRef\.current\) return;\s*qrScanHandledRef\.current = true;\s*setQrScanHandled\(true\);/,
    );
    expect(appSource).toMatch(
      /qrRetryTimerRef\.current = setTimeout\(\(\) => \{\s*qrRetryTimerRef\.current = null;\s*qrScanHandledRef\.current = false;\s*setQrScanHandled\(false\);/,
    );
  });

  it('stops retrying instead of blinking forever', () => {
    expect(appSource).toContain('if (qrScanAttemptsRef.current >= QR_SCAN_MAX_ATTEMPTS) return;');
    expect(appSource).toContain('qrScanAttemptsRef.current = 0;');
  });

  it('closes the scanner when the target row was lost rather than blaming the code', () => {
    expect(appSource).toMatch(
      /if \(recipientId === null\) \{[\s\S]{0,400}?closeQrScanner\(\);\s*return;/,
    );
    expect(appSource).not.toContain("throw new Error('No recipient selected for QR scan.')");
  });
});
