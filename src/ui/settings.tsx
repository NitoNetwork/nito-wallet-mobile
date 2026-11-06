import Constants from 'expo-constants';
import { useState, type ReactNode } from 'react';
import {
  Linking,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  AUTO_LOCK_TIMEOUT_OPTIONS_MS,
  type AutoLockTimeoutMs,
} from '../constants/nito';
import type { LanguageCode, TranslationKey, Translator } from '../i18n';
import { formatLocalizedInteger } from '../i18n.amounts';
import { reportNonFinancialFailure } from '../services/diagnostics';
import type { ElectrumServerPreference } from '../services/electrumClientFactory';
import { ActionButton, MnemonicGrid, PasswordField } from './components';
import { RecoveryPhraseCopy } from './RecoveryPhraseCopy';
import type { WalletStyles } from './styles';
import { THEME_NAMES, type ThemeName } from './theme';
import { useStyles, useThemeColor } from './themeContext';
import type { BiometricMethod, NetworkState, PendingAction, Wallet } from './types';

type SettingsRoute = 'root' | 'security' | 'display' | 'network' | 'about' | 'danger';
type SensitiveAction = 'reveal' | 'delete' | 'enableBiometrics' | 'disableBiometrics' | null;

type SensitiveConfirmationControls = {
  vaultUnlockMode: 'password' | 'biometric';
  sensitiveAction: SensitiveAction;
  sensitivePassword: string;
  sensitivePasswordError: string;
  onChangeSensitivePassword: (value: string) => void;
  showSensitivePassword: boolean;
  onToggleSensitivePassword: () => void;
  sensitiveBusy: boolean;
  onConfirmSensitive: () => void;
  onCancelSensitive: () => void;
};

