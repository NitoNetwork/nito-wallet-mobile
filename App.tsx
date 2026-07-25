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
  Image,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import nacl from 'tweetnacl';

import { ActionButton, PasswordField } from './src/ui/components';
import { escapeCsvCell, isValidTransactionId, shortAddress, transactionExplorerUrl } from './src/ui/format';
import { styles } from './src/ui/styles';
import { HistoryTab, HomeTab, ReceiveTab, SecurityTab, SendTab } from './src/ui/tabs';
import type {
  AppScreen,
  BiometricMethod,
  NetworkState,
  PendingAction,
  Wallet,
  WalletTab,
} from './src/ui/types';

import { NitoElectrumClient, scriptPubKeyForNitoAddress } from './src/network/electrum';
import {
  buildHistoryExportRecords,
  historyExportCsvRows,
  historyRecordsFromEntries,
} from './src/services/historyExport';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  makeTranslator,
  type LanguageCode,
  type Translator,
} from './src/i18n';
import { nitoWalletCrypto } from './src/native/nitoWalletCrypto';
import {
  clearWalletHistoryCache,
  loadWalletHistoryCache,
  loadWalletSnapshotCache,
  normalizeWalletHistory,
  saveEnrichedHistoryRecords,
  saveWalletHistoryCache,
  saveWalletSnapshotCache,
} from './src/services/walletHistoryDb';
import {
  satoshisToNito,
  refreshKnownUsedAddresses,
  scanTransparentWallet,
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
import { AutoLock } from './src/services/session';
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
import { applyOptimisticWalletBroadcast } from './src/wallet/optimisticConsolidation';

declare const require: (path: string) => number;

const NITO_LOGO = require('./assets/nito-logo.png');
const PRIMARY_DERIVATION_PATH = "m/84'/0'/0'/0/0";
const LANGUAGE_PREFERENCE_KEY = 'nito.wallet.language.v1';
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
const isLanguageCode = (value: string | null): value is LanguageCode =>
  LANGUAGES.some((entry) => entry.code === value);
const detectSystemLanguage = (): LanguageCode => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const primaryLanguage = locale.toLowerCase().replace('_', '-').split('-', 1)[0] ?? '';
    return isLanguageCode(primaryLanguage) ? primaryLanguage : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
};
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
const enrichKey = (entry: { txid: string; height: number }) => `${entry.txid}:${entry.height}`;

const openTransactionExplorer = async (txid: string): Promise<void> => {
  if (!isValidTransactionId(txid)) return;
  await Linking.openURL(transactionExplorerUrl(txid));
};
const createEmptyNetworkState = (): NetworkState => ({
  status: 'idle',
  snapshot: null,
  error: '',
  serverUrl: '',
  height: 0,
  fullHistoryEnabled: false,
});

