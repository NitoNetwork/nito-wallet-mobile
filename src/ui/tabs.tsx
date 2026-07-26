import Constants from 'expo-constants';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {
  AUTO_LOCK_TIMEOUT_OPTIONS_MS,
  CONSOLIDATION_MIN_UTXOS,
  type AutoLockTimeoutMs,
} from '../constants/nito';
import type { LanguageCode, TranslationKey, Translator } from '../i18n';
import { makeConsolidationTranslator } from '../i18n.consolidation';
import { HISTORY_PAGE_SIZE } from '../services/historyEnrichmentQueue';
import type { CachedTransactionOutput } from '../services/historyExport';
import { reportNonFinancialFailure } from '../services/diagnostics';
import type { ElectrumServerPreference } from '../services/electrumClientFactory';
import { loadTransactionOutputCache } from '../services/walletHistoryDb';
import { isTransparentUtxoSpendable } from '../wallet/coinbaseMaturity';
import { satoshisToNito } from '../wallet/transparentScan';
import type { PreparedTransparentConsolidation, PreparedTransparentTx } from '../wallet/transparentSend';
import { ActionButton, PasswordField } from './components';
import {
  BALANCE_DECIMAL_OPTIONS,
  canShowHistoryExport,
  formatHomeBalance,
  historyAmountBreakdown,
  historyPageFromInput,
  signedHistoryAmountLines,
  shortAddress,
  type BalanceDecimals,
} from './format';
import { styles } from './styles';
import type { BiometricMethod, NetworkState, PendingAction, Wallet } from './types';

export function ReceiveTab({ wallet, t, pendingAction, actionLocked, onCopyAddress }: {
  wallet: Wallet;
  t: Translator;
  pendingAction: PendingAction | null;
  actionLocked: boolean;
  onCopyAddress: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('receive.title')}</Text>
      <View style={styles.qrPlaceholder}>
        <QRCode value={wallet.address} size={204} quietZone={12} color="#071326" backgroundColor="#f8fbff" />
      </View>
      <Text style={styles.label}>{t('receive.bech32Address')}</Text>
      <Text selectable style={styles.address}>{wallet.address}</Text>
      <ActionButton label={t('actions.copyAddress')} loading={pendingAction === 'copy'} disabled={actionLocked} onPress={onCopyAddress} />
    </View>
  );
}

export function SendTab({
  t,
  language,
  network,
  actionLocked,
  pendingAction,
  broadcasting,
  sendAddress,
  sendAmount,
  preparedTx,
  preparedConsolidation,
  onChangeSendAddress,
  onChangeSendAmount,
  onOpenQrScanner,
  onFillMax,
  onPrepareSend,
  onBroadcastTx,
  onBroadcastConsolidation,
}: {
  t: Translator;
  language: LanguageCode;
  network: NetworkState;
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  broadcasting: boolean;
  sendAddress: string;
  sendAmount: string;
  preparedTx: PreparedTransparentTx | null;
  preparedConsolidation: PreparedTransparentConsolidation | null;
  onChangeSendAddress: (value: string) => void;
  onChangeSendAmount: (value: string) => void;
  onOpenQrScanner: () => void;
  onFillMax: () => void;
  onPrepareSend: () => void;
  onBroadcastTx: () => void;
  onBroadcastConsolidation: () => void;
}) {
  const consolidationT = makeConsolidationTranslator(language);
  const amountDisabled = actionLocked || !network.snapshot || network.status === 'syncing' || !sendAddress.trim();
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('send.title')}</Text>
      <Text style={styles.body}>{t('send.body')}</Text>
      <View style={styles.destinationRow}>
        <TextInput
          value={sendAddress}
          onChangeText={onChangeSendAddress}
          placeholder={t('send.destination')}
          placeholderTextColor="#6d7892"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, styles.destinationInput]}
        />
        <TouchableOpacity disabled={actionLocked} onPress={onOpenQrScanner} style={[styles.scanButton, actionLocked && styles.scanButtonDisabled]}>
          <Text style={styles.scanButtonText}>{t('actions.scanQr')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.amountRow}>
        <TextInput
          value={sendAmount}
          onChangeText={onChangeSendAmount}
          placeholder={t('send.amount')}
          placeholderTextColor="#6d7892"
          keyboardType="decimal-pad"
          style={[styles.input, styles.amountInput]}
        />
        <TouchableOpacity
          disabled={amountDisabled}
          onPress={onFillMax}
          style={[styles.maxButton, amountDisabled && styles.maxButtonDisabled]}
        >
          <Text style={styles.maxButtonText}>{t('actions.max')}</Text>
        </TouchableOpacity>
      </View>
      <ActionButton
        label={network.status === 'syncing' ? t('send.updating') : t('actions.prepareSend')}
        loading={pendingAction === 'prepare'}
        disabled={actionLocked || !network.snapshot || network.status === 'syncing' || !sendAddress.trim() || !sendAmount.trim()}
        onPress={onPrepareSend}
      />
      <Text style={styles.helper}>
        {t('send.available', { amount: network.snapshot ? satoshisToNito(network.snapshot.spendableSats) : '0' })}
      </Text>
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
            onPress={onBroadcastTx}
          />
        </View>
      ) : null}
      {preparedConsolidation ? (
        <View style={styles.txBox}>
          <Text style={styles.label}>{consolidationT('review')}</Text>
          <Text style={styles.previewAddress}>
            {`${consolidationT('transactions')}: ${preparedConsolidation.transactions.length}`}
          </Text>
          <Text style={styles.helper}>
            {`${consolidationT('inputs')}: ${preparedConsolidation.inputCount}`}
          </Text>
          <Text style={styles.helper}>
            {`${consolidationT('outputs')}: ${preparedConsolidation.outputCount}`}
          </Text>
          <Text style={styles.helper}>
            {`${consolidationT('fees')}: ${satoshisToNito(preparedConsolidation.totalFeeSats)} NITO`}
          </Text>
          <ActionButton
            label={consolidationT('send')}
            loading={pendingAction === 'broadcastConsolidation' || broadcasting}
            disabled={actionLocked || broadcasting}
            onPress={onBroadcastConsolidation}
          />
        </View>
      ) : null}
    </View>
  );
}

