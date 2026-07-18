import 'react-native-get-random-values';

import { entropyToMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import nacl from 'tweetnacl';

import { NitoElectrumClient, scriptPubKeyForNitoAddress } from './src/network/electrum';
import { buildHistoryExportRecords, historyExportCsvRows } from './src/services/historyExport';
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
  buildTransparentSend,
  calculateMaxTransparentSendAmount,
  parseNitoAmountToSats,
  type PreparedTransparentTx,
} from './src/wallet/transparentSend';

declare const require: (path: string) => number;

const NITO_LOGO = require('./assets/nito-logo.png');
const PRIMARY_DERIVATION_PATH = "m/84'/0'/0'/0/0";
const VAULT_KEY = 'nito.wallet.vault.v1';
const BIOMETRIC_SECRET_KEY = 'nito.wallet.biometric.secret.v1';
const LANGUAGE_PREFERENCE_KEY = 'nito.wallet.language.v1';
const BALANCE_REFRESH_COOLDOWN_KEY = 'nito.wallet.balance-refresh-until.v1';
const BALANCE_REFRESH_COOLDOWN_MS = 120_000;
const HISTORY_PAGE_SIZE = 12;
const PBKDF2_ROUNDS = 120_000;
const MNEMONIC_REVEAL_MS = 60_000;
const ADDRESS_CLIPBOARD_MS = 60_000;
const BIP39_WORDS = new Set<string>(wordlist);

type AppScreen = 'loading' | 'landing' | 'unlock' | 'import' | 'wallet' | 'persist';
type WalletTab = 'home' | 'receive' | 'send' | 'history' | 'security';
type BiometricMethod = 'Face ID' | 'Touch ID' | 'biometrics';
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger' | 'disabled';
type PendingAction =
  | 'create'
  | 'import'
  | 'unlock'
  | 'protect'
  | 'copy'
  | 'max'
  | 'prepare'
  | 'broadcast'
  | 'history'
  | 'reveal'
  | 'delete'
  | 'lock';

type Wallet = {
  mnemonic: string;
  address: string;
  derivationPath: string;
};

type VaultPayload = {
  version: 1;
  mnemonic: string;
  address: string;
  derivationPath: string;
  createdAt: string;
};

type EncryptedVault = {
  version: 1;
  kdf: 'pbkdf2-sha256';
  rounds: number;
  salt: string;
  nonce: string;
  ciphertext: string;
  address: string;
  derivationPath: string;
  createdAt: string;
  biometricsEnabled: boolean;
  unlockMode?: 'password' | 'biometric';
};

type NetworkState = {
  status: 'idle' | 'syncing' | 'connected' | 'error';
  snapshot: TransparentWalletSnapshot | null;
  error: string;
  serverUrl: string;
  height: number;
  fullHistoryEnabled: boolean;
};

const BASE_WALLET_TABS: { key: WalletTab; labelKey: Parameters<Translator>[0] }[] = [
  { key: 'home', labelKey: 'tabs.home' },
  { key: 'receive', labelKey: 'tabs.receive' },
  { key: 'send', labelKey: 'tabs.send' },
  { key: 'history', labelKey: 'tabs.history' },
  { key: 'security', labelKey: 'tabs.security' },
];

const uint8ArrayToBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const base64ToUint8Array = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
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
const escapeCsvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
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
const shortAddress = (address: string) => `${address.slice(0, 13)}...${address.slice(-8)}`;
const transactionExplorerUrl = (txid: string) => `https://mempool-explorer.nito.network/fr/tx/${txid}`;
const createEmptyNetworkState = (): NetworkState => ({
  status: 'idle',
  snapshot: null,
  error: '',
  serverUrl: '',
  height: 0,
  fullHistoryEnabled: false,
});