const toQuickWalletSnapshot = (snapshot: TransparentWalletSnapshot): TransparentWalletSnapshot => {
  const spendableUtxos = snapshot.utxos.filter((utxo) => (
    utxo.confirmations >= 101 || (utxo.confirmations > 0 && utxo.isCoinbase === false)
  ));
  const currentUtxoTxids = new Set(
    spendableUtxos.map((utxo) => utxo.txid),
  );
  const immatureCoinbaseUtxos = snapshot.utxos.filter((utxo) => (
    utxo.isCoinbase === true && utxo.confirmations > 0 && utxo.confirmations < 101
  ));
  const keepCurrentUtxoHistory = (history: TransparentWalletSnapshot['history']) =>
    normalizeWalletHistory(history.filter((entry) => currentUtxoTxids.has(entry.txid)));
  const stripAddressHistory = (address: TransparentWalletSnapshot['addresses'][number]) => ({
    ...address,
    history: keepCurrentUtxoHistory(address.history),
  });

  return {
    ...snapshot,
    spendableSats: spendableUtxos.reduce((total, utxo) => total + utxo.valueSats, 0),
    immatureCoinbaseSats: immatureCoinbaseUtxos.reduce((total, utxo) => total + utxo.valueSats, 0),
    immatureCoinbaseBlocksRemaining: immatureCoinbaseUtxos.length === 0
      ? 0
      : Math.min(...immatureCoinbaseUtxos.map((utxo) => 101 - utxo.confirmations)),
    history: keepCurrentUtxoHistory(snapshot.history),
    addresses: snapshot.addresses.map(stripAddressHistory),
    usedAddresses: snapshot.usedAddresses.map(stripAddressHistory),
    spendableAddresses: snapshot.spendableAddresses.map(stripAddressHistory),
  };
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
  const electrumClientRef = useRef<NitoElectrumClient | null>(null);
  const pendingNetworkRef = useRef<{ address: string; snapshot: TransparentWalletSnapshot; height: number } | null>(null);
  const walletRef = useRef<Wallet | null>(null);
  const networkRef = useRef<NetworkState>(createEmptyNetworkState());
  const addressStatusRef = useRef<Map<string, string | null>>(new Map());
  const addressUnsubscribeRef = useRef<Map<string, () => void>>(new Map());
  const blockHeightUnsubscribeRef = useRef<(() => void) | null>(null);
  const subscriptionRefreshInFlightRef = useRef(false);
  const silentNextAutoSyncRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const enrichInFlightRef = useRef(false);
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
  const [historyPage, setHistoryPage] = useState(0);
  const [historyProgress, setHistoryProgress] = useState<{ done: number; total: number } | null>(null);
  const [historySyncing, setHistorySyncing] = useState(false);
  const [language, setLanguage] = useState<LanguageCode>(detectSystemLanguage);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [refreshCooldownUntil, setRefreshCooldownUntil] = useState(0);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrScanHandled, setQrScanHandled] = useState(false);
  const [qrScannerError, setQrScannerError] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const t = useMemo(() => makeTranslator(language), [language]);
  const tRef = useRef(t);
  const selectedLanguage = useMemo(
    () => LANGUAGES.find((entry) => entry.code === language) ?? LANGUAGES[0],
    [language],
  );

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const resetFeedback = useCallback(() => {
    setError('');
    setStatus('');
  }, []);

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
    networkRef.current = network;
  }, [network]);

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
    if (pendingActionRef.current) {
      return;
    }

    pendingActionRef.current = action;
    setPendingAction(action);
    await yieldToUi();

    try {
      await task();
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const [vault, hasHardware, isEnrolled, method, savedLanguage, savedRefreshUntil] = await Promise.all([
          loadVault(),
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          getBiometricMethod(),
          SecureStore.getItemAsync(LANGUAGE_PREFERENCE_KEY),
          SecureStore.getItemAsync(BALANCE_REFRESH_COOLDOWN_KEY),
        ]);

        if (!mounted) {
          return;
        }

        setBiometricMethod(method);
        setSeedSaved(Boolean(vault));
        setVaultUnlockMode(vault?.unlockMode === 'biometric' ? 'biometric' : 'password');
        setVaultBiometricsEnabled(Boolean(vault?.biometricsEnabled || vault?.unlockMode === 'biometric'));

        setLanguage(isLanguageCode(savedLanguage) ? savedLanguage : detectSystemLanguage());

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
  }, []);

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
    const pendingPreload = pendingNetworkRef.current?.address === nextWallet.address ? pendingNetworkRef.current : null;
    const fullHistoryEnabled = (cachedHistory?.fullHistoryHeight ?? 0) > 0;
    const cachedQuickNetwork = cachedNetwork
      ? {
          ...cachedNetwork,
          snapshot: fullHistoryEnabled
            ? {
                ...toQuickWalletSnapshot(cachedNetwork.snapshot),
                history: normalizeWalletHistory([
                  ...(cachedHistory?.history ?? []),
                  ...toQuickWalletSnapshot(cachedNetwork.snapshot).history,
                ]),
              }
            : toQuickWalletSnapshot(cachedNetwork.snapshot),
        }
      : null;
    const preloaded = pendingPreload
      ? { ...pendingPreload, snapshot: toQuickWalletSnapshot(pendingPreload.snapshot) }
      : cachedQuickNetwork;

    if (pendingPreload) {
      pendingNetworkRef.current = null;
      silentNextAutoSyncRef.current = true;
    } else if (cachedQuickNetwork) {
      silentNextAutoSyncRef.current = true;
    }

    setPendingWallet(null);
    setWallet(nextWallet);
    setSeedSaved(saved);
    setWalletTab('home');
    setHistoryPage(0);
    enrichAttemptedRef.current.clear();
    setBalanceRefreshing(!pendingPreload);
    setNetwork(preloaded ? {
      status: 'connected',
      snapshot: preloaded.snapshot,
      error: '',
      serverUrl: '',
      height: preloaded.height,
      fullHistoryEnabled,
    } : { ...createEmptyNetworkState(), status: 'syncing' });
    setSendAddress('');
    setSendAmount('');
    setPreparedTx(null);
    setPreparedConsolidation(null);
    setScreen('wallet');
    setStatus(pendingPreload ? t('status.walletSynced') : message);
  };

  const prefetchWalletNetwork = useCallback(async (nextWallet: Wallet) => {
    pendingNetworkRef.current = null;

    try {
      const client = electrumClientRef.current || new NitoElectrumClient();
      electrumClientRef.current = client;
      const snapshot = await scanTransparentWallet({
        mnemonic: nextWallet.mnemonic,
        electrum: client,
        gapLimit: 20,
        includeHistory: false,
      });
      pendingNetworkRef.current = { address: nextWallet.address, snapshot, height: client.blockHeight };
    } catch {
      pendingNetworkRef.current = null;
    }
  }, []);

  const enrichWalletHistory = useCallback(async () => {
    if (enrichInFlightRef.current) return;
    const activeWallet = walletRef.current;
    const snapshot = networkRef.current.snapshot;
    if (!activeWallet || !snapshot) return;
    const pending = snapshot.history.filter((entry) =>
      entry.direction === undefined && !enrichAttemptedRef.current.has(enrichKey(entry)),
    );
    if (pending.length === 0) return;

    enrichInFlightRef.current = true;
    pending.forEach((entry) => enrichAttemptedRef.current.add(enrichKey(entry)));
    setHistoryProgress({ done: 0, total: pending.length });
    try {
      const client = electrumClientRef.current || new NitoElectrumClient();
      electrumClientRef.current = client;
      await client.connect().catch(() => undefined);
      const records = await buildHistoryExportRecords({
        history: pending,
        walletAddresses: snapshot.addresses.map((address) => address.address),
        reader: client,
        onProgress: (done, total) => setHistoryProgress({ done, total }),
      });
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
      ).catch(() => undefined);

      const byTxid = new Map(records.map((record) => [record.txid, record]));
      const current = networkRef.current;
      if (!current.snapshot) return;
      const enrichedHistory = current.snapshot.history.map((entry) => {
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
        snapshot: { ...current.snapshot, history: enrichedHistory },
      };
      networkRef.current = nextNetwork;
      setNetwork(nextNetwork);
    } catch {
      pending.forEach((entry) => enrichAttemptedRef.current.delete(enrichKey(entry)));
    } finally {
      enrichInFlightRef.current = false;
      setHistoryProgress(null);
    }
  }, []);

  const syncTransparentNetwork = useCallback(async (
    includeHistory = false,
    options: {
      force?: boolean;
      silent?: boolean;
      pendingOnly?: boolean;
      onlyAddresses?: readonly string[];
      rescanGap?: boolean;
    } = {},
  ) => {
    const activeWallet = walletRef.current;
    const currentNetwork = networkRef.current;

    if (!activeWallet) {
      setError(t('errors.noActiveWallet'));
      return;
    }

    if (syncInFlightRef.current || (pendingActionRef.current && !options.force)) {
      return;
    }

    syncInFlightRef.current = true;

    if (!includeHistory) {
      setBalanceRefreshing(true);
    }

    try {
      const client = electrumClientRef.current || new NitoElectrumClient();
      electrumClientRef.current = client;
      await client.connect().catch(() => undefined);
      const knownHeight = client.blockHeight || currentNetwork.height;
      const cache = await loadWalletHistoryCache(activeWallet.address).catch(() => ({
        history: [],
        fullHistoryHeight: 0,
      }));
      const wantsFullHistory = HISTORY_AUTO_IMPORT || includeHistory || cache.fullHistoryHeight > 0;
      if (wantsFullHistory) {
        setHistorySyncing(true);
      }
      const cacheAlreadyFresh =
        wantsFullHistory &&
        knownHeight > 0 &&
        cache.fullHistoryHeight >= knownHeight;
      const heightUnchanged =
        knownHeight > 0 &&
        currentNetwork.height >= knownHeight &&
        Boolean(currentNetwork.snapshot);

      if (!options.force && !wantsFullHistory && heightUnchanged) {
        const nextNetwork: NetworkState = {
          ...currentNetwork,
          status: 'connected',
          error: '',
          height: Math.max(currentNetwork.height, knownHeight),
          fullHistoryEnabled: currentNetwork.fullHistoryEnabled || cache.fullHistoryHeight > 0,
        };
        networkRef.current = nextNetwork;
        setNetwork(nextNetwork);
        if (!options.silent) {
          setStatus(t('status.walletSynced'));
        }
        return;
      }

      if (wantsFullHistory && cacheAlreadyFresh && currentNetwork.snapshot && heightUnchanged) {
        const snapshot = {
          ...currentNetwork.snapshot,
          history: normalizeWalletHistory([...cache.history, ...currentNetwork.snapshot.history]),
        };
        const nextNetwork: NetworkState = {
          ...currentNetwork,
          status: 'connected',
          snapshot,
          error: '',
          height: knownHeight,
          fullHistoryEnabled: true,
        };
        networkRef.current = nextNetwork;
        setNetwork(nextNetwork);
        await saveWalletSnapshotCache(activeWallet.address, toQuickWalletSnapshot(snapshot), knownHeight);
        if (!options.silent) {
          setStatus(t('status.walletSynced'));
        }
        return;
      }

      if (!options.silent) {
        setStatus(wantsFullHistory ? t('status.syncingHistory') : t('status.syncing'));
        setNetwork((current) => ({
          ...current,
          status: 'syncing',
          error: '',
          height: Math.max(current.height, knownHeight),
          fullHistoryEnabled: wantsFullHistory || current.fullHistoryEnabled,
        }));
      }

        let snapshot = currentNetwork.snapshot && !options.rescanGap
          ? await refreshKnownUsedAddresses({
              snapshot: currentNetwork.snapshot,
              electrum: client,
              includeHistory: wantsFullHistory,
              onlyAddresses: options.onlyAddresses,
            })
        : await scanTransparentWallet({
            mnemonic: activeWallet.mnemonic,
            electrum: client,
            gapLimit: 20,
            includeHistory: wantsFullHistory && !cacheAlreadyFresh,
            previousSnapshot: currentNetwork.snapshot,
          });
      const mergedHistory = normalizeWalletHistory([...cache.history, ...snapshot.history]);

      if (wantsFullHistory) {
        snapshot = { ...snapshot, history: mergedHistory };

        if (!cacheAlreadyFresh) {
          await saveWalletHistoryCache(activeWallet.address, mergedHistory, knownHeight);
        }
      }

      const nextNetwork: NetworkState = {
        status: 'connected',
        snapshot,
        error: '',
        serverUrl: '',
        height: knownHeight,
        fullHistoryEnabled: wantsFullHistory,
      };
      networkRef.current = nextNetwork;
      setNetwork(nextNetwork);
      await saveWalletSnapshotCache(activeWallet.address, toQuickWalletSnapshot(snapshot), knownHeight);
      if (!options.silent) {
        setStatus(t('status.walletSynced'));
      }
    } catch (caught) {
      const fallbackNetwork = networkRef.current;
      if (options.silent && fallbackNetwork.snapshot) {
        const nextNetwork: NetworkState = {
          ...fallbackNetwork,
          status: 'connected',
          error: '',
        };
        networkRef.current = nextNetwork;
        setNetwork(nextNetwork);
        return;
      }

      const nextNetwork: NetworkState = {
        status: 'error',
        snapshot: fallbackNetwork.snapshot,
        error: caught instanceof Error ? caught.message : t('errors.networkUnavailable'),
        serverUrl: '',
        height: electrumClientRef.current?.blockHeight || fallbackNetwork.height || 0,
        fullHistoryEnabled: includeHistory || fallbackNetwork.fullHistoryEnabled,
      };
      networkRef.current = nextNetwork;
      setNetwork(nextNetwork);
    } finally {
      syncInFlightRef.current = false;
      setHistorySyncing(false);
      if (!includeHistory) {
        setBalanceRefreshing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    if (screen !== 'wallet' || !network.snapshot) return;
    const hasPending = network.snapshot.history.some(
      (entry) => entry.direction === undefined && !enrichAttemptedRef.current.has(enrichKey(entry)),
    );
    if (hasPending) {
      void enrichWalletHistory();
    }
  }, [screen, network.snapshot, enrichWalletHistory]);

  const reconcileBroadcasts = useCallback(async (txids: readonly string[]) => {
    if (txids.length === 0) return;
    const client = electrumClientRef.current ?? new NitoElectrumClient();
    electrumClientRef.current = client;
    for (const delayMs of [250, 750, 1_500, 3_000]) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      const visible = await Promise.all(
        txids.map(async (txid) => {
          try {
            await client.getTransactionHex(txid);
            return true;
          } catch {
            return false;
          }
        }),
      );
      if (visible.every(Boolean)) break;
    }
    await syncTransparentNetwork(false, { force: true, silent: true, pendingOnly: true });
  }, [syncTransparentNetwork]);

  useEffect(() => {
    blockHeightUnsubscribeRef.current?.();
    blockHeightUnsubscribeRef.current = null;

    const client = electrumClientRef.current;
    if (screen !== 'wallet' || !wallet || !network.snapshot || !client) {
      return undefined;
    }

    blockHeightUnsubscribeRef.current = client.subscribeBlockHeight((height) => {
      const current = networkRef.current;
      const snapshot = current.snapshot;
      if (!snapshot || height <= current.height) return;

      const hasPending = snapshot.unconfirmedSats !== 0
        || (snapshot.immatureCoinbaseSats ?? 0) > 0
        || snapshot.history.some((entry) => entry.height <= 0)
        || snapshot.utxos.some((utxo) => (
          utxo.confirmations > 0
          && utxo.confirmations < 101
          && utxo.isCoinbase !== false
        ));
      if (!hasPending) {
        const nextNetwork = { ...current, height };
        networkRef.current = nextNetwork;
        setNetwork(nextNetwork);
        return;
      }

      if (!syncInFlightRef.current) {
        void syncTransparentNetwork(false, {
          force: true,
          silent: true,
          pendingOnly: true,
          onlyAddresses: snapshot.addresses
            .filter((address) => address.utxos.some((utxo) => (
              utxo.confirmations <= 0
              || (
                utxo.confirmations > 0
                && utxo.confirmations < 101
                && utxo.isCoinbase !== false
              )
            )))
            .map((address) => address.address),
        });
      }
    });

    return () => {
      blockHeightUnsubscribeRef.current?.();
      blockHeightUnsubscribeRef.current = null;
    };
  }, [network.snapshot, screen, syncTransparentNetwork, wallet]);

  const clearAddressSubscriptions = useCallback(() => {
    addressUnsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    addressUnsubscribeRef.current.clear();
    addressStatusRef.current.clear();
    subscriptionRefreshInFlightRef.current = false;
  }, []);

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

  useEffect(() => () => {
    clearAddressSubscriptions();
  }, [clearAddressSubscriptions, wallet?.address]);

  useEffect(() => {
    if (screen !== 'wallet' || !wallet || !network.snapshot) {
      return undefined;
    }

    const snapshot = network.snapshot;
    let cancelled = false;
    const activeAddresses = new Set(snapshot.addresses.map(({ address }) => address));
    for (const [address, unsubscribe] of addressUnsubscribeRef.current) {
      if (!activeAddresses.has(address)) {
        unsubscribe();
        addressUnsubscribeRef.current.delete(address);
        addressStatusRef.current.delete(address);
      }
    }

    const subscribeKnownAddresses = async () => {
      const client = electrumClientRef.current;

      if (!client || subscriptionRefreshInFlightRef.current) {
        return;
      }

      subscriptionRefreshInFlightRef.current = true;

      try {
        for (const scannedAddress of snapshot.addresses) {
          const address = scannedAddress.address;

          if (cancelled || addressUnsubscribeRef.current.has(address)) {
            continue;
          }

          try {
            const subscription = await client.subscribeAddressStatus(address, (nextStatus, changedAddress) => {
              const previousStatus = addressStatusRef.current.get(changedAddress);
              addressStatusRef.current.set(changedAddress, nextStatus);

              if (previousStatus !== undefined && previousStatus !== nextStatus && !syncInFlightRef.current) {
                const knownAddress = networkRef.current.snapshot?.addresses.find(
                  ({ address: candidate }) => candidate === changedAddress,
                );
                void syncTransparentNetwork(false, {
                  force: true,
                  silent: true,
                  onlyAddresses: knownAddress?.used ? [changedAddress] : undefined,
                  rescanGap: !knownAddress?.used,
                });
              }
            });

            if (cancelled) {
              subscription.unsubscribe();
              return;
            }

            addressStatusRef.current.set(address, subscription.status);
            addressUnsubscribeRef.current.set(address, subscription.unsubscribe);
            if (!scannedAddress.used && subscription.status !== null && !syncInFlightRef.current) {
              void syncTransparentNetwork(false, { force: true, silent: true, rescanGap: true });
            }
          } catch {
            addressStatusRef.current.delete(address);
          }
        }
      } finally {
        subscriptionRefreshInFlightRef.current = false;
      }
    };

    void subscribeKnownAddresses();

    return () => {
      cancelled = true;
    };
  }, [network.snapshot, screen, syncTransparentNetwork, wallet]);

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
        setSeedSaved(false);
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

      const cachedNetworkPromise = loadWalletSnapshotCache(vault.address).catch(() => null);
      const cachedHistoryPromise = loadWalletHistoryCache(vault.address).catch(() => null);
      const [payload, candidateCachedNetwork, candidateCachedHistory] = await Promise.all([
        decryptVault(vault, vaultSecret, t('errors.invalidPasswordOrVault')),
        cachedNetworkPromise,
        cachedHistoryPromise,
      ]);
      const unlockedWallet: Wallet = {
        mnemonic: payload.mnemonic,
        address: payload.address,
        derivationPath: payload.derivationPath,
      };
      const cachedNetwork = vault.address === payload.address
        ? candidateCachedNetwork
        : await loadWalletSnapshotCache(payload.address).catch(() => null);
      const cachedHistory = vault.address === payload.address
        ? candidateCachedHistory
        : await loadWalletHistoryCache(payload.address).catch(() => null);
      if (cachedNetwork) {
        void saveWalletSnapshotCache(
          unlockedWallet.address,
          toQuickWalletSnapshot(cachedNetwork.snapshot),
          cachedNetwork.height,
        ).catch(() => undefined);
      }
      setVaultUnlockMode(vault.unlockMode === 'biometric' ? 'biometric' : 'password');
      setVaultBiometricsEnabled(Boolean(vault.biometricsEnabled || vault.unlockMode === 'biometric'));
      setUnlockPassword('');
      enterWallet(unlockedWallet, true, t('status.walletUnlocked'), cachedNetwork, cachedHistory);

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
            await saveVault({
              ...upgraded,
              biometricsEnabled: latest?.biometricsEnabled ?? upgraded.biometricsEnabled,
              unlockMode: latest?.unlockMode ?? upgraded.unlockMode,
            });
          } catch {
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
      setSeedSaved(true);
      setVaultUnlockMode('password');
      setVaultBiometricsEnabled(false);

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
                await deleteVault();
                await deleteBiometricSecret();
                if (walletId) {
                  await clearWalletHistoryCache(walletId).catch(() => undefined);
                }
                setSeedSaved(false);
                setVaultUnlockMode('password');
                setVaultBiometricsEnabled(false);
                setWallet(null);
                setPendingWallet(null);
                setShowMnemonic(false);
                setSensitiveAction(null);
                setSensitivePassword('');
                setNetwork(createEmptyNetworkState());
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
    setSensitiveAction(null);
    setSensitivePassword('');
    setShowSensitivePassword(false);
    enrichAttemptedRef.current.clear();
    setNetwork(createEmptyNetworkState());
    setScreen(seedSaved ? 'unlock' : 'landing');
  }, [clearAddressSubscriptions, resetFeedback, seedSaved]);

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
        const current = await Clipboard.getStringAsync().catch(() => '');
        if (current === wallet.address) {
          await Clipboard.setStringAsync('').catch(() => undefined);
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

    try {
      setBroadcasting(true);
      const client = electrumClientRef.current || new NitoElectrumClient();
      electrumClientRef.current = client;
      const transaction = preparedTx;
      const txid = await client.broadcastTransaction(transaction.hex);

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
      void reconcileBroadcasts([txid])
        .catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.sendFailed'));
    } finally {
      setBroadcasting(false);
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

      setBroadcasting(true);
      const client = electrumClientRef.current || new NitoElectrumClient();
      electrumClientRef.current = client;
      const txids: string[] = [];
      let sentCount = 0;
      try {
        for (const transaction of preparedConsolidation.transactions) {
          const txid = await client.broadcastTransaction(transaction.hex);
          txids.push(txid);
          sentCount += 1;
          const currentNetwork = networkRef.current;
          if (currentNetwork.snapshot && wallet) {
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
        setBroadcasting(false);
        if (txids.length > 0) void reconcileBroadcasts(txids).catch(() => undefined);
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
    setVaultBiometricsEnabled(true);
  };

  const disableBiometricUnlock = async () => {
    await deleteBiometricSecret();
    const vault = await loadVault();
    if (vault) {
      await saveVault({ ...vault, biometricsEnabled: false, unlockMode: 'password' });
    }
    setVaultBiometricsEnabled(false);
    setVaultUnlockMode('password');
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
      try {
        if (!networkRef.current.fullHistoryEnabled || !networkRef.current.snapshot) {
          throw new Error(t('errors.fullHistoryRequired'));
        }
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error(t('errors.historyExportUnavailable'));
        }

        const rootDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
        if (!rootDirectory) {
          throw new Error(t('errors.historyExportUnavailable'));
        }

        const activeWallet = walletRef.current;
        if (!activeWallet) {
          throw new Error(t('errors.noActiveWallet'));
        }

        while (enrichInFlightRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        enrichInFlightRef.current = true;
        try {
          const snapshot = networkRef.current.snapshot;
          const missing = snapshot.history.filter((entry) => entry.direction === undefined);

          if (missing.length > 0) {
            const client = electrumClientRef.current || new NitoElectrumClient();
            electrumClientRef.current = client;
            await client.connect().catch(() => undefined);
            const fresh = await buildHistoryExportRecords({
              history: missing,
              walletAddresses: snapshot.addresses.map((address) => address.address),
              reader: client,
              onProgress: (done, total) => {
                setStatus(t('status.historyExporting', { done, total }));
              },
            });
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
            ).catch(() => undefined);
            const byTxid = new Map(fresh.map((record) => [record.txid, record]));
            const current = networkRef.current;
            if (current.snapshot) {
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
            missing.forEach((entry) => enrichAttemptedRef.current.add(enrichKey(entry)));
          }
        } finally {
          enrichInFlightRef.current = false;
        }

        const records = historyRecordsFromEntries(networkRef.current.snapshot?.history ?? []);
        const rows = historyExportCsvRows(records);
        const csv = `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}`;
        const date = new Date().toISOString().slice(0, 10);
        const uri = `${rootDirectory}nito-wallet-history-${date}.csv`;
        await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
        await Sharing.shareAsync(uri, {
          dialogTitle: t('history.exportTitle'),
          mimeType: 'text/csv',
          UTI: 'public.comma-separated-values-text',
        });
        setStatus(t('status.historyExported'));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t('errors.historyExportFailed'));
      }
    });
  };

  const refreshBalance = async () => {
    const now = Date.now();
    if (balanceRefreshing || syncInFlightRef.current || pendingActionRef.current || !walletRef.current) return;
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
    await SecureStore.setItemAsync(BALANCE_REFRESH_COOLDOWN_KEY, String(cooldownUntil)).catch(() => undefined);
    await syncTransparentNetwork(false, { force: true, silent: true });
    if (networkRef.current.status === 'connected') setStatus(t('status.walletSynced'));
  };

  const openQrScanner = async () => {
    if (pendingActionRef.current) return;
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

  const handleQrScan = (value: string) => {
    if (qrScanHandled) return;
    setQrScanHandled(true);
    try {
      const address = parseNitoQrAddress(value);
      setSendAddress(address);
      setPreparedTx(null);
      setQrScannerOpen(false);
      setQrScannerError('');
      setStatus(t('status.addressScanned'));
    } catch {
      setQrScannerError(t('errors.invalidQr'));
      setTimeout(() => setQrScanHandled(false), 900);
    }
  };

  const selectLanguage = (nextLanguage: LanguageCode) => {
    setLanguage(nextLanguage);
    setLanguagePickerOpen(false);
    void SecureStore.setItemAsync(LANGUAGE_PREFERENCE_KEY, nextLanguage);
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
    <View style={styles.languageSettings}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: languagePickerOpen }}
        style={styles.languageSettingsButton}
        onPress={() => setLanguagePickerOpen((current) => !current)}
      >
        <View style={styles.languageSettingsText}>
          <Text style={styles.label}>{t('language.title')}</Text>
          <Text style={styles.languageCurrent}>{selectedLanguage.name}</Text>
        </View>
        <Text style={styles.languageChevron}>{languagePickerOpen ? '\u2303' : '\u2304'}</Text>
      </TouchableOpacity>
      {languagePickerOpen ? (
        <View style={styles.languageMenu}>
          <View style={styles.languageGrid}>
            {LANGUAGES.map((entry) => (
              <TouchableOpacity
                key={entry.code}
                style={[styles.languageOption, language === entry.code && styles.languageOptionActive]}
                onPress={() => selectLanguage(entry.code)}
              >
                <Text style={[styles.languageOptionCode, language === entry.code && styles.languageOptionCodeActive]}>
                  {entry.short}
                </Text>
                <Text style={styles.languageOptionName}>{entry.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  const hero = (
    <View style={styles.hero}>
      <View style={styles.brandRow}>
        <Image source={NITO_LOGO} style={styles.logo} resizeMode="contain" />
        <View style={styles.brandText}>
          <Text style={styles.eyebrow}>{t('brand.network')}</Text>
          <Text style={styles.title}>{t('brand.wallet')}</Text>
        </View>
      </View>

    </View>
  );

  const feedback = (
    <>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </>
  );

  const landing = (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('start.title')}</Text>
      <Text style={styles.body}>{t('start.body')}</Text>
      <ActionButton label={t('actions.createWallet')} loading={pendingAction === 'create'} disabled={actionLocked} onPress={createWallet} />
      <ActionButton label={t('actions.importSeed')} variant="secondary" disabled={actionLocked} onPress={() => { resetFeedback(); setShowImportSeed(false); setScreen('import'); }} />
    </View>
  );

  const importScreen = (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('import.title')}</Text>
      <Text style={styles.body}>{t('import.body')}</Text>
      <View style={styles.seedInputShell}>
        <TextInput
          value={importText}
          onChangeText={setImportText}
          placeholder={t('import.placeholder')}
          placeholderTextColor="#6d7892"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="noExcludeDescendants"
          secureTextEntry={!showImportSeed}
          multiline={showImportSeed}
          textAlignVertical={showImportSeed ? 'top' : 'center'}
          style={[styles.seedInput, !showImportSeed && styles.seedInputHidden]}
        />
        <TouchableOpacity
          style={styles.seedVisibilityButton}
          onPress={() => setShowImportSeed((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={showImportSeed ? t('actions.hide') : t('actions.show')}
        >
          <Text style={styles.seedVisibilityButtonText}>
            {showImportSeed ? t('actions.hide') : t('actions.show')}
          </Text>
        </TouchableOpacity>
      </View>
      {invalidImportWords.length > 0 ? (
        <View style={styles.seedWordErrors} accessibilityLiveRegion="polite">
          {invalidImportWords.map((entry) => (
            <Text key={`${entry.index}:${entry.word}`} style={styles.seedWordError}>
              {`X #${entry.index + 1}${showImportSeed ? `: ${entry.word}` : ''}`}
            </Text>
          ))}
        </View>
      ) : null}
      {importMnemonicStatus ? <Text style={styles.helper}>{importMnemonicStatus}</Text> : null}
      <ActionButton label={t('actions.continue')} loading={pendingAction === 'import'} disabled={actionLocked || !importMnemonicValid} onPress={importWallet} />
      <ActionButton label={t('actions.back')} variant="ghost" disabled={actionLocked} onPress={() => { resetFeedback(); setImportText(''); setShowImportSeed(false); setScreen(seedSaved ? 'unlock' : 'landing'); }} />
    </View>
  );

  const unlockScreen = (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('unlock.title')}</Text>
      {vaultBiometricsEnabled ? (
        <ActionButton
          label={t('unlock.withBiometric', { method: biometricMethod })}
          loading={pendingAction === 'unlock'}
          disabled={actionLocked}
          onPress={() => { void unlockSavedWallet(true); }}
        />
      ) : null}
      <PasswordField
        value={unlockPassword}
        onChangeText={setUnlockPassword}
        placeholder={t('unlock.password')}
        visible={showUnlockPassword}
        onToggleVisible={() => setShowUnlockPassword((current) => !current)}
        showLabel={t('actions.show')}
        hideLabel={t('actions.hide')}
      />
      <ActionButton
        label={t('unlock.title')}
        variant={vaultBiometricsEnabled ? 'secondary' : 'primary'}
        loading={pendingAction === 'unlock'}
        disabled={actionLocked}
        onPress={() => { void unlockSavedWallet(false); }}
      />
    </View>
  );

  const persistScreen = (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('persist.title')}</Text>
      {showMnemonic && pendingWallet ? <Text selectable style={styles.mnemonic}>{pendingWallet.mnemonic}</Text> : null}
      <PasswordField
        value={persistPassword}
        onChangeText={setPersistPassword}
        placeholder={t('persist.password')}
        visible={showPersistPassword}
        onToggleVisible={() => setShowPersistPassword((current) => !current)}
        showLabel={t('actions.show')}
        hideLabel={t('actions.hide')}
      />
      <PasswordField
        value={persistConfirmPassword}
        onChangeText={setPersistConfirmPassword}
        placeholder={t('persist.confirmPassword')}
        visible={showPersistConfirmPassword}
        onToggleVisible={() => setShowPersistConfirmPassword((current) => !current)}
        showLabel={t('actions.show')}
        hideLabel={t('actions.hide')}
      />
      <ActionButton
        label={persistBusy ? t('persist.protecting') : t('persist.protectOpen')}
        loading={pendingAction === 'protect' || persistBusy}
        disabled={actionLocked || persistBusy}
        onPress={() => { void persistWallet(); }}
      />
    </View>
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

  const walletScreen = (
    <View style={styles.walletShell}>
      <View style={styles.tabs}>
        {walletTabs.map((tab, index) => (
          <TouchableOpacity
            accessibilityRole="tab"
            accessibilityState={{ selected: walletTab === tab.key }}
            key={tab.key}
            style={[styles.tab, index >= 3 && styles.tabWide, walletTab === tab.key && styles.tabActive]}
            onPress={() => setWalletTab(tab.key)}
          >
            <Text style={[styles.tabText, walletTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {renderWalletTab()}
    </View>
  );

  const activeScreen = () => {
    if (screen === 'loading') {
      return (
        <View style={styles.loadingPanel}>
          <Animated.Image
            source={NITO_LOGO}
            style={[styles.bootstrapLogo, { transform: [{ rotate: loadingRotation }] }]}
            resizeMode="contain"
          />
          <Text style={styles.sectionTitle}>{t('loading.title')}</Text>
        </View>
      );
    }

    if (screen === 'import') {
      return importScreen;
    }

    if (screen === 'unlock') {
      return unlockScreen;
    }

    if (screen === 'persist') {
      return persistScreen;
    }

    if (screen === 'wallet') {
      return walletScreen;
    }

    return landing;
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={styles.safeArea}
        onStartShouldSetResponderCapture={() => { registerActivity(); return false; }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
            {screen !== 'loading' ? hero : null}
            {feedback}
            {activeScreen()}
          </ScrollView>
          {pendingAction ? (
            <View style={styles.loadingOverlay} pointerEvents="auto">
              <View style={styles.loadingLogoShell}>
                <Animated.Image
                  source={NITO_LOGO}
                  style={[styles.loadingLogo, { transform: [{ rotate: loadingRotation }] }]}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.loadingOverlayTitle}>{t('brand.wallet')}</Text>
              <Text style={styles.loadingOverlayText}>{loadingMessage}</Text>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
      <Modal animationType="fade" onRequestClose={() => setQrScannerOpen(false)} presentationStyle="fullScreen" visible={qrScannerOpen}>
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
          <TouchableOpacity style={styles.scannerCloseButton} onPress={() => setQrScannerOpen(false)}>
            <Text style={styles.scannerCloseButtonText}>{t('actions.cancel')}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>
    </SafeAreaProvider>
  );
}

