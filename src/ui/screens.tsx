import type { ReactNode } from 'react';
import { Animated, Image, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { LANGUAGES, type LanguageCode, type Translator } from '../i18n';
import type { SeedBackupChallenge } from '../services/seedBackup';
import { ActionButton, PasswordField } from './components';
import { useStyles, useThemeColor } from './themeContext';
import type { BiometricMethod, PendingAction, Wallet } from './types';

const NITO_LOGO = require('../../assets/nito-logo.png');

type Rotation = Animated.AnimatedInterpolation<string | number>;

export function Hero({ t }: { t: Translator }) {
  const styles = useStyles();
  return (
    <View style={styles.hero}>
      <View style={styles.brandRow}>
        <Image source={NITO_LOGO} style={styles.logo} resizeMode="contain" />
        <View style={styles.brandText}>
          <Text style={styles.title}>{t('brand.wallet')}</Text>
        </View>
      </View>
    </View>
  );
}

export function Feedback({ error, status }: { error: string; status: string }) {
  const styles = useStyles();
  return (
    <>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </>
  );
}

export function LoadingScreen({ t, rotation }: { t: Translator; rotation: Rotation }) {
  const styles = useStyles();
  return (
    <View style={styles.loadingPanel}>
      <Animated.Image
        source={NITO_LOGO}
        style={[styles.bootstrapLogo, { transform: [{ rotate: rotation }] }]}
        resizeMode="contain"
      />
      <Text style={styles.sectionTitle}>{t('loading.title')}</Text>
    </View>
  );
}

export function LoadingOverlay({
  title,
  message,
  rotation,
}: {
  title: string;
  message: string;
  rotation: Rotation;
}) {
  const styles = useStyles();
  return (
    <View style={styles.loadingOverlay} pointerEvents="auto">
      <View style={styles.loadingLogoShell}>
        <Animated.Image
          source={NITO_LOGO}
          style={[styles.loadingLogo, { transform: [{ rotate: rotation }] }]}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.loadingOverlayTitle}>{title}</Text>
      <Text style={styles.loadingOverlayText}>{message}</Text>
    </View>
  );
}

export function LanguageSettings({
  t,
  language,
  selectedLanguageName,
  open,
  onToggle,
  onSelect,
}: {
  t: Translator;
  language: LanguageCode;
  selectedLanguageName: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (next: LanguageCode) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.languageSettings}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.languageSettingsButton}
        onPress={onToggle}
      >
        <View style={styles.languageSettingsText}>
          <Text style={styles.label}>{t('language.title')}</Text>
          <Text style={styles.languageCurrent}>{selectedLanguageName}</Text>
        </View>
        <Text style={styles.languageChevron}>{open ? '⌃' : '⌄'}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.languageMenu}>
          <View style={styles.languageGrid}>
            {LANGUAGES.map((entry) => (
              <TouchableOpacity
                key={entry.code}
                style={[styles.languageOption, language === entry.code && styles.languageOptionActive]}
                onPress={() => onSelect(entry.code)}
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
}

export function LandingScreen({
  t,
  pendingAction,
  actionLocked,
  onCreate,
  onImport,
}: {
  t: Translator;
  pendingAction: PendingAction | null;
  actionLocked: boolean;
  onCreate: () => void;
  onImport: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('start.title')}</Text>
      <Text style={styles.body}>{t('start.body')}</Text>
      <ActionButton label={t('actions.createWallet')} loading={pendingAction === 'create'} disabled={actionLocked} onPress={onCreate} />
      <ActionButton label={t('actions.importSeed')} variant="secondary" disabled={actionLocked} onPress={onImport} />
    </View>
  );
}

export function ImportScreen({
  t,
  pendingAction,
  actionLocked,
  importText,
  importFieldError,
  onChangeImportText,
  showSeed,
  onToggleSeed,
  invalidWords,
  mnemonicStatus,
  mnemonicValid,
  onSubmit,
  onBack,
}: {
  t: Translator;
  pendingAction: PendingAction | null;
  actionLocked: boolean;
  importText: string;
  importFieldError: string;
  onChangeImportText: (value: string) => void;
  showSeed: boolean;
  onToggleSeed: () => void;
  invalidWords: { index: number; word: string }[];
  mnemonicStatus: string;
  mnemonicValid: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const styles = useStyles();
  const themeColor = useThemeColor();
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('import.title')}</Text>
      <Text style={styles.body}>{t('import.body')}</Text>
      <View style={styles.seedInputShell}>
        <TextInput
          value={importText}
          onChangeText={onChangeImportText}
          placeholder={t('import.placeholder')}
          placeholderTextColor={themeColor('#6d7892')}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="noExcludeDescendants"
          secureTextEntry={!showSeed}
          multiline={showSeed}
          textAlignVertical={showSeed ? 'top' : 'center'}
          style={[styles.seedInput, !showSeed && styles.seedInputHidden]}
        />
        <TouchableOpacity
          style={styles.seedVisibilityButton}
          onPress={onToggleSeed}
          accessibilityRole="button"
          accessibilityLabel={showSeed ? t('actions.hide') : t('actions.show')}
        >
          <Text style={styles.seedVisibilityButtonText}>
            {showSeed ? t('actions.hide') : t('actions.show')}
          </Text>
        </TouchableOpacity>
      </View>
      {importFieldError ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {importFieldError}
        </Text>
      ) : null}
      {invalidWords.length > 0 ? (
        <View style={styles.seedWordErrors} accessibilityLiveRegion="polite">
          {invalidWords.map((entry) => (
            <Text key={`${entry.index}:${entry.word}`} style={styles.seedWordError}>
              {`X #${entry.index + 1}${showSeed ? `: ${entry.word}` : ''}`}
            </Text>
          ))}
        </View>
      ) : null}
      {mnemonicStatus ? <Text style={styles.helper}>{mnemonicStatus}</Text> : null}
      <ActionButton label={t('actions.continue')} loading={pendingAction === 'import'} disabled={actionLocked || !mnemonicValid} onPress={onSubmit} />
      <ActionButton label={t('actions.back')} variant="ghost" disabled={actionLocked} onPress={onBack} />
    </View>
  );
}