const toQuickWalletSnapshot = (snapshot: TransparentWalletSnapshot): TransparentWalletSnapshot => {
  const currentUtxoTxids = new Set(
    snapshot.utxos.filter((utxo) => utxo.confirmations > 0).map((utxo) => utxo.txid),
  );
  const keepCurrentUtxoHistory = (history: TransparentWalletSnapshot['history']) =>
    normalizeWalletHistory(history.filter((entry) => currentUtxoTxids.has(entry.txid)));
  const stripAddressHistory = (address: TransparentWalletSnapshot['addresses'][number]) => ({
    ...address,
    history: keepCurrentUtxoHistory(address.history),
  });

  return {
    ...snapshot,
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

const deriveKey = async (password: string, salt: Uint8Array, rounds = PBKDF2_ROUNDS) => {
  const { keyBase64 } = await nitoWalletCrypto.pbkdf2({
    password,
    saltBase64: uint8ArrayToBase64(salt),
    rounds,
    outputLength: 32,
  });
  return base64ToUint8Array(keyBase64);
};

const encryptVault = async (
  payload: VaultPayload,
  password: string,
  biometricsEnabled: boolean,
  unlockMode: 'password' | 'biometric' = 'password',
): Promise<EncryptedVault> => {
  const salt = nacl.randomBytes(16);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = nacl.secretbox(plaintext, nonce, key);

  return {
    version: 1,
    kdf: 'pbkdf2-sha256',
    rounds: PBKDF2_ROUNDS,
    salt: uint8ArrayToBase64(salt),
    nonce: uint8ArrayToBase64(nonce),
    ciphertext: uint8ArrayToBase64(ciphertext),
    address: payload.address,
    derivationPath: payload.derivationPath,
    createdAt: payload.createdAt,
    biometricsEnabled,
    unlockMode,
  };
};

const decryptVault = async (
  vault: EncryptedVault,
  password: string,
  invalidMessage = 'Invalid password or corrupted vault.',
): Promise<VaultPayload> => {
  const key = await deriveKey(password, base64ToUint8Array(vault.salt), vault.rounds || PBKDF2_ROUNDS);
  const plaintext = nacl.secretbox.open(
    base64ToUint8Array(vault.ciphertext),
    base64ToUint8Array(vault.nonce),
    key,
  );

  if (!plaintext) {
    throw new Error(invalidMessage);
  }

  return JSON.parse(new TextDecoder().decode(plaintext)) as VaultPayload;
};

const loadVault = async () => {
  const raw = await SecureStore.getItemAsync(VAULT_KEY);
  return raw ? (JSON.parse(raw) as EncryptedVault) : null;
};

const saveVault = async (vault: EncryptedVault) => {
  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(vault), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

const saveBiometricSecret = async (secret: string) => {
  await SecureStore.setItemAsync(BIOMETRIC_SECRET_KEY, secret, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: 'Unlock Nito Wallet',
  });
};

const loadBiometricSecret = async () =>
  SecureStore.getItemAsync(BIOMETRIC_SECRET_KEY, {
    requireAuthentication: true,
    authenticationPrompt: 'Unlock Nito Wallet',
  });

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
    disableDeviceFallback: false,
    requireConfirmation: true,
  });

  if (!result.success) {
    throw new Error('Biometric authentication was cancelled or rejected.');
  }
};

