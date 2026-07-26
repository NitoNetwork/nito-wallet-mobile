import { PBKDF2_ROUNDS } from './src/constants/nito';
import 'react-native-get-random-values';

import { entropyToMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import nacl from 'tweetnacl';

import { escapeCsvCell, isValidTransactionId, shortAddress, transactionExplorerUrl } from './src/ui/format';
import { styles } from './src/ui/styles';
import {
  Feedback,
  Hero,
  ImportScreen,
  LandingScreen,
  LanguageSettings,
  LoadingOverlay,
  LoadingScreen,
  PersistScreen,
  UnlockScreen,
  WalletShell,
} from './src/ui/screens';
import { HistoryTab, HomeTab, ReceiveTab, SecurityTab, SendTab } from './src/ui/tabs';
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
  NitoElectrumClient,
  scriptPubKeyForNitoAddress,
} from './src/network/electrum';
import {
  buildHistoryExportRecords,
  historyExportCsvRows,
  historyRecordsFromEntries,
} from './src/services/historyExport';
import { readOptionalCache } from './src/services/cachePolicy';
import { reportNonFinancialFailure } from './src/services/diagnostics';
import { ExclusiveActionGate } from './src/services/exclusiveActionGate';
import {
  HistoryEnrichmentQueue,
  historyEnrichmentKey as enrichKey,
  processHistoryEnrichmentQueue,
} from './src/services/historyEnrichmentQueue';
import { type Translator } from './src/i18n';
import { nitoWalletCrypto } from './src/native/nitoWalletCrypto';
import {
  clearWalletHistoryCache,
  loadWalletHistoryCache,
  loadWalletSnapshotCache,
  saveEnrichedHistoryRecords,
  saveWalletHistoryCache,
  saveWalletSnapshotCache,
} from './src/services/walletHistoryDb';
import {
  satoshisToNito,
  type TransparentWalletSnapshot,
} from './src/wallet/transparentScan';
import {
  buildTransparentConsolidation,
  buildTransparentSend,
  calculateMaxTransparentSendAmount,
  parseNitoAmountToSats,
  type PreparedTransparentConsolidation,
  type PreparedTransparentTx,
} from './src/wallet/transparentSend';
import { makeConsolidationTranslator } from './src/i18n.consolidation';
import { useLanguage } from './src/hooks/useLanguage';
import { useWalletSubscriptions } from './src/hooks/useWalletSubscriptions';
import { AutoLock } from './src/services/session';
import { prepareVaultUpgradeCommit } from './src/services/vaultMigration';
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
import {
  WalletNetworkController,
  createEmptyNetworkState,
  enrichHistorySnapshot,
  mergeHistoryEnrichment,
  prefetchWalletSnapshot,
  prepareWalletEntry,
  reconcileBroadcastTransactions,
  synchronizeWalletNetwork,
  toQuickWalletSnapshot,
  type WalletSyncOptions,
} from './src/services/walletNetworkController';
import { applyOptimisticWalletBroadcast } from './src/wallet/optimisticConsolidation';

const PRIMARY_DERIVATION_PATH = "m/84'/0'/0'/0/0";
const BALANCE_REFRESH_COOLDOWN_KEY = 'nito.wallet.balance-refresh-until.v1';
const BALANCE_REFRESH_COOLDOWN_MS = 120_000;
const HISTORY_AUTO_IMPORT = true;
const MNEMONIC_REVEAL_MS = 60_000;
const ADDRESS_CLIPBOARD_MS = 60_000;
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

const generateMnemonic24 = () => entropyToMnemonic(nacl.randomBytes(32), wordlist);