function HistoryLoadingStatus({
  t,
  historyProgress,
  indicatorSize,
}: {
  t: Translator;
  historyProgress: { done: number; total: number } | null;
  indicatorSize: 'small' | 'large';
}) {
  return (
    <View style={styles.historyLoadingStatus}>
      <ActivityIndicator
        accessibilityLabel={t('history.syncing')}
        color="#dbeaff"
        size={indicatorSize}
      />
      <Text style={styles.historyLoadingTitle}>{t('history.loading')}</Text>
      {historyProgress ? (
        <Text style={styles.historyLoadingCount}>
          {t('history.loadingCount', {
            done: historyProgress.done,
            total: historyProgress.total,
          })}
        </Text>
      ) : null}
    </View>
  );
}

export function HistoryTab({
  t,
  walletId,
  network,
  actionLocked,
  pendingAction,
  historyPage,
  historyProgress,
  historySyncing,
  onChangeHistoryPage,
  onExportHistory,
  onOpenTx,
}: {
  t: Translator;
  walletId: string;
  network: NetworkState;
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  historyPage: number;
  historyProgress: { done: number; total: number } | null;
  historySyncing: boolean;
  onChangeHistoryPage: (next: number) => void;
  onExportHistory: () => void;
  onOpenTx: (txid: string) => void;
}) {
  const historyEntries = network.snapshot?.history ?? [];
  const loading = network.status === 'syncing' || historyProgress !== null || historySyncing;
  const historyPageCount = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
  const activeHistoryPage = Math.min(historyPage, historyPageCount - 1);
  const [historyPageInput, setHistoryPageInput] = useState<string | null>(null);
  const visibleHistory = historyEntries.slice(
    activeHistoryPage * HISTORY_PAGE_SIZE,
    (activeHistoryPage + 1) * HISTORY_PAGE_SIZE,
  );
  const visibleTxidKey = visibleHistory.map((entry) => entry.txid).join(',');
  const outputPageKey = [
    walletId,
    activeHistoryPage,
    historyProgress === null && !historySyncing ? 'idle' : 'busy',
    visibleTxidKey,
  ].join(':');
  const [outputPage, setOutputPage] = useState<{
    key: string;
    outputsByTxid: Map<string, CachedTransactionOutput[]>;
  }>(() => ({ key: '', outputsByTxid: new Map() }));
  const outputsByTxid = outputPage.key === outputPageKey
    ? outputPage.outputsByTxid
    : new Map<string, CachedTransactionOutput[]>();
  const walletAddresses = network.snapshot?.addresses.map((address) => address.address) ?? [];
  const showHistoryExport = canShowHistoryExport({
    entries: historyEntries,
    historyProgress,
    historySyncing,
    networkStatus: network.status,
  });

  useEffect(() => {
    let current = true;
    const visibleTxids = visibleTxidKey ? visibleTxidKey.split(',') : [];
    if (visibleTxids.length === 0) {
      return () => {
        current = false;
      };
    }

    void loadTransactionOutputCache(walletId, visibleTxids)
      .then((outputs) => {
        if (!current) return;
        const nextOutputsByTxid = new Map<string, CachedTransactionOutput[]>();
        for (const output of outputs) {
          const transactionOutputs = nextOutputsByTxid.get(output.txid) ?? [];
          transactionOutputs.push(output);
          nextOutputsByTxid.set(output.txid, transactionOutputs);
        }
        setOutputPage({ key: outputPageKey, outputsByTxid: nextOutputsByTxid });
      })
      .catch((caught) => {
        reportNonFinancialFailure('visible history output cache read', caught);
      });

    return () => {
      current = false;
    };
  }, [outputPageKey, visibleTxidKey, walletId]);

  const commitHistoryPageInput = (value: string) => {
    const nextPage = historyPageFromInput(value, historyPageCount);
    setHistoryPageInput(null);
    if (nextPage === null) {
      return;
    }

    if (nextPage !== activeHistoryPage) {
      onChangeHistoryPage(nextPage);
    }
  };

  if (loading && historyEntries.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('history.title')}</Text>
        <View style={styles.empty}>
          <HistoryLoadingStatus t={t} historyProgress={historyProgress} indicatorSize="large" />
          {!historyProgress ? <Text style={styles.body}>{t('history.loadingHint')}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('history.title')}</Text>
      {loading ? (
        <HistoryLoadingStatus t={t} historyProgress={historyProgress} indicatorSize="small" />
      ) : null}
      {showHistoryExport ? (
        <ActionButton
          label={t('actions.exportHistory')}
          variant="secondary"
          loading={pendingAction === 'history'}
          disabled={actionLocked || !network.snapshot}
          onPress={onExportHistory}
        />
      ) : null}
      {visibleHistory.length > 0 ? (
        <View style={styles.historyList}>
          {visibleHistory.map((entry) => {
            const amountBreakdown = entry.direction === undefined
              ? null
              : historyAmountBreakdown({
                direction: entry.direction,
                totalSats: entry.amountSats ?? 0,
                outputs: outputsByTxid.get(entry.txid) ?? [],
                walletAddresses,
              });
            const amountLines = amountBreakdown && entry.direction
              ? signedHistoryAmountLines(
                entry.direction,
                amountBreakdown.amountsSats.map(satoshisToNito),
              )
              : [];
            if (amountBreakdown && amountBreakdown.hiddenOutputCount > 0) {
              amountLines.push(t('history.moreOutputs', {
                count: amountBreakdown.hiddenOutputCount,
              }));
            }

            return (
              <TouchableOpacity
                key={entry.txid}
                style={styles.historyRow}
                onPress={() => { onOpenTx(entry.txid); }}
              >
                <View style={styles.historyRowTop}>
                  <View style={styles.historyRowText}>
                    <Text style={styles.historyTxid}>
                      {entry.direction === undefined
                        ? shortAddress(entry.txid)
                        : amountLines.join('\n')}
                    </Text>
                    <Text style={styles.helper}>
                      {[
                        entry.direction === 'received'
                          ? t('history.received')
                          : entry.direction === 'sent'
                            ? t('history.sent')
                            : entry.direction === 'self'
                              ? t('history.self')
                              : '',
                        entry.height > 0 ? t('history.block', { height: entry.height }) : t('history.mempool'),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={styles.viewTxBadge}>
                    <Text style={styles.viewTxText}>{t('actions.viewTx')}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
          {historyPageCount > 1 ? (
            <View style={styles.historyPagination}>
              <TouchableOpacity
                disabled={activeHistoryPage === 0 || actionLocked}
                onPress={() => onChangeHistoryPage(Math.max(0, activeHistoryPage - 1))}
                style={[
                  styles.historyPageButton,
                  (activeHistoryPage === 0 || actionLocked) && styles.historyPageButtonDisabled,
                ]}
              >
                <Text style={styles.historyPageButtonText}>{t('actions.previousPage')}</Text>
              </TouchableOpacity>
              <View style={styles.historyPageInputContainer}>
                <TextInput
                  accessibilityLabel={t('history.pageInputLabel')}
                  accessibilityHint={t('history.pageInputHint', { total: historyPageCount })}
                  accessibilityState={{ disabled: actionLocked }}
                  accessibilityValue={{
                    text: t('history.page', {
                      current: activeHistoryPage + 1,
                      total: historyPageCount,
                    }),
                  }}
                  value={historyPageInput ?? String(activeHistoryPage + 1)}
                  onChangeText={setHistoryPageInput}
                  onEndEditing={(event) => commitHistoryPageInput(event.nativeEvent.text)}
                  editable={!actionLocked}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  selectTextOnFocus
                  style={styles.historyPageInput}
                />
                <Text style={styles.historyPageTotal}>{`/ ${historyPageCount}`}</Text>
              </View>
              <TouchableOpacity
                disabled={activeHistoryPage >= historyPageCount - 1 || actionLocked}
                onPress={() => onChangeHistoryPage(Math.min(historyPageCount - 1, activeHistoryPage + 1))}
                style={[
                  styles.historyPageButton,
                  (activeHistoryPage >= historyPageCount - 1 || actionLocked)
                    && styles.historyPageButtonDisabled,
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

type SettingsRoute = 'root' | 'security' | 'display' | 'network' | 'about' | 'danger';
type SensitiveAction = 'reveal' | 'delete' | 'enableBiometrics' | 'disableBiometrics' | null;

type SensitiveConfirmationControls = {
  vaultUnlockMode: 'password' | 'biometric';
  sensitiveAction: SensitiveAction;
  sensitivePassword: string;
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
  0: 'settings.autoLockImmediate',
  60_000: 'settings.autoLockOneMinute',
  300_000: 'settings.autoLockFiveMinutes',
  900_000: 'settings.autoLockFifteenMinutes',
} satisfies Record<AutoLockTimeoutMs, TranslationKey>;
const NETWORK_STATUS_KEYS = {
  idle: 'settings.networkIdle',
  syncing: 'settings.networkSyncing',
  connected: 'settings.networkConnected',
  error: 'settings.networkError',
} satisfies Record<NetworkState['status'], TranslationKey>;

function SettingsHeader({
  t,
  title,
  onBack,
}: {
  t: Translator;
  title: string;
  onBack: () => void;
}) {
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

function SettingsValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.settingsValue}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.settingsValueText}>{value}</Text>
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
    onLockWallet: () => void;
    onToggleMnemonic: () => void;
    onEnableBiometrics: () => void;
    onDisableBiometrics: () => void;
  };
  confirmation: SensitiveConfirmationControls;
  onBack: () => void;
}) {
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
        label={t('actions.lockWallet')}
        variant="success"
        disabled={actionLocked}
        onPress={settings.onLockWallet}
      />
      <ActionButton
        label={settings.showMnemonic ? t('actions.hideSeed') : t('actions.showSeed')}
        variant="secondary"
        disabled={actionLocked}
        onPress={settings.onToggleMnemonic}
      />
      {settings.showMnemonic ? (
        <Text selectable style={styles.mnemonic}>{settings.wallet.mnemonic}</Text>
      ) : null}
      <SensitiveConfirmation
        t={t}
        pendingAction={pendingAction}
        actionLocked={actionLocked}
        biometricMethod={settings.biometricMethod}
        controls={securityConfirmation}
      />
      <View style={styles.settingsOptionPanel}>
        <Text style={styles.label}>{t('settings.autoLockTitle')}</Text>
        <Text style={styles.helper}>{t('settings.autoLockHint')}</Text>
        <View style={styles.settingsChoiceList}>
          {AUTO_LOCK_TIMEOUT_OPTIONS_MS.map((option) => (
            <TouchableOpacity
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: settings.autoLockTimeoutMs === option }}
              disabled={actionLocked}
              onPress={() => settings.onSelectAutoLockTimeout(option)}
              style={[
                styles.settingsChoice,
                settings.autoLockTimeoutMs === option && styles.settingsChoiceActive,
                actionLocked && styles.balanceDecimalsOptionDisabled,
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
    </View>
  );
}

function DisplaySettingsSection({
  t,
  actionLocked,
  languageSettings,
  balanceDecimals,
  onSelectBalanceDecimals,
  onBack,
}: {
  t: Translator;
  actionLocked: boolean;
  languageSettings: ReactNode;
  balanceDecimals: BalanceDecimals;
  onSelectBalanceDecimals: (next: BalanceDecimals) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.card}>
      <SettingsHeader t={t} title={t('settings.sectionDisplay')} onBack={onBack} />
      {languageSettings}
      <View style={styles.balanceDecimalsSettings}>
        <Text style={styles.label}>{t('security.balanceDecimalsTitle')}</Text>
        <Text style={styles.helper}>{t('security.balanceDecimalsHint')}</Text>
        <View style={styles.balanceDecimalsOptions}>
          {BALANCE_DECIMAL_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option}
              accessibilityRole="button"
              accessibilityLabel={t('security.balanceDecimalsOption', { count: option })}
              accessibilityState={{ selected: balanceDecimals === option, disabled: actionLocked }}
              disabled={actionLocked}
              onPress={() => onSelectBalanceDecimals(option)}
              style={[
                styles.balanceDecimalsOption,
                balanceDecimals === option && styles.balanceDecimalsOptionActive,
                actionLocked && styles.balanceDecimalsOptionDisabled,
              ]}
            >
              <Text
                style={[
                  styles.balanceDecimalsOptionText,
                  balanceDecimals === option && styles.balanceDecimalsOptionTextActive,
                ]}
              >
                {option}
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
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  network: NetworkState;
  electrumServerPreference: ElectrumServerPreference;
  historyBusy: boolean;
  onUseCustomElectrumServer: (input: string) => void;
  onUseOfficialElectrumServers: () => void;
  onResynchronizeHistory: () => void;
  onBack: () => void;
}) {
  const server = network.serverUrl.replace(/^wss:\/\//i, '') || '—';
  const blockHeight = network.height > 0 ? network.height.toLocaleString('fr-FR') : '—';
  const [customServerInput, setCustomServerInput] = useState(
    electrumServerPreference.customServerUrl ?? '',
  );

  return (
    <View style={styles.card}>
      <SettingsHeader t={t} title={t('settings.sectionNetwork')} onBack={onBack} />
      <SettingsValue label={t('settings.server')} value={server} />
      <SettingsValue
        label={t('settings.connectionStatus')}
        value={t(NETWORK_STATUS_KEYS[network.status])}
      />
      <SettingsValue label={t('settings.blockHeight')} value={blockHeight} />
      <View style={styles.settingsOptionPanel}>
        <Text style={styles.label}>{t('settings.customElectrumTitle')}</Text>
        <Text style={styles.helper}>{t('settings.customElectrumHint')}</Text>
        <Text style={styles.settingsWarning}>{t('settings.customElectrumRisk')}</Text>
        <TextInput
          value={customServerInput}
          onChangeText={setCustomServerInput}
          placeholder="wss://host:port"
          placeholderTextColor="#6d7892"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.settingsWarning}>
          {t('settings.customElectrumCertificateWarning')}
        </Text>
        <Text style={styles.helper}>{t('settings.customElectrumCacheHint')}</Text>
        <ActionButton
          label={t('actions.useCustomElectrum')}
          loading={pendingAction === 'electrumServer'}
          disabled={actionLocked || !customServerInput.trim()}
          onPress={() => onUseCustomElectrumServer(customServerInput)}
        />
        {electrumServerPreference.mode !== 'official' ? (
          <>
            {electrumServerPreference.mode === 'recovery' ? (
              <Text style={styles.settingsWarning}>
                {t('settings.customElectrumRecovery')}
              </Text>
            ) : null}
            <ActionButton
              label={t('actions.useOfficialElectrum')}
              variant="secondary"
              loading={pendingAction === 'electrumServer'}
              disabled={actionLocked}
              onPress={onUseOfficialElectrumServers}
            />
          </>
        ) : null}
      </View>
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
  actionLocked,
  pendingAction,
  security,
  confirmation,
  display,
  networkSettings,
  danger,
}: {
  t: Translator;
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
    onLockWallet: () => void;
    onToggleMnemonic: () => void;
    onEnableBiometrics: () => void;
    onDisableBiometrics: () => void;
  };
  confirmation: SensitiveConfirmationControls;
  display: {
    languageSettings: ReactNode;
    balanceDecimals: BalanceDecimals;
    onSelectBalanceDecimals: (next: BalanceDecimals) => void;
  };
  networkSettings: {
    network: NetworkState;
    pendingAction: PendingAction | null;
    electrumServerPreference: ElectrumServerPreference;
    historyBusy: boolean;
    onUseCustomElectrumServer: (input: string) => void;
    onUseOfficialElectrumServers: () => void;
    onResynchronizeHistory: () => void;
  };
  danger: {
    seedSaved: boolean;
    onAskDelete: () => void;
  };
}) {
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
        actionLocked={actionLocked}
        languageSettings={display.languageSettings}
        balanceDecimals={display.balanceDecimals}
        onSelectBalanceDecimals={display.onSelectBalanceDecimals}
        onBack={goBack}
      />
    );
  }
  if (route === 'network') {
    return (
      <NetworkSettingsSection
        t={t}
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

export function HomeTab({
  t,
  language,
  wallet,
  network,
  actionLocked,
  pendingAction,
  balanceRefreshing,
  balanceDecimals,
  preparedConsolidation,
  onRefreshBalance,
  onConfirmConsolidation,
}: {
  t: Translator;
  language: LanguageCode;
  wallet: Wallet;
  network: NetworkState;
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  balanceRefreshing: boolean;
  balanceDecimals: BalanceDecimals;
  preparedConsolidation: PreparedTransparentConsolidation | null;
  onRefreshBalance: () => void;
  onConfirmConsolidation: () => void;
}) {
  const spendableAddressSet = new Set(
    (network.snapshot?.spendableAddresses ?? []).map((address) => address.address),
  );
  const eligibleUtxos = (network.snapshot?.utxos ?? []).filter(
    (utxo) => isTransparentUtxoSpendable(utxo) && spendableAddressSet.has(utxo.address),
  );
  const refreshDisabled = actionLocked || balanceRefreshing || network.status === 'syncing';
  const balanceDisplay = network.snapshot
    ? formatHomeBalance(network.snapshot.spendableSats, balanceDecimals)
    : { text: '--' };

  return (
    <View style={styles.card}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{t('home.title')}</Text>
        <TouchableOpacity
          accessibilityLabel={t('actions.refreshBalance')}
          disabled={refreshDisabled}
          onPress={onRefreshBalance}
          style={[styles.refreshButton, refreshDisabled && styles.refreshButtonDisabled]}
        >
          <Text style={styles.refreshButtonText}>{'↻'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.balanceCard}>
        <Text
          style={styles.balance}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.65}
        >
          {balanceDisplay.text}
        </Text>
        {network.snapshot && network.snapshot.unconfirmedSats > 0 ? (
          <Text style={styles.pendingBalance}>
            {t('home.pendingBalance', { amount: satoshisToNito(network.snapshot.unconfirmedSats) })}
          </Text>
        ) : null}
        {network.snapshot && (network.snapshot.immatureCoinbaseSats ?? 0) > 0 ? (
          <Text style={styles.immatureCoinbaseBalance}>
            {t('home.immatureMiningRewards', {
              amount: satoshisToNito(network.snapshot.immatureCoinbaseSats ?? 0),
            })}
            {'\n'}
            {t('home.coinbaseBlocksRemaining', {
              blocks: network.snapshot.immatureCoinbaseBlocksRemaining ?? 0,
            })}
          </Text>
        ) : null}
        {balanceRefreshing ? (
          <View style={styles.balanceUpdating}>
            <Text style={styles.balanceHourglass}>{'⌛'}</Text>
            <Text style={styles.balanceUpdatingText}>{t('home.updatingBalance')}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.preview}>
        <Text style={styles.label}>{t('home.mainAddress')}</Text>
        <Text style={styles.previewAddress}>{shortAddress(wallet.address)}</Text>
      </View>
      {!preparedConsolidation && network.snapshot && eligibleUtxos.length >= CONSOLIDATION_MIN_UTXOS ? (
        <ActionButton
          label={makeConsolidationTranslator(language)('action')}
          onPress={onConfirmConsolidation}
          variant="secondary"
          disabled={actionLocked || network.status === 'syncing'}
          loading={pendingAction === 'consolidate'}
        />
      ) : null}
    </View>
  );
}