const APP_VERSION = Constants.expoConfig?.version ?? '—';
const DERIVATION_PATHS = ["m/44'", "m/49'", "m/84'", "m/86'"] as const;
const SOURCE_URL = 'https://github.com/NitoNetwork/nito-wallet-mobile';
const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE`;
const PRIVACY_URL = `${SOURCE_URL}/blob/main/PRIVACY.md`;
const AUTO_LOCK_LABEL_KEYS = {
  60_000: 'settings.autoLockOneMinute',
  300_000: 'settings.autoLockFiveMinutes',
  900_000: 'settings.autoLockFifteenMinutes',
} satisfies Record<AutoLockTimeoutMs, TranslationKey>;
const THEME_LABEL_KEYS = {
  dark: 'settings.themeDark',
  light: 'settings.themeLight',
} satisfies Record<ThemeName, TranslationKey>;
const NETWORK_STATUS_KEYS = {
  idle: 'settings.networkIdle',
  syncing: 'settings.networkSyncing',
  connected: 'settings.networkConnected',
  error: 'settings.networkError',
} satisfies Record<NetworkState['status'], TranslationKey>;
const NETWORK_STATUS_STYLE_KEYS = {
  idle: 'networkStatusError',
  syncing: 'networkStatusSyncing',
  connected: 'networkStatusConnected',
  error: 'networkStatusError',
} satisfies Record<NetworkState['status'], keyof WalletStyles>;

function SettingsHeader({
  t,
  title,
  onBack,
}: {
  t: Translator;
  title: string;
  onBack: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.settingsHeader}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('actions.back')}
        onPress={onBack}
        style={styles.settingsBackButton}
      >
        <Text style={styles.settingsBackText}>{'‹'}</Text>
      </TouchableOpacity>
      <Text style={styles.settingsHeaderTitle}>{title}</Text>
    </View>
  );
}

function SettingsNavigationRow({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.settingsNavigationRow, danger && styles.settingsNavigationRowDanger]}
    >
      <Text style={[styles.settingsNavigationLabel, danger && styles.settingsNavigationLabelDanger]}>
        {label}
      </Text>
      <Text style={[styles.settingsChevron, danger && styles.settingsNavigationLabelDanger]}>
        {'›'}
      </Text>
    </TouchableOpacity>
  );
}

function SettingsDisclosureRow({
  label,
  expanded,
  onPress,
}: {
  label: string;
  expanded: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={styles.settingsNavigationRow}
    >
      <Text style={styles.settingsNavigationLabel}>{label}</Text>
      <Text style={styles.settingsChevron}>{expanded ? '\u2303' : '\u2304'}</Text>
    </TouchableOpacity>
  );
}

function SettingsValue({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: StyleProp<TextStyle>;
}) {
  const styles = useStyles();
  return (
    <View style={styles.settingsValue}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={[styles.settingsValueText, valueStyle]}>{value}</Text>
    </View>
  );
}

function SensitiveConfirmation({
  t,
  pendingAction,
  actionLocked,
  biometricMethod,
  controls,
}: {
  t: Translator;
  pendingAction: PendingAction | null;
  actionLocked: boolean;
  biometricMethod: BiometricMethod;
  controls: SensitiveConfirmationControls;
}) {
  const styles = useStyles();
  const { sensitiveAction } = controls;
  if (!sensitiveAction) return null;

  return (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>
        {sensitiveAction === 'reveal'
          ? t('security.confirmReveal')
          : sensitiveAction === 'enableBiometrics'
            ? t('security.confirmEnableBiometric', { method: biometricMethod })
            : sensitiveAction === 'disableBiometrics'
              ? t('security.confirmDisableBiometric', { method: biometricMethod })
              : t('security.confirmDelete')}
      </Text>
      {controls.vaultUnlockMode === 'password' || sensitiveAction === 'disableBiometrics' ? (
        <PasswordField
          value={controls.sensitivePassword}
          onChangeText={controls.onChangeSensitivePassword}
          placeholder={t('unlock.password')}
          visible={controls.showSensitivePassword}
          onToggleVisible={controls.onToggleSensitivePassword}
          showLabel={t('actions.show')}
          hideLabel={t('actions.hide')}
          error={controls.sensitivePasswordError}
        />
      ) : (
        <Text style={styles.noticeText}>{t('security.biometricRequested', { method: biometricMethod })}</Text>
      )}
      <ActionButton
        label={controls.sensitiveBusy ? t('security.checking') : t('actions.confirm')}
        loading={pendingAction === 'reveal' || pendingAction === 'delete' || controls.sensitiveBusy}
        disabled={actionLocked || controls.sensitiveBusy}
        onPress={controls.onConfirmSensitive}
      />
      <ActionButton
        label={t('actions.cancel')}
        variant="ghost"
        disabled={actionLocked || controls.sensitiveBusy}
        onPress={controls.onCancelSensitive}
      />
    </View>
  );
}

function SecuritySettingsSection({
  t,
  actionLocked,
  pendingAction,
  settings,
  confirmation,
  onBack,
}: {
  t: Translator;
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  settings: {
    wallet: Wallet;
    seedSaved: boolean;
    vaultBiometricsEnabled: boolean;
    biometricMethod: BiometricMethod;
    showMnemonic: boolean;
    biometricAvailable: boolean;
    autoLockTimeoutMs: AutoLockTimeoutMs;
    onSelectAutoLockTimeout: (next: AutoLockTimeoutMs) => void;
    onToggleMnemonic: () => void;
    onEnableBiometrics: () => void;
    onDisableBiometrics: () => void;
  };
  confirmation: SensitiveConfirmationControls;
  onBack: () => void;
}) {
  const styles = useStyles();
  const [autoLockExpanded, setAutoLockExpanded] = useState(false);
  const securityConfirmation = confirmation.sensitiveAction === 'delete'
    ? { ...confirmation, sensitiveAction: null }
    : confirmation;

  return (
    <View style={styles.card}>
      <SettingsHeader t={t} title={t('settings.sectionSecurity')} onBack={onBack} />
      <View style={styles.tiles}>
        <View style={styles.tile}>
          <Text style={styles.label}>{t('security.vault')}</Text>
          <Text style={styles.tileValue}>
            {settings.seedSaved ? t('wallet.protected') : t('wallet.needsProtection')}
          </Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.label}>{t('security.unlockMethod')}</Text>
          <Text style={styles.tileValue}>
            {settings.vaultBiometricsEnabled ? settings.biometricMethod : t('security.password')}
          </Text>
        </View>
      </View>
      {settings.biometricAvailable ? (
        <ActionButton
          label={settings.vaultBiometricsEnabled
            ? t('actions.disableBiometric', { method: settings.biometricMethod })
            : t('actions.enableBiometric', { method: settings.biometricMethod })}
          variant="secondary"
          disabled={actionLocked}
          onPress={settings.vaultBiometricsEnabled
            ? settings.onDisableBiometrics
            : settings.onEnableBiometrics}
        />
      ) : null}
      <ActionButton
        label={settings.showMnemonic ? t('actions.hideSeed') : t('actions.showSeed')}
        variant="secondary"
        disabled={actionLocked}
        onPress={settings.onToggleMnemonic}
      />
      {settings.showMnemonic ? (
        <>
          <MnemonicGrid mnemonic={settings.wallet.mnemonic} />
          <RecoveryPhraseCopy mnemonic={settings.wallet.mnemonic} t={t} disabled={actionLocked} />
          {settings.wallet.bip39Passphrase ? (
            <Text style={styles.helper}>{t('persist.passphraseBackupReminder')}</Text>
          ) : null}
        </>
      ) : null}
      <SensitiveConfirmation
        t={t}
        pendingAction={pendingAction}
        actionLocked={actionLocked}
        biometricMethod={settings.biometricMethod}
        controls={securityConfirmation}
      />
      <SettingsDisclosureRow
        label={`${t('settings.autoLockTitle')}: ${t(AUTO_LOCK_LABEL_KEYS[settings.autoLockTimeoutMs])}`}
        expanded={autoLockExpanded}
        onPress={() => setAutoLockExpanded((current) => !current)}
      />
      {autoLockExpanded ? (
        <View style={styles.settingsOptionPanel}>
          <Text style={styles.helper}>{t('settings.autoLockHint')}</Text>
          <View style={styles.settingsChoiceList}>
            {AUTO_LOCK_TIMEOUT_OPTIONS_MS.map((option) => (
              <TouchableOpacity
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: settings.autoLockTimeoutMs === option }}
                disabled={actionLocked}
                onPress={() => {
                  settings.onSelectAutoLockTimeout(option);
                  setAutoLockExpanded(false);
                }}
                style={[
                  styles.settingsChoice,
                  settings.autoLockTimeoutMs === option && styles.settingsChoiceActive,
                  actionLocked && styles.settingsChoiceDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.settingsChoiceText,
                    settings.autoLockTimeoutMs === option && styles.settingsChoiceTextActive,
                  ]}
                >
                  {t(AUTO_LOCK_LABEL_KEYS[option])}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DisplaySettingsSection({
  t,
  languageSettings,
  theme,
  onSelectTheme,
  onBack,
}: {
  t: Translator;
  languageSettings: ReactNode;
  theme: ThemeName;
  onSelectTheme: (next: ThemeName) => void;
  onBack: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <SettingsHeader t={t} title={t('settings.sectionDisplay')} onBack={onBack} />
      {languageSettings}
      <View style={styles.settingsOptionPanel}>
        <Text style={styles.label}>{t('settings.themeTitle')}</Text>
        <View style={styles.settingsChoiceList}>
          {THEME_NAMES.map((option) => (
            <TouchableOpacity
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: theme === option }}
              onPress={() => onSelectTheme(option)}
              style={[
                styles.settingsChoice,
                theme === option && styles.settingsChoiceActive,
              ]}
            >
              <Text
                style={[
                  styles.settingsChoiceText,
                  theme === option && styles.settingsChoiceTextActive,
                ]}
              >
                {t(THEME_LABEL_KEYS[option])}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

function NetworkSettingsSection({
  t,
  language,
  actionLocked,
  pendingAction,
  network,
  electrumServerPreference,
  historyBusy,
  onUseCustomElectrumServer,
  onUseOfficialElectrumServers,
  onResynchronizeHistory,
  onBack,
}: {
  t: Translator;
  language: LanguageCode;
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  network: NetworkState;
  electrumServerPreference: ElectrumServerPreference;
  historyBusy: boolean;
  onUseCustomElectrumServer: (
    input: string,
    onValidationError: (message: string) => void,
  ) => string | null;
  onUseOfficialElectrumServers: () => void;
  onResynchronizeHistory: () => void;
  onBack: () => void;
}) {
  const styles = useStyles();
  const themeColor = useThemeColor();
  const server = network.serverUrl.replace(/^wss:\/\//i, '') || '—';
  const blockHeight = network.height > 0 ? formatLocalizedInteger(network.height, language) : '—';
  const [customServerInput, setCustomServerInput] = useState(
    electrumServerPreference.customServerUrl ?? '',
  );
  const [customServerError, setCustomServerError] = useState('');
  const [customElectrumExpanded, setCustomElectrumExpanded] = useState(false);
  const customElectrumState = electrumServerPreference.mode === 'custom'
    ? t('settings.customElectrumActive')
    : t('settings.customElectrumInactive');

  return (
    <View style={styles.card}>
      <SettingsHeader t={t} title={t('settings.sectionNetwork')} onBack={onBack} />
      <SettingsValue label={t('settings.server')} value={server} />
      <SettingsValue
        label={t('settings.connectionStatus')}
        value={t(NETWORK_STATUS_KEYS[network.status])}
        valueStyle={styles[NETWORK_STATUS_STYLE_KEYS[network.status]]}
      />
      <SettingsValue label={t('settings.blockHeight')} value={blockHeight} />
      <SettingsDisclosureRow
        label={`${t('settings.customElectrumTitle')}: ${customElectrumState}`}
        expanded={customElectrumExpanded}
        onPress={() => {
          if (customElectrumExpanded) {
            setCustomServerError('');
          }
          setCustomElectrumExpanded((current) => !current);
        }}
      />
      {customElectrumExpanded ? (
        <View style={styles.settingsOptionPanel}>
          {electrumServerPreference.mode !== 'official' ? (
            <>
              <ActionButton
                label={t('actions.useOfficialElectrum')}
                variant="secondary"
                loading={pendingAction === 'electrumServer'}
                disabled={actionLocked}
                onPress={onUseOfficialElectrumServers}
              />
              {electrumServerPreference.mode === 'recovery' ? (
                <Text style={styles.settingsWarning}>
                  {t('settings.customElectrumRecovery')}
                </Text>
              ) : null}
            </>
          ) : null}
          <Text style={styles.helper}>{t('settings.customElectrumHint')}</Text>
          <Text style={styles.settingsWarning}>{t('settings.customElectrumRisk')}</Text>
          <TextInput
            value={customServerInput}
            onChangeText={(value) => {
              setCustomServerInput(value);
              setCustomServerError('');
            }}
            placeholder="wss://host:port"
            placeholderTextColor={themeColor('#6d7892')}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          {customServerError ? (
            <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
              {customServerError}
            </Text>
          ) : null}
          <Text style={styles.settingsWarning}>
            {t('settings.customElectrumCertificateWarning')}
          </Text>
          <Text style={styles.helper}>{t('settings.customElectrumCacheHint')}</Text>
          <ActionButton
            label={t('actions.useCustomElectrum')}
            loading={pendingAction === 'electrumServer'}
            disabled={actionLocked || !customServerInput.trim()}
            onPress={() => {
              setCustomServerError(onUseCustomElectrumServer(
                customServerInput,
                setCustomServerError,
              ) ?? '');
            }}
          />
        </View>
      ) : null}
      <View style={styles.settingsOptionPanel}>
        <Text style={styles.helper}>{t('settings.resyncHistoryHint')}</Text>
        <ActionButton
          label={t('settings.resyncHistory')}
          variant="secondary"
          disabled={actionLocked || historyBusy || network.status === 'syncing'}
          onPress={onResynchronizeHistory}
        />
      </View>
    </View>
  );
}

function AboutLink({
  label,
  url,
}: {
  label: string;
  url: string;
}) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      accessibilityRole="link"
      onPress={() => {
        void Linking.openURL(url).catch((caught) => {
          reportNonFinancialFailure('settings external link', caught);
        });
      }}
      style={styles.settingsNavigationRow}
    >
      <Text style={styles.settingsNavigationLabel}>{label}</Text>
      <Text style={styles.settingsExternalLink}>{'↗'}</Text>
    </TouchableOpacity>
  );
}

function AboutSettingsSection({ t, onBack }: { t: Translator; onBack: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <SettingsHeader t={t} title={t('settings.sectionAbout')} onBack={onBack} />
      <SettingsValue label={t('settings.appVersion')} value={APP_VERSION} />
      <SettingsValue label={t('settings.derivationPaths')} value={DERIVATION_PATHS.join(' · ')} />
      <View style={styles.settingsList}>
        <AboutLink label={t('settings.license')} url={LICENSE_URL} />
        <AboutLink label={t('settings.privacy')} url={PRIVACY_URL} />
        <AboutLink label={t('settings.sourceCode')} url={SOURCE_URL} />
      </View>
    </View>
  );
}

function DangerSettingsSection({
  t,
  actionLocked,
  pendingAction,
  seedSaved,
  biometricMethod,
  confirmation,
  onAskDelete,
  onBack,
}: {
  t: Translator;
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  seedSaved: boolean;
  biometricMethod: BiometricMethod;
  confirmation: SensitiveConfirmationControls;
  onAskDelete: () => void;
  onBack: () => void;
}) {
  const styles = useStyles();
  const deleteConfirmation = confirmation.sensitiveAction === 'delete'
    ? confirmation
    : { ...confirmation, sensitiveAction: null };

  return (
    <View style={[styles.card, styles.settingsDangerCard]}>
      <SettingsHeader t={t} title={t('settings.sectionDanger')} onBack={onBack} />
      {seedSaved ? (
        <ActionButton
          label={t('actions.deleteWallet')}
          variant="danger"
          disabled={actionLocked}
          onPress={onAskDelete}
        />
      ) : null}
      <SensitiveConfirmation
        t={t}
        pendingAction={pendingAction}
        actionLocked={actionLocked}
        biometricMethod={biometricMethod}
        controls={deleteConfirmation}
      />
    </View>
  );
}

export function SecurityTab({
  t,
  language,
  actionLocked,
  pendingAction,
  security,
  confirmation,
  display,
  networkSettings,
  danger,
}: {
  t: Translator;
  language: LanguageCode;
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  security: {
    wallet: Wallet;
    seedSaved: boolean;
    vaultBiometricsEnabled: boolean;
    biometricMethod: BiometricMethod;
    showMnemonic: boolean;
    biometricAvailable: boolean;
    autoLockTimeoutMs: AutoLockTimeoutMs;
    onSelectAutoLockTimeout: (next: AutoLockTimeoutMs) => void;
    onToggleMnemonic: () => void;
    onEnableBiometrics: () => void;
    onDisableBiometrics: () => void;
  };
  confirmation: SensitiveConfirmationControls;
  display: {
    languageSettings: ReactNode;
    theme: ThemeName;
    onSelectTheme: (next: ThemeName) => void;
  };
  networkSettings: {
    network: NetworkState;
    pendingAction: PendingAction | null;
    electrumServerPreference: ElectrumServerPreference;
    historyBusy: boolean;
    onUseCustomElectrumServer: (
      input: string,
      onValidationError: (message: string) => void,
    ) => string | null;
    onUseOfficialElectrumServers: () => void;
    onResynchronizeHistory: () => void;
  };
  danger: {
    seedSaved: boolean;
    onAskDelete: () => void;
  };
}) {
  const styles = useStyles();
  const [route, setRoute] = useState<SettingsRoute>('root');
  const goBack = () => {
    confirmation.onCancelSensitive();
    if (route === 'security' && security.showMnemonic) {
      security.onToggleMnemonic();
    }
    setRoute('root');
  };

  if (route === 'security') {
    return (
      <SecuritySettingsSection
        t={t}
        actionLocked={actionLocked}
        pendingAction={pendingAction}
        settings={security}
        confirmation={confirmation}
        onBack={goBack}
      />
    );
  }
  if (route === 'display') {
    return (
      <DisplaySettingsSection
        t={t}
        languageSettings={display.languageSettings}
        theme={display.theme}
        onSelectTheme={display.onSelectTheme}
        onBack={goBack}
      />
    );
  }
  if (route === 'network') {
    return (
      <NetworkSettingsSection
        t={t}
        language={language}
        actionLocked={actionLocked}
        pendingAction={networkSettings.pendingAction}
        network={networkSettings.network}
        electrumServerPreference={networkSettings.electrumServerPreference}
        historyBusy={networkSettings.historyBusy}
        onUseCustomElectrumServer={networkSettings.onUseCustomElectrumServer}
        onUseOfficialElectrumServers={networkSettings.onUseOfficialElectrumServers}
        onResynchronizeHistory={networkSettings.onResynchronizeHistory}
        onBack={goBack}
      />
    );
  }
  if (route === 'about') {
    return <AboutSettingsSection t={t} onBack={goBack} />;
  }
  if (route === 'danger') {
    return (
      <DangerSettingsSection
        t={t}
        actionLocked={actionLocked}
        pendingAction={pendingAction}
        seedSaved={danger.seedSaved}
        biometricMethod={security.biometricMethod}
        confirmation={confirmation}
        onAskDelete={danger.onAskDelete}
        onBack={goBack}
      />
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('tabs.security')}</Text>
      <View style={styles.settingsList}>
        <SettingsNavigationRow
          label={t('settings.sectionSecurity')}
          onPress={() => setRoute('security')}
        />
        <SettingsNavigationRow
          label={t('settings.sectionDisplay')}
          onPress={() => setRoute('display')}
        />
        <SettingsNavigationRow
          label={t('settings.sectionNetwork')}
          onPress={() => setRoute('network')}
        />
        <SettingsNavigationRow
          label={t('settings.sectionAbout')}
          onPress={() => setRoute('about')}
        />
        <SettingsNavigationRow
          label={t('settings.sectionDanger')}
          danger
          onPress={() => setRoute('danger')}
        />
      </View>
    </View>
  );
}