const derivePrimaryAddress = async (mnemonic: string): Promise<Wallet> => {
  const [derived] = await nitoWalletCrypto.deriveAddresses(mnemonic, [
    { path: PRIMARY_DERIVATION_PATH, scriptType: 'p2wpkh' },
  ]);
  if (!derived) {
    throw new Error('Unable to derive the primary HD address.');
  }
  return {
    mnemonic,
    address: derived.address,
    derivationPath: PRIMARY_DERIVATION_PATH,
  };
};

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

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('loading');
  const [walletTab, setWalletTab] = useState<WalletTab>('home');
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [pendingWallet, setPendingWallet] = useState<Wallet | null>(null);
  const [walletNetworkController] = useState(() => new WalletNetworkController());
  const electrumClientRef = useRef<NitoElectrumClient | null>(null);
  const pendingNetworkRef = useRef<{ address: string; snapshot: TransparentWalletSnapshot; height: number } | null>(null);
  const walletRef = useRef<Wallet | null>(null);
  const networkRef = useRef<NetworkState>(createEmptyNetworkState());
  const silentNextAutoSyncRef = useRef(false);
  const subscriptionSyncFlushRef = useRef<() => void>(() => undefined);
  const autoBiometricAttemptedRef = useRef(false);
  const unlockSavedWalletRef = useRef<(useBiometrics?: boolean, auto?: boolean) => Promise<void>>(async () => undefined);
  const biometricDismissedRef = useRef(false);
  const biometricInterruptedRef = useRef(false);
  const lockedDuringSessionRef = useRef(false);
  const enrichAttemptedRef = useRef<Set<string>>(new Set());
  const appStateRef = useRef(AppState.currentState);
  const systemPromptActiveRef = useRef(false);
  const autoLockRef = useRef<AutoLock | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const [loadingSpin] = useState(() => new Animated.Value(0));
  const [network, setNetwork] = useState<NetworkState>(createEmptyNetworkState);
  const [importText, setImportText] = useState('');
  const [showImportSeed, setShowImportSeed] = useState(false);
  const [sendAddress, setSendAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [preparedTx, setPreparedTx] = useState<PreparedTransparentTx | null>(null);
  const [preparedConsolidation, setPreparedConsolidation] =
    useState<PreparedTransparentConsolidation | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [seedSaved, setSeedSaved] = useState(false);
  const [vaultUnlockMode, setVaultUnlockMode] = useState<'password' | 'biometric'>('password');
  const [vaultBiometricsEnabled, setVaultBiometricsEnabled] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [persistPassword, setPersistPassword] = useState('');
  const [persistBusy, setPersistBusy] = useState(false);
  const [persistConfirmPassword, setPersistConfirmPassword] = useState('');
  const [showPersistPassword, setShowPersistPassword] = useState(false);
  const [showPersistConfirmPassword, setShowPersistConfirmPassword] = useState(false);
  const [biometricMethod, setBiometricMethod] = useState<BiometricMethod>('biometrics');
  const [biometricUnavailableReason, setBiometricUnavailableReason] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
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
  const [historyProgress, setHistoryProgress] = useState<{ done: number; total: number } | null>(null);
  const [historySyncing, setHistorySyncing] = useState(false);
  const { language, t, selected: selectedLanguage, pickerOpen: languagePickerOpen, togglePicker: toggleLanguagePicker, select: selectLanguage } = useLanguage();
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [refreshCooldownUntil, setRefreshCooldownUntil] = useState(0);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrScanHandled, setQrScanHandled] = useState(false);
  const [qrScannerError, setQrScannerError] = useState('');
  const qrRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    historyPageRef.current = historyPage;
    historyEnrichmentQueueRef.current?.prioritizePage(historyPage);
  }, [historyPage]);

  const resetFeedback = useCallback(() => {
    setError('');
    setStatus('');
  }, []);

  const applyVaultTransition = useCallback((event: VaultSessionEvent) => {
    const next = transitionVaultSession(vaultSessionStateRef.current, event);
    vaultSessionStateRef.current = next;
    setSeedSaved(next.status !== 'absent');
    setVaultUnlockMode(next.unlockMode);
    setVaultBiometricsEnabled(next.biometricsEnabled);
    return next;
  }, []);

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
        const [vault, hasHardware, isEnrolled, method, savedRefreshUntil] = await Promise.all([
          loadVault(),
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          getBiometricMethod(),
          SecureStore.getItemAsync(BALANCE_REFRESH_COOLDOWN_KEY).catch((caught) => {
            reportNonFinancialFailure('balance refresh cooldown read', caught);
            return null;
          }),
        ]);

        if (!mounted) {
          return;
        }

        setBiometricMethod(method);
        applyVaultTransition({ type: 'load', vault });


        const savedCooldown = Number(savedRefreshUntil);
        if (Number.isFinite(savedCooldown) && savedCooldown > Date.now()) {
          setRefreshCooldownUntil(Math.min(savedCooldown, Date.now() + BALANCE_REFRESH_COOLDOWN_MS));
        }

        if (!hasHardware) {
          setBiometricUnavailableReason(tRef.current('errors.biometricNoHardware'));
        } else if (!isEnrolled) {
          setBiometricUnavailableReason(tRef.current('errors.biometricNotEnrolled'));
        }

        setScreen(vault ? 'unlock' : 'landing');
      } catch (caught) {
        if (!mounted) {
          return;
        }

        setError(caught instanceof Error ? caught.message : tRef.current('errors.initializationFailed'));
        setScreen('landing');
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, [applyVaultTransition]);

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
    const entry = prepareWalletEntry({
      pendingNetwork: pendingNetworkRef.current,
      wallet: nextWallet,
      cachedNetwork,
      cachedHistory,
    });
    const { pendingPreload, network: nextNetwork } = entry;
    walletNetworkController.beginWalletSession(nextWallet.address);
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
    enrichAttemptedRef.current.clear();
    setBalanceRefreshing(!pendingPreload);
    setHistoryProgress(null);
    setHistorySyncing(false);
    setBroadcasting(false);
    networkRef.current = nextNetwork;
    setNetwork(nextNetwork);
    setSendAddress('');
    setSendAmount('');
    setPreparedTx(null);
    setPreparedConsolidation(null);
    setScreen('wallet');
    setStatus(pendingPreload ? t('status.syncing') : message);
  };

  const prefetchWalletNetwork = useCallback(async (nextWallet: Wallet) => {
    const generation = walletNetworkController.beginPrefetch();
    pendingNetworkRef.current = null;

    try {
      const client = electrumClientRef.current || new NitoElectrumClient();
      electrumClientRef.current = client;
      const prefetched = await prefetchWalletSnapshot(nextWallet, client);
      if (!walletNetworkController.isCurrentPrefetch(generation)) {
        return;
      }
      pendingNetworkRef.current = { address: nextWallet.address, ...prefetched };
    } catch (caught) {
      if (walletNetworkController.isCurrentPrefetch(generation)) {
        pendingNetworkRef.current = null;
        setError(caught instanceof Error ? caught.message : t('errors.networkUnavailable'));
      }
    }
  }, [t, walletNetworkController]);

  const enrichWalletHistory = useCallback(async () => {
    if (!walletNetworkController.startEnrichment()) return;
    const activeWallet = walletRef.current;
    const snapshot = networkRef.current.snapshot;
    if (!activeWallet || !snapshot) {
      walletNetworkController.finishEnrichment();
      return;
    }
    const session = walletNetworkController.sessions.capture(activeWallet.address);
    if (!session) {
      walletNetworkController.finishEnrichment();
      return;
    }
    const queue = new HistoryEnrichmentQueue(snapshot.history, {
      attempted: enrichAttemptedRef.current,
      initialPage: historyPageRef.current,
    });
    if (queue.remainingCount === 0) {
      walletNetworkController.finishEnrichment();
      return;
    }

    historyEnrichmentQueueRef.current = queue;
    let activeBatchKeys: string[] = [];
    try {
      const client = electrumClientRef.current || new NitoElectrumClient();
      electrumClientRef.current = client;
      const requireCurrentSession = () => {
        if (!walletNetworkController.isCurrent(session)) {
          throw new Error('Wallet session changed during history enrichment.');
        }
      };

      await processHistoryEnrichmentQueue({
        queue,
        onBatchStart: (batch) => {
          activeBatchKeys = batch.map(enrichKey);
          activeBatchKeys.forEach((key) => enrichAttemptedRef.current.add(key));
        },
        enrichBatch: async (batch, onBatchProgress) => {
          requireCurrentSession();
          const { records } = await enrichHistorySnapshot({
            snapshot,
            pending: batch,
            client,
            onProgress: (done) => onBatchProgress(done),
          });
          requireCurrentSession();
          return records;
        },
        publishBatch: async (records) => {
          requireCurrentSession();
          await saveEnrichedHistoryRecords(
            activeWallet.address,
            records
              .filter((record) => record.blockHeight > 0)
              .map((record) => ({
                txid: record.txid,
                height: record.blockHeight,
                amountSats: record.amountSats,
                direction: record.direction,
                feeSats: record.feeSats,
                counterparty: record.counterparty,
                blockTime: record.blockTime,
              })),
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
          networkRef.current = nextNetwork;
          setNetwork(nextNetwork);
        },
        onBatchPublished: () => {
          activeBatchKeys = [];
        },
        onProgress: (done, total) => {
          if (walletNetworkController.isCurrent(session)) {
            setHistoryProgress({ done, total });
          }
        },
      });
    } catch (caught) {
      if (walletNetworkController.isCurrent(session)) {
        activeBatchKeys.forEach((key) => enrichAttemptedRef.current.delete(key));
        const message = caught instanceof Error ? caught.message : t('errors.networkUnavailable');
        const current = networkRef.current;
        const nextNetwork: NetworkState = {
          ...current,
          status: 'error',
          error: message,
        };
        networkRef.current = nextNetwork;
        setNetwork(nextNetwork);
        setError(message);
      }
    } finally {
      if (historyEnrichmentQueueRef.current === queue) {
        historyEnrichmentQueueRef.current = null;
      }
      if (walletNetworkController.isCurrent(session)) {
        walletNetworkController.finishEnrichment();
        setHistoryProgress(null);
      }
    }
  }, [t, walletNetworkController]);

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
      fullHistoryByDefault: HISTORY_AUTO_IMPORT,
      readHistoryCache: (address) => readOptionalCache(() => loadWalletHistoryCache(address)),
      saveHistory: saveWalletHistoryCache,
      saveSnapshot: saveWalletSnapshotCache,
      publishNetwork: (nextNetwork) => {
        networkRef.current = nextNetwork;
        setNetwork(nextNetwork);
      },
      setError,
      setStatus,
      setHistorySyncing,
      setHistoryProgress,
      setBalanceRefreshing,
      finishSync: () => {
        subscriptionSyncFlushRef.current();
      },
      messages: {
        noActiveWallet: t('errors.noActiveWallet'),
        networkUnavailable: t('errors.networkUnavailable'),
        syncing: t('status.syncing'),
        syncingHistory: t('status.syncingHistory'),
        walletSynced: t('status.walletSynced'),
      },
    }, includeHistory, options);
  }, [t, walletNetworkController]);

  useEffect(() => {
    if (screen !== 'wallet' || !network.snapshot) return;
    const hasPending = network.snapshot.history.some(
      (entry) => entry.direction === undefined && !enrichAttemptedRef.current.has(enrichKey(entry)),
    );
    if (hasPending) {
      void enrichWalletHistory();
    }
  }, [screen, network.snapshot, enrichWalletHistory]);

  const reconcileBroadcasts = useCallback(async (
    txids: readonly string[],
    session: WalletSessionToken,
  ) => {
    const client = electrumClientRef.current ?? new NitoElectrumClient();
    electrumClientRef.current = client;
    const found = await reconcileBroadcastTransactions({
      txids,
      client,
      isCurrent: () => walletNetworkController.isCurrent(session),
    });
    if (found) {
      await syncTransparentNetwork(false, { force: true, silent: true, pendingOnly: true });
    }
  }, [syncTransparentNetwork, walletNetworkController]);

  const advanceBlockHeight = useCallback((height: number) => {
    const activeWallet = walletRef.current;
    if (!activeWallet) return;
    const session = walletNetworkController.sessions.capture(activeWallet.address);
    if (!walletNetworkController.isCurrent(session)) return;
    const nextNetwork = { ...networkRef.current, height };
    networkRef.current = nextNetwork;
    setNetwork(nextNetwork);
  }, [walletNetworkController]);

  const requestSync = useCallback((options: Parameters<typeof syncTransparentNetwork>[1]) => {
    void syncTransparentNetwork(false, options);
  }, [syncTransparentNetwork]);

  const reportNetworkFailure = useCallback((caught: unknown) => {
    const message = caught instanceof Error ? caught.message : t('errors.networkUnavailable');
    const current = networkRef.current;
    const nextNetwork: NetworkState = {
      ...current,
      status: 'error',
      error: message,
    };
    networkRef.current = nextNetwork;
    setNetwork(nextNetwork);
    setError(message);
  }, [t]);

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
      address: wallet?.address,
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

  const createWallet = async () => {
    await runExclusiveAction('create', async () => {
    resetFeedback();

    try {
      const mnemonic = generateMnemonic24();
      const nextWallet = await derivePrimaryAddress(mnemonic);
      setPendingWallet(nextWallet);
      void prefetchWalletNetwork(nextWallet);
      setWallet(null);
      setPersistPassword('');
      setPersistConfirmPassword('');
      setShowMnemonic(false);
      setScreen('persist');
      setStatus(t('status.seedCreated'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.walletCreationFailed'));
    }
  
    });
  };

  const importWallet = async () => {
    await runExclusiveAction('import', async () => {
    resetFeedback();

    try {
      const mnemonic = validateImportMnemonic(importText, t);
      const nextWallet = await derivePrimaryAddress(mnemonic);
      setPendingWallet(nextWallet);
      void prefetchWalletNetwork(nextWallet);
      setWallet(null);
      setPersistPassword('');
      setPersistConfirmPassword('');
      setShowMnemonic(false);
      setImportText('');
      setShowImportSeed(false);
      setScreen('persist');
      setStatus(t('status.seedImported'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.importFailed'));
    }
  
    });
  };

  const unlockSavedWallet = async (useBiometrics = false, auto = false) => {
    await runExclusiveAction('unlock', async () => {
    resetFeedback();

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
        const secret = await loadBiometricSecret().finally(() => {
          systemPromptActiveRef.current = false;
        });

        if (!secret) {
          throw new Error(t('errors.biometricReimport'));
        }
        vaultSecret = secret;
      } else if (unlockPassword.length < 8) {
        throw new Error(t('errors.enterVaultPassword'));
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
      const unlockedWallet: Wallet = {
        mnemonic: payload.mnemonic,
        address: payload.address,
        derivationPath: payload.derivationPath,
      };
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
      const unlockedSession = walletNetworkController.sessions.capture(unlockedWallet.address);
      if (cachedNetwork && unlockedSession) {
        void (async () => {
          if (!walletNetworkController.isCurrent(unlockedSession)) return;
          await saveWalletSnapshotCache(
            unlockedWallet.address,
            toQuickWalletSnapshot(cachedNetwork.snapshot),
            cachedNetwork.height,
          );
        })().catch((caught) => {
          if (walletNetworkController.isCurrent(unlockedSession)) {
            setError(caught instanceof Error ? caught.message : t('errors.networkUnavailable'));
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
      setError(
        useBiometrics
          ? t('errors.biometricCancelled', { method: biometricMethod })
          : caught instanceof Error ? caught.message : t('errors.unlockFailed'),
      );
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

    if (persistPassword.length < 10) {
      setError(t('errors.passwordMin10'));
      return;
    }

    if (persistPassword !== persistConfirmPassword) {
      setError(t('errors.passwordMismatch'));
      return;
    }

    await deleteBiometricSecret();
    setPersistBusy(true);
    setStatus(t('loading.protect'));
    await yieldToUi();

    try {
      const encrypted = await encryptVault(
        {
          version: 1,
          mnemonic: walletToPersist.mnemonic,
          address: walletToPersist.address,
          derivationPath: walletToPersist.derivationPath,
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
        } catch {
          biometricNotice = t('errors.biometricUnavailable');
        }
      }

      setPersistPassword('');
      setPersistConfirmPassword('');
      enterWallet(walletToPersist, true, biometricNotice || t('status.walletOpened'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.saveFailed'));
    } finally {
      setPersistBusy(false);
    }
  
    });
  };

  const removeSavedWallet = () => {
    resetFeedback();
    const walletId = wallet?.address;
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
                  await clearWalletHistoryCache(walletId);
                }
                await deleteBiometricSecret();
                await deleteVault();
                walletNetworkController.cancel();
                pendingNetworkRef.current = null;
                walletRef.current = null;
                applyVaultTransition({ type: 'delete' });
                setWallet(null);
                setPendingWallet(null);
                setShowMnemonic(false);
                setSensitiveAction(null);
                setSensitivePassword('');
                setHistoryProgress(null);
                setHistorySyncing(false);
                setBalanceRefreshing(false);
                setBroadcasting(false);
                const emptyNetwork = createEmptyNetworkState();
                networkRef.current = emptyNetwork;
                setNetwork(emptyNetwork);
                setScreen('landing');
                setStatus(t('status.walletDeleted'));
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : t('errors.deleteFailed'));
              }
            })();
          },
        },
      ],
    );
  };

  const lockWallet = useCallback(() => {
    lockedDuringSessionRef.current = true;
    applyVaultTransition({ type: 'lock' });
    walletNetworkController.cancel();
    pendingNetworkRef.current = null;
    walletRef.current = null;
    resetFeedback();
    clearAddressSubscriptions();
    setWallet(null);
    setPendingWallet(null);
    setShowMnemonic(false);
    setWalletTab('home');
    setHistoryPage(0);
    setImportText('');
    setShowImportSeed(false);
    setSendAddress('');
    setSendAmount('');
    setPreparedTx(null);
    setPreparedConsolidation(null);
    setQrScannerOpen(false);
    setQrScanHandled(false);
    setQrScannerError('');
    setBalanceRefreshing(false);
    setHistoryProgress(null);
    setHistorySyncing(false);
    setBroadcasting(false);
    setSensitiveAction(null);
    setSensitivePassword('');
    setShowSensitivePassword(false);
    enrichAttemptedRef.current.clear();
    const emptyNetwork = createEmptyNetworkState();
    networkRef.current = emptyNetwork;
    setNetwork(emptyNetwork);
    setScreen(seedSaved ? 'unlock' : 'landing');
  }, [
    applyVaultTransition,
    clearAddressSubscriptions,
    resetFeedback,
    seedSaved,
    walletNetworkController,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (previousState === 'active' && nextState !== 'active' && screen === 'wallet' && seedSaved && !systemPromptActiveRef.current) {
        lockWallet();
      }
      if (previousState === 'active' && nextState !== 'active' && systemPromptActiveRef.current) {
        biometricInterruptedRef.current = true;
      }
      if (
        previousState === 'background'
        && nextState === 'active'
        && screen === 'unlock'
        && vaultBiometricsEnabled
        && !biometricUnavailableReason
        && !systemPromptActiveRef.current
        && biometricInterruptedRef.current
        && !biometricDismissedRef.current
        && !lockedDuringSessionRef.current
      ) {
        biometricInterruptedRef.current = false;
        void unlockSavedWalletRef.current(true, true);
      }
    });
    return () => subscription.remove();
  }, [lockWallet, screen, seedSaved, vaultBiometricsEnabled, biometricUnavailableReason]);

  useEffect(() => {
    if (screen !== 'wallet' || !seedSaved) {
      autoLockRef.current?.stop();
      autoLockRef.current = null;
      return;
    }
    const lock = new AutoLock(() => {
      if (!systemPromptActiveRef.current) {
        lockWallet();
      }
    });
    autoLockRef.current = lock;
    lock.resetTimer();
    return () => {
      lock.stop();
      autoLockRef.current = null;
    };
  }, [screen, seedSaved, lockWallet]);

  const registerActivity = useCallback(() => {
    autoLockRef.current?.resetTimer();
  }, []);

  const copyAddressToClipboard = async () => {
    await runExclusiveAction('copy', async () => {
    resetFeedback();

    if (!wallet) {
      setError(t('errors.noAddress'));
      return;
    }

    await Clipboard.setStringAsync(wallet.address);
    setStatus(t('status.addressCopied'));
    setTimeout(() => {
      void (async () => {
        const current = await Clipboard.getStringAsync().catch((caught) => {
          reportNonFinancialFailure('clipboard cleanup read', caught);
          return '';
        });
        if (current === wallet.address) {
          await Clipboard.setStringAsync('').catch((caught) => {
            reportNonFinancialFailure('clipboard cleanup write', caught);
          });
        }
      })();
    }, ADDRESS_CLIPBOARD_MS);
  
    });
  };

  const prepareTransparentSend = async () => {
    await runExclusiveAction('prepare', async () => {
    resetFeedback();

    if (!wallet || !network.snapshot) {
      setError(t('errors.walletSyncing'));
      return;
    }

    try {
      setPreparedTx(null);
      setPreparedConsolidation(null);
      const tx = await buildTransparentSend({
        mnemonic: wallet.mnemonic,
        snapshot: network.snapshot,
        toAddress: sendAddress,
        amountSats: parseNitoAmountToSats(sendAmount),
      });

      setPreparedConsolidation(null);
      setPreparedTx(tx);
      setStatus(t('status.transactionReady', { fee: satoshisToNito(tx.feeSats) }));
    } catch (caught) {
      setPreparedTx(null);
      setError(caught instanceof Error ? caught.message : t('errors.txPrepareFailed'));
    }
  
    });
  };

  const fillMaxSendAmount = async () => {
    await runExclusiveAction('max', async () => {
      resetFeedback();

      if (!wallet || !network.snapshot) {
        setError(t('errors.walletSyncing'));
        return;
      }

      if (!sendAddress.trim()) {
        setError(t('send.destination'));
        return;
      }

      try {
        const max = await calculateMaxTransparentSendAmount({
          mnemonic: wallet.mnemonic,
          snapshot: network.snapshot,
          toAddress: sendAddress,
          changeAddress: wallet.address,
        });

        setSendAmount(satoshisToNitoInput(max.amountSats));
        setPreparedTx(null);
        setPreparedConsolidation(null);
      } catch (caught) {
        setPreparedTx(null);
        setPreparedConsolidation(null);
        setError(caught instanceof Error ? caught.message : t('errors.txPrepareFailed'));
      }
    });
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
      ? walletNetworkController.sessions.capture(activeWallet.address)
      : null;
    if (!session) {
      setError(t('errors.noActiveWallet'));
      return;
    }

    try {
      setBroadcasting(true);
      const client = electrumClientRef.current || new NitoElectrumClient();
      electrumClientRef.current = client;
      const transaction = preparedTx;
      const txid = await client.broadcastTransaction(transaction.hex);
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
        networkRef.current = optimisticNetwork;
        setNetwork(optimisticNetwork);
      }

      setPreparedTx(null);
      setPreparedConsolidation(null);
      setSendAddress('');
      setSendAmount('');
      setStatus(t('status.transactionSent', { txid }));
      Alert.alert(
        t('dialog.sentTitle'),
        t('dialog.sentBody', { txid: shortAddress(txid) }),
        [
          {
            text: t('actions.viewTx'),
            onPress: () => {
              void openTransactionExplorer(txid);
            },
          },
          { text: t('actions.ok'), style: 'cancel' },
        ],
      );
      startBroadcastReconciliation([txid], session);
    } catch (caught) {
      if (walletNetworkController.isCurrent(session)) {
        setError(caught instanceof Error ? caught.message : t('errors.sendFailed'));
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
        const plan = await buildTransparentConsolidation({
          mnemonic: wallet.mnemonic,
          snapshot: network.snapshot,
          toAddress: wallet.address,
        });
        setPreparedTx(null);
        setPreparedConsolidation(plan);
        setWalletTab('send');
        setStatus(consolidationT('review'));
      } catch {
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
        ? walletNetworkController.sessions.capture(activeWallet.address)
        : null;
      if (!session) {
        setError(t('errors.noActiveWallet'));
        return;
      }

      setBroadcasting(true);
      const client = electrumClientRef.current || new NitoElectrumClient();
      electrumClientRef.current = client;
      const txids: string[] = [];
      let sentCount = 0;
      try {
        for (const transaction of preparedConsolidation.transactions) {
          if (!walletNetworkController.isCurrent(session)) return;
          const txid = await client.broadcastTransaction(transaction.hex);
          if (!walletNetworkController.isCurrent(session)) return;
          txids.push(txid);
          sentCount += 1;
          const currentNetwork = networkRef.current;
          if (currentNetwork.snapshot) {
            const optimisticSnapshot = applyOptimisticWalletBroadcast({
              snapshot: currentNetwork.snapshot,
              transaction,
              txid,
            });
            const optimisticNetwork = { ...currentNetwork, snapshot: optimisticSnapshot };
            networkRef.current = optimisticNetwork;
            setNetwork(optimisticNetwork);
          }
        }
        setPreparedConsolidation(null);
        Alert.alert(consolidationT('successTitle'), consolidationT('successBody'), [
          { text: t('actions.ok'), style: 'cancel' },
        ]);
      } catch {
        if (!walletNetworkController.isCurrent(session)) return;
        const remaining = preparedConsolidation.transactions.slice(sentCount);
        setPreparedConsolidation(remaining.length > 0 ? {
          transactions: remaining,
          inputCount: remaining.reduce((total, transaction) => total + transaction.inputCount, 0),
          outputCount: remaining.reduce((total, transaction) => total + transaction.outputCount, 0),
          totalFeeSats: remaining.reduce((total, transaction) => total + transaction.feeSats, 0),
        } : null);
        Alert.alert(consolidationT('partialTitle'), consolidationT('partialBody'));
        setError(consolidationT('partialBody'));
      } finally {
        if (walletNetworkController.isCurrent(session)) {
          setBroadcasting(false);
        }
        if (txids.length > 0) startBroadcastReconciliation(txids, session);
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
      if (sensitivePassword.length < 8) {
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
    } else if (sensitivePassword.length < 8) {
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
      setError(caught instanceof Error ? caught.message : t('errors.validationFailed'));
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
        ? walletNetworkController.sessions.capture(activeWallet.address)
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
          const missing = snapshot.history.filter((entry) => entry.direction === undefined);

          if (missing.length > 0) {
            const client = electrumClientRef.current || new NitoElectrumClient();
            electrumClientRef.current = client;
            await client.connect();
            if (!walletNetworkController.isCurrent(session)) return;
            const fresh = await buildHistoryExportRecords({
              history: missing,
              walletAddresses: snapshot.addresses.map((address) => address.address),
              reader: client,
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
            await saveEnrichedHistoryRecords(
              activeWallet.address,
              fresh
                .filter((record) => record.blockHeight > 0)
                .map((record) => ({
                  txid: record.txid,
                  height: record.blockHeight,
                  amountSats: record.amountSats,
                  direction: record.direction,
                  feeSats: record.feeSats,
                  counterparty: record.counterparty,
                  blockTime: record.blockTime,
                })),
            );
            if (!client.connected) {
              throw new ElectrumSessionUnhealthyError(
                new Error('ElectrumX connection closed before history export commit.'),
              );
            }
            if (!walletNetworkController.isCurrent(session)) return;
            const byTxid = new Map(fresh.map((record) => [record.txid, record]));
            const current = networkRef.current;
            if (current.snapshot && walletNetworkController.isCurrent(session)) {
              const merged = current.snapshot.history.map((entry) => {
                const record = byTxid.get(entry.txid);
                if (!record || entry.direction !== undefined || record.blockHeight !== entry.height) {
                  return entry;
                }
                return {
                  ...entry,
                  direction: record.direction,
                  amountSats: record.amountSats,
                  feeSats: record.feeSats,
                  counterparty: record.counterparty,
                  blockTime: record.blockTime ?? undefined,
                };
              });
              const nextNetwork: NetworkState = {
                ...current,
                snapshot: { ...current.snapshot, history: merged },
              };
              networkRef.current = nextNetwork;
              setNetwork(nextNetwork);
            }
            if (!walletNetworkController.isCurrent(session)) return;
            missing.forEach((entry) => enrichAttemptedRef.current.add(enrichKey(entry)));
          }
        } finally {
          if (walletNetworkController.isCurrent(session)) {
            walletNetworkController.finishEnrichment();
          }
        }

        if (!walletNetworkController.isCurrent(session)) return;
        const records = historyRecordsFromEntries(networkRef.current.snapshot?.history ?? []);
        const rows = historyExportCsvRows(records);
        const csv = `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}`;
        const date = new Date().toISOString().slice(0, 10);
        const uri = `${rootDirectory}nito-wallet-history-${date}.csv`;
        await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
        if (!walletNetworkController.isCurrent(session)) return;
        await Sharing.shareAsync(uri, {
          dialogTitle: t('history.exportTitle'),
          mimeType: 'text/csv',
          UTI: 'public.comma-separated-values-text',
        });
        if (!walletNetworkController.isCurrent(session)) return;
        setStatus(t('status.historyExported'));
      } catch (caught) {
        if (!session || walletNetworkController.isCurrent(session)) {
          setError(caught instanceof Error ? caught.message : t('errors.historyExportFailed'));
        }
      }
    });
  };

  const refreshBalance = async () => {
    const now = Date.now();
    const activeWallet = walletRef.current;
    if (balanceRefreshing || walletNetworkController.syncInFlight || pendingActionRef.current || !activeWallet) return;
    const session = walletNetworkController.sessions.capture(activeWallet.address);
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
    if (walletNetworkController.isCurrent(session) && networkRef.current.status === 'connected') {
      setStatus(t('status.walletSynced'));
    }
  };

  const openQrScanner = async () => {
    if (pendingActionRef.current) return;
    clearQrRetryTimer();
    resetFeedback();
    let granted = cameraPermission?.granted ?? false;
    if (!granted) {
      systemPromptActiveRef.current = true;
      try {
        const permission = await requestCameraPermission();
        granted = permission.granted;
      } finally {
        systemPromptActiveRef.current = false;
      }
    }
    if (!granted) {
      setError(t('errors.cameraPermission'));
      return;
    }
    setQrScannerError('');
    setQrScanHandled(false);
    setQrScannerOpen(true);
  };

  const closeQrScanner = () => {
    clearQrRetryTimer();
    setQrScannerOpen(false);
    setQrScannerError('');
    setQrScanHandled(false);
  };

  const handleQrScan = (value: string) => {
    if (qrScanHandled) return;
    setQrScanHandled(true);
    try {
      const address = parseNitoQrAddress(value);
      setSendAddress(address);
      setPreparedTx(null);
      closeQrScanner();
      setStatus(t('status.addressScanned'));
    } catch {
      setQrScannerError(t('errors.invalidQr'));
      clearQrRetryTimer();
      qrRetryTimerRef.current = setTimeout(() => {
        qrRetryTimerRef.current = null;
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
    history: t('loading.history'),
    reveal: t('loading.reveal'),
    delete: t('loading.delete'),
    lock: t('loading.lock'),
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
          sendAddress={sendAddress}
          sendAmount={sendAmount}
          preparedTx={preparedTx}
          preparedConsolidation={preparedConsolidation}
          onChangeSendAddress={(value) => { setSendAddress(value); setPreparedTx(null); setPreparedConsolidation(null); }}
          onChangeSendAmount={(value) => { setSendAmount(value); setPreparedTx(null); setPreparedConsolidation(null); }}
          onOpenQrScanner={() => { void openQrScanner(); }}
          onFillMax={() => { void fillMaxSendAmount(); }}
          onPrepareSend={prepareTransparentSend}
          onBroadcastTx={() => { void broadcastPreparedTx(); }}
          onBroadcastConsolidation={() => { void broadcastPreparedConsolidation(); }}
        />
      );
    }

    if (walletTab === 'history') {
      return (
        <HistoryTab
          t={t}
          network={network}
          actionLocked={actionLocked}
          pendingAction={pendingAction}
          historyPage={historyPage}
          historyProgress={historyProgress}
          historySyncing={historySyncing}
          onChangeHistoryPage={setHistoryPage}
          onExportHistory={() => { void exportFullHistory(); }}
          onOpenTx={(txid) => { void openTransactionExplorer(txid); }}
        />
      );
    }

    if (walletTab === 'security') {
      return (
        <SecurityTab
          t={t}
          wallet={wallet}
          seedSaved={seedSaved}
          actionLocked={actionLocked}
          pendingAction={pendingAction}
          vaultBiometricsEnabled={vaultBiometricsEnabled}
          biometricMethod={biometricMethod}
          showMnemonic={showMnemonic}
          vaultUnlockMode={vaultUnlockMode}
          sensitiveAction={sensitiveAction}
          sensitivePassword={sensitivePassword}
          onChangeSensitivePassword={setSensitivePassword}
          showSensitivePassword={showSensitivePassword}
          onToggleSensitivePassword={() => setShowSensitivePassword((current) => !current)}
          sensitiveBusy={sensitiveBusy}
          onLockWallet={lockWallet}
          onToggleMnemonic={toggleMnemonic}
          onAskDelete={askDeleteWallet}
          onConfirmSensitive={() => { void confirmSensitiveAction(); }}
          onCancelSensitive={() => { setSensitiveAction(null); setSensitivePassword(''); }}
          languageSettings={languageSettings}
          biometricAvailable={!biometricUnavailableReason}
          onEnableBiometrics={askEnableBiometrics}
          onDisableBiometrics={askDisableBiometrics}
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

    if (screen === 'import') {
      return (
        <ImportScreen
          t={t}
          pendingAction={pendingAction}
          actionLocked={actionLocked}
          importText={importText}
          onChangeImportText={setImportText}
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
          onChangePassword={setUnlockPassword}
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
          showMnemonic={showMnemonic}
          password={persistPassword}
          onChangePassword={setPersistPassword}
          showPassword={showPersistPassword}
          onToggleShowPassword={() => setShowPersistPassword((current) => !current)}
          confirmPassword={persistConfirmPassword}
          onChangeConfirmPassword={setPersistConfirmPassword}
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
        onCreate={createWallet}
        onImport={() => { resetFeedback(); setShowImportSeed(false); setScreen('import'); }}
      />
    );
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={styles.safeArea}
        onStartShouldSetResponderCapture={() => { registerActivity(); return false; }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
            {screen !== 'loading' ? <Hero t={t} /> : null}
            <Feedback error={error} status={status} />
            {activeScreen()}
          </ScrollView>
          {pendingAction ? (
            <LoadingOverlay
              title={t('brand.wallet')}
              message={loadingMessage}
              rotation={loadingRotation}
            />
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
      <Modal animationType="fade" onRequestClose={closeQrScanner} presentationStyle="fullScreen" visible={qrScannerOpen}>
        <SafeAreaView style={styles.scannerSafeArea}>
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
      </Modal>
    </SafeAreaProvider>
  );
}
