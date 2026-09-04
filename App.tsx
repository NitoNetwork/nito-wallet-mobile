import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_UNLOCK_MIN_LENGTH,
  PBKDF2_ROUNDS,
  SEED_ENTROPY_BYTE_LENGTH,
} from './src/constants/nito';

import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Alert,
  Animated,
  AppState,
  Easing,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { escapeTsvCell, isValidTransactionId, transactionExplorerUrl } from './src/ui/format';
import { shouldShowBlockingLoadingOverlay } from './src/ui/loadingPolicy';
import {
  appendSendRecipient,
  clearSendRecipientFieldError,
  summarizeRecipientSpend,
  updateRecipientAddress,
  validateSendRecipientDrafts,
  type SendRecipientDraft,
  type SendRecipientField,
  type SendRecipientFieldErrors,
} from './src/ui/sendRecipients';
import { ThemeProvider, useStyles } from './src/ui/themeContext';
import { STATUS_BAR_BACKGROUND } from './src/ui/theme';
import type { ThemeName } from './src/ui/theme';
import { useThemePreference } from './src/hooks/useThemePreference';
import {
  Feedback,
  Hero,
  ImportScreen,
  InitializationErrorScreen,
  LandingScreen,
  LanguageSettings,
  LoadingOverlay,
  LoadingScreen,
  PersistScreen,
  UnlockScreen,
  WalletShell,
} from './src/ui/screens';
import { HistoryTab, HomeTab, ReceiveTab, SendTab } from './src/ui/tabs';
import { SecurityTab } from './src/ui/settings';
import { ActionButton } from './src/ui/components';
import { TransactionTrackingWindow } from './src/ui/TransactionTrackingWindow';
import { TransactionTrackingController } from './src/services/transactionTracking';
import { DiceEntropyScreen } from './src/ui/dice';
import type {
  AppScreen,
  BiometricMethod,
  NetworkState,
  PendingAction,
  Wallet,
  WalletTab,
} from './src/ui/types';

import {
  ElectrumSessionUnhealthyError,
  isElectrumTransactionNotFoundError,
  type NitoElectrumClient,
  scriptPubKeyForNitoAddress,
} from './src/network/electrum';
import {
  buildHistoryExportBatch,
  historyExportTsvRows,
  historyRecordsFromEntries,
} from './src/services/historyExport';
import { readOptionalCache } from './src/services/cachePolicy';
import { reportNonFinancialFailure } from './src/services/diagnostics';
import { ExclusiveActionGate } from './src/services/exclusiveActionGate';
import { loadWalletBootstrapState } from './src/services/appBootstrap';
import {
  createWalletAppStateChangeHandler,
  lockWalletIfAppStateBackground,
} from './src/services/appStateSecurity';
import {
  CustomElectrumServerValidationError,
  createElectrumClient,
  getConfiguredElectrumServerUrl,
  getElectrumServerPreference,
  loadElectrumServerPreference,
  parseCustomElectrumServerUrl,
  restoreOfficialElectrumServers,
  saveCustomElectrumServerPreference,
  type ElectrumServerPreference,
} from './src/services/electrumClientFactory';
import { invalidateElectrumRuntimeForServerChange } from './src/services/electrumServerTransition';
import {
  HistoryEnrichmentQueue,
  HistoryEnrichmentRetryScheduler,
  historyEnrichmentKey as enrichKey,
  isRetryableHistoryEnrichmentFailure,
  processHistoryEnrichmentQueue,
  processHistoryEnrichmentPasses,
  pruneHistoryEnrichmentFailures,
  recordHistoryEnrichmentBatchOutcome,
  releaseFailedHistoryEnrichmentAttempts,
  type HistoryEnrichmentFailures,
} from './src/services/historyEnrichmentQueue';
import {
  createSeedBackupChallenges,
  nextSeedBackupConfirmationStep,
} from './src/services/seedBackup';
import { type Translator } from './src/i18n';
import { nitoWalletCrypto } from './src/native/nitoWalletCrypto';
import {
  clearWalletPublicData,
  clearWalletHistoryCache,
  loadCurrentHdAddressIndex,
  loadHdAddressRequirements,
  loadTransactionLifecycles,
  loadTransactionTracking,
  saveTransactionTrackingWindow,
  loadTransactionOutputCache,
  loadWalletHistoryCache,
  loadWalletSnapshotCache,
  saveHistoryEnrichmentBatch,
  saveWalletHistoryCache,
  saveWalletSnapshotCache,
  reserveNextHdAddressIndex,
  attachInternalTransactionAddresses,
  claimTransactionLifecycleBroadcastAttempt,
  recordTransactionLifecycleBroadcastInvocation,
  markTransactionLifecyclePublished,
  markTransactionLifecycleSigned,
  reconcileTransactionLifecycles,
  reserveInternalTaprootTransactions,
  reserveTransactionWithoutAddress,
} from './src/services/walletHistoryDb';
import {
  processPersistentTransactionSequence,
  recoverPersistedTransactionBroadcasts,
  TransactionBroadcastRetryScheduler,
} from './src/services/transactionRecovery';
import {
  satoshisToNito,
  type TransparentWalletSnapshot,
} from './src/wallet/transparentScan';
import {
  assertTransparentSendFitsAvailable,
  assertTransparentConsolidationPlanMatches,
  assertTransparentSendPlanMatches,
  assertUnsignedTransparentInputsAvailable,
  calculateMaxTransparentSendAmount,
  estimateTransparentMultiSend,
  isTransparentSendReviewChanged,
  parseNitoAmountToSats,
  prepareUnsignedTransparentConsolidation,
  prepareUnsignedTransparentMultiSend,
  signUnsignedTransparentTx,
  type UnsignedTransparentConsolidation,
  type UnsignedTransparentSend,
  type TransparentSendOutput,
} from './src/wallet/transparentSend';
import { makeConsolidationTranslator } from './src/i18n.consolidation';
import { useAutoLockTimeout } from './src/hooks/useAutoLockTimeout';
import { useLanguage } from './src/hooks/useLanguage';
import { useWalletScreenProtection } from './src/hooks/useWalletScreenProtection';
import { useWalletSubscriptions } from './src/hooks/useWalletSubscriptions';
import { shouldProtectSensitiveContent } from './src/services/screenProtection';
import { AutoLock } from './src/services/session';
import {
  reportUnexpectedTransparentSendFailure,
  translatedTransparentSendError,
} from './src/services/transparentSendError';
import { prepareVaultUpgradeCommit } from './src/services/vaultMigration';
import { userFacingErrorMessage, WalletStorageError } from './src/services/walletStorageError';
import {
  initialVaultSession,
  transitionVaultSession,
  type VaultSessionEvent,
} from './src/services/vaultSessionMachine';
import {
  decryptVault,
  deleteBiometricSecret,
  deleteVault,
  encryptVault,
  loadBiometricSecret,
  loadVault,
  saveBiometricSecret,
  saveVault,
} from './src/services/vault';
import type { WalletSessionToken } from './src/services/walletSession';
import { needsHistoryEnrichment } from './src/services/walletHistory';
import {
  WalletNetworkController,
  createEmptyNetworkState,
  enrichHistorySnapshot,
  mergeHistoryEnrichment,
  mergeWalletNetworkPublication,
  prefetchWalletSnapshot,
  prepareWalletEntry,
  reconcileBroadcastTransactions,
  synchronizeWalletNetwork,
  toQuickWalletSnapshot,
  type WalletNetworkHistoryPublicationMode,
  type WalletSyncOptions,
} from './src/services/walletNetworkController';
import { applyOptimisticWalletBroadcast } from './src/wallet/optimisticConsolidation';
import {
  deriveLegacyCompatibleWallet,
  restoreLegacyCompatibleWallet,
} from './src/wallet/walletIdentity';
import {
  assertGapSafeIssuedIndex,
  deriveHdAddress,
  highestUsedHdIndex,
  hdAccountTemplate,
  type HdAccountKey,
} from './src/wallet/hdAddress';

const BALANCE_REFRESH_COOLDOWN_KEY = 'nito.wallet.balance-refresh-until.v1';
const BALANCE_REFRESH_COOLDOWN_MS = 120_000;
const MNEMONIC_REVEAL_MS = 60_000;
const ADDRESS_CLIPBOARD_MS = 60_000;
const QR_SCAN_MAX_ATTEMPTS = 3;
const BIP39_WORDS = new Set<string>(wordlist);

