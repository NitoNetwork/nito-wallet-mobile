import type { ReactNode } from 'react';
import { Animated, Image, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { LANGUAGES, type LanguageCode, type Translator } from '../i18n';
import { ActionButton, PasswordField } from './components';
import { styles } from './styles';
import type { BiometricMethod, PendingAction, Wallet } from './types';

const NITO_LOGO = require('../../assets/nito-logo.png');

type Rotation = Animated.AnimatedInterpolation<string | number>;

export function Hero({ t }: { t: Translator }) {
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
  return (
    <>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </>
  );
}

export function LoadingScreen({ t, rotation }: { t: Translator; rotation: Rotation }) {
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
  onChangeImportText: (value: string) => void;
  showSeed: boolean;
  onToggleSeed: () => void;
  invalidWords: { index: number; word: string }[];
  mnemonicStatus: string;
  mnemonicValid: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('import.title')}</Text>
      <Text style={styles.body}>{t('import.body')}</Text>
      <View style={styles.seedInputShell}>
        <TextInput
          value={importText}
          onChangeText={onChangeImportText}
          placeholder={t('import.placeholder')}
          placeholderTextColor="#6d7892"
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
  onChangePassword: (value: string) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
  onUnlockWithBiometrics: () => void;
  onUnlockWithPassword: () => void;
}) {
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
  showMnemonic,
  password,
  onChangePassword,
  showPassword,
  onToggleShowPassword,
  confirmPassword,
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
  showMnemonic: boolean;
  password: string;
  onChangePassword: (value: string) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
  confirmPassword: string;
  onChangeConfirmPassword: (value: string) => void;
  showConfirmPassword: boolean;
  onToggleShowConfirmPassword: () => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('persist.title')}</Text>
      {showMnemonic && pendingWallet ? <Text selectable style={styles.mnemonic}>{pendingWallet.mnemonic}</Text> : null}
      <PasswordField
        value={password}
        onChangeText={onChangePassword}
        placeholder={t('persist.password')}
        visible={showPassword}
        onToggleVisible={onToggleShowPassword}
        showLabel={t('actions.show')}
        hideLabel={t('actions.hide')}
      />
      <PasswordField
        value={confirmPassword}
        onChangeText={onChangeConfirmPassword}
        placeholder={t('persist.confirmPassword')}
        visible={showConfirmPassword}
        onToggleVisible={onToggleShowConfirmPassword}
        showLabel={t('actions.show')}
        hideLabel={t('actions.hide')}
      />
      <ActionButton
        label={busy ? t('persist.protecting') : t('persist.protectOpen')}
        loading={pendingAction === 'protect' || busy}
        disabled={actionLocked || busy}
        onPress={onSubmit}
      />
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