export function UnlockScreen({
  t,
  pendingAction,
  actionLocked,
  biometricsEnabled,
  biometricMethod,
  password,
  passwordError,
  onChangePassword,
  showPassword,
  onToggleShowPassword,
  onUnlockWithBiometrics,
  onUnlockWithPassword,
}: {
  t: Translator;
  pendingAction: PendingAction | null;
  actionLocked: boolean;
  biometricsEnabled: boolean;
  biometricMethod: BiometricMethod;
  password: string;
  passwordError: string;
  onChangePassword: (value: string) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
  onUnlockWithBiometrics: () => void;
  onUnlockWithPassword: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('unlock.title')}</Text>
      {biometricsEnabled ? (
        <ActionButton
          label={t('unlock.withBiometric', { method: biometricMethod })}
          loading={pendingAction === 'unlock'}
          disabled={actionLocked}
          onPress={onUnlockWithBiometrics}
        />
      ) : null}
      <PasswordField
        value={password}
        onChangeText={onChangePassword}
        placeholder={t('unlock.password')}
        visible={showPassword}
        onToggleVisible={onToggleShowPassword}
        showLabel={t('actions.show')}
        hideLabel={t('actions.hide')}
        error={passwordError}
      />
      <ActionButton
        label={t('unlock.title')}
        variant={biometricsEnabled ? 'secondary' : 'primary'}
        loading={pendingAction === 'unlock'}
        disabled={actionLocked}
        onPress={onUnlockWithPassword}
      />
    </View>
  );
}