const BASE_WALLET_TABS: { key: WalletTab; labelKey: Parameters<Translator>[0] }[] = [
  { key: 'home', labelKey: 'tabs.home' },
  { key: 'receive', labelKey: 'tabs.receive' },
  { key: 'send', labelKey: 'tabs.send' },
  { key: 'history', labelKey: 'tabs.history' },
  { key: 'security', labelKey: 'tabs.security' },
];

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const normalizeMnemonic = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const parseNitoQrAddress = (value: string) => {
  const trimmed = value.trim();
  const addressPart = /^nito:(?:\/\/)?/i.test(trimmed)
    ? (trimmed.replace(/^nito:(?:\/\/)?/i, '').split('?', 1)[0] ?? '')
    : trimmed;
  const decodedAddress = decodeURIComponent(addressPart).trim();
  const address = decodedAddress.toLowerCase().startsWith('nito1')
    ? decodedAddress.toLowerCase()
    : decodedAddress;

  scriptPubKeyForNitoAddress(address);
  return address;
};
const formatCooldownRemaining = (milliseconds: number) => {
  const totalSeconds = Math.max(1, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};
const customElectrumValidationMessage = (caught: unknown, t: Translator): string => {
  if (!(caught instanceof CustomElectrumServerValidationError)) {
    reportNonFinancialFailure('custom Electrum server validation', caught);
    return t('errors.networkUnavailable');
  }

  const keys = {
    'wss-required': 'errors.customElectrumWssRequired',
    'invalid-format': 'errors.customElectrumFormat',
    'invalid-host': 'errors.customElectrumHost',
    'invalid-port': 'errors.customElectrumPort',
  } as const;
  return t(keys[caught.code]);
};
const translatedErrorMessage = (
  caught: unknown,
  t: Translator,
  fallback: string,
  operation: string,
): string => userFacingErrorMessage(
  caught,
  fallback,
  t('errors.walletStorageUnavailable'),
  operation,
);
type ImportWordCheck = {
  index: number;
  word: string;
  complete: boolean;
  valid: boolean;
};

const getImportWordChecks = (value: string): ImportWordCheck[] => {
  const words = value.trim().toLowerCase().split(/\s+/g).filter(Boolean);
  const endsWithWhitespace = /\s$/.test(value);
  const finalWordIsComplete = words.length === 12 || words.length === 24 || words.length > 24;

  return words.map((word, index) => {
    const complete = index < words.length - 1 || endsWithWhitespace || finalWordIsComplete;
    return { index, word, complete, valid: !complete || BIP39_WORDS.has(word) };
  });
};

const getImportMnemonicStatus = (value: string, t: Translator) => {
  const normalized = normalizeMnemonic(value);

  if (!normalized) {
    return '';
  }

  const words = normalized.split(' ').filter(Boolean);
  const hasInvalidCompletedWord = getImportWordChecks(value).some((entry) => entry.complete && !entry.valid);

  if (hasInvalidCompletedWord) {
    return '';
  }

  if (words.length === 12 || words.length === 24) {
    return validateMnemonic(normalized, wordlist)
      ? t(words.length === 12 ? 'seed.valid12' : 'seed.valid24')
      : t('seed.invalidChecksum');
  }

  if (words.length > 24) {
    return t('seed.invalidLength');
  }

  return '';
};
const openTransactionExplorer = async (txid: string): Promise<void> => {
  if (!isValidTransactionId(txid)) return;
  await Linking.openURL(transactionExplorerUrl(txid));
};
const satoshisToNitoInput = (sats: bigint) => {
  const whole = sats / 100_000_000n;
  const fraction = (sats % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()},${fraction}` : whole.toString();
};
const initialSendRecipients = (): SendRecipientDraft[] => [
  { id: 1, address: '', amount: '' },
];
type SendEstimateState = {
  feeSats: number;
  totalSats: bigint;
  fitsAvailable: boolean;
};

const internalTaprootReservationRange = ({
  snapshot,
  highestIssuedIndex,
  count,
}: {
  snapshot: TransparentWalletSnapshot;
  highestIssuedIndex: number;
  count: number;
}) => {
  const sequence = { accountKey: 'taproot' as const, branch: 'internal' as const };
  const highestUsed = highestUsedHdIndex(snapshot.addresses, sequence);
  const minimumIndex = Math.max(highestIssuedIndex + 1, highestUsed + 1, 0);
  const maximumIndex = highestUsed + snapshot.gapLimit;
  assertGapSafeIssuedIndex({
    addresses: snapshot.addresses,
    sequence,
    index: minimumIndex + count - 1,
    gapLimit: snapshot.gapLimit,
  });
  return { minimumIndex, maximumIndex };
};

const generateMnemonic24 = async (additionalEntropyBase64?: string) => (
  await nitoWalletCrypto.generateMnemonic(additionalEntropyBase64)
).mnemonic;

const validateImportMnemonic = (value: string, t: Translator) => {
  const normalized = normalizeMnemonic(value);
  const words = normalized.split(' ').filter(Boolean).length;

  if (words !== 12 && words !== 24) {
    throw new Error(t('seed.require12or24'));
  }

  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error(t('seed.invalidFull'));
  }

  return normalized;
};

const getBiometricMethod = async (): Promise<BiometricMethod> => {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return 'Face ID';
  }

  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return 'Touch ID';
  }

  return 'biometrics';
};

const requestBiometricGate = async (promptMessage: string) => {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Cancel',
    disableDeviceFallback: true,
    requireConfirmation: true,
  });

  if (!result.success) {
    throw new Error('Biometric authentication was cancelled or rejected.');
  }
};

let seedBackupAttemptCounter = 0;
const nextSeedBackupAttemptToken = () => `attempt-${++seedBackupAttemptCounter}`;

function WalletApp({ theme, onSelectTheme }: {
  theme: ThemeName;
  onSelectTheme: (next: ThemeName) => void;
}) {
  const styles = useStyles();
  const [importFieldError, setImportFieldError] = useState('');
  const [sendRecipientErrors, setSendRecipientErrors] = useState<SendRecipientFieldErrors>({});
  const [unlockPasswordError, setUnlockPasswordError] = useState('');
  const [persistPasswordError, setPersistPasswordError] = useState('');
  const [persistConfirmPasswordError, setPersistConfirmPasswordError] = useState('');
  const [seedBackupConfirmationError, setSeedBackupConfirmationError] = useState('');
  const [sensitivePasswordError, setSensitivePasswordError] = useState('');
  const clearFieldErrors = useCallback(() => {
    setImportFieldError('');
    setUnlockPasswordError('');
    setPersistPasswordError('');
    setPersistConfirmPasswordError('');
    setSeedBackupConfirmationError('');
    setSensitivePasswordError('');
    setSendRecipientErrors({});
  }, []);
  const screenRef = useRef<AppScreen>('loading');
  const [screen, setScreenState] = useState<AppScreen>('loading');
  const setScreen = useCallback((nextScreen: AppScreen) => {
    clearFieldErrors();
    screenRef.current = nextScreen;
    setScreenState(nextScreen);
  }, [clearFieldErrors]);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [walletTab, setWalletTabState] = useState<WalletTab>('home');
  const setWalletTab = useCallback((nextTab: WalletTab) => {
    clearFieldErrors();
    if (nextTab !== 'security') {
      setShowMnemonic(false);
    }
    setWalletTabState(nextTab);
  }, [clearFieldErrors]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [receiveAddressBusy, setReceiveAddressBusy] = useState(false);
  const receiveAddressOperationRef = useRef(0);
  const [pendingWallet, setPendingWallet] = useState<Wallet | null>(null);
  const [pendingWalletRequiresSeedBackup, setPendingWalletRequiresSeedBackup] = useState(false);
  const [diceSessionKey, setDiceSessionKey] = useState(0);
  const [seedBackupConfirmationStep, setSeedBackupConfirmationStep] = useState(-1);
  const [seedBackupAttemptToken, setSeedBackupAttemptToken] =
    useState(nextSeedBackupAttemptToken);
  const seedBackupAnswerLockedRef = useRef(false);
  const [walletNetworkController] = useState(() => new WalletNetworkController());
  const [transactionTrackingController] = useState(() => new TransactionTrackingController({
    isCurrent: (session) => walletNetworkController.isCurrent(session),
    read: loadTransactionTracking,
    writeWindow: saveTransactionTrackingWindow,
    reportError: (caught) => reportNonFinancialFailure('transaction tracking', caught),
  }));
  const transactionTracking = useSyncExternalStore(
    transactionTrackingController.subscribe, transactionTrackingController.getSnapshot,
  );
  const [historyEnrichmentRetryScheduler] =
    useState(() => new HistoryEnrichmentRetryScheduler());
  const [transactionBroadcastRetryScheduler] =
    useState(() => new TransactionBroadcastRetryScheduler());
  const electrumClientRef = useRef<NitoElectrumClient | null>(null);
  const pendingNetworkRef = useRef<{ walletId: string; snapshot: TransparentWalletSnapshot; height: number } | null>(null);
  const walletRef = useRef<Wallet | null>(null);
  const networkRef = useRef<NetworkState>(createEmptyNetworkState());
  const networkOwnerWalletIdRef = useRef<string | null>(null);
  const silentNextAutoSyncRef = useRef(false);
  const subscriptionSyncFlushRef = useRef<() => void>(() => undefined);
  const autoBiometricAttemptedRef = useRef(false);
  const unlockSavedWalletRef = useRef<(useBiometrics?: boolean, auto?: boolean) => Promise<void>>(async () => undefined);
  const biometricDismissedRef = useRef(false);
  const biometricInterruptedRef = useRef(false);
  const lockedDuringSessionRef = useRef(false);
  const walletLockAppliedRef = useRef(false);
  const lockWalletRef = useRef<() => void>(() => undefined);
  const clearTransientSecretsRef = useRef<() => void>(() => undefined);
  const diceEntropyResetRef = useRef<() => void>(() => undefined);
  const transientSecretGenerationRef = useRef(0);
  const enrichAttemptedRef = useRef<Set<string>>(new Set());
  const enrichFailedRef = useRef<HistoryEnrichmentFailures>(new Map());
  const appStateRef = useRef(AppState.currentState);
  const systemPromptActiveRef = useRef(false);
  const autoLockRef = useRef<AutoLock | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const walletScrollRef = useRef<ScrollView | null>(null);
  const [loadingSpin] = useState(() => new Animated.Value(0));
  const [network, setNetwork] = useState<NetworkState>(createEmptyNetworkState);
  const publishNetworkState = useCallback((
    incoming: NetworkState,
    walletId = walletRef.current?.walletId ?? null,
    historyMode: WalletNetworkHistoryPublicationMode = 'partial',
  ): NetworkState => {
    const nextNetwork = mergeWalletNetworkPublication(
      networkRef.current,
      incoming,
      walletId !== null && networkOwnerWalletIdRef.current === walletId,
      historyMode,
    );
    networkOwnerWalletIdRef.current = walletId;
    networkRef.current = nextNetwork;
    setNetwork(nextNetwork);
    return nextNetwork;
  }, []);
  const [electrumServerPreference, setElectrumServerPreference] =
    useState<ElectrumServerPreference>(getElectrumServerPreference);
  const [importText, setImportText] = useState('');
  const [showImportSeed, setShowImportSeed] = useState(false);
  const [sendRecipients, setSendRecipients] = useState<SendRecipientDraft[]>(initialSendRecipients);
  const nextSendRecipientIdRef = useRef(2);
  const qrRecipientIdRef = useRef<number | null>(null);
  const [sendEstimate, setSendEstimate] = useState<SendEstimateState | null>(null);
  const [sendEstimatePending, setSendEstimatePending] = useState(false);
  const [preparedTx, setPreparedTx] = useState<UnsignedTransparentSend | null>(null);
  const [preparedConsolidation, setPreparedConsolidation] =
    useState<UnsignedTransparentConsolidation | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [seedSaved, setSeedSaved] = useState(false);
  const [vaultUnlockMode, setVaultUnlockMode] = useState<'password' | 'biometric'>('password');
  const vaultBiometricsEnabledRef = useRef(false);
  const [vaultBiometricsEnabled, setVaultBiometricsEnabledState] = useState(false);
  const setVaultBiometricsEnabled = useCallback((enabled: boolean) => {
    vaultBiometricsEnabledRef.current = enabled;
    setVaultBiometricsEnabledState(enabled);
  }, []);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [persistPassword, setPersistPassword] = useState('');
  const [persistBusy, setPersistBusy] = useState(false);
  const [persistConfirmPassword, setPersistConfirmPassword] = useState('');
  const [showPersistPassword, setShowPersistPassword] = useState(false);
  const [showPersistConfirmPassword, setShowPersistConfirmPassword] = useState(false);
  const [biometricMethod, setBiometricMethod] = useState<BiometricMethod>('biometrics');
  const biometricUnavailableReasonRef = useRef('');
  const [biometricUnavailableReason, setBiometricUnavailableReasonState] = useState('');
  const setBiometricUnavailableReason = useCallback((reason: string) => {
    biometricUnavailableReasonRef.current = reason;
    setBiometricUnavailableReasonState(reason);
  }, []);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [sensitivePassword, setSensitivePassword] = useState('');
  const [showSensitivePassword, setShowSensitivePassword] = useState(false);
  const [sensitiveAction, setSensitiveAction] = useState<'reveal' | 'delete' | 'enableBiometrics' | 'disableBiometrics' | null>(null);
  const [sensitiveBusy, setSensitiveBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [exclusiveActionGate] = useState(() => new ExclusiveActionGate<PendingAction>());
  const vaultSessionStateRef = useRef(initialVaultSession);
  const [historyPage, setHistoryPage] = useState(0);
  const historyPageRef = useRef(historyPage);
  const historyEnrichmentQueueRef = useRef<HistoryEnrichmentQueue | null>(null);
  const enrichWalletHistoryRef = useRef<() => void>(() => undefined);
  const syncTransparentNetworkRef = useRef<(
    includeHistory?: boolean,
    options?: WalletSyncOptions,
  ) => Promise<void>>(async () => undefined);
  const [historyProgress, setHistoryProgress] = useState<{ done: number; total: number } | null>(null);
  const [historySyncing, setHistorySyncing] = useState(false);
  const { language, t, selected: selectedLanguage, pickerOpen: languagePickerOpen, togglePicker: toggleLanguagePicker, select: selectLanguage } = useLanguage();
  const { autoLockTimeoutMs, selectAutoLockTimeout } = useAutoLockTimeout();
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [refreshCooldownUntil, setRefreshCooldownUntil] = useState(0);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrScanHandled, setQrScanHandled] = useState(false);
  const qrScanHandledRef = useRef(false);
  const [qrScannerError, setQrScannerError] = useState('');
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const qrRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrScanAttemptsRef = useRef(0);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const tRef = useRef(t);
  const seedBackupChallenges = useMemo(
    () => (
      pendingWalletRequiresSeedBackup && pendingWallet
        ? createSeedBackupChallenges(pendingWallet.mnemonic, seedBackupAttemptToken)
        : []
    ),
    [pendingWallet, pendingWalletRequiresSeedBackup, seedBackupAttemptToken],
  );
  useWalletScreenProtection({
    protectSensitiveContent: shouldProtectSensitiveContent({
      screen,
      walletTab,
      createdPhraseVisible: Boolean(
        pendingWallet
        && pendingWalletRequiresSeedBackup
        && seedBackupConfirmationStep < 0
      ),
      settingsPhraseVisible: showMnemonic,
    }),
  });

  useLayoutEffect(() => {
    seedBackupAnswerLockedRef.current = false;
  }, [seedBackupAttemptToken, seedBackupConfirmationStep]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    const canEstimate = Boolean(
      !wallet
      || !network.snapshot
      || network.status === 'syncing'
      || sendRecipients.some((recipient) => !recipient.address.trim() || !recipient.amount.trim())
    ) === false;
    const stateTimer = setTimeout(() => {
      if (cancelled) return;
      setSendEstimate(null);
      setSendEstimatePending(canEstimate);
    }, 0);

    if (!canEstimate || !wallet || !network.snapshot) {
      return () => {
        cancelled = true;
        clearTimeout(stateTimer);
      };
    }

    let outputs: TransparentSendOutput[];
    try {
      sendRecipients.forEach((recipient) => {
        scriptPubKeyForNitoAddress(recipient.address);
      });
      outputs = sendRecipients.map((recipient) => ({
        address: recipient.address,
        amountSats: parseNitoAmountToSats(recipient.amount),
      }));
    } catch {
      clearTimeout(stateTimer);
      const invalidTimer = setTimeout(() => {
        if (!cancelled) {
          setSendEstimate(null);
          setSendEstimatePending(false);
        }
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(invalidTimer);
      };
    }

    const snapshot = network.snapshot;
    const timer = setTimeout(() => {
      void deriveHdAddress(wallet.mnemonic, 'taproot', 'internal', 0).then((previewChange) => (
        estimateTransparentMultiSend({
          mnemonic: wallet.mnemonic,
          snapshot,
          outputs,
          changeAddress: previewChange.address,
        })
      )).then((estimate) => {
        if (cancelled) return;
        const summary = summarizeRecipientSpend(
          outputs.map((output) => output.amountSats),
          BigInt(estimate.feeSats),
          BigInt(snapshot.spendableSats),
        );
        setSendEstimate({
          feeSats: estimate.feeSats,
          totalSats: summary.totalSats,
          fitsAvailable: estimate.fitsAvailable && summary.fitsAvailable,
        });
      }).catch((caught) => {
        if (!cancelled) {
          setSendEstimate(null);
          reportUnexpectedTransparentSendFailure('transparent send estimate', caught);
        }
      }).finally(() => {
        if (!cancelled) setSendEstimatePending(false);
      });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(stateTimer);
      clearTimeout(timer);
    };
  }, [network.snapshot, network.status, sendRecipients, wallet]);

  useEffect(() => {
    historyPageRef.current = historyPage;
    historyEnrichmentQueueRef.current?.prioritizePage(historyPage);
  }, [historyPage]);

  const resetFeedback = useCallback(() => {
    setError('');
    setStatus('');
    clearFieldErrors();
  }, [clearFieldErrors]);

  const openTransactionExplorerWithFeedback = useCallback(async (txid: string) => {
    try {
      await openTransactionExplorer(txid);
    } catch (caught) {
      setError(translatedErrorMessage(
        caught,
        t,
        t('errors.explorerUnavailable'),
        'transaction explorer opening',
      ));
    }
  }, [t]);

  const scrollToPreparedReview = useCallback(() => {
    walletScrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  const resetSendDraft = useCallback(() => {
    nextSendRecipientIdRef.current = 2;
    qrRecipientIdRef.current = null;
    setSendRecipients(initialSendRecipients());
    setSendRecipientErrors({});
    setSendEstimate(null);
    setSendEstimatePending(false);
  }, []);

  const applyVaultTransition = useCallback((event: VaultSessionEvent) => {
    const next = transitionVaultSession(vaultSessionStateRef.current, event);
    vaultSessionStateRef.current = next;
    setSeedSaved(next.status !== 'absent');
    setVaultUnlockMode(next.unlockMode);
    setVaultBiometricsEnabled(next.biometricsEnabled);
    return next;
  }, [setVaultBiometricsEnabled]);

  const clearQrRetryTimer = useCallback(() => {
    if (qrRetryTimerRef.current) {
      clearTimeout(qrRetryTimerRef.current);
      qrRetryTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearQrRetryTimer, [clearQrRetryTimer]);

  useEffect(() => {
    if (!status) {
      return undefined;
    }

    const timeout = setTimeout(() => setStatus(''), 7000);
    return () => clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  useEffect(() => {
    if (!pendingAction && screen !== 'loading') {
      loadingSpin.stopAnimation();
      loadingSpin.setValue(0);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.timing(loadingSpin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    animation.start();

    return () => animation.stop();
  }, [loadingSpin, pendingAction, screen]);

  const runExclusiveAction = useCallback(async (action: PendingAction, task: () => Promise<void> | void) => {
    if (exclusiveActionGate.active !== null) return;
    pendingActionRef.current = action;
    setPendingAction(action);
    try {
      await exclusiveActionGate.run(action, async () => {
        await yieldToUi();
        await task();
      });
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }, [exclusiveActionGate]);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const {
          vault,
          hasBiometricHardware,
          isBiometricEnrolled,
          biometricMethod: method,
          savedRefreshCooldown,
          electrumPreference: savedElectrumServerPreference,
        } = await loadWalletBootstrapState({
          loadVault,
          probeNativeCrypto: async () => {
            if (!nitoWalletCrypto.isAvailable()) {
              throw new Error('Native cryptographic core is unavailable.');
            }
            await nitoWalletCrypto.randomBytes(SEED_ENTROPY_BYTE_LENGTH);
          },
          hasBiometricHardware: LocalAuthentication.hasHardwareAsync,
          isBiometricEnrolled: LocalAuthentication.isEnrolledAsync,
          getBiometricMethod,
          loadRefreshCooldown: () => SecureStore.getItemAsync(BALANCE_REFRESH_COOLDOWN_KEY),
          loadElectrumPreference: loadElectrumServerPreference,
          reportAncillaryFailure: reportNonFinancialFailure,
        });

        if (!mounted) {
          return;
        }

        if (method) {
          setBiometricMethod(method);
        }
        if (savedElectrumServerPreference) {
          setElectrumServerPreference(savedElectrumServerPreference);
        }
        applyVaultTransition({ type: 'load', vault });


        const savedCooldown = Number(savedRefreshCooldown);
        if (Number.isFinite(savedCooldown) && savedCooldown > Date.now()) {
          setRefreshCooldownUntil(Math.min(savedCooldown, Date.now() + BALANCE_REFRESH_COOLDOWN_MS));
        }

        if (hasBiometricHardware === false) {
          setBiometricUnavailableReason(tRef.current('errors.biometricNoHardware'));
        } else if (isBiometricEnrolled === false) {
          setBiometricUnavailableReason(tRef.current('errors.biometricNotEnrolled'));
        }

        setScreen(vault ? 'unlock' : 'landing');
      } catch (caught) {
        if (!mounted) {
          return;
        }

        reportNonFinancialFailure('wallet bootstrap vault read', caught);
        setError('');
        setScreen('initializationError');
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, [
    applyVaultTransition,
    bootstrapAttempt,
    setBiometricUnavailableReason,
    setScreen,
  ]);

  useEffect(() => {
    if (refreshCooldownUntil <= Date.now()) {
      return undefined;
    }

    const timer = setTimeout(() => setRefreshCooldownUntil(0), refreshCooldownUntil - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [refreshCooldownUntil]);

  useEffect(() => {
    if (!showMnemonic) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setShowMnemonic(false);
      setStatus(t('status.seedHiddenAuto'));
    }, MNEMONIC_REVEAL_MS);

    return () => clearTimeout(timer);
  }, [showMnemonic, t]);

  const walletTabs = useMemo(
    () => BASE_WALLET_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) })),
    [t],
  );

  const enterWallet = (
    nextWallet: Wallet,
    saved: boolean,
    message: string,
    cachedNetwork?: { snapshot: TransparentWalletSnapshot; height: number } | null,
    cachedHistory?: Awaited<ReturnType<typeof loadWalletHistoryCache>> | null,
  ) => {
    walletLockAppliedRef.current = false;
    const entry = prepareWalletEntry({
      pendingNetwork: pendingNetworkRef.current,
      wallet: nextWallet,
      cachedNetwork,
      cachedHistory,
    });
    const { pendingPreload, network: nextNetwork } = entry;
    walletNetworkController.beginWalletSession(nextWallet.walletId);
    receiveAddressOperationRef.current += 1;
    setReceiveAddressBusy(false);
    walletRef.current = nextWallet;

    if (pendingPreload) {
      pendingNetworkRef.current = null;
      silentNextAutoSyncRef.current = true;
    } else if (entry.usedPreload) {
      silentNextAutoSyncRef.current = true;
    }

    setPendingWallet(null);
    setWallet(nextWallet);
    if (saved && vaultSessionStateRef.current.status === 'locked') {
      applyVaultTransition({ type: 'unlock' });
    }
    setWalletTab('home');
    setHistoryPage(0);
    historyEnrichmentRetryScheduler.cancel();
    transactionBroadcastRetryScheduler.cancel();
    enrichAttemptedRef.current.clear();
    enrichFailedRef.current.clear();
    setBalanceRefreshing(!pendingPreload);
    setHistoryProgress(null);
    setHistorySyncing(false);
    setBroadcasting(false);
    publishNetworkState(nextNetwork, nextWallet.walletId);
    resetSendDraft();
    setPreparedTx(null);
    setPreparedConsolidation(null);
    setScreen('wallet');
    if (lockWalletIfAppStateBackground(
      appStateRef.current,
      lockWalletRef.current,
    )) return;
    const trackingSession = walletNetworkController.sessions.capture(nextWallet.walletId);
    if (trackingSession) void transactionTrackingController.restore(trackingSession);
    setStatus(message);
  };

  const prefetchWalletNetwork = useCallback(async (nextWallet: Wallet) => {
    const generation = walletNetworkController.beginPrefetch();
    pendingNetworkRef.current = null;

    try {
      const client = electrumClientRef.current || createElectrumClient();
      electrumClientRef.current = client;
      const issuedAddresses = await loadHdAddressRequirements(nextWallet.walletId);
      const prefetched = await prefetchWalletSnapshot(nextWallet, client, issuedAddresses);
      if (!walletNetworkController.isCurrentPrefetch(generation)) {
        return;
      }
      pendingNetworkRef.current = { walletId: nextWallet.walletId, ...prefetched };
    } catch (caught) {
      if (walletNetworkController.isCurrentPrefetch(generation)) {
        pendingNetworkRef.current = null;
        setError(translatedErrorMessage(
          caught,
          t,
          t('errors.networkUnavailable'),
          'wallet network prefetch',
        ));
      }
    }
  }, [t, walletNetworkController]);

  const scheduleHistoryEnrichmentRetries = useCallback(() => {
    const activeWallet = walletRef.current;
    const session = activeWallet
      ? walletNetworkController.sessions.capture(activeWallet.walletId)
      : null;
    if (!session || screenRef.current !== 'wallet') {
      historyEnrichmentRetryScheduler.cancel();
      return;
    }
    historyEnrichmentRetryScheduler.schedule(
      enrichAttemptedRef.current,
      enrichFailedRef.current,
      () => {
        walletNetworkController.requestOrQueueEnrichment(enrichWalletHistoryRef.current);
      },
      () => (
        screenRef.current === 'wallet'
        && walletNetworkController.isCurrent(session)
      ),
    );
  }, [historyEnrichmentRetryScheduler, walletNetworkController]);

  useEffect(
    () => () => historyEnrichmentRetryScheduler.cancel(),
    [historyEnrichmentRetryScheduler],
  );

  const enrichWalletHistory = useCallback(async () => {
    if (!walletNetworkController.startEnrichment()) {
      walletNetworkController.requestOrQueueEnrichment(enrichWalletHistoryRef.current);
      return;
    }
    const activeWallet = walletRef.current;
    if (!activeWallet || !networkRef.current.snapshot) {
      walletNetworkController.finishEnrichment(enrichWalletHistoryRef.current);
      return;
    }
    const session = walletNetworkController.sessions.capture(activeWallet.walletId);
    if (!session) {
      walletNetworkController.finishEnrichment(enrichWalletHistoryRef.current);
      return;
    }
    let ownedQueue: HistoryEnrichmentQueue | null = null;
    let activeBatch: TransparentWalletSnapshot['history'] = [];
    let activeBatchKeys: string[] = [];
    try {
      const client = electrumClientRef.current || createElectrumClient();
      electrumClientRef.current = client;
      const requireCurrentSession = () => {
        if (!walletNetworkController.isCurrent(session)) {
          throw new Error('Wallet session changed during history enrichment.');
        }
      };

      await processHistoryEnrichmentPasses({
        createPass: () => {
          requireCurrentSession();
          const snapshot = networkRef.current.snapshot;
          if (!snapshot) {
            throw new Error('Wallet snapshot disappeared during history enrichment.');
          }
          const queue = new HistoryEnrichmentQueue(snapshot.history, {
            attempted: enrichAttemptedRef.current,
            initialPage: historyPageRef.current,
          });
          if (queue.remainingCount === 0) return null;
          ownedQueue = queue;
          historyEnrichmentQueueRef.current = queue;
          return { queue, snapshot };
        },
        processPass: async ({ queue, snapshot }) => {
          await processHistoryEnrichmentQueue({
            queue,
            onBatchStart: (batch) => {
              activeBatch = batch;
              activeBatchKeys = batch.map(enrichKey);
            },
            enrichBatch: async (batch, onBatchProgress) => {
              requireCurrentSession();
              const { records, outputs } = await enrichHistorySnapshot({
                snapshot,
                pending: batch,
                client,
                loadCachedOutputs: (txids) => loadTransactionOutputCache(
                  activeWallet.walletId,
                  txids,
                ),
                onCacheReadError: (caught) => {
                  reportNonFinancialFailure('transaction output cache read', caught);
                },
                onProgress: (done) => onBatchProgress(done),
              });
              requireCurrentSession();
              return { records, outputs };
            },
            publishBatch: async ({ records, outputs }) => {
              requireCurrentSession();
              await saveHistoryEnrichmentBatch(
                activeWallet.walletId,
                records
                  .map((record) => ({
                    txid: record.txid,
                    height: record.blockHeight,
                    amountSats: record.amountSats,
                    direction: record.direction,
                    feeSats: record.feeSats,
                    counterparty: record.counterparty,
                    blockTime: record.blockTime,
                  })),
                outputs,
              );
              requireCurrentSession();
              if (!client.connected) {
                throw new ElectrumSessionUnhealthyError(
                  new Error('ElectrumX connection closed before history enrichment commit.'),
                );
              }
              const current = networkRef.current;
              if (!current.snapshot) {
                throw new Error('Wallet snapshot disappeared during history enrichment.');
              }
              const nextNetwork: NetworkState = {
                ...current,
                snapshot: mergeHistoryEnrichment(current.snapshot, records),
              };
              requireCurrentSession();
              publishNetworkState(nextNetwork, activeWallet.walletId);
            },
            onBatchPublished: () => {
              recordHistoryEnrichmentBatchOutcome(
                enrichAttemptedRef.current,
                enrichFailedRef.current,
                activeBatchKeys,
                'published',
              );
              activeBatch = [];
              activeBatchKeys = [];
              scheduleHistoryEnrichmentRetries();
            },
            onProgress: (done, total) => {
              if (walletNetworkController.isCurrent(session)) {
                setHistoryProgress({ done, total });
              }
            },
          });
        },
      });
    } catch (caught) {
      const sessionCurrent = walletNetworkController.isCurrent(session);
      const retryableFailure = (
        sessionCurrent
        && isRetryableHistoryEnrichmentFailure(caught, activeBatch)
      );
      const failureOutcome = !sessionCurrent
        ? 'interrupted'
        : retryableFailure ? 'retryable-failure' : 'failed';
      recordHistoryEnrichmentBatchOutcome(
        enrichAttemptedRef.current,
        enrichFailedRef.current,
        activeBatchKeys,
        failureOutcome,
      );
      activeBatch = [];
      activeBatchKeys = [];
      if (retryableFailure) {
        scheduleHistoryEnrichmentRetries();
      } else if (sessionCurrent) {
        const message = translatedErrorMessage(
          caught,
          t,
          t('errors.networkUnavailable'),
          'history enrichment',
        );
        const current = networkRef.current;
        const nextNetwork: NetworkState = {
          ...current,
          status: 'error',
          error: message,
        };
        publishNetworkState(nextNetwork, activeWallet.walletId);
        setError(message);
      }
    } finally {
      if (historyEnrichmentQueueRef.current === ownedQueue) {
        historyEnrichmentQueueRef.current = null;
      }
      if (walletNetworkController.isCurrent(session)) {
        setHistoryProgress(null);
        walletNetworkController.finishEnrichment(enrichWalletHistoryRef.current);
      }
    }
  }, [
    publishNetworkState,
    scheduleHistoryEnrichmentRetries,
    t,
    walletNetworkController,
  ]);

  useEffect(() => {
    enrichWalletHistoryRef.current = () => {
      void enrichWalletHistory();
    };
  }, [enrichWalletHistory]);

  const recoverTransactionBroadcasts = useCallback(async (
    walletId: string,
    records?: Awaited<ReturnType<typeof loadTransactionLifecycles>>,
  ) => {
    const session = walletNetworkController.sessions.capture(walletId);
    const candidates = records ?? await loadTransactionLifecycles(walletId);
    if (!session || !walletNetworkController.isCurrent(session)) {
      return { publishedTxids: [], failures: [], nextAttemptAt: null };
    }
    const client = electrumClientRef.current ?? createElectrumClient();
    electrumClientRef.current = client;
    const result = await recoverPersistedTransactionBroadcasts({
      now: Date.now(),
      records: candidates,
      claimAttempt: (record, now) => (
        walletNetworkController.isCurrent(session)
          ? claimTransactionLifecycleBroadcastAttempt(walletId, record.lifecycleId, now)
          : Promise.resolve(null)
      ),
      recordBroadcastInvocation: (record, now) => (
        recordTransactionLifecycleBroadcastInvocation(walletId, record.lifecycleId, now)
      ),
      lookupTransaction: async (txid) => {
        await client.getTransactionHex(txid);
      },
      isTransactionNotFound: isElectrumTransactionNotFoundError,
      broadcastTransaction: (rawTxHex, expectedTxid) => (
        client.broadcastTransaction(rawTxHex, expectedTxid)
      ),
      markPublished: (record) => (
        markTransactionLifecyclePublished(walletId, record.lifecycleId)
      ),
      onRecordChanged: (record, active) => transactionTrackingController.update(session, record, active),
    });
    result.failures.forEach(({ error: caught }) => {
      reportNonFinancialFailure('persistent transaction broadcast recovery', caught);
    });
    if (walletNetworkController.isCurrent(session)) {
      if (result.failures.some(({ error: caught }) => caught instanceof WalletStorageError)) {
        setError(t('errors.walletStorageUnavailable'));
      }
      await transactionTrackingController.refresh(session);
      if (walletNetworkController.isCurrent(session)) {
        transactionBroadcastRetryScheduler.schedule(result.nextAttemptAt, () => {
          if (!walletNetworkController.isCurrent(session) || screenRef.current !== 'wallet') return;
          void syncTransparentNetworkRef.current(false, { force: true, silent: true });
        });
      }
    }
    return result;
  }, [t, transactionBroadcastRetryScheduler, transactionTrackingController, walletNetworkController]);

  const syncTransparentNetwork = useCallback(async (
    includeHistory = false,
    options: WalletSyncOptions = {},
  ) => {
    await synchronizeWalletNetwork({
      controller: walletNetworkController,
      getWallet: () => walletRef.current,
      getNetwork: () => networkRef.current,
      getClient: () => electrumClientRef.current,
      setClient: (client) => {
        electrumClientRef.current = client;
      },
      actionPending: () => pendingActionRef.current !== null,
      readHistoryCache: (address) => readOptionalCache(() => loadWalletHistoryCache(address)),
      readHdAddressRequirements: loadHdAddressRequirements,
      saveHistory: saveWalletHistoryCache,
      saveSnapshot: saveWalletSnapshotCache,
      publishNetwork: (nextNetwork, historyMode) => {
        const publishedNetwork = publishNetworkState(
          nextNetwork,
          walletRef.current?.walletId ?? null,
          historyMode,
        );
        // Deliberately release failed enrichment keys after every successful
        // synchronization, even when the socket never disconnected. The
        // global Electrum limiter bounds the retry load, while this broad
        // recovery prevents one transient read failure from lasting forever.
        if (
          publishedNetwork.status === 'connected'
          && releaseFailedHistoryEnrichmentAttempts(
            enrichAttemptedRef.current,
            enrichFailedRef.current,
          ) > 0
        ) {
          historyEnrichmentRetryScheduler.cancel();
          walletNetworkController.requestOrQueueEnrichment(enrichWalletHistoryRef.current);
        }
      },
      setError,
      setHistorySyncing,
      setHistoryProgress,
      setBalanceRefreshing,
      finishSync: () => {
        subscriptionSyncFlushRef.current();
      },
      messages: {
        noActiveWallet: t('errors.noActiveWallet'),
        networkUnavailable: t('errors.networkUnavailable'),
        walletStorageUnavailable: t('errors.walletStorageUnavailable'),
      },
    }, includeHistory, options);
    const activeWallet = walletRef.current;
    const currentNetwork = networkRef.current;
    if (activeWallet && currentNetwork.status === 'connected' && currentNetwork.snapshot) {
      try {
        await reconcileTransactionLifecycles(
          activeWallet.walletId,
          currentNetwork.snapshot.history,
        );
        const lifecycles = await loadTransactionLifecycles(activeWallet.walletId);
        await recoverTransactionBroadcasts(activeWallet.walletId, lifecycles);
      } catch (caught) {
        setError(translatedErrorMessage(
          caught,
          t,
          t('errors.walletStorageUnavailable'),
          'transaction lifecycle reconciliation',
        ));
      }
    }
  }, [
    historyEnrichmentRetryScheduler,
    publishNetworkState,
    recoverTransactionBroadcasts,
    t,
    walletNetworkController,
  ]);

  useLayoutEffect(() => {
    syncTransparentNetworkRef.current = syncTransparentNetwork;
  }, [syncTransparentNetwork]);

  useEffect(
    () => () => transactionBroadcastRetryScheduler.cancel(),
    [transactionBroadcastRetryScheduler],
  );

  useEffect(() => {
    if (screen !== 'wallet' || !network.snapshot) return;
    const pendingKeys = new Set(
      network.snapshot.history
        .filter(needsHistoryEnrichment)
        .map(enrichKey),
    );
    pruneHistoryEnrichmentFailures(
      enrichAttemptedRef.current,
      enrichFailedRef.current,
      pendingKeys,
    );
    scheduleHistoryEnrichmentRetries();
    const hasPending = network.snapshot.history.some(
      (entry) => needsHistoryEnrichment(entry)
        && !enrichAttemptedRef.current.has(enrichKey(entry)),
    );
    if (hasPending) {
      walletNetworkController.requestOrQueueEnrichment(enrichWalletHistoryRef.current);
    }
  }, [
    network.snapshot,
    scheduleHistoryEnrichmentRetries,
    screen,
    walletNetworkController,
  ]);

  const reconcileBroadcasts = useCallback(async (
    txids: readonly string[],
    session: WalletSessionToken,
  ) => {
    const client = electrumClientRef.current ?? createElectrumClient();
    electrumClientRef.current = client;
    const found = await reconcileBroadcastTransactions({
      txids,
      client,
      isCurrent: () => walletNetworkController.isCurrent(session),
    });
    if (found) {
      await syncTransparentNetwork(false, { force: true, silent: true });
    }
  }, [syncTransparentNetwork, walletNetworkController]);

  const advanceBlockHeight = useCallback((height: number) => {
    const activeWallet = walletRef.current;
    if (!activeWallet) return;
    const session = walletNetworkController.sessions.capture(activeWallet.walletId);
    if (!walletNetworkController.isCurrent(session)) return;
    publishNetworkState({ ...networkRef.current, height }, activeWallet.walletId);
  }, [publishNetworkState, walletNetworkController]);

  const requestSync = useCallback((options: Parameters<typeof syncTransparentNetwork>[1]) => {
    void syncTransparentNetwork(false, options);
  }, [syncTransparentNetwork]);

  const reportNetworkFailure = useCallback((caught: unknown) => {
    const message = translatedErrorMessage(
      caught,
      t,
      t('errors.networkUnavailable'),
      'wallet network connection',
    );
    const current = networkRef.current;
    const nextNetwork: NetworkState = {
      ...current,
      status: 'error',
      error: message,
    };
    publishNetworkState(nextNetwork);
    setError(message);
  }, [publishNetworkState, t]);

  const startBroadcastReconciliation = useCallback((
    txids: readonly string[],
    session: WalletSessionToken,
  ) => {
    void reconcileBroadcasts(txids, session).catch(reportNetworkFailure);
  }, [reconcileBroadcasts, reportNetworkFailure]);

  const {
    clearSubscriptions: clearAddressSubscriptions,
    flushPendingSync,
  } = useWalletSubscriptions({
    enabled: screen === 'wallet' && Boolean(wallet),
    wallet: {
      walletId: wallet?.walletId,
      snapshot: network.snapshot,
    },
    electrum: {
      clientRef: electrumClientRef,
      networkRef,
    },
    synchronization: {
      controller: walletNetworkController,
      request: requestSync,
    },
    onHeightAdvance: advanceBlockHeight,
    onConnectionError: reportNetworkFailure,
  });

  const invalidateElectrumRuntime = useCallback(() => {
    const activeWalletId = walletRef.current?.walletId ?? null;
    invalidateElectrumRuntimeForServerChange({
      client: electrumClientRef.current,
      controller: walletNetworkController,
      walletId: activeWalletId,
      clearClient: () => {
        electrumClientRef.current = null;
      },
      clearPreparedTransaction: () => setPreparedTx(null),
      clearPreparedConsolidation: () => setPreparedConsolidation(null),
      clearDeferredNetworkWork: () => {
        historyEnrichmentRetryScheduler.cancel();
        transactionBroadcastRetryScheduler.cancel();
        pendingNetworkRef.current = null;
        silentNextAutoSyncRef.current = false;
        historyEnrichmentQueueRef.current = null;
        clearAddressSubscriptions();
        setHistorySyncing(false);
        setHistoryProgress(null);
        setBalanceRefreshing(false);
      },
    });
    const session = walletNetworkController.sessions.capture();
    if (session) void transactionTrackingController.restore(session);
  }, [
    clearAddressSubscriptions,
    historyEnrichmentRetryScheduler,
    transactionBroadcastRetryScheduler,
    transactionTrackingController,
    walletNetworkController,
  ]);

  const synchronizeAfterElectrumServerChange = useCallback(async (
    preference: ElectrumServerPreference,
    successMessage: string,
  ) => {
    setElectrumServerPreference(preference);
    const nextNetwork: NetworkState = {
      ...networkRef.current,
      status: 'syncing',
      error: '',
      serverUrl: getConfiguredElectrumServerUrl(),
      height: 0,
    };
    publishNetworkState(nextNetwork);
    if (!walletRef.current) {
      setStatus(successMessage);
      return;
    }
    await syncTransparentNetwork(false, { force: true });
    if (networkRef.current.status === 'connected') {
      setStatus(successMessage);
    }
  }, [publishNetworkState, syncTransparentNetwork]);

  const configureCustomElectrumServer = async (
    input: string,
    onValidationError: (message: string) => void,
  ) => {
    await runExclusiveAction('electrumServer', async () => {
      resetFeedback();
      try {
        const preference = await saveCustomElectrumServerPreference(
          input,
          invalidateElectrumRuntime,
        );
        await synchronizeAfterElectrumServerChange(
          preference,
          t('status.customElectrumSaved'),
        );
      } catch (caught) {
        if (caught instanceof CustomElectrumServerValidationError) {
          onValidationError(customElectrumValidationMessage(caught, t));
        } else {
          setError(translatedErrorMessage(
            caught,
            t,
            t('errors.networkUnavailable'),
            'custom Electrum server configuration',
          ));
        }
      }
    });
  };

  const askUseCustomElectrumServer = (
    input: string,
    onValidationError: (message: string) => void,
  ): string | null => {
    resetFeedback();
    try {
      parseCustomElectrumServerUrl(input);
    } catch (caught) {
      return customElectrumValidationMessage(caught, t);
    }

    Alert.alert(
      t('dialog.customElectrumTitle'),
      t('dialog.customElectrumRisk'),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('dialog.customElectrumConfirm'),
          onPress: () => {
            void configureCustomElectrumServer(input, onValidationError);
          },
        },
      ],
    );
    return null;
  };

  const restoreOfficialElectrumServerSelection = async () => {
    await runExclusiveAction('electrumServer', async () => {
      resetFeedback();
      try {
        const preference = await restoreOfficialElectrumServers(
          invalidateElectrumRuntime,
        );
        await synchronizeAfterElectrumServerChange(
          preference,
          t('status.officialElectrumRestored'),
        );
      } catch (caught) {
        setError(customElectrumValidationMessage(caught, t));
      }
    });
  };

  const askUseOfficialElectrumServers = () => {
    Alert.alert(
      t('dialog.officialElectrumTitle'),
      t('dialog.officialElectrumBody'),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('dialog.officialElectrumConfirm'),
          onPress: () => {
            void restoreOfficialElectrumServerSelection();
          },
        },
      ],
    );
  };

  useEffect(() => {
    subscriptionSyncFlushRef.current = flushPendingSync;
    return () => {
      if (subscriptionSyncFlushRef.current === flushPendingSync) {
        subscriptionSyncFlushRef.current = () => undefined;
      }
    };
  }, [flushPendingSync]);

  useEffect(() => {
    if (screen === 'wallet' && wallet) {
      const timer = setTimeout(() => {
        const silent = silentNextAutoSyncRef.current;
        silentNextAutoSyncRef.current = false;
        void syncTransparentNetwork(false, silent ? { silent: true } : {});
      }, 0);

      return () => {
        clearTimeout(timer);
      };
    }

    return undefined;
  }, [screen, syncTransparentNetwork, wallet]);

  const createWallet = async (additionalEntropyBase64?: string) => {
    await runExclusiveAction('create', async () => {
    resetFeedback();
    const secretGeneration = transientSecretGenerationRef.current;

    try {
      const mnemonic = await generateMnemonic24(additionalEntropyBase64);
      if (
        additionalEntropyBase64 !== undefined
        && secretGeneration !== transientSecretGenerationRef.current
      ) return;
      const nextWallet = await deriveLegacyCompatibleWallet(mnemonic);
      walletLockAppliedRef.current = false;
      setPendingWallet(nextWallet);
      setPendingWalletRequiresSeedBackup(true);
      setSeedBackupConfirmationStep(-1);
      setSeedBackupAttemptToken(nextSeedBackupAttemptToken());
      setSeedBackupConfirmationError('');
      void prefetchWalletNetwork(nextWallet);
      setWallet(null);
      setPersistPassword('');
      setPersistConfirmPassword('');
      setShowMnemonic(false);
      setScreen('persist');
      if (lockWalletIfAppStateBackground(
        appStateRef.current,
        lockWalletRef.current,
      )) return;
      setStatus(t('status.seedCreated'));
    } catch (caught) {
      setError(translatedErrorMessage(
        caught,
        t,
        t('errors.walletCreationFailed'),
        'wallet creation',
      ));
    }
  
    });
  };

  const importWallet = async () => {
    await runExclusiveAction('import', async () => {
    resetFeedback();
    const transientSecretGeneration = transientSecretGenerationRef.current;

    let mnemonic: string;
    try {
      mnemonic = validateImportMnemonic(importText, t);
    } catch (caught) {
      setImportFieldError(caught instanceof Error ? caught.message : t('errors.importFailed'));
      return;
    }

    try {
      const nextWallet = await deriveLegacyCompatibleWallet(mnemonic);
      if (
        transientSecretGeneration !== transientSecretGenerationRef.current
        || screenRef.current !== 'import'
      ) {
        return;
      }
      walletLockAppliedRef.current = false;
      setPendingWallet(nextWallet);
      setPendingWalletRequiresSeedBackup(false);
      setSeedBackupConfirmationStep(-1);
      setSeedBackupAttemptToken(nextSeedBackupAttemptToken());
      setSeedBackupConfirmationError('');
      void prefetchWalletNetwork(nextWallet);
      setWallet(null);
      setPersistPassword('');
      setPersistConfirmPassword('');
      setShowMnemonic(false);
      setImportText('');
      setShowImportSeed(false);
      setScreen('persist');
      if (lockWalletIfAppStateBackground(
        appStateRef.current,
        lockWalletRef.current,
      )) return;
      setStatus(t('status.seedImported'));
    } catch (caught) {
      setError(translatedErrorMessage(
        caught,
        t,
        t('errors.importFailed'),
        'wallet import derivation',
      ));
    }
  
    });
  };

  const unlockSavedWallet = async (useBiometrics = false, auto = false) => {
    await runExclusiveAction('unlock', async () => {
    resetFeedback();
    let biometricPromptGuardActive = false;

    if (!useBiometrics && unlockPassword.length < PASSWORD_UNLOCK_MIN_LENGTH) {
      setUnlockPasswordError(t('errors.enterVaultPassword'));
      return;
    }

    try {
      const vault = await loadVault();
      if (!vault) {
        applyVaultTransition({ type: 'load', vault: null });
        setScreen('landing');
        throw new Error(t('errors.noVault'));
      }

      let vaultSecret = unlockPassword;

      if (useBiometrics) {
        if (!vault.biometricsEnabled && vault.unlockMode !== 'biometric') {
          throw new Error(t('errors.biometricUnavailable'));
        }

        systemPromptActiveRef.current = true;
        biometricPromptGuardActive = true;
        const secret = await loadBiometricSecret();

        if (!secret) {
          throw new Error(t('errors.biometricReimport'));
        }
        vaultSecret = secret;
      }

      const cachedNetworkPromise = readOptionalCache(() => loadWalletSnapshotCache(vault.address));
      const cachedHistoryPromise = readOptionalCache(() => loadWalletHistoryCache(vault.address));
      const [payload, candidateCachedNetworkRead, candidateCachedHistoryRead] = await Promise.all([
        decryptVault(vault, vaultSecret, t('errors.invalidPasswordOrVault')),
        cachedNetworkPromise,
        cachedHistoryPromise,
      ]);
      const candidateCachedNetwork = candidateCachedNetworkRead.status === 'hit'
        ? candidateCachedNetworkRead.value
        : null;
      const candidateCachedHistory = candidateCachedHistoryRead.status === 'hit'
        ? candidateCachedHistoryRead.value
        : null;
      const receiveIndex = await loadCurrentHdAddressIndex(
        payload.address,
        'taproot',
        'external',
      );
      const unlockedWallet = await restoreLegacyCompatibleWallet(
        payload,
        'taproot',
        receiveIndex,
      );
      const cachedNetwork = vault.address === payload.address
        ? candidateCachedNetwork
        : await readOptionalCache(() => loadWalletSnapshotCache(payload.address)).then(
            (result) => result.status === 'hit' ? result.value : null,
          );
      const cachedHistory = vault.address === payload.address
        ? candidateCachedHistory
        : await readOptionalCache(() => loadWalletHistoryCache(payload.address)).then(
            (result) => result.status === 'hit' ? result.value : null,
          );
      applyVaultTransition({ type: 'load', vault });
      applyVaultTransition({ type: 'unlock' });
      setUnlockPassword('');
      enterWallet(unlockedWallet, true, t('status.walletUnlocked'), cachedNetwork, cachedHistory);
      const unlockedSession = walletNetworkController.sessions.capture(unlockedWallet.walletId);
      if (cachedNetwork && unlockedSession) {
        void (async () => {
          if (!walletNetworkController.isCurrent(unlockedSession)) return;
          await saveWalletSnapshotCache(
            unlockedWallet.walletId,
            toQuickWalletSnapshot(cachedNetwork.snapshot),
            cachedNetwork.height,
          );
        })().catch((caught) => {
          if (walletNetworkController.isCurrent(unlockedSession)) {
            setError(translatedErrorMessage(
              caught,
              t,
              t('errors.networkUnavailable'),
              'wallet snapshot cache upgrade',
            ));
          }
        });
      }

      if ((vault.rounds || 0) < PBKDF2_ROUNDS) {
        void (async () => {
          try {
            const upgraded = await encryptVault(
              payload,
              vaultSecret,
              Boolean(vault.biometricsEnabled),
              vault.unlockMode === 'biometric' ? 'biometric' : 'password',
            );
            const latest = await loadVault();
            const upgradeCommit = prepareVaultUpgradeCommit(upgraded, latest, payload.address);
            if (!upgradeCommit) {
              return;
            }
            await saveVault(upgradeCommit);
          } catch (caught) {
            reportNonFinancialFailure('vault KDF upgrade', caught);
            // Best-effort KDF upgrade; the vault stays usable at its stored rounds.
          }
        })();
      }
    } catch (caught) {
      if (useBiometrics) {
        biometricDismissedRef.current = true;
      }
      if (auto) {
        return;
      }
      if (useBiometrics) {
        setError(t('errors.biometricCancelled', { method: biometricMethod }));
      } else if (
        caught instanceof Error
        && caught.message === t('errors.invalidPasswordOrVault')
      ) {
        setUnlockPasswordError(caught.message);
      } else {
        setError(translatedErrorMessage(
          caught,
          t,
          t('errors.unlockFailed'),
          'wallet unlock',
        ));
      }
    } finally {
      if (biometricPromptGuardActive) {
        systemPromptActiveRef.current = false;
      }
    }

    });
  };

  useEffect(() => {
    unlockSavedWalletRef.current = unlockSavedWallet;
  });

  useEffect(() => {
    if (screen !== 'unlock') {
      autoBiometricAttemptedRef.current = false;
      biometricDismissedRef.current = false;
      biometricInterruptedRef.current = false;
      return;
    }
    if (
      autoBiometricAttemptedRef.current
      || biometricDismissedRef.current
      || lockedDuringSessionRef.current
      || !vaultBiometricsEnabled
      || biometricUnavailableReason
    ) {
      return;
    }
    autoBiometricAttemptedRef.current = true;
    const timer = setTimeout(() => {
      void unlockSavedWalletRef.current(true, true);
    }, 350);
    return () => clearTimeout(timer);
  }, [screen, vaultBiometricsEnabled, biometricUnavailableReason]);

  const persistWallet = async () => {
    await runExclusiveAction('protect', async () => {
    resetFeedback();

    const walletToPersist = pendingWallet || wallet;

    if (!walletToPersist) {
      setError(t('errors.noWalletToProtect'));
      return;
    }

    if (
      pendingWalletRequiresSeedBackup
      && (
        seedBackupChallenges.length === 0
        || seedBackupConfirmationStep < seedBackupChallenges.length
      )
    ) {
      setSeedBackupConfirmationError(t('errors.seedBackupIncomplete'));
      return;
    }

    if (persistPassword.length < PASSWORD_MIN_LENGTH) {
      setPersistPasswordError(t('errors.passwordMin10'));
      return;
    }

    if (persistPassword !== persistConfirmPassword) {
      setPersistConfirmPasswordError(t('errors.passwordMismatch'));
      return;
    }

    setPersistBusy(true);
    setStatus(t('loading.protect'));
    await yieldToUi();

    try {
      await deleteBiometricSecret();
      const encrypted = await encryptVault(
        {
          version: 1,
          mnemonic: walletToPersist.mnemonic,
          address: walletToPersist.walletId,
          derivationPath: walletToPersist.walletIdDerivationPath,
          createdAt: new Date().toISOString(),
        },
        persistPassword,
        false,
        'password',
      );

      await saveVault(encrypted);
      applyVaultTransition({ type: 'persist' });

      let biometricNotice = '';
      if (!biometricUnavailableReason && await askBiometricOptIn()) {
        try {
          await enableBiometricUnlock(persistPassword, walletToPersist.mnemonic);
          biometricNotice = t('status.biometricEnabled', { method: biometricMethod });
        } catch (caught) {
          reportNonFinancialFailure('biometric opt-in', caught);
          biometricNotice = t('errors.biometricUnavailable');
        }
      }

      setPersistPassword('');
      setPersistConfirmPassword('');
      setPendingWalletRequiresSeedBackup(false);
      setSeedBackupConfirmationStep(-1);
      setSeedBackupConfirmationError('');
      enterWallet(walletToPersist, true, biometricNotice || t('status.walletOpened'));
    } catch (caught) {
      setError(translatedErrorMessage(
        caught,
        t,
        t('errors.saveFailed'),
        'wallet persistence',
      ));
    } finally {
      setPersistBusy(false);
    }
  
    });
  };

  const startSeedBackupConfirmation = () => {
    seedBackupAnswerLockedRef.current = false;
    setSeedBackupConfirmationError('');
    setSeedBackupConfirmationStep(0);
  };

  const showSeedBackupAgain = () => {
    seedBackupAnswerLockedRef.current = false;
    setSeedBackupConfirmationError('');
    setSeedBackupConfirmationStep(-1);
    setSeedBackupAttemptToken(nextSeedBackupAttemptToken());
  };

  const confirmSeedBackupWord = (answer: string) => {
    if (seedBackupAnswerLockedRef.current) return;
    const challenge = seedBackupChallenges[seedBackupConfirmationStep];
    if (!challenge) return;
    seedBackupAnswerLockedRef.current = true;

    const nextStep = nextSeedBackupConfirmationStep(
      seedBackupConfirmationStep,
      challenge,
      answer,
    );
    if (nextStep < 0) {
      setSeedBackupConfirmationError(t('errors.seedBackupWordMismatch'));
      setSeedBackupConfirmationStep(-1);
      setSeedBackupAttemptToken(nextSeedBackupAttemptToken());
      return;
    }

    setSeedBackupConfirmationError('');
    setSeedBackupConfirmationStep(nextStep);
    if (nextStep >= seedBackupChallenges.length) {
      setStatus(t('status.seedBackupVerified'));
    }
  };

  const removeSavedWallet = () => {
    resetFeedback();
    const walletId = wallet?.walletId;
    Alert.alert(
      t('dialog.deleteTitle'),
      t('dialog.deleteBody'),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('dialog.deleteConfirm'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                if (walletId) {
                  await clearWalletPublicData(walletId);
                }
                await deleteBiometricSecret();
                await deleteVault();
                historyEnrichmentRetryScheduler.cancel();
                transactionBroadcastRetryScheduler.cancel();
                walletNetworkController.cancel();
                clearAddressSubscriptions();
                electrumClientRef.current?.disconnect(new Error('Wallet deleted.'));
                electrumClientRef.current = null;
                pendingNetworkRef.current = null;
                walletRef.current = null;
                receiveAddressOperationRef.current += 1;
                setReceiveAddressBusy(false);
                applyVaultTransition({ type: 'delete' });
                setWallet(null);
                setPendingWallet(null);
                setPendingWalletRequiresSeedBackup(false);
                setSeedBackupConfirmationStep(-1);
                setSeedBackupConfirmationError('');
                setShowMnemonic(false);
                setSensitiveAction(null);
                setSensitivePassword('');
                setHistoryProgress(null);
                setHistorySyncing(false);
                setBalanceRefreshing(false);
                setBroadcasting(false);
                const emptyNetwork = createEmptyNetworkState();
                publishNetworkState(emptyNetwork);
                setScreen('landing');
                setStatus(t('status.walletDeleted'));
              } catch (caught) {
                setError(translatedErrorMessage(
                  caught,
                  t,
                  t('errors.deleteFailed'),
                  'wallet deletion',
                ));
              }
            })();
          },
        },
      ],
    );
  };

  const clearTransientEntrySecrets = useCallback(() => {
    transientSecretGenerationRef.current += 1;
    setImportText('');
    setShowImportSeed(false);
    setImportFieldError('');
    setUnlockPassword('');
    setShowUnlockPassword(false);
    setUnlockPasswordError('');

    if (screenRef.current === 'dice') {
      diceEntropyResetRef.current();
      setDiceSessionKey((current) => current + 1);
      setError('');
      setStatus(tRef.current('status.diceResultsCleared'));
      setScreen('landing');
    }

    if (screenRef.current === 'import') {
      setScreen(vaultSessionStateRef.current.status !== 'absent' ? 'unlock' : 'landing');
    }
  }, [setScreen]);
  useLayoutEffect(() => {
    clearTransientSecretsRef.current = clearTransientEntrySecrets;
  }, [clearTransientEntrySecrets]);

  const lockWallet = useCallback(() => {
    if (walletLockAppliedRef.current) return;
    walletLockAppliedRef.current = true;
    lockedDuringSessionRef.current = true;
    applyVaultTransition({ type: 'lock' });
    historyEnrichmentRetryScheduler.cancel();
    transactionBroadcastRetryScheduler.cancel();
    walletNetworkController.cancel();
    transactionTrackingController.reset();
    pendingNetworkRef.current = null;
    receiveAddressOperationRef.current += 1;
    setReceiveAddressBusy(false);
    walletRef.current = null;
    resetFeedback();
    clearAddressSubscriptions();
    electrumClientRef.current?.disconnect(new Error('Wallet locked.'));
    electrumClientRef.current = null;
    setWallet(null);
    setPendingWallet(null);
    setPendingWalletRequiresSeedBackup(false);
    setSeedBackupConfirmationStep(-1);
    setSeedBackupConfirmationError('');
    setShowMnemonic(false);
    setWalletTab('home');
    setHistoryPage(0);
    setImportText('');
    setShowImportSeed(false);
    setUnlockPassword('');
    setShowUnlockPassword(false);
    setPersistPassword('');
    setPersistConfirmPassword('');
    setShowPersistPassword(false);
    setShowPersistConfirmPassword(false);
    resetSendDraft();
    setPreparedTx(null);
    setPreparedConsolidation(null);
    systemPromptActiveRef.current = false;
    setQrScannerOpen(false);
    qrScanHandledRef.current = true;
    setQrScanHandled(true);
    setQrScannerError('');
    setBalanceRefreshing(false);
    setHistoryProgress(null);
    setHistorySyncing(false);
    setBroadcasting(false);
    setSensitiveAction(null);
    setSensitivePassword('');
    setShowSensitivePassword(false);
    enrichAttemptedRef.current.clear();
    enrichFailedRef.current.clear();
    const emptyNetwork = createEmptyNetworkState();
    publishNetworkState(emptyNetwork);
    setScreen(vaultSessionStateRef.current.status !== 'absent' ? 'unlock' : 'landing');
  }, [
    applyVaultTransition,
    clearAddressSubscriptions,
    historyEnrichmentRetryScheduler,
    transactionBroadcastRetryScheduler,
    resetFeedback,
    transactionTrackingController,
    resetSendDraft,
    publishNetworkState,
    setScreen,
    setWalletTab,
    walletNetworkController,
  ]);
  useLayoutEffect(() => {
    lockWalletRef.current = lockWallet;
  }, [lockWallet]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      createWalletAppStateChangeHandler({
        appStateRef,
        screenRef,
        systemPromptActiveRef,
        vaultBiometricsEnabledRef,
        biometricUnavailableReasonRef,
        biometricInterruptedRef,
        biometricDismissedRef,
        lockedDuringSessionRef,
        lockWalletRef,
        clearTransientSecretsRef,
        unlockSavedWalletRef,
      }),
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (screen !== 'wallet' || !seedSaved) {
      autoLockRef.current?.stop();
      autoLockRef.current = null;
      return;
    }
    const lock = new AutoLock(() => {
      if (systemPromptActiveRef.current) return false;
      lockWallet();
      return true;
    }, autoLockTimeoutMs);
    autoLockRef.current = lock;
    lock.resetTimer();
    return () => {
      lock.stop();
      autoLockRef.current = null;
    };
  }, [autoLockTimeoutMs, screen, seedSaved, lockWallet]);

  const registerActivity = useCallback(() => {
    autoLockRef.current?.resetTimer();
  }, []);

  const applyReceiveAddress = useCallback(async (
    activeWallet: Wallet,
    accountKey: HdAccountKey,
    index: number,
    operation: number,
    session: WalletSessionToken,
  ) => {
    const derived = await deriveHdAddress(
      activeWallet.mnemonic,
      accountKey,
      'external',
      index,
    );
    if (
      receiveAddressOperationRef.current !== operation
      || !walletNetworkController.isCurrent(session)
      || walletRef.current?.walletId !== activeWallet.walletId
    ) return false;
    const nextWallet: Wallet = {
      ...activeWallet,
      ...(accountKey === 'taproot' ? {
        primaryAddress: derived.address,
        primaryDerivationPath: derived.path,
        primaryIndex: index,
      } : {}),
      receiveAccountKey: accountKey,
      receiveIndex: index,
      receiveAddress: derived.address,
      receiveDerivationPath: derived.path,
    };
    walletRef.current = nextWallet;
    setWallet(nextWallet);
    return true;
  }, [walletNetworkController]);

  const selectReceiveAddressFamily = useCallback(async (accountKey: HdAccountKey) => {
    if (receiveAddressBusy || pendingActionRef.current) return;
    const activeWallet = walletRef.current;
    const session = activeWallet
      ? walletNetworkController.sessions.capture(activeWallet.walletId)
      : null;
    if (!activeWallet || !session) return;
    const operation = receiveAddressOperationRef.current + 1;
    receiveAddressOperationRef.current = operation;
    setReceiveAddressBusy(true);
    resetFeedback();
    try {
      const index = await loadCurrentHdAddressIndex(
        activeWallet.walletId,
        accountKey,
        'external',
      );
      await applyReceiveAddress(activeWallet, accountKey, index, operation, session);
    } catch (caught) {
      if (receiveAddressOperationRef.current === operation) {
        setError(translatedErrorMessage(
          caught,
          t,
          t('errors.receiveAddressFailed'),
          'receive address selection',
        ));
      }
    } finally {
      if (receiveAddressOperationRef.current === operation) {
        setReceiveAddressBusy(false);
      }
    }
  }, [applyReceiveAddress, receiveAddressBusy, resetFeedback, t, walletNetworkController]);

  const createNewReceiveAddress = useCallback(async () => {
    if (receiveAddressBusy || pendingActionRef.current) return;
    const activeWallet = walletRef.current;
    const snapshot = networkRef.current.snapshot;
    const session = activeWallet
      ? walletNetworkController.sessions.capture(activeWallet.walletId)
      : null;
    if (!activeWallet || !snapshot || !session) {
      setError(t('errors.receiveAddressSyncRequired'));
      return;
    }
    const operation = receiveAddressOperationRef.current + 1;
    receiveAddressOperationRef.current = operation;
    setReceiveAddressBusy(true);
    resetFeedback();
    const sequence = {
      accountKey: activeWallet.receiveAccountKey,
      branch: 'external' as const,
    };
    try {
      const highestUsed = highestUsedHdIndex(snapshot.addresses, sequence);
      const minimumIndex = Math.max(activeWallet.receiveIndex + 1, highestUsed + 1);
      assertGapSafeIssuedIndex({
        addresses: snapshot.addresses,
        sequence,
        index: minimumIndex,
        gapLimit: snapshot.gapLimit,
      });
      const maximumIndex = highestUsed + snapshot.gapLimit;
      const index = await reserveNextHdAddressIndex({
        walletId: activeWallet.walletId,
        accountKey: sequence.accountKey,
        branch: sequence.branch,
        minimumIndex,
        maximumIndex,
      });
      const applied = await applyReceiveAddress(
        activeWallet,
        sequence.accountKey,
        index,
        operation,
        session,
      );
      if (!applied) return;
      setStatus(t('status.receiveAddressCreated', {
        family: hdAccountTemplate(sequence.accountKey).label,
        index,
      }));
      await syncTransparentNetwork(false, { force: true, rescanGap: true, silent: true });
    } catch (caught) {
      if (receiveAddressOperationRef.current !== operation) return;
      if (caught instanceof Error && caught.message === 'HD_ADDRESS_GAP_LIMIT_REACHED') {
        setError(t('errors.receiveAddressGapLimit'));
      } else {
        setError(translatedErrorMessage(
          caught,
          t,
          t('errors.receiveAddressFailed'),
          'receive address creation',
        ));
      }
    } finally {
      if (receiveAddressOperationRef.current === operation) {
        setReceiveAddressBusy(false);
      }
    }
  }, [
    applyReceiveAddress,
    receiveAddressBusy,
    resetFeedback,
    syncTransparentNetwork,
    t,
    walletNetworkController,
  ]);

  const copyAddressToClipboard = async () => {
    await runExclusiveAction('copy', async () => {
    resetFeedback();

    if (!wallet) {
      setError(t('errors.noAddress'));
      return;
    }

    try {
      await Clipboard.setStringAsync(wallet.receiveAddress);
    } catch (caught) {
      setError(translatedErrorMessage(
        caught,
        t,
        t('errors.addressCopyFailed'),
        'wallet address copy',
      ));
      return;
    }
    setStatus(t('status.addressCopied'));
    setTimeout(() => {
      void (async () => {
        const current = await Clipboard.getStringAsync().catch((caught) => {
          reportNonFinancialFailure('clipboard cleanup read', caught);
          return '';
        });
        if (current === wallet.receiveAddress) {
          await Clipboard.setStringAsync('').catch((caught) => {
            reportNonFinancialFailure('clipboard cleanup write', caught);
          });
        }
      })();
    }, ADDRESS_CLIPBOARD_MS);
  
    });
  };

  const validateSendFields = (skipAmountRecipientId?: number) => {
    const fieldErrors = validateSendRecipientDrafts({
      recipients: sendRecipients,
      validateAddress: (address) => {
        scriptPubKeyForNitoAddress(address);
      },
      validateAmount: (amount) => {
        parseNitoAmountToSats(amount);
      },
      addressError: t('errors.invalidDestination'),
      amountError: t('errors.invalidAmount'),
      skipAmountRecipientId,
    });
    setSendRecipientErrors(fieldErrors);
    return Object.keys(fieldErrors).length === 0;
  };

  const prepareTransparentSend = async () => {
    await runExclusiveAction('prepare', async () => {
    resetFeedback();

    if (!wallet || !network.snapshot) {
      setError(t('errors.walletSyncing'));
      return;
    }

    if (!validateSendFields()) {
      setPreparedTx(null);
      setPreparedConsolidation(null);
      return;
    }

    try {
      setPreparedTx(null);
      setPreparedConsolidation(null);
      const outputs = sendRecipients.map((recipient) => ({
        address: recipient.address,
        amountSats: parseNitoAmountToSats(recipient.amount),
      }));
      const previewChange = await deriveHdAddress(
        wallet.mnemonic,
        'taproot',
        'internal',
        0,
      );
      const estimate = await estimateTransparentMultiSend({
        mnemonic: wallet.mnemonic,
        snapshot: network.snapshot,
        outputs,
        changeAddress: previewChange.address,
      });
      const summary = summarizeRecipientSpend(
        outputs.map((output) => output.amountSats),
        BigInt(estimate.feeSats),
        BigInt(network.snapshot.spendableSats),
      );
      assertTransparentSendFitsAvailable(estimate.fitsAvailable && summary.fitsAvailable);
      const tx = await prepareUnsignedTransparentMultiSend({
        mnemonic: wallet.mnemonic,
        snapshot: network.snapshot,
        outputs,
        changeAddress: previewChange.address,
      });

      setPreparedConsolidation(null);
      setPreparedTx(tx);
      setStatus(t('status.transactionReady', { fee: satoshisToNito(tx.feeSats, language) }));
    } catch (caught) {
      setPreparedTx(null);
      setError(translatedTransparentSendError(
        caught,
        t,
        t('errors.txPrepareFailed'),
        'transparent send prepare',
      ));
    }
  
    });
  };

  const fillMaxSendAmount = async (recipientId: number) => {
    await runExclusiveAction('max', async () => {
      resetFeedback();

      if (!wallet || !network.snapshot) {
        setError(t('errors.walletSyncing'));
        return;
      }

      const targetIndex = sendRecipients.findIndex((recipient) => recipient.id === recipientId);
      if (targetIndex < 0 || !validateSendFields(recipientId)) {
        setPreparedTx(null);
        setPreparedConsolidation(null);
        return;
      }

      try {
        const previewChange = await deriveHdAddress(
          wallet.mnemonic,
          'taproot',
          'internal',
          0,
        );
        const outputs = sendRecipients.map((recipient, index) => ({
          address: recipient.address,
          amountSats: index === targetIndex ? 0n : parseNitoAmountToSats(recipient.amount),
        }));
        const max = await calculateMaxTransparentSendAmount({
          mnemonic: wallet.mnemonic,
          snapshot: network.snapshot,
          outputs,
          targetIndex,
          changeAddress: previewChange.address,
        });

        setSendRecipients((current) => current.map((recipient) => (
          recipient.id === recipientId
            ? { ...recipient, amount: satoshisToNitoInput(max.amountSats) }
            : recipient
        )));
        setPreparedTx(null);
        setPreparedConsolidation(null);
      } catch (caught) {
        setPreparedTx(null);
        setPreparedConsolidation(null);
        setError(translatedTransparentSendError(
          caught,
          t,
          t('errors.txPrepareFailed'),
          'transparent send max',
        ));
      }
    });
  };

  const updateSendRecipient = (
    recipientId: number,
    field: SendRecipientField,
    value: string,
  ) => {
    setSendRecipients((current) => current.map((recipient) => (
      recipient.id === recipientId ? { ...recipient, [field]: value } : recipient
    )));
    setSendRecipientErrors((current) => (
      clearSendRecipientFieldError(current, recipientId, field)
    ));
    setPreparedTx(null);
    setPreparedConsolidation(null);
  };

  const addSendRecipient = () => {
    const id = nextSendRecipientIdRef.current;
    nextSendRecipientIdRef.current += 1;
    setSendRecipients((current) => appendSendRecipient(current, { id, address: '', amount: '' }));
    setPreparedTx(null);
    setPreparedConsolidation(null);
  };

  const removeSendRecipient = (recipientId: number) => {
    setSendRecipients((current) => (
      current.length > 1
        ? current.filter((recipient) => recipient.id !== recipientId)
        : current
    ));
    setSendRecipientErrors((current) => {
      if (!current[recipientId]) return current;
      const next = { ...current };
      delete next[recipientId];
      return next;
    });
    setPreparedTx(null);
    setPreparedConsolidation(null);
  };

  const broadcastPreparedTx = async () => {
    await runExclusiveAction('broadcast', async () => {
    resetFeedback();

    if (!preparedTx) {
      setError(t('errors.noPreparedTx'));
      return;
    }
    const activeWallet = walletRef.current;
    const session = activeWallet
      ? walletNetworkController.sessions.capture(activeWallet.walletId)
      : null;
    if (!session) {
      setError(t('errors.noActiveWallet'));
      return;
    }

    try {
      setBroadcasting(true);
      const activeSnapshot = networkRef.current.snapshot;
      if (!activeSnapshot || !activeWallet) {
        setError(t('errors.walletSyncing'));
        return;
      }
      const preview = preparedTx;
      let changeAddress = (await deriveHdAddress(
        activeWallet.mnemonic,
        'taproot',
        'internal',
        0,
      )).address;
      let lifecycle: Awaited<ReturnType<typeof reserveTransactionWithoutAddress>>;
      if (preview.changeUsed) {
        const requirements = await loadHdAddressRequirements(activeWallet.walletId);
        const highestIssuedIndex = requirements.find((requirement) => (
          requirement.accountKey === 'taproot' && requirement.branch === 'internal'
        ))?.highestIssuedIndex ?? -1;
        const range = internalTaprootReservationRange({
          snapshot: activeSnapshot,
          highestIssuedIndex,
          count: 1,
        });
        const [reserved] = await reserveInternalTaprootTransactions({
          walletId: activeWallet.walletId,
          purpose: 'send',
          count: 1,
          ...range,
        });
        if (!reserved || reserved.addressIndex === null) {
          throw new Error('Internal Taproot reservation is incomplete.');
        }
        const derived = await deriveHdAddress(
          activeWallet.mnemonic,
          'taproot',
          'internal',
          reserved.addressIndex,
        );
        await attachInternalTransactionAddresses(activeWallet.walletId, [{
          lifecycleId: reserved.lifecycleId,
          address: derived.address,
        }]);
        lifecycle = { ...reserved, address: derived.address };
        changeAddress = derived.address;
      } else {
        lifecycle = await reserveTransactionWithoutAddress(activeWallet.walletId, 'send');
      }
      if (!walletNetworkController.isCurrent(session)) return;
      const rebuildSnapshot = networkRef.current.snapshot;
      if (!rebuildSnapshot) throw new Error('Wallet snapshot unavailable before reconstruction.');
      const rebuilt = await prepareUnsignedTransparentMultiSend({
        mnemonic: activeWallet.mnemonic,
        snapshot: rebuildSnapshot,
        outputs: preview.recipients,
        changeAddress,
      });
      try {
        assertTransparentSendPlanMatches(preview, rebuilt);
      } catch (caught) {
        if (!isTransparentSendReviewChanged(caught)) throw caught;
        setPreparedTx(rebuilt);
        setPreparedConsolidation(null);
        setStatus(t('status.transactionReady', {
          fee: satoshisToNito(rebuilt.feeSats, language),
        }));
        return;
      }
      if (
        rebuilt.changeUsed
        && !rebuilt.walletOutputs.some((output) => output.address === changeAddress)
      ) {
        throw new Error('Reserved internal Taproot address is missing from the transaction.');
      }
      const signingSnapshot = networkRef.current.snapshot;
      if (!signingSnapshot) throw new Error('Wallet snapshot unavailable before signing.');
      assertUnsignedTransparentInputsAvailable(rebuilt, signingSnapshot);
      const signed = await signUnsignedTransparentTx({
        mnemonic: activeWallet.mnemonic,
        transaction: rebuilt,
      });
      await markTransactionLifecycleSigned(
        activeWallet.walletId,
        lifecycle.lifecycleId,
        signed.txid,
        signed.hex,
      );
      setPreparedTx(null);
      setPreparedConsolidation(null);
      if (!walletNetworkController.isCurrent(session)) return;
      await transactionTrackingController.refresh(session);
      const transaction = { ...signed, recipients: rebuilt.recipients };
      const recovery = await recoverTransactionBroadcasts(activeWallet.walletId);
      if (!recovery.publishedTxids.includes(transaction.txid)) {
        // The saved transaction is now owned by recovery and its single window.
        // Do not present a planned retry as a failed payment inviting a duplicate.
        if (walletNetworkController.isCurrent(session)) resetSendDraft();
        return;
      }
      const txid = transaction.txid;
      if (!walletNetworkController.isCurrent(session)) return;

      const currentNetwork = networkRef.current;
      if (currentNetwork.snapshot) {
        const optimisticNetwork = {
          ...currentNetwork,
          snapshot: applyOptimisticWalletBroadcast({
            snapshot: currentNetwork.snapshot,
            transaction,
            txid,
          }),
        };
        publishNetworkState(optimisticNetwork, session.walletId);
      }

      resetSendDraft();
      setStatus(t('status.transactionSent', { txid }));
      startBroadcastReconciliation([txid], session);
    } catch (caught) {
      if (walletNetworkController.isCurrent(session)) {
        setError(translatedErrorMessage(
          caught,
          t,
          t('errors.sendFailed'),
          'transparent transaction broadcast',
        ));
      }
    } finally {
      if (walletNetworkController.isCurrent(session)) {
        setBroadcasting(false);
      }
    }
  
    });
  };

  const prepareTransparentConsolidation = async () => {
    await runExclusiveAction('consolidate', async () => {
      resetFeedback();
      const consolidationT = makeConsolidationTranslator(language);
      if (!wallet || !network.snapshot) {
        setError(t('errors.walletSyncing'));
        return;
      }
      try {
        const previewAddress = await deriveHdAddress(
          wallet.mnemonic,
          'taproot',
          'internal',
          0,
        );
        const plan = await prepareUnsignedTransparentConsolidation({
          mnemonic: wallet.mnemonic,
          snapshot: network.snapshot,
          toAddresses: [previewAddress.address],
        });
        setPreparedTx(null);
        setPreparedConsolidation(plan);
        setWalletTab('send');
        setStatus(consolidationT('review'));
      } catch (caught) {
        reportUnexpectedTransparentSendFailure('transparent consolidation prepare', caught);
        setPreparedConsolidation(null);
        setError(consolidationT('unavailable'));
      }
    });
  };

  const confirmTransparentConsolidation = () => {
    const consolidationT = makeConsolidationTranslator(language);
    Alert.alert(consolidationT('title'), consolidationT('explanation'), [
      { text: consolidationT('cancel'), style: 'cancel' },
      { text: consolidationT('prepare'), onPress: () => { void prepareTransparentConsolidation(); } },
    ]);
  };

  const broadcastPreparedConsolidation = async () => {
    await runExclusiveAction('broadcastConsolidation', async () => {
      const consolidationT = makeConsolidationTranslator(language);
      resetFeedback();
      if (!preparedConsolidation) {
        setError(consolidationT('unavailable'));
        return;
      }
      const activeWallet = walletRef.current;
      const session = activeWallet
        ? walletNetworkController.sessions.capture(activeWallet.walletId)
        : null;
      if (!session) {
        setError(t('errors.noActiveWallet'));
        return;
      }

      setBroadcasting(true);
      const reconciliationTxids: string[] = [];
      let sentCount = 0;
      let signingStarted = false;
      let broadcastDeferred = false;
      try {
        const activeSnapshot = networkRef.current.snapshot;
        if (!activeSnapshot || !activeWallet) {
          setError(t('errors.walletSyncing'));
          return;
        }
        const requirements = await loadHdAddressRequirements(activeWallet.walletId);
        const highestIssuedIndex = requirements.find((requirement) => (
          requirement.accountKey === 'taproot' && requirement.branch === 'internal'
        ))?.highestIssuedIndex ?? -1;
        const count = preparedConsolidation.transactions.length;
        const range = internalTaprootReservationRange({
          snapshot: activeSnapshot,
          highestIssuedIndex,
          count,
        });
        const reservations = await reserveInternalTaprootTransactions({
          walletId: activeWallet.walletId,
          purpose: 'consolidation',
          count,
          ...range,
        });
        const destinations: string[] = [];
        for (const reservation of reservations) {
          if (reservation.addressIndex === null) {
            throw new Error('Internal Taproot reservation is incomplete.');
          }
          const derived = await deriveHdAddress(
            activeWallet.mnemonic,
            'taproot',
            'internal',
            reservation.addressIndex,
          );
          destinations.push(derived.address);
        }
        if (new Set(destinations).size !== count) {
          throw new Error('Consolidation internal Taproot addresses are not unique.');
        }
        await attachInternalTransactionAddresses(
          activeWallet.walletId,
          reservations.map((reservation, index) => ({
            lifecycleId: reservation.lifecycleId,
            address: destinations[index]!,
          })),
        );
        if (!walletNetworkController.isCurrent(session)) return;
        const rebuildSnapshot = networkRef.current.snapshot;
        if (!rebuildSnapshot) throw new Error('Wallet snapshot unavailable before reconstruction.');
        const rebuilt = await prepareUnsignedTransparentConsolidation({
          mnemonic: activeWallet.mnemonic,
          snapshot: rebuildSnapshot,
          toAddresses: destinations,
        });
        try {
          assertTransparentConsolidationPlanMatches(preparedConsolidation, rebuilt);
        } catch (caught) {
          if (!isTransparentSendReviewChanged(caught)) throw caught;
          setPreparedTx(null);
          setPreparedConsolidation(rebuilt);
          setStatus(consolidationT('review'));
          return;
        }
        rebuilt.transactions.forEach((transaction, index) => {
          const destination = destinations[index];
          if (
            !destination
            || transaction.walletOutputs.length !== transaction.outputCount
            || transaction.walletOutputs.some((output) => output.address !== destination)
          ) {
            throw new Error('Consolidation output does not use its reserved Taproot address.');
          }
        });
        setPreparedConsolidation(null);
        setPreparedTx(null);
        const sequence = rebuilt.transactions.map((transaction, index) => ({
          transaction,
          reservation: reservations[index],
        }));
        if (sequence.some(({ reservation }) => !reservation)) {
          throw new Error('Consolidation reservation is missing.');
        }
        await processPersistentTransactionSequence({
          items: sequence,
          sign: async ({ transaction: unsigned }) => {
            const signingSnapshot = networkRef.current.snapshot;
            if (!signingSnapshot) throw new Error('Wallet snapshot unavailable before signing.');
            assertUnsignedTransparentInputsAvailable(unsigned, signingSnapshot);
            signingStarted = true;
            return signUnsignedTransparentTx({
              mnemonic: activeWallet.mnemonic,
              transaction: unsigned,
            });
          },
          persistSigned: async ({ reservation }, transaction) => {
            if (!reservation) throw new Error('Consolidation reservation is missing.');
            await markTransactionLifecycleSigned(
              activeWallet.walletId,
              reservation.lifecycleId,
              transaction.txid,
              transaction.hex,
            );
            await transactionTrackingController.refresh(session);
          },
          broadcastPersisted: async (_item, transaction) => {
            if (!walletNetworkController.isCurrent(session)) {
              throw new Error('Wallet session changed before transaction broadcast.');
            }
            reconciliationTxids.push(transaction.txid);
            const recovery = await recoverTransactionBroadcasts(activeWallet.walletId);
            if (!recovery.publishedTxids.includes(transaction.txid)) {
              broadcastDeferred = true;
              throw recovery.failures[0]?.error ?? new Error('Transaction broadcast was deferred.');
            }
          },
          afterPublished: async (_item, transaction) => {
            if (!walletNetworkController.isCurrent(session)) {
              throw new Error('Wallet session changed after transaction broadcast.');
            }
            sentCount += 1;
            const currentNetwork = networkRef.current;
            if (currentNetwork.snapshot) {
              const optimisticSnapshot = applyOptimisticWalletBroadcast({
                snapshot: currentNetwork.snapshot,
                transaction,
                txid: transaction.txid,
              });
              const optimisticNetwork = { ...currentNetwork, snapshot: optimisticSnapshot };
              publishNetworkState(optimisticNetwork, session.walletId);
            }
          },
        });
      } catch (caught) {
        if (!walletNetworkController.isCurrent(session)) return;
        reportNonFinancialFailure('transparent consolidation broadcast', caught);
        if (signingStarted) setPreparedConsolidation(null);
        if (broadcastDeferred) return;
        if (sentCount > 0) {
          setError(consolidationT('partialBody'));
        } else {
          setError(translatedErrorMessage(caught, t, t('errors.sendFailed'), 'consolidation signing'));
        }
      } finally {
        if (walletNetworkController.isCurrent(session)) {
          setBroadcasting(false);
        }
        if (reconciliationTxids.length > 0) {
          startBroadcastReconciliation(reconciliationTxids, session);
        }
      }
    });
  };

  const verifySensitiveAction = async (requirePassword = false) => {
    const vault = await loadVault();

    if (!vault) {
      throw new Error(t('errors.noVault'));
    }

    let vaultSecret = sensitivePassword;

    if (requirePassword) {
      if (sensitivePassword.length < PASSWORD_UNLOCK_MIN_LENGTH) {
        throw new Error(t('errors.enterVaultPassword'));
      }
    } else if (vault.unlockMode === 'biometric') {
      systemPromptActiveRef.current = true;
      const secret = await loadBiometricSecret().finally(() => {
        systemPromptActiveRef.current = false;
      });

      if (!secret) {
        throw new Error(t('errors.biometricUnavailable'));
      }

      vaultSecret = secret;
    } else if (sensitivePassword.length < PASSWORD_UNLOCK_MIN_LENGTH) {
      throw new Error(t('errors.enterVaultPassword'));
    }

    const payload = await decryptVault(vault, vaultSecret, t('errors.invalidPasswordOrVault'));

    if (wallet && payload.mnemonic !== wallet.mnemonic) {
      throw new Error(t('errors.passwordDoesNotMatchWallet'));
    }

    return vaultSecret;
  };

  const enableBiometricUnlock = async (password: string, persistingMnemonic?: string) => {
    if (biometricUnavailableReason) {
      throw new Error(biometricUnavailableReason);
    }
    if (!persistingMnemonic && !walletRef.current) {
      throw new Error(t('errors.noActiveWallet'));
    }

    systemPromptActiveRef.current = true;
    try {
      await requestBiometricGate(`Protect Nito Wallet with ${biometricMethod}`);
      await saveBiometricSecret(password);
    } finally {
      systemPromptActiveRef.current = false;
    }

    const vault = await loadVault();
    if (vault) {
      await saveVault({ ...vault, biometricsEnabled: true });
    }
    applyVaultTransition({ type: 'enable-biometrics' });
  };

  const disableBiometricUnlock = async () => {
    await deleteBiometricSecret();
    const vault = await loadVault();
    if (vault) {
      await saveVault({ ...vault, biometricsEnabled: false, unlockMode: 'password' });
    }
    applyVaultTransition({ type: 'disable-biometrics' });
  };

  const askDisableBiometrics = () => {
    resetFeedback();
    setSensitiveAction('disableBiometrics');
    setSensitivePassword('');
  };

  const askEnableBiometrics = () => {
    resetFeedback();
    if (biometricUnavailableReason) {
      setError(biometricUnavailableReason);
      return;
    }
    setSensitiveAction('enableBiometrics');
    setSensitivePassword('');
  };

  const askBiometricOptIn = () =>
    new Promise<boolean>((resolve) => {
      if (biometricUnavailableReason) {
        resolve(false);
        return;
      }
      Alert.alert(
        t('dialog.biometricTitle', { method: biometricMethod }),
        t('dialog.biometricBody', { method: biometricMethod }),
        [
          { text: t('dialog.biometricLater'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('dialog.biometricEnable'), onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });

  const confirmSensitiveAction = async () => {
    await runExclusiveAction(
      sensitiveAction === 'delete' ? 'delete' : sensitiveAction === 'reveal' ? 'reveal' : 'protect',
      async () => {
    resetFeedback();

    if (!wallet || !sensitiveAction) {
      return;
    }

    setSensitiveBusy(true);

    try {
      const vaultSecret = await verifySensitiveAction(sensitiveAction === 'disableBiometrics');

      if (sensitiveAction === 'reveal') {
        setShowMnemonic(true);
        setStatus(t('status.seedVisibleTemporary'));
      } else if (sensitiveAction === 'enableBiometrics') {
        await enableBiometricUnlock(vaultSecret);
        setStatus(t('status.biometricEnabled', { method: biometricMethod }));
      } else if (sensitiveAction === 'disableBiometrics') {
        await disableBiometricUnlock();
        setStatus(t('status.biometricDisabled'));
      } else {
        removeSavedWallet();
      }

      setSensitiveAction(null);
      setSensitivePassword('');
    } catch (caught) {
      const caughtMessage = caught instanceof Error ? caught.message : '';
      const passwordFieldVisible = vaultUnlockMode === 'password'
        || sensitiveAction === 'disableBiometrics';
      if (
        passwordFieldVisible
        && [
          t('errors.enterVaultPassword'),
          t('errors.invalidPasswordOrVault'),
          t('errors.passwordDoesNotMatchWallet'),
        ].includes(caughtMessage)
      ) {
        setSensitivePasswordError(caughtMessage);
      } else {
        setError(translatedErrorMessage(
          caught,
          t,
          t('errors.validationFailed'),
          'sensitive wallet action',
        ));
      }
    } finally {
      setSensitiveBusy(false);
    }
  
    });
  };

  const toggleMnemonic = () => {
    resetFeedback();

    if (!wallet) {
      setError(t('errors.noSeed'));
      return;
    }

    if (showMnemonic) {
      setShowMnemonic(false);
      setStatus(t('status.seedHidden'));
      return;
    }

    setSensitiveAction('reveal');
    setSensitivePassword('');
  };

  const askDeleteWallet = () => {
    resetFeedback();
    setSensitiveAction('delete');
    setSensitivePassword('');
  };

  const exportFullHistory = async () => {
    await runExclusiveAction('history', async () => {
      resetFeedback();
      const activeWallet = walletRef.current;
      const session = activeWallet
        ? walletNetworkController.sessions.capture(activeWallet.walletId)
        : null;
      try {
        if (!activeWallet || !session) {
          throw new Error(t('errors.noActiveWallet'));
        }
        if (!networkRef.current.fullHistoryEnabled || !networkRef.current.snapshot) {
          throw new Error(t('errors.fullHistoryRequired'));
        }
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error(t('errors.historyExportUnavailable'));
        }
        if (!walletNetworkController.isCurrent(session)) return;

        const rootDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
        if (!rootDirectory) {
          throw new Error(t('errors.historyExportUnavailable'));
        }

        while (walletNetworkController.enrichmentInFlight) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (!walletNetworkController.isCurrent(session)) return;
        }
        if (!walletNetworkController.startEnrichment()) return;
        try {
          const snapshot = networkRef.current.snapshot;
          if (!snapshot || !walletNetworkController.isCurrent(session)) return;
          const missing = snapshot.history.filter(needsHistoryEnrichment);

          if (missing.length > 0) {
            const client = electrumClientRef.current || createElectrumClient();
            electrumClientRef.current = client;
            await client.connect();
            if (!walletNetworkController.isCurrent(session)) return;
            const { records: fresh, outputs } = await buildHistoryExportBatch({
              history: missing,
              walletAddresses: snapshot.addresses.map((address) => address.address),
              reader: client,
              loadCachedOutputs: (txids) => loadTransactionOutputCache(
                activeWallet.walletId,
                txids,
              ),
              onCacheReadError: (caught) => {
                reportNonFinancialFailure('transaction output cache read', caught);
              },
              onProgress: (done, total) => {
                if (walletNetworkController.isCurrent(session)) {
                  setStatus(t('status.historyExporting', { done, total }));
                }
              },
            });
            if (!client.connected) {
              throw new ElectrumSessionUnhealthyError(
                new Error('ElectrumX connection closed before history export enrichment completed.'),
              );
            }
            if (!walletNetworkController.isCurrent(session)) return;
            await saveHistoryEnrichmentBatch(
              activeWallet.walletId,
              fresh
                .map((record) => ({
                  txid: record.txid,
                  height: record.blockHeight,
                  amountSats: record.amountSats,
                  direction: record.direction,
                  feeSats: record.feeSats,
                  counterparty: record.counterparty,
                  blockTime: record.blockTime,
                })),
              outputs,
            );
            if (!client.connected) {
              throw new ElectrumSessionUnhealthyError(
                new Error('ElectrumX connection closed before history export commit.'),
              );
            }
            if (!walletNetworkController.isCurrent(session)) return;
            const current = networkRef.current;
            if (current.snapshot && walletNetworkController.isCurrent(session)) {
              const nextNetwork: NetworkState = {
                ...current,
                snapshot: mergeHistoryEnrichment(current.snapshot, fresh),
              };
              publishNetworkState(nextNetwork, activeWallet.walletId);
            }
            if (!walletNetworkController.isCurrent(session)) return;
            recordHistoryEnrichmentBatchOutcome(
              enrichAttemptedRef.current,
              enrichFailedRef.current,
              missing.map(enrichKey),
              'published',
            );
          }
        } finally {
          if (walletNetworkController.isCurrent(session)) {
            walletNetworkController.finishEnrichment(enrichWalletHistoryRef.current);
          }
        }

        if (!walletNetworkController.isCurrent(session)) return;
        const records = historyRecordsFromEntries(networkRef.current.snapshot?.history ?? []);
        const rows = historyExportTsvRows(records, language);
        // Tab separated rather than comma: a comma file collapses into a single
        // column wherever the spreadsheet list separator is a semicolon, which
        // is the default on French and German Windows. Tabs split everywhere.
        const table = `\uFEFF${rows.map((row) => row.map(escapeTsvCell).join('\t')).join('\r\n')}`;
        const date = new Date().toISOString().slice(0, 10);
        const uri = `${rootDirectory}nito-wallet-history-${date}.tsv`;
        await FileSystem.writeAsStringAsync(uri, table, { encoding: FileSystem.EncodingType.UTF8 });
        if (!walletNetworkController.isCurrent(session)) return;
        await Sharing.shareAsync(uri, {
          dialogTitle: t('history.exportTitle'),
          mimeType: 'text/tab-separated-values',
          UTI: 'public.tab-separated-values-text',
        });
        if (!walletNetworkController.isCurrent(session)) return;
        setStatus(t('status.historyExported'));
      } catch (caught) {
        if (!session || walletNetworkController.isCurrent(session)) {
          setError(translatedErrorMessage(
            caught,
            t,
            t('errors.historyExportFailed'),
            'history export',
          ));
        }
      }
    });
  };

  const resynchronizeWalletHistory = async () => {
    await runExclusiveAction('resynchronizeHistory', async () => {
      resetFeedback();
      const activeWallet = walletRef.current;
      if (!activeWallet) {
        setError(t('errors.noActiveWallet'));
        return;
      }
      if (walletNetworkController.syncInFlight || walletNetworkController.enrichmentInFlight) {
        setError(t('errors.walletSyncing'));
        return;
      }
      const session = walletNetworkController.sessions.capture(activeWallet.walletId);
      if (!session) {
        setError(t('errors.noActiveWallet'));
        return;
      }

      try {
        setWalletTab('history');
        clearAddressSubscriptions();
        await clearWalletHistoryCache(activeWallet.walletId);
        if (!walletNetworkController.isCurrent(session)) return;
        historyEnrichmentRetryScheduler.cancel();
        const currentNetwork = networkRef.current;
        if (currentNetwork.snapshot) {
          publishNetworkState({
            ...currentNetwork,
            snapshot: {
              ...currentNetwork.snapshot,
              history: [],
            },
          }, activeWallet.walletId, 'replace');
        }
        enrichAttemptedRef.current.clear();
        enrichFailedRef.current.clear();
        setHistoryPage(0);
        await syncTransparentNetwork(true, { force: true, rescanGap: true });
        if (!walletNetworkController.isCurrent(session)) return;
        if (networkRef.current.status !== 'connected') return;
        setStatus('');
        await enrichWalletHistory();
        while (
          walletNetworkController.isCurrent(session)
          && walletNetworkController.enrichmentInFlight
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!walletNetworkController.isCurrent(session)) return;
        const remaining = networkRef.current.snapshot?.history.some(
          needsHistoryEnrichment,
        );
        if (networkRef.current.status === 'connected' && !remaining) {
          setStatus(t('status.historyResynchronized'));
        } else if (networkRef.current.status === 'connected') {
          setError(t('errors.historyResyncIncomplete'));
        }
      } catch (caught) {
        if (walletNetworkController.isCurrent(session)) {
          setError(translatedErrorMessage(
            caught,
            t,
            t('errors.networkUnavailable'),
            'history resynchronization',
          ));
        }
      }
    });
  };

  const askResynchronizeWalletHistory = () => {
    Alert.alert(
      t('dialog.resyncHistoryTitle'),
      t('dialog.resyncHistoryBody'),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('dialog.resyncHistoryConfirm'),
          onPress: () => {
            void resynchronizeWalletHistory();
          },
        },
      ],
    );
  };

  const refreshBalance = async () => {
    const now = Date.now();
    const activeWallet = walletRef.current;
    if (balanceRefreshing || walletNetworkController.syncInFlight || pendingActionRef.current || !activeWallet) return;
    const session = walletNetworkController.sessions.capture(activeWallet.walletId);
    if (!session) return;
    if (now < refreshCooldownUntil) {
      Alert.alert(
        t('dialog.refreshCooldownTitle'),
        t('dialog.refreshCooldownBody', { time: formatCooldownRemaining(refreshCooldownUntil - now) }),
        [{ text: t('actions.ok') }],
      );
      return;
    }
    resetFeedback();
    const cooldownUntil = now + BALANCE_REFRESH_COOLDOWN_MS;
    setRefreshCooldownUntil(cooldownUntil);
    await SecureStore.setItemAsync(BALANCE_REFRESH_COOLDOWN_KEY, String(cooldownUntil)).catch((caught) => {
      reportNonFinancialFailure('balance refresh cooldown write', caught);
    });
    if (!walletNetworkController.isCurrent(session)) return;
    await syncTransparentNetwork(false, { force: true, silent: true });
  };

  const openQrScanner = async (recipientId: number) => {
    if (pendingActionRef.current) return;
    qrRecipientIdRef.current = recipientId;
    clearQrRetryTimer();
    resetFeedback();
    let granted = cameraPermission?.granted ?? false;
    if (!granted) {
      systemPromptActiveRef.current = true;
      try {
        const permission = await requestCameraPermission();
        granted = permission.granted;
      } catch (caught) {
        qrRecipientIdRef.current = null;
        setError(translatedErrorMessage(
          caught,
          t,
          t('errors.cameraUnavailable'),
          'camera permission request',
        ));
        return;
      } finally {
        systemPromptActiveRef.current = false;
      }
    }
    if (!granted) {
      qrRecipientIdRef.current = null;
      setError(t('errors.cameraPermission'));
      return;
    }
    setQrScannerError('');
    qrScanHandledRef.current = false;
    setQrScanHandled(false);
    qrScanAttemptsRef.current = 0;
    // Opening the camera makes some Android builds report the app as inactive.
    // Treated as a system prompt, that transient state no longer locks the
    // wallet under the open scanner. A real background departure still does:
    // shouldLockWalletForAppState ignores this flag for 'background'.
    systemPromptActiveRef.current = true;
    setQrScannerOpen(true);
  };

  const closeQrScanner = () => {
    clearQrRetryTimer();
    qrRecipientIdRef.current = null;
    systemPromptActiveRef.current = false;
    setQrScannerOpen(false);
    setQrScannerError('');
    qrScanHandledRef.current = true;
    setQrScanHandled(true);
    autoLockRef.current?.resetTimer();
  };

  const handleQrScan = (value: string) => {
    if (qrScanHandledRef.current) return;
    qrScanHandledRef.current = true;
    setQrScanHandled(true);
    try {
      const recipientId = qrRecipientIdRef.current;
      if (recipientId === null) {
        // Losing the target row is an internal fault, not an unreadable code.
        // Retrying would report "invalid address" forever on a perfectly good
        // QR, so the scanner closes instead of looping.
        closeQrScanner();
        return;
      }
      const address = parseNitoQrAddress(value);
      setSendRecipients((current) => updateRecipientAddress(current, recipientId, address));
      setSendRecipientErrors((current) => (
        clearSendRecipientFieldError(current, recipientId, 'address')
      ));
      setPreparedTx(null);
      setPreparedConsolidation(null);
      closeQrScanner();
      setStatus(t('status.addressScanned'));
    } catch {
      setQrScannerError(t('errors.invalidQr'));
      clearQrRetryTimer();
      qrScanAttemptsRef.current += 1;
      // A genuinely unreadable code would otherwise blink forever. After a few
      // tries the error stays on screen and the camera stops re-firing.
      if (qrScanAttemptsRef.current >= QR_SCAN_MAX_ATTEMPTS) return;
      qrRetryTimerRef.current = setTimeout(() => {
        qrRetryTimerRef.current = null;
        qrScanHandledRef.current = false;
        setQrScanHandled(false);
      }, 900);
    }
  };

  const actionLocked = pendingAction !== null;
  const importWordChecks = useMemo(() => getImportWordChecks(importText), [importText]);
  const invalidImportWords = importWordChecks.filter((entry) => entry.complete && !entry.valid);
  const normalizedImportText = normalizeMnemonic(importText);
  const importMnemonicValid = (importWordChecks.length === 12 || importWordChecks.length === 24)
    && validateMnemonic(normalizedImportText, wordlist);
  const importMnemonicStatus = getImportMnemonicStatus(importText, t);
  const loadingMessage = pendingAction ? ({
    create: t('loading.create'),
    import: t('loading.import'),
    unlock: t('loading.unlock'),
    protect: t('loading.protect'),
    copy: t('loading.copy'),
    max: t('loading.max'),
    consolidate: makeConsolidationTranslator(language)('loadingPrepare'),
    prepare: t('loading.prepare'),
    broadcast: t('loading.broadcast'),
    broadcastConsolidation: makeConsolidationTranslator(language)('loadingSend'),
    electrumServer: t('loading.electrumServer'),
    history: t('loading.history'),
    resynchronizeHistory: t('loading.history'),
    reveal: t('loading.reveal'),
    delete: t('loading.delete'),
  } satisfies Record<PendingAction, string>)[pendingAction] : '';
  const loadingRotation = loadingSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const languageSettings = (
    <LanguageSettings
      t={t}
      language={language}
      selectedLanguageName={selectedLanguage.name}
      open={languagePickerOpen}
      onToggle={toggleLanguagePicker}
      onSelect={selectLanguage}
    />
  );

  const renderWalletTab = () => {
    if (!wallet) {
      return null;
    }

    if (walletTab === 'receive') {
      return (
        <ReceiveTab
          wallet={wallet}
          t={t}
          pendingAction={pendingAction}
          actionLocked={actionLocked}
          addressBusy={receiveAddressBusy}
          networkReady={network.status === 'connected' && Boolean(network.snapshot)}
          onSelectFamily={(accountKey) => { void selectReceiveAddressFamily(accountKey); }}
          onCreateAddress={() => { void createNewReceiveAddress(); }}
          onCopyAddress={() => { void copyAddressToClipboard(); }}
        />
      );
    }

    if (walletTab === 'send') {
      return (
        <SendTab
          t={t}
          language={language}
          network={network}
          actionLocked={actionLocked}
          pendingAction={pendingAction}
          broadcasting={broadcasting}
          recipients={sendRecipients}
          recipientErrors={sendRecipientErrors}
          sendEstimate={sendEstimate}
          sendEstimatePending={sendEstimatePending}
          preparedTx={preparedTx}
          preparedConsolidation={preparedConsolidation}
          onChangeRecipient={updateSendRecipient}
          onAddRecipient={addSendRecipient}
          onRemoveRecipient={removeSendRecipient}
          onOpenQrScanner={(recipientId) => { void openQrScanner(recipientId); }}
          onFillMax={(recipientId) => { void fillMaxSendAmount(recipientId); }}
          onPrepareSend={prepareTransparentSend}
          onBroadcastTx={() => { void broadcastPreparedTx(); }}
          onBroadcastConsolidation={() => { void broadcastPreparedConsolidation(); }}
          onPreparedReviewLayout={scrollToPreparedReview}
        />
      );
    }

    if (walletTab === 'history') {
      return (
        <HistoryTab
          t={t}
          language={language}
          walletId={wallet.walletId}
          network={network}
          actionLocked={actionLocked}
          pendingAction={pendingAction}
          historyPage={historyPage}
          historyProgress={historyProgress}
          historySyncing={historySyncing}
          onChangeHistoryPage={setHistoryPage}
          onExportHistory={() => { void exportFullHistory(); }}
          onOpenTx={(txid) => { void openTransactionExplorerWithFeedback(txid); }}
        />
      );
    }

    if (walletTab === 'security') {
      return (
        <SecurityTab
          t={t}
          language={language}
          actionLocked={actionLocked}
          pendingAction={pendingAction}
          security={{
            wallet,
            seedSaved,
            vaultBiometricsEnabled,
            biometricMethod,
            showMnemonic,
            biometricAvailable: !biometricUnavailableReason,
            autoLockTimeoutMs,
            onSelectAutoLockTimeout: selectAutoLockTimeout,
            onToggleMnemonic: toggleMnemonic,
            onEnableBiometrics: askEnableBiometrics,
            onDisableBiometrics: askDisableBiometrics,
          }}
          confirmation={{
            vaultUnlockMode,
            sensitiveAction,
            sensitivePassword,
            sensitivePasswordError,
            onChangeSensitivePassword: (value) => {
              setSensitivePassword(value);
              setSensitivePasswordError('');
            },
            showSensitivePassword,
            onToggleSensitivePassword: () => setShowSensitivePassword((current) => !current),
            sensitiveBusy,
            onConfirmSensitive: () => { void confirmSensitiveAction(); },
            onCancelSensitive: () => {
              setSensitiveAction(null);
              setSensitivePassword('');
              setSensitivePasswordError('');
            },
          }}
          display={{
            languageSettings,
            theme,
            onSelectTheme,
          }}
          networkSettings={{
            network,
            pendingAction,
            electrumServerPreference,
            historyBusy: historySyncing || historyProgress !== null,
            onUseCustomElectrumServer: askUseCustomElectrumServer,
            onUseOfficialElectrumServers: askUseOfficialElectrumServers,
            onResynchronizeHistory: askResynchronizeWalletHistory,
          }}
          danger={{
            seedSaved,
            onAskDelete: askDeleteWallet,
          }}
        />
      );
    }

    return (
      <HomeTab
        t={t}
        language={language}
        wallet={wallet}
        network={network}
        actionLocked={actionLocked}
        pendingAction={pendingAction}
        balanceRefreshing={balanceRefreshing}
        preparedConsolidation={preparedConsolidation}
        onRefreshBalance={() => { void refreshBalance(); }}
        onConfirmConsolidation={confirmTransparentConsolidation}
      />
    );
  };

  const activeScreen = () => {
    if (screen === 'loading') {
      return <LoadingScreen t={t} rotation={loadingRotation} />;
    }

    if (screen === 'initializationError') {
      return (
        <InitializationErrorScreen
          t={t}
          onRetry={() => {
            resetFeedback();
            setScreen('loading');
            setBootstrapAttempt((current) => current + 1);
          }}
        />
      );
    }

    if (screen === 'dice') {
      return (
        <DiceEntropyScreen
          key={diceSessionKey}
          t={t}
          pendingAction={pendingAction}
          actionLocked={actionLocked}
          resetRef={diceEntropyResetRef}
          onContinue={(additionalEntropyBase64) => {
            void createWallet(additionalEntropyBase64);
          }}
          onBack={() => { resetFeedback(); setScreen('landing'); }}
        />
      );
    }

    if (screen === 'import') {
      return (
        <ImportScreen
          t={t}
          pendingAction={pendingAction}
          actionLocked={actionLocked}
          importText={importText}
          importFieldError={importFieldError}
          onChangeImportText={(value) => {
            setImportText(value);
            setImportFieldError('');
          }}
          showSeed={showImportSeed}
          onToggleSeed={() => setShowImportSeed((current) => !current)}
          invalidWords={invalidImportWords}
          mnemonicStatus={importMnemonicStatus}
          mnemonicValid={importMnemonicValid}
          onSubmit={importWallet}
          onBack={() => { resetFeedback(); setImportText(''); setShowImportSeed(false); setScreen(seedSaved ? 'unlock' : 'landing'); }}
        />
      );
    }

    if (screen === 'unlock') {
      return (
        <UnlockScreen
          t={t}
          pendingAction={pendingAction}
          actionLocked={actionLocked}
          biometricsEnabled={vaultBiometricsEnabled}
          biometricMethod={biometricMethod}
          password={unlockPassword}
          passwordError={unlockPasswordError}
          onChangePassword={(value) => {
            setUnlockPassword(value);
            setUnlockPasswordError('');
          }}
          showPassword={showUnlockPassword}
          onToggleShowPassword={() => setShowUnlockPassword((current) => !current)}
          onUnlockWithBiometrics={() => { void unlockSavedWallet(true); }}
          onUnlockWithPassword={() => { void unlockSavedWallet(false); }}
        />
      );
    }

    if (screen === 'persist') {
      return (
        <PersistScreen
          t={t}
          pendingAction={pendingAction}
          actionLocked={actionLocked}
          busy={persistBusy}
          pendingWallet={pendingWallet}
          seedBackupRequired={pendingWalletRequiresSeedBackup}
          seedBackupConfirmationStep={seedBackupConfirmationStep}
          seedBackupChallenges={seedBackupChallenges}
          seedBackupConfirmationError={seedBackupConfirmationError}
          onStartSeedBackupConfirmation={startSeedBackupConfirmation}
          onShowSeedBackupAgain={showSeedBackupAgain}
          onConfirmSeedBackupWord={confirmSeedBackupWord}
          password={persistPassword}
          passwordError={persistPasswordError}
          onChangePassword={(value) => {
            setPersistPassword(value);
            setPersistPasswordError('');
            setPersistConfirmPasswordError('');
          }}
          showPassword={showPersistPassword}
          onToggleShowPassword={() => setShowPersistPassword((current) => !current)}
          confirmPassword={persistConfirmPassword}
          confirmPasswordError={persistConfirmPasswordError}
          onChangeConfirmPassword={(value) => {
            setPersistConfirmPassword(value);
            setPersistConfirmPasswordError('');
          }}
          showConfirmPassword={showPersistConfirmPassword}
          onToggleShowConfirmPassword={() => setShowPersistConfirmPassword((current) => !current)}
          onSubmit={() => { void persistWallet(); }}
        />
      );
    }

    if (screen === 'wallet') {
      return (
        <WalletShell
          tabs={walletTabs}
          activeTab={walletTab}
          onSelectTab={(key) => setWalletTab(key as WalletTab)}
        >
          {renderWalletTab()}
        </WalletShell>
      );
    }

    return (
      <LandingScreen
        t={t}
        pendingAction={pendingAction}
        actionLocked={actionLocked}
        onCreate={() => {
          resetFeedback();
          void createWallet();
        }}
        onUsePhysicalDice={() => {
          resetFeedback();
          setDiceSessionKey((current) => current + 1);
          setScreen('dice');
        }}
        onImport={() => { resetFeedback(); setShowImportSeed(false); setScreen('import'); }}
      />
    );
  };

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={STATUS_BAR_BACKGROUND[theme]}
      />
      <SafeAreaView
        style={styles.safeArea}
        onStartShouldSetResponderCapture={() => { registerActivity(); return false; }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
          <ScrollView
            ref={walletScrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.screen}
          >
            {screen !== 'loading' ? <Hero t={t} /> : null}
            <Feedback error={error} status={status} />
            {screen === 'wallet' && transactionTracking.storageError ? (
              <Feedback error={t('errors.walletStorageUnavailable')} status="" />
            ) : null}
            {screen === 'wallet' && transactionTracking.window ? (
              <ActionButton label={t('tracking.reopen')} variant="secondary" onPress={() => {
                const session = walletNetworkController.sessions.capture();
                if (session && transactionTracking.window) {
                  void transactionTrackingController.setWindow(session, { ...transactionTracking.window, open: true });
                }
              }} />
            ) : null}
            {activeScreen()}
          </ScrollView>
          {shouldShowBlockingLoadingOverlay(pendingAction) ? (
            <LoadingOverlay
              title={t('brand.wallet')}
              message={loadingMessage}
              rotation={loadingRotation}
            />
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
      <TransactionTrackingWindow
        tracking={transactionTracking}
        feedbackError={error}
        network={network}
        visible={screen === 'wallet' && transactionTracking.walletId === wallet?.walletId && Boolean(transactionTracking.window?.open)}
        t={t}
        onActivity={registerActivity}
        onExplorer={(txid) => { void openTransactionExplorerWithFeedback(txid); }}
        onWindowChange={(lifecycleId, open) => {
          const session = walletNetworkController.sessions.capture();
          if (session) void transactionTrackingController.setWindow(session, { lifecycleId, open });
        }}
      />
      <Modal animationType="fade" onRequestClose={closeQrScanner} presentationStyle="fullScreen" visible={qrScannerOpen}>
        {/*
          A Modal renders in its own native view, outside the root provider, so
          the SafeAreaView inside it measured no inset and the title slid under
          the notch. Its own provider gives it the real system margins.
        */}
        <SafeAreaProvider>
        <SafeAreaView edges={['top', 'bottom']} style={styles.scannerSafeArea}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>{t('send.scanQrTitle')}</Text>
            <Text style={styles.scannerHint}>{t('send.scanQrHint')}</Text>
          </View>
          <View style={styles.cameraFrame}>
            <CameraView barcodeScannerSettings={{ barcodeTypes: ['qr'] }} facing="back" onBarcodeScanned={qrScanHandled ? undefined : ({ data }) => handleQrScan(data)} style={styles.camera} />
            <View pointerEvents="none" style={styles.cameraGuide} />
          </View>
          {qrScannerError ? <Text style={styles.scannerError}>{qrScannerError}</Text> : null}
          <TouchableOpacity style={styles.scannerCloseButton} onPress={closeQrScanner}>
            <Text style={styles.scannerCloseButtonText}>{t('actions.cancel')}</Text>
          </TouchableOpacity>
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaProvider>
  );
}

export default function App() {
  const { theme, selectTheme } = useThemePreference();

  return (
    <ThemeProvider theme={theme}>
      <WalletApp theme={theme} onSelectTheme={selectTheme} />
    </ThemeProvider>
  );
}
