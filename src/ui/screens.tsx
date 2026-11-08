import { useState, type ReactNode } from 'react';
import { Animated, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { LANGUAGES, type LanguageCode, type Translator } from '../i18n';
import type { SeedBackupChallenge } from '../services/seedBackup';
import { ActionButton, MnemonicGrid, PasswordField } from './components';
import { RecoveryPhraseCopy } from './RecoveryPhraseCopy';
import { useStyles, useThemeColor } from './themeContext';
import { TYPOGRAPHY } from './typography';
import type { BiometricMethod, PendingAction, Wallet } from './types';

const NITO_LOGO = require('../../assets/nito-logo.png');

type Rotation = Animated.AnimatedInterpolation<string | number>;

const LANDING_STYLES = StyleSheet.create({
  diceOptionButton: {
    minHeight: 62,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  diceOptionText: {
    flex: 1,
    gap: 2,
  },
  diceOptionTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: TYPOGRAPHY.bold,
  },
  diceOptionSummary: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: TYPOGRAPHY.regular,
  },
  diceOptionChevron: {
    fontSize: 18,
  },
  diceOptionPanel: {
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  diceOptionBody: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: TYPOGRAPHY.regular,
  },
});

export function Hero({
  t,
  compact = false,
}: {
  t: Translator;
  compact?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.hero, compact && styles.heroCompact]}>
      <View style={styles.brandRow}>
        <Image
          source={NITO_LOGO}
          style={[styles.logo, compact && styles.heroCompactLogo]}
          resizeMode="contain"
        />
        <View style={styles.brandText}>
          <Text
            adjustsFontSizeToFit={compact}
            minimumFontScale={0.78}
            numberOfLines={1}
            style={[styles.title, compact && styles.heroCompactTitle]}
          >
            {t('brand.wallet')}
          </Text>
          {compact ? (
            <Text numberOfLines={1} style={styles.heroSubtitle}>
              {t('brand.nonCustodial')}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function Feedback({ error }: { error: string }) {
  const styles = useStyles();
  return error ? <Text style={styles.error}>{error}</Text> : null;
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

export function InitializationErrorScreen({
  t,
  onRetry,
}: {
  t: Translator;
  onRetry: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('errors.initializationFailed')}</Text>
      <Text style={styles.body}>{t('errors.walletStorageUnavailable')}</Text>
      <ActionButton label={t('actions.retry')} onPress={onRetry} />
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
  actionLocked,
  onCreate,
  onImport,
}: {
  t: Translator;
  actionLocked: boolean;
  onCreate: () => void;
  onImport: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('start.title')}</Text>
      <Text style={styles.body}>{t('start.body')}</Text>
      <ActionButton
        label={t('actions.createWallet')}
        disabled={actionLocked}
        onPress={onCreate}
      />
      <ActionButton
        label={t('actions.importSeed')}
        variant="secondary"
        disabled={actionLocked}
        onPress={onImport}
      />
    </View>
  );
}

export function CreateScreen({
  t,
  pendingAction,
  actionLocked,
  onCreate,
  onUsePhysicalDice,
  onBack,
  passphraseOpen,
  passphrase,
  confirmPassphrase,
  passphraseError,
  showPassphrase,
  showConfirmPassphrase,
  onTogglePassphraseOpen,
  onChangePassphrase,
  onChangeConfirmPassphrase,
  onToggleShowPassphrase,
  onToggleShowConfirmPassphrase,
}: {
  t: Translator;
  pendingAction: PendingAction | null;
  actionLocked: boolean;
  onCreate: () => void;
  onUsePhysicalDice: () => void;
  onBack: () => void;
  passphraseOpen: boolean;
  passphrase: string;
  confirmPassphrase: string;
  passphraseError: string;
  showPassphrase: boolean;
  showConfirmPassphrase: boolean;
  onTogglePassphraseOpen: () => void;
  onChangePassphrase: (value: string) => void;
  onChangeConfirmPassphrase: (value: string) => void;
  onToggleShowPassphrase: () => void;
  onToggleShowConfirmPassphrase: () => void;
}) {
  const styles = useStyles();
  const themeColor = useThemeColor();
  const [diceOptionOpen, setDiceOptionOpen] = useState(false);
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('actions.createWallet')}</Text>
      <Text style={styles.body}>{t('start.createOptionsBody')}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: passphraseOpen, disabled: actionLocked }}
        disabled={actionLocked}
        onPress={onTogglePassphraseOpen}
        style={[
          LANDING_STYLES.diceOptionButton,
          {
            backgroundColor: themeColor('#071326'),
            borderColor: themeColor('rgba(75, 157, 255, 0.32)'),
          },
        ]}
      >
        <View style={LANDING_STYLES.diceOptionText}>
          <Text style={[LANDING_STYLES.diceOptionTitle, { color: themeColor('#dbeaff') }]}>
            {t('passphrase.optionTitle')}
          </Text>
          <Text style={[LANDING_STYLES.diceOptionSummary, { color: themeColor('#9fb4d3') }]}>
            {t('passphrase.optionSummary')}
          </Text>
        </View>
        <Text
          accessible={false}
          style={[LANDING_STYLES.diceOptionChevron, { color: themeColor('#8cc6ff') }]}
        >
          {passphraseOpen ? '⌃' : '⌄'}
        </Text>
      </TouchableOpacity>
      {passphraseOpen ? (
        <View style={[
          LANDING_STYLES.diceOptionPanel,
          { backgroundColor: themeColor('rgba(2, 6, 17, 0.62)') },
        ]}>
          <Text style={[LANDING_STYLES.diceOptionBody, { color: themeColor('#bdc9df') }]}>
            {t('passphrase.warning')}
          </Text>
          <PasswordField
            value={passphrase}
            onChangeText={onChangePassphrase}
            placeholder={t('passphrase.placeholder')}
            visible={showPassphrase}
            onToggleVisible={onToggleShowPassphrase}
            showLabel={t('actions.show')}
            hideLabel={t('actions.hide')}
            disableAutofill
          />
          <PasswordField
            value={confirmPassphrase}
            onChangeText={onChangeConfirmPassphrase}
            placeholder={t('passphrase.confirmPlaceholder')}
            visible={showConfirmPassphrase}
            onToggleVisible={onToggleShowConfirmPassphrase}
            showLabel={t('actions.show')}
            hideLabel={t('actions.hide')}
            error={passphraseError}
            disableAutofill
          />
        </View>
      ) : null}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: diceOptionOpen, disabled: actionLocked }}
        disabled={actionLocked}
        onPress={() => setDiceOptionOpen((current) => !current)}
        style={[
          LANDING_STYLES.diceOptionButton,
          {
            backgroundColor: themeColor('#071326'),
            borderColor: themeColor('rgba(75, 157, 255, 0.32)'),
          },
        ]}
      >
        <View style={LANDING_STYLES.diceOptionText}>
          <Text style={[
            LANDING_STYLES.diceOptionTitle,
            { color: themeColor('#dbeaff') },
          ]}>
            {t('dice.optionTitle')}
          </Text>
          <Text style={[
            LANDING_STYLES.diceOptionSummary,
            { color: themeColor('#9fb4d3') },
          ]}>
            {t('dice.optionSummary')}
          </Text>
        </View>
        <Text
          accessible={false}
          style={[
            LANDING_STYLES.diceOptionChevron,
            { color: themeColor('#8cc6ff') },
          ]}
        >
          {diceOptionOpen ? '⌃' : '⌄'}
        </Text>
      </TouchableOpacity>
      {diceOptionOpen ? (
        <View style={[
          LANDING_STYLES.diceOptionPanel,
          { backgroundColor: themeColor('rgba(2, 6, 17, 0.62)') },
        ]}>
          <Text style={[
            LANDING_STYLES.diceOptionBody,
            { color: themeColor('#bdc9df') },
          ]}>
            {t('dice.optionBody')}
          </Text>
          <Text style={[
            LANDING_STYLES.diceOptionBody,
            { color: themeColor('#bdc9df') },
          ]}>
            {t('dice.optionMethod')}
          </Text>
          <ActionButton
            label={t('dice.start')}
            variant="secondary"
            disabled={actionLocked}
            onPress={onUsePhysicalDice}
          />
        </View>
      ) : null}
      <ActionButton
        label={t('actions.createWallet')}
        loading={pendingAction === 'create'}
        disabled={actionLocked}
        onPress={onCreate}
      />
      <ActionButton
        label={t('actions.back')}
        variant="ghost"
        disabled={actionLocked}
        onPress={onBack}
      />
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
  passphraseOpen,
  passphrase,
  showPassphrase,
  onTogglePassphraseOpen,
  onChangePassphrase,
  onToggleShowPassphrase,
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
  passphraseOpen: boolean;
  passphrase: string;
  showPassphrase: boolean;
  onTogglePassphraseOpen: () => void;
  onChangePassphrase: (value: string) => void;
  onToggleShowPassphrase: () => void;
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
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: passphraseOpen, disabled: actionLocked }}
        disabled={actionLocked}
        onPress={onTogglePassphraseOpen}
        style={[
          LANDING_STYLES.diceOptionButton,
          {
            backgroundColor: themeColor('#071326'),
            borderColor: themeColor('rgba(75, 157, 255, 0.32)'),
          },
        ]}
      >
        <View style={LANDING_STYLES.diceOptionText}>
          <Text style={[LANDING_STYLES.diceOptionTitle, { color: themeColor('#dbeaff') }]}>
            {t('passphrase.optionTitle')}
          </Text>
          <Text style={[LANDING_STYLES.diceOptionSummary, { color: themeColor('#9fb4d3') }]}>
            {t('passphrase.importSummary')}
          </Text>
        </View>
        <Text
          accessible={false}
          style={[LANDING_STYLES.diceOptionChevron, { color: themeColor('#8cc6ff') }]}
        >
          {passphraseOpen ? '⌃' : '⌄'}
        </Text>
      </TouchableOpacity>
      {passphraseOpen ? (
        <View style={[
          LANDING_STYLES.diceOptionPanel,
          { backgroundColor: themeColor('rgba(2, 6, 17, 0.62)') },
        ]}>
          <Text style={[LANDING_STYLES.diceOptionBody, { color: themeColor('#bdc9df') }]}>
            {t('passphrase.importWarning')}
          </Text>
          <PasswordField
            value={passphrase}
            onChangeText={onChangePassphrase}
            placeholder={t('passphrase.placeholder')}
            visible={showPassphrase}
            onToggleVisible={onToggleShowPassphrase}
            showLabel={t('actions.show')}
            hideLabel={t('actions.hide')}
            disableAutofill
          />
        </View>
      ) : null}
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
          <MnemonicGrid mnemonic={pendingWallet.mnemonic} />
          <RecoveryPhraseCopy mnemonic={pendingWallet.mnemonic} t={t} disabled={actionLocked} />
          {pendingWallet.bip39Passphrase ? (
            <Text style={styles.helper}>{t('persist.passphraseBackupReminder')}</Text>
          ) : null}
          {seedBackupConfirmationError ? (
            <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
              {seedBackupConfirmationError}
            </Text>
          ) : null}
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
        <Text style={styles.helper}>{t('persist.seedBackupVerified')}</Text>
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
  const icons: Record<string, string> = {
    home: '⌂',
    receive: '↓',
    send: '↗',
    history: '◷',
    security: '⚙',
  };
  return (
    <View style={styles.walletShell}>
      {children}
      <View style={styles.tabs}>
        {tabs.map((tab) => (
          <TouchableOpacity
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: activeTab === tab.key }}
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => onSelectTab(tab.key)}
          >
            <Text
              accessible={false}
              style={[styles.tabIcon, activeTab === tab.key && styles.tabIconActive]}
            >
              {icons[tab.key] ?? '•'}
            </Text>
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              numberOfLines={2}
              style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