export function PersistScreen({
  t,
  pendingAction,
  actionLocked,
  busy,
  pendingWallet,
  seedBackupRequired,
  seedBackupConfirmationStep,
  seedBackupChallenges,
  seedBackupConfirmationError,
  onStartSeedBackupConfirmation,
  onShowSeedBackupAgain,
  onConfirmSeedBackupWord,
  password,
  passwordError,
  onChangePassword,
  showPassword,
  onToggleShowPassword,
  confirmPassword,
  confirmPasswordError,
  onChangeConfirmPassword,
  showConfirmPassword,
  onToggleShowConfirmPassword,
  onSubmit,
}: {
  t: Translator;
  pendingAction: PendingAction | null;
  actionLocked: boolean;
  busy: boolean;
  pendingWallet: Wallet | null;
  seedBackupRequired: boolean;
  seedBackupConfirmationStep: number;
  seedBackupChallenges: readonly SeedBackupChallenge[];
  seedBackupConfirmationError: string;
  onStartSeedBackupConfirmation: () => void;
  onShowSeedBackupAgain: () => void;
  onConfirmSeedBackupWord: (word: string) => void;
  password: string;
  passwordError: string;
  onChangePassword: (value: string) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
  confirmPassword: string;
  confirmPasswordError: string;
  onChangeConfirmPassword: (value: string) => void;
  showConfirmPassword: boolean;
  onToggleShowConfirmPassword: () => void;
  onSubmit: () => void;
}) {
  const styles = useStyles();
  const activeSeedBackupChallenge = (
    seedBackupRequired
    && seedBackupConfirmationStep >= 0
    && seedBackupConfirmationStep < seedBackupChallenges.length
  )
    ? seedBackupChallenges[seedBackupConfirmationStep]
    : null;
  const seedBackupConfirmed = (
    !seedBackupRequired
    || (
      seedBackupChallenges.length > 0
      && seedBackupConfirmationStep >= seedBackupChallenges.length
    )
  );

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('persist.title')}</Text>
      {seedBackupRequired && pendingWallet && seedBackupConfirmationStep < 0 ? (
        <>
          <Text style={styles.helper}>{t('persist.seedBackupInstruction')}</Text>
          <Text style={styles.mnemonic}>{pendingWallet.mnemonic}</Text>
          <ActionButton
            label={t('actions.confirmSeedBackup')}
            disabled={actionLocked}
            onPress={onStartSeedBackupConfirmation}
          />
        </>
      ) : null}
      {activeSeedBackupChallenge ? (
        <>
          <Text style={styles.helper}>
            {t('persist.seedBackupConfirmInstruction', {
              position: activeSeedBackupChallenge.wordIndex + 1,
            })}
          </Text>
          {activeSeedBackupChallenge.options.map((word) => (
            <ActionButton
              key={word}
              label={word}
              variant="secondary"
              disabled={actionLocked}
              onPress={() => onConfirmSeedBackupWord(word)}
            />
          ))}
          {seedBackupConfirmationError ? (
            <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
              {seedBackupConfirmationError}
            </Text>
          ) : null}
          <ActionButton
            label={t('actions.showSeed')}
            variant="ghost"
            disabled={actionLocked}
            onPress={onShowSeedBackupAgain}
          />
        </>
      ) : null}
      {seedBackupRequired && seedBackupConfirmed ? (
        <Text style={styles.helper}>{t('status.seedBackupVerified')}</Text>
      ) : null}
      {seedBackupConfirmed ? (
        <>
          <PasswordField
            value={password}
            onChangeText={onChangePassword}
            placeholder={t('persist.password')}
            visible={showPassword}
            onToggleVisible={onToggleShowPassword}
            showLabel={t('actions.show')}
            hideLabel={t('actions.hide')}
            error={passwordError}
          />
          <PasswordField
            value={confirmPassword}
            onChangeText={onChangeConfirmPassword}
            placeholder={t('persist.confirmPassword')}
            visible={showConfirmPassword}
            onToggleVisible={onToggleShowConfirmPassword}
            showLabel={t('actions.show')}
            hideLabel={t('actions.hide')}
            error={confirmPasswordError}
          />
          <ActionButton
            label={busy ? t('persist.protecting') : t('persist.protectOpen')}
            loading={pendingAction === 'protect' || busy}
            disabled={actionLocked || busy}
            onPress={onSubmit}
          />
        </>
      ) : null}
    </View>
  );
}

export function WalletShell({
  tabs,
  activeTab,
  onSelectTab,
  children,
}: {
  tabs: { key: string; label: string }[];
  activeTab: string;
  onSelectTab: (key: string) => void;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.walletShell}>
      <View style={styles.tabs}>
        {tabs.map((tab, index) => (
          <TouchableOpacity
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.key }}
            key={tab.key}
            style={[styles.tab, index >= 3 && styles.tabWide, activeTab === tab.key && styles.tabActive]}
            onPress={() => onSelectTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {children}
    </View>
  );
}