function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
}) {
  const inactive = disabled || loading || variant === 'disabled';
  return (
    <TouchableOpacity
      disabled={inactive}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        variant === 'success' && styles.buttonSuccess,
        variant === 'danger' && styles.buttonDanger,
        inactive && styles.buttonDisabled,
      ]}
    >
      <View style={styles.buttonContent}>
        <Text
          style={[
            styles.buttonText,
            variant === 'secondary' && styles.buttonTextSecondary,
            variant === 'ghost' && styles.buttonTextGhost,
            variant === 'success' && styles.buttonTextSuccess,
            variant === 'danger' && styles.buttonTextDanger,
            inactive && styles.buttonTextDisabled,
          ]}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function PasswordField({
  value,
  onChangeText,
  placeholder,
  visible,
  onToggleVisible,
  showLabel,
  hideLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  visible: boolean;
  onToggleVisible: () => void;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <View style={styles.passwordField}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#6d7892"
        secureTextEntry={!visible}
        style={styles.passwordInput}
      />
      <TouchableOpacity onPress={onToggleVisible} style={styles.passwordToggle}>
        <Text style={styles.passwordToggleText}>{visible ? hideLabel : showLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

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
  const skipNextAutoSyncRef = useRef(false);
  const silentNextAutoSyncRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const systemPromptActiveRef = useRef(false);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const [loadingSpin] = useState(() => new Animated.Value(0));
  const [network, setNetwork] = useState<NetworkState>(createEmptyNetworkState);
  const [importText, setImportText] = useState('');
  const [showImportSeed, setShowImportSeed] = useState(false);
  const [sendAddress, setSendAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [preparedTx, setPreparedTx] = useState<PreparedTransparentTx | null>(null);
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
  const [persistWithBiometrics, setPersistWithBiometrics] = useState(false);
  const [biometricMethod, setBiometricMethod] = useState<BiometricMethod>('biometrics');
  const [biometricUnavailableReason, setBiometricUnavailableReason] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [sensitivePassword, setSensitivePassword] = useState('');
  const [showSensitivePassword, setShowSensitivePassword] = useState(false);
  const [sensitiveAction, setSensitiveAction] = useState<'reveal' | 'delete' | null>(null);
  const [sensitiveBusy, setSensitiveBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
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
      skipNextAutoSyncRef.current = true;
    } else if (cachedQuickNetwork) {
      silentNextAutoSyncRef.current = true;
    }

    setPendingWallet(null);
    setWallet(nextWallet);
    setSeedSaved(saved);
    setWalletTab('home');
    setHistoryPage(0);
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

  const syncTransparentNetwork = useCallback(async (
    includeHistory = false,
    options: { force?: boolean; silent?: boolean; pendingOnly?: boolean } = {},
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
      const wantsFullHistory = includeHistory || cache.fullHistoryHeight > 0;
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

      let snapshot = options.pendingOnly && currentNetwork.snapshot
        ? await refreshKnownUsedAddresses({
            snapshot: currentNetwork.snapshot,
            electrum: client,
            includeHistory: wantsFullHistory,
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
      if (!includeHistory) {
        setBalanceRefreshing(false);
      }
    }
  }, [t]);

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

      const hasPending = snapshot.unconfirmedSats !== 0 || snapshot.history.some((entry) => entry.height <= 0);
      if (!hasPending) {
        const nextNetwork = { ...current, height };
        networkRef.current = nextNetwork;
        setNetwork(nextNetwork);
        return;
      }

      if (!syncInFlightRef.current) {
        void syncTransparentNetwork(false, { force: true, silent: true, pendingOnly: true });
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
        if (skipNextAutoSyncRef.current) {
          skipNextAutoSyncRef.current = false;
          return;
        }

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

    const subscribeKnownAddresses = async () => {
      const client = electrumClientRef.current;

      if (!client || subscriptionRefreshInFlightRef.current) {
        return;
      }

      clearAddressSubscriptions();
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
                void syncTransparentNetwork(false, { force: true });
              }
            });

            if (cancelled) {
              subscription.unsubscribe();
              return;
            }

            addressStatusRef.current.set(address, subscription.status);
            addressUnsubscribeRef.current.set(address, subscription.unsubscribe);
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
  }, [clearAddressSubscriptions, network.snapshot, screen, syncTransparentNetwork, wallet]);

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
      setPersistWithBiometrics(false);
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
      setPersistWithBiometrics(false);
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

  const unlockSavedWallet = async (useBiometrics = false) => {
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.unlockFailed'));
    }
  
    });
  };

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

    if (persistWithBiometrics) {
      if (biometricUnavailableReason) {
        setError(biometricUnavailableReason);
        return;
      }

      try {
        systemPromptActiveRef.current = true;
        try {
          await requestBiometricGate(`Protect Nito Wallet with ${biometricMethod}`);
          await saveBiometricSecret(persistPassword);
        } finally {
          systemPromptActiveRef.current = false;
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t('errors.biometricUnavailable'));
        return;
      }
    } else {
      await SecureStore.deleteItemAsync(BIOMETRIC_SECRET_KEY).catch(() => undefined);
    }
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
        persistWithBiometrics,
        'password',
      );

      await saveVault(encrypted);
      setSeedSaved(true);
      setVaultUnlockMode('password');
      setVaultBiometricsEnabled(persistWithBiometrics);
      setPersistPassword('');
      setPersistConfirmPassword('');
      setPersistWithBiometrics(false);
      enterWallet(walletToPersist, true, t('status.walletOpened'));
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
                await SecureStore.deleteItemAsync(VAULT_KEY);
                await SecureStore.deleteItemAsync(BIOMETRIC_SECRET_KEY).catch(() => undefined);
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
    setQrScannerOpen(false);
    setQrScanHandled(false);
    setQrScannerError('');
    setBalanceRefreshing(false);
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
    });
    return () => subscription.remove();
  }, [lockWallet, screen, seedSaved]);

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
      const tx = await buildTransparentSend({
        mnemonic: wallet.mnemonic,
        snapshot: network.snapshot,
        toAddress: sendAddress,
        amountSats: parseNitoAmountToSats(sendAmount),
      });

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
      } catch (caught) {
        setPreparedTx(null);
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
      const destinationAddress = sendAddress.trim();
      const txid = await client.broadcastTransaction(preparedTx.hex);
      setPreparedTx(null);
      setSendAddress('');
      setSendAmount('');
      setStatus(t('status.transactionSent', { txid }));

      const rememberSentTransaction = () => setNetwork((current) => {
        if (!current.snapshot) {
          return current;
        }

        const existing = current.snapshot.history.find((entry) => entry.txid === txid);
        const sentEntry = existing || { txid, height: 0, address: destinationAddress };

        return {
          ...current,
          snapshot: {
            ...current.snapshot,
            history: [
              sentEntry,
              ...current.snapshot.history.filter((entry) => entry.txid !== txid),
            ],
          },
        };
      });

      rememberSentTransaction();
      Alert.alert(
        t('dialog.sentTitle'),
        t('dialog.sentBody', { txid: shortAddress(txid) }),
        [
          {
            text: t('actions.viewTx'),
            onPress: () => {
              void Linking.openURL(transactionExplorerUrl(txid));
            },
          },
          { text: t('actions.ok'), style: 'cancel' },
        ],
      );
      void syncTransparentNetwork(false, { force: true })
        .catch(() => undefined)
        .finally(rememberSentTransaction);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.sendFailed'));
    } finally {
      setBroadcasting(false);
    }
  
    });
  };

  const verifySensitiveAction = async () => {
    const vault = await loadVault();

    if (!vault) {
      throw new Error(t('errors.noVault'));
    }

    let vaultSecret = sensitivePassword;

    if (vault.unlockMode === 'biometric') {
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
  };

  const confirmSensitiveAction = async () => {
    await runExclusiveAction(sensitiveAction === 'delete' ? 'delete' : 'reveal', async () => {
    resetFeedback();

    if (!wallet || !sensitiveAction) {
      return;
    }

    setSensitiveBusy(true);

    try {
      await verifySensitiveAction();

      if (sensitiveAction === 'reveal') {
        setShowMnemonic(true);
        setStatus(t('status.seedVisibleTemporary'));
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

  const loadFullHistory = async () => {
    await runExclusiveAction('history', async () => {
      resetFeedback();
      await syncTransparentNetwork(true, { force: true });
      setHistoryPage(0);
      setStatus(t('status.historySynced'));
    });
  };

  const confirmFullHistorySync = () => {
    Alert.alert(
      t('dialog.fullHistoryTitle'),
      t('dialog.fullHistoryBody'),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('dialog.fullHistoryConfirm'),
          onPress: () => { void loadFullHistory(); },
        },
      ],
    );
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

        const client = electrumClientRef.current || new NitoElectrumClient();
        electrumClientRef.current = client;
        const records = await buildHistoryExportRecords({
          history: networkRef.current.snapshot.history,
          walletAddresses: networkRef.current.snapshot.addresses.map((address) => address.address),
          reader: client,
        });
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
    prepare: t('loading.prepare'),
    broadcast: t('loading.broadcast'),
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
      {!biometricUnavailableReason ? (
        <TouchableOpacity
          style={[styles.biometricChoice, persistWithBiometrics && styles.biometricChoiceActive]}
          onPress={() => setPersistWithBiometrics((current) => !current)}
        >
          <Text style={styles.biometricTitle}>
            {persistWithBiometrics ? t('persist.biometricEnabled', { method: biometricMethod }) : t('persist.useBiometric', { method: biometricMethod })}
          </Text>
        </TouchableOpacity>
      ) : null}
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
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('receive.title')}</Text>
          <View style={styles.qrPlaceholder}>
            <QRCode value={wallet.address} size={204} quietZone={12} color="#071326" backgroundColor="#f8fbff" />
          </View>
          <Text style={styles.label}>{t('receive.bech32Address')}</Text>
          <Text selectable style={styles.address}>{wallet.address}</Text>
          <ActionButton label={t('actions.copyAddress')} loading={pendingAction === 'copy'} disabled={actionLocked} onPress={() => { void copyAddressToClipboard(); }} />
        </View>
      );
    }

    if (walletTab === 'send') {
      return (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('send.title')}</Text>
          <Text style={styles.body}>{t('send.body')}</Text>
          <View style={styles.destinationRow}>
            <TextInput
              value={sendAddress}
              onChangeText={(value) => {
                setSendAddress(value);
                setPreparedTx(null);
              }}
              placeholder={t('send.destination')}
              placeholderTextColor="#6d7892"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.destinationInput]}
            />
            <TouchableOpacity disabled={actionLocked} onPress={() => { void openQrScanner(); }} style={[styles.scanButton, actionLocked && styles.scanButtonDisabled]}>
              <Text style={styles.scanButtonText}>{t('actions.scanQr')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.amountRow}>
            <TextInput
              value={sendAmount}
              onChangeText={(value) => {
                setSendAmount(value);
                setPreparedTx(null);
              }}
              placeholder={t('send.amount')}
              placeholderTextColor="#6d7892"
              keyboardType="decimal-pad"
              style={[styles.input, styles.amountInput]}
            />
            <TouchableOpacity
              disabled={actionLocked || !network.snapshot || network.status === 'syncing' || !sendAddress.trim()}
              onPress={() => { void fillMaxSendAmount(); }}
              style={[
                styles.maxButton,
                (actionLocked || !network.snapshot || network.status === 'syncing' || !sendAddress.trim()) && styles.maxButtonDisabled,
              ]}
            >
              <Text style={styles.maxButtonText}>{t('actions.max')}</Text>
            </TouchableOpacity>
          </View>
          <ActionButton
            label={network.status === 'syncing' ? t('send.updating') : t('actions.prepareSend')}
            loading={pendingAction === 'prepare'}
            disabled={actionLocked || !network.snapshot || network.status === 'syncing' || !sendAddress.trim() || !sendAmount.trim()}
            onPress={prepareTransparentSend}
          />
          {preparedTx ? (
            <View style={styles.txBox}>
              <Text style={styles.label}>{t('send.transactionReady')}</Text>
              <Text style={styles.previewAddress}>{t('send.fee', { amount: satoshisToNito(preparedTx.feeSats) })}</Text>
              <Text style={styles.helper}>{t('send.inputsOutputs', { inputs: preparedTx.inputCount, outputs: preparedTx.outputCount })}</Text>
              <Text selectable style={styles.address}>{preparedTx.txid}</Text>
              <ActionButton
                label={broadcasting ? t('send.sending') : t('actions.sendNow')}
                loading={pendingAction === 'broadcast' || broadcasting}
                disabled={actionLocked || broadcasting}
                onPress={() => { void broadcastPreparedTx(); }}
              />
            </View>
          ) : null}
          <Text style={styles.helper}>
            {t('send.available', { amount: network.snapshot ? satoshisToNito(network.snapshot.spendableSats) : '0' })}
          </Text>
        </View>
      );
    }

    if (walletTab === 'history') {
      const historyEntries = network.snapshot?.history ?? [];
      const historyPageCount = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
      const activeHistoryPage = Math.min(historyPage, historyPageCount - 1);
      const visibleHistory = historyEntries.slice(
        activeHistoryPage * HISTORY_PAGE_SIZE,
        (activeHistoryPage + 1) * HISTORY_PAGE_SIZE,
      );
      return (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('history.title')}</Text>
          {!network.fullHistoryEnabled ? (
            <TouchableOpacity
              disabled={actionLocked || !network.snapshot || network.status === 'syncing'}
              onPress={confirmFullHistorySync}
              style={[
                styles.historySyncButton,
                (actionLocked || !network.snapshot || network.status === 'syncing') && styles.historySyncButtonDisabled,
              ]}
            >
              <View style={styles.historySyncButtonContent}>
                {pendingAction === 'history' || (network.status === 'syncing' && network.fullHistoryEnabled) ? (
                  <ActivityIndicator color="#dbeaff" size="small" />
                ) : null}
                <Text style={styles.historySyncButtonText}>
                  {network.status === 'syncing' && network.fullHistoryEnabled ? t('history.syncing') : t('actions.syncFullHistory')}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}
          {network.fullHistoryEnabled ? (
            <ActionButton
              label={t('actions.exportHistory')}
              variant="secondary"
              loading={pendingAction === 'history'}
              disabled={actionLocked || !network.snapshot}
              onPress={() => { void exportFullHistory(); }}
            />
          ) : null}
          {visibleHistory.length > 0 ? (
            <View style={styles.historyList}>
              {visibleHistory.map((entry) => (
                <TouchableOpacity
                  key={entry.txid}
                  style={styles.historyRow}
                  onPress={() => {
                    void Linking.openURL(transactionExplorerUrl(entry.txid));
                  }}
                >
                  <View style={styles.historyRowTop}>
                    <View style={styles.historyRowText}>
                      <Text style={styles.historyTxid}>{shortAddress(entry.txid)}</Text>
                      <Text style={styles.helper}>{entry.height > 0 ? t('history.block', { height: entry.height }) : t('history.mempool')}</Text>
                    </View>
                    <View style={styles.viewTxBadge}>
                      <Text style={styles.viewTxText}>{t('actions.viewTx')}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              {historyPageCount > 1 ? (
                <View style={styles.historyPagination}>
                  <TouchableOpacity
                    disabled={activeHistoryPage === 0 || actionLocked}
                    onPress={() => setHistoryPage((current) => Math.max(0, current - 1))}
                    style={[styles.historyPageButton, activeHistoryPage === 0 && styles.historyPageButtonDisabled]}
                  >
                    <Text style={styles.historyPageButtonText}>{t('actions.previousPage')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.historyPageLabel}>
                    {t('history.page', { current: activeHistoryPage + 1, total: historyPageCount })}
                  </Text>
                  <TouchableOpacity
                    disabled={activeHistoryPage >= historyPageCount - 1 || actionLocked}
                    onPress={() => setHistoryPage((current) => Math.min(historyPageCount - 1, current + 1))}
                    style={[
                      styles.historyPageButton,
                      activeHistoryPage >= historyPageCount - 1 && styles.historyPageButtonDisabled,
                    ]}
                  >
                    <Text style={styles.historyPageButtonText}>{t('actions.nextPage')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t('history.emptyTitle')}</Text>
              <Text style={styles.body}>{t('history.emptyBody')}</Text>
            </View>
          )}
        </View>
      );
    }

    if (walletTab === 'security') {
      return (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('security.title')}</Text>
          <View style={styles.tiles}>
            <View style={styles.tile}>
              <Text style={styles.label}>{t('security.vault')}</Text>
              <Text style={styles.tileValue}>{seedSaved ? t('wallet.protected') : t('wallet.needsProtection')}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.label}>{t('security.unlockMethod')}</Text>
              <Text style={styles.tileValue}>{vaultBiometricsEnabled ? biometricMethod : t('security.password')}</Text>
            </View>
          </View>
          <ActionButton label={t('actions.lockWallet')} variant="success" disabled={actionLocked} onPress={lockWallet} />
          <ActionButton label={showMnemonic ? t('actions.hideSeed') : t('actions.showSeed')} variant="secondary" disabled={actionLocked} onPress={toggleMnemonic} />
          {showMnemonic ? <Text selectable style={styles.mnemonic}>{wallet.mnemonic}</Text> : null}
          {seedSaved ? <ActionButton label={t('actions.deleteWallet')} variant="danger" disabled={actionLocked} onPress={askDeleteWallet} /> : null}
          {sensitiveAction ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>
                {sensitiveAction === 'reveal' ? t('security.confirmReveal') : t('security.confirmDelete')}
              </Text>
              {vaultUnlockMode === 'password' ? (
                <PasswordField
                  value={sensitivePassword}
                  onChangeText={setSensitivePassword}
                  placeholder={t('unlock.password')}
                  visible={showSensitivePassword}
                  onToggleVisible={() => setShowSensitivePassword((current) => !current)}
                  showLabel={t('actions.show')}
                  hideLabel={t('actions.hide')}
                />
              ) : (
                <Text style={styles.noticeText}>{t('security.biometricRequested', { method: biometricMethod })}</Text>
              )}
              <ActionButton
                label={sensitiveBusy ? t('security.checking') : t('actions.confirm')}
                loading={pendingAction === 'reveal' || pendingAction === 'delete' || sensitiveBusy}
                disabled={actionLocked || sensitiveBusy}
                onPress={() => { void confirmSensitiveAction(); }}
              />
              <ActionButton
                label={t('actions.cancel')}
                variant="ghost"
                disabled={actionLocked || sensitiveBusy}
                onPress={() => { setSensitiveAction(null); setSensitivePassword(''); }}
              />
            </View>
          ) : null}
          {languageSettings}
        </View>
      );
    }

    return (
      <View style={styles.card}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>{t('home.title')}</Text>
          <TouchableOpacity
            accessibilityLabel={t('actions.refreshBalance')}
            disabled={actionLocked || balanceRefreshing || network.status === 'syncing'}
            onPress={() => { void refreshBalance(); }}
            style={[styles.refreshButton, (actionLocked || balanceRefreshing || network.status === 'syncing') && styles.refreshButtonDisabled]}
          >
            <Text style={styles.refreshButtonText}>{'\u21bb'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.balanceCard}>
          <Text style={styles.balance}>
            {network.snapshot ? satoshisToNito(network.snapshot.spendableSats) + ' NITO' : '-- NITO'}
          </Text>
          {network.snapshot && network.snapshot.unconfirmedSats > 0 ? (
            <Text style={styles.pendingBalance}>
              {t('home.pendingBalance', { amount: satoshisToNito(network.snapshot.unconfirmedSats) })}
            </Text>
          ) : null}
          {balanceRefreshing ? (
            <View style={styles.balanceUpdating}>
              <Text style={styles.balanceHourglass}>{'\u231b'}</Text>
              <Text style={styles.balanceUpdatingText}>{t('home.updatingBalance')}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.preview}>
          <Text style={styles.label}>{t('home.mainAddress')}</Text>
          <Text style={styles.previewAddress}>{shortAddress(wallet.address)}</Text>
        </View>
        <ActionButton label={t('actions.receive')} onPress={() => setWalletTab('receive')} />
      </View>
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
      <SafeAreaView style={styles.safeArea}>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#020611',
  },
  keyboard: {
    flex: 1,
  },
  screen: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 34,
    gap: 18,
    backgroundColor: '#020611',
    overflow: 'hidden',
  },
  languageSettings: {
    marginTop: 8,
    gap: 10,
  },
  languageSettingsButton: {
    minHeight: 68,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(3, 9, 20, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(185, 204, 237, 0.12)',
  },
  languageSettingsText: {
    gap: 4,
  },
  languageCurrent: {
    color: '#f6f8ff',
    fontSize: 16,
    fontWeight: '800',
  },
  languageChevron: {
    color: '#7fb9ff',
    fontSize: 22,
    fontWeight: '900',
  },
  languageMenu: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(3, 9, 20, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(91, 166, 255, 0.24)',
  },
  languageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  languageOption: {
    width: '31%',
    borderRadius: 15,
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 3,
    backgroundColor: 'rgba(117, 139, 171, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(185, 204, 237, 0.12)',
  },
  languageOptionActive: {
    backgroundColor: 'rgba(245, 189, 49, 0.16)',
    borderColor: 'rgba(245, 189, 49, 0.52)',
  },
  languageOptionCode: {
    color: '#dbeaff',
    fontSize: 12,
    fontWeight: '900',
  },
  languageOptionCodeActive: {
    color: '#f6c44f',
  },
  languageOptionName: {
    color: '#9fb4d3',
    fontSize: 10,
    fontWeight: '700',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 50,
    elevation: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: 'rgba(2, 6, 17, 0.94)',
  },
  loadingLogoShell: {
    width: 112,
    height: 112,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#020611',
    borderWidth: 1,
    borderColor: 'rgba(91, 166, 255, 0.34)',
    shadowColor: '#0b62c7',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 30,
    elevation: 12,
  },
  loadingLogo: {
    width: 82,
    height: 82,
    borderRadius: 24,
  },
  loadingOverlayTitle: {
    color: '#f6f8ff',
    fontSize: 26,
    fontWeight: '900',
  },
  loadingOverlayText: {
    color: '#bdc9df',
    fontSize: 15,
    textAlign: 'center',
  },
  hero: {
    borderRadius: 34,
    padding: 22,
    backgroundColor: 'rgba(8, 18, 38, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(91, 166, 255, 0.28)',
    shadowColor: '#0b62c7',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 28,
    elevation: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#01040b',
  },
  brandText: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    color: '#f6c44f',
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: '800',
  },
  title: {
    color: '#f6f8ff',
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '900',
  },
  subtitle: {
    marginTop: 16,
    color: '#bdc9df',
    fontSize: 15,
    lineHeight: 22,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(117, 139, 171, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(185, 204, 237, 0.18)',
  },
  pillSuccess: {
    backgroundColor: 'rgba(37, 181, 121, 0.16)',
    borderColor: 'rgba(37, 181, 121, 0.42)',
  },
  pillWarning: {
    backgroundColor: 'rgba(246, 196, 79, 0.14)',
    borderColor: 'rgba(246, 196, 79, 0.36)',
  },
  pillText: {
    color: '#e8efff',
    fontSize: 12,
    fontWeight: '800',
  },
  pillWarningText: {
    color: '#ffdc81',
  },
  card: {
    borderRadius: 28,
    padding: 20,
    gap: 14,
    backgroundColor: 'rgba(9, 18, 33, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(155, 180, 217, 0.18)',
  },
  sectionTitle: {
    color: '#f6f8ff',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  refreshButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b203a', borderWidth: 1, borderColor: 'rgba(91, 166, 255, 0.54)' },
  refreshButtonDisabled: { opacity: 0.38 },
  refreshButtonText: { color: '#8cc6ff', fontSize: 25, lineHeight: 28, fontWeight: '800' },
  body: {
    color: '#bdc9df',
    fontSize: 15,
    lineHeight: 22,
  },
  helper: {
    color: '#8390a8',
    fontSize: 13,
    lineHeight: 19,
  },
  label: {
    color: '#8ea0bd',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  button: {
    minHeight: 54,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5bd31',
    shadowColor: '#f5bd31',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 4,
  },
  buttonSecondary: {
    backgroundColor: '#0b203a',
    borderWidth: 1,
    borderColor: 'rgba(75, 157, 255, 0.64)',
    shadowColor: '#2f81f7',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 2,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonSuccess: {
    backgroundColor: '#07351f',
    borderWidth: 1,
    borderColor: 'rgba(37, 181, 121, 0.58)',
    shadowOpacity: 0,
  },
  buttonDanger: {
    backgroundColor: '#39111c',
    borderWidth: 1,
    borderColor: 'rgba(255, 86, 110, 0.48)',
    shadowOpacity: 0,
  },
  buttonDisabled: {
    backgroundColor: '#161f31',
    borderWidth: 1,
    borderColor: 'rgba(126, 151, 188, 0.22)',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    backgroundColor: 'transparent',
  },
  buttonText: {
    color: '#0b101d',
    fontWeight: '900',
    fontSize: 15,
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: 'transparent',
    includeFontPadding: false,
  },
  buttonTextSecondary: {
    color: '#dbeaff',
  },
  buttonTextGhost: {
    color: '#9fb4d3',
  },
  buttonTextSuccess: {
    color: '#9ef2c9',
  },
  buttonTextDanger: {
    color: '#ff97a7',
  },
  buttonTextDisabled: {
    color: '#748198',
  },
  input: {
    minHeight: 54,
    borderRadius: 18,
    paddingHorizontal: 16,
    color: '#f7faff',
    backgroundColor: 'rgba(2, 6, 17, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(126, 151, 188, 0.28)',
    fontSize: 15,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  destinationRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  destinationInput: { flex: 1 },
  scanButton: { minWidth: 82, minHeight: 54, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b203a', borderWidth: 1, borderColor: 'rgba(91, 166, 255, 0.54)' },
  scanButtonDisabled: { opacity: 0.42 },
  scanButtonText: { color: '#8cc6ff', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  amountInput: {
    flex: 1,
  },
  maxButton: {
    minWidth: 72,
    minHeight: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(246, 196, 79, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(246, 196, 79, 0.58)',
  },
  maxButtonDisabled: {
    opacity: 0.42,
  },
  maxButtonText: {
    color: '#f6c44f',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: 'transparent',
    includeFontPadding: false,
  },
  passwordField: {
    minHeight: 54,
    borderRadius: 18,
    paddingLeft: 16,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 17, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(126, 151, 188, 0.28)',
  },
  passwordInput: {
    flex: 1,
    minHeight: 54,
    color: '#f7faff',
    fontSize: 15,
  },
  passwordToggle: {
    minHeight: 38,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(32, 118, 220, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(75, 157, 255, 0.32)',
  },
  passwordToggleText: {
    color: '#dbeaff',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: 'transparent',
    includeFontPadding: false,
  },
  seedInput: {
    minHeight: 150,
    borderRadius: 20,
    padding: 16,
    paddingRight: 84,
    color: '#f7faff',
    backgroundColor: 'rgba(2, 6, 17, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(126, 151, 188, 0.28)',
    fontSize: 15,
    lineHeight: 22,
  },
  seedInputShell: {
    position: 'relative',
  },
  seedInputHidden: {
    minHeight: 64,
    height: 64,
    paddingVertical: 12,
  },
  seedVisibilityButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    minWidth: 58,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(32, 118, 220, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(75, 157, 255, 0.32)',
  },
  seedVisibilityButtonText: {
    color: '#dbeaff',
    fontSize: 12,
    fontWeight: '900',
    includeFontPadding: false,
  },
  seedWordErrors: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  seedWordError: {
    color: '#ff9baa',
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: 'rgba(255, 86, 110, 0.14)',
    borderColor: 'rgba(255, 86, 110, 0.32)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  error: {
    color: '#ff9baa',
    backgroundColor: 'rgba(255, 86, 110, 0.14)',
    borderColor: 'rgba(255, 86, 110, 0.32)',
    borderWidth: 1,
    padding: 13,
    borderRadius: 16,
    lineHeight: 20,
  },
  status: {
    color: '#d8ffef',
    backgroundColor: 'rgba(37, 181, 121, 0.14)',
    borderColor: 'rgba(37, 181, 121, 0.32)',
    borderWidth: 1,
    padding: 13,
    borderRadius: 16,
    lineHeight: 20,
  },
  loadingPanel: {
    minHeight: 220,
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: 'rgba(9, 18, 33, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(155, 180, 217, 0.18)',
  },
  bootstrapLogo: {
    width: 104,
    height: 104,
    borderRadius: 30,
  },
  inlineLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notice: {
    borderRadius: 20,
    padding: 15,
    backgroundColor: 'rgba(246, 196, 79, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(246, 196, 79, 0.22)',
    gap: 6,
  },
  noticeTitle: {
    color: '#ffdc81',
    fontWeight: '900',
    fontSize: 14,
  },
  noticeText: {
    color: '#d3c7a1',
    fontSize: 13,
    lineHeight: 19,
  },
  biometricChoice: {
    borderRadius: 20,
    padding: 15,
    backgroundColor: 'rgba(2, 6, 17, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(126, 151, 188, 0.28)',
    gap: 6,
  },
  biometricChoiceActive: {
    borderColor: 'rgba(37, 181, 121, 0.62)',
    backgroundColor: 'rgba(37, 181, 121, 0.12)',
  },
  biometricTitle: {
    color: '#eff6ff',
    fontWeight: '900',
    fontSize: 15,
  },
  walletShell: {
    gap: 14,
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: 6,
    borderRadius: 22,
    backgroundColor: '#061020',
    borderWidth: 1,
    borderColor: 'rgba(155, 180, 217, 0.16)',
  },
  tab: {
    minHeight: 46,
    flexBasis: '30%',
    flexGrow: 1,
    borderRadius: 16,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabWide: {
    flexBasis: '46%',
  },
  tabActive: {
    backgroundColor: '#1f75d6',
    borderColor: '#6ab0ff',
  },
  tabText: {
    color: '#aebbd0',
    fontWeight: '900',
    fontSize: 13,
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: 'transparent',
    includeFontPadding: false,
  },
  tabTextActive: {
    color: '#ffffff',
  },
  balanceCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#071326',
    borderWidth: 1,
    borderColor: 'rgba(75, 157, 255, 0.26)',
    gap: 5,
  },
  balance: {
    color: '#f6f8ff',
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '900',
  },
  pendingBalance: {
    color: '#ffc52f',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  balanceUpdating: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 },
  balanceHourglass: { color: '#8cc6ff', fontSize: 15 },
  balanceUpdatingText: { color: '#8ea0bd', fontSize: 12, fontWeight: '700' },
  preview: {
    borderRadius: 20,
    padding: 15,
    backgroundColor: 'rgba(2, 6, 17, 0.62)',
    gap: 7,
  },
  txBox: {
    borderRadius: 20,
    padding: 15,
    backgroundColor: 'rgba(37, 181, 121, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(37, 181, 121, 0.36)',
    gap: 8,
  },
  previewAddress: {
    color: '#f7faff',
    fontSize: 18,
    fontWeight: '900',
  },
  address: {
    color: '#f7faff',
    fontSize: 16,
    lineHeight: 24,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    backgroundColor: 'rgba(2, 6, 17, 0.72)',
    borderRadius: 18,
    padding: 14,
  },
  qrPlaceholder: {
    width: 228,
    height: 228,
    alignSelf: 'center',
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fbff',
  },
  qrText: {
    color: '#0b101d',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 2,
  },
  empty: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: 'rgba(2, 6, 17, 0.62)',
    gap: 8,
  },
  emptyTitle: {
    color: '#f6f8ff',
    fontSize: 18,
    fontWeight: '900',
  },
  historyList: {
    gap: 10,
  },
  historyPagination: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  historyPageButton: {
    minHeight: 44,
    minWidth: 92,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(32, 118, 220, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(75, 157, 255, 0.42)',
  },
  historyPageButtonDisabled: {
    opacity: 0.4,
  },
  historyPageButtonText: {
    color: '#dbeaff',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  historyPageLabel: {
    flex: 1,
    color: '#91a4c3',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  historySyncButton: {
    minHeight: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: '#0b203a',
    borderWidth: 1,
    borderColor: 'rgba(91, 166, 255, 0.64)',
    shadowColor: '#2f81f7',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 2,
  },
  historySyncButtonDisabled: {
    opacity: 0.62,
  },
  historySyncButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: 'transparent',
  },
  historySyncButtonText: {
    color: '#dbeaff',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: 'transparent',
    includeFontPadding: false,
  },
  historyRow: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(2, 6, 17, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(126, 151, 188, 0.16)',
    gap: 4,
  },
  historyRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  historyRowText: {
    flex: 1,
    gap: 4,
  },
  historyTxid: {
    color: '#73b9ff',
    fontSize: 15,
    fontWeight: '900',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  viewTxBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(32, 118, 220, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(75, 157, 255, 0.38)',
  },
  viewTxText: {
    color: '#8cc6ff',
    fontWeight: '900',
    fontSize: 12,
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: 'transparent',
    includeFontPadding: false,
  },
  tiles: {
    flexDirection: 'row',
    gap: 10,
  },
  tile: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(2, 6, 17, 0.62)',
    gap: 5,
  },
  tileValue: {
    color: '#f7faff',
    fontSize: 15,
    fontWeight: '900',
  },
  mnemonic: {
    color: '#fff4d6',
    backgroundColor: 'rgba(246, 196, 79, 0.10)',
    borderColor: 'rgba(246, 196, 79, 0.24)',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    fontSize: 15,
    lineHeight: 23,
  },
  scannerSafeArea: { flex: 1, padding: 20, gap: 18, backgroundColor: '#020611' },
  scannerHeader: { gap: 6 },
  scannerTitle: { color: '#f6f8ff', fontSize: 25, fontWeight: '900' },
  scannerHint: { color: '#9fb4d3', fontSize: 14, lineHeight: 20 },
  cameraFrame: { flex: 1, minHeight: 320, borderRadius: 28, overflow: 'hidden', backgroundColor: '#071326', borderWidth: 1, borderColor: 'rgba(91, 166, 255, 0.42)' },
  camera: { flex: 1 },
  cameraGuide: { position: 'absolute', top: '22%', left: '12%', right: '12%', bottom: '22%', borderRadius: 24, borderWidth: 3, borderColor: '#f5bd31' },
  scannerError: { color: '#ff9baa', textAlign: 'center', fontSize: 14, fontWeight: '800' },
  scannerCloseButton: { minHeight: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b203a', borderWidth: 1, borderColor: 'rgba(91, 166, 255, 0.54)' },
  scannerCloseButtonText: { color: '#dbeaff', fontSize: 15, fontWeight: '900' },
});
