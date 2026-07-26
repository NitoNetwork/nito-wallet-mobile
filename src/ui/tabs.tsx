import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { CONSOLIDATION_MIN_UTXOS } from '../constants/nito';
import type { LanguageCode, Translator } from '../i18n';
import { makeConsolidationTranslator } from '../i18n.consolidation';
import { HISTORY_PAGE_SIZE } from '../services/historyEnrichmentQueue';
import { isTransparentUtxoSpendable } from '../wallet/coinbaseMaturity';
import { satoshisToNito } from '../wallet/transparentScan';
import type { PreparedTransparentConsolidation, PreparedTransparentTx } from '../wallet/transparentSend';
import { ActionButton, PasswordField } from './components';
import {
  BALANCE_DECIMAL_OPTIONS,
  canShowHistoryExport,
  formatHomeBalance,
  historyPageFromInput,
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
  const showHistoryExport = canShowHistoryExport({
    entries: historyEntries,
    historyProgress,
    historySyncing,
    networkStatus: network.status,
  });

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
          {visibleHistory.map((entry) => (
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
                      : `${entry.direction === 'received' ? '+' : entry.direction === 'sent' ? '−' : ''}${satoshisToNito(entry.amountSats ?? 0)} NITO`}
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
          ))}
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

export function SecurityTab({
  t,
  wallet,
  seedSaved,
  actionLocked,
  pendingAction,
  vaultBiometricsEnabled,
  biometricMethod,
  showMnemonic,
  vaultUnlockMode,
  sensitiveAction,
  sensitivePassword,
  onChangeSensitivePassword,
  showSensitivePassword,
  onToggleSensitivePassword,
  sensitiveBusy,
  onLockWallet,
  onToggleMnemonic,
  onAskDelete,
  onConfirmSensitive,
  onCancelSensitive,
  languageSettings,
  balanceDecimals,
  onSelectBalanceDecimals,
  biometricAvailable,
  onEnableBiometrics,
  onDisableBiometrics,
}: {
  t: Translator;
  wallet: Wallet;
  seedSaved: boolean;
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  vaultBiometricsEnabled: boolean;
  biometricMethod: BiometricMethod;
  showMnemonic: boolean;
  vaultUnlockMode: 'password' | 'biometric';
  sensitiveAction: 'reveal' | 'delete' | 'enableBiometrics' | 'disableBiometrics' | null;
  sensitivePassword: string;
  onChangeSensitivePassword: (value: string) => void;
  showSensitivePassword: boolean;
  onToggleSensitivePassword: () => void;
  sensitiveBusy: boolean;
  onLockWallet: () => void;
  onToggleMnemonic: () => void;
  onAskDelete: () => void;
  onConfirmSensitive: () => void;
  onCancelSensitive: () => void;
  languageSettings: ReactNode;
  balanceDecimals: BalanceDecimals;
  onSelectBalanceDecimals: (next: BalanceDecimals) => void;
  biometricAvailable: boolean;
  onEnableBiometrics: () => void;
  onDisableBiometrics: () => void;
}) {
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
      <ActionButton label={t('actions.lockWallet')} variant="success" disabled={actionLocked} onPress={onLockWallet} />
      {biometricAvailable ? (
        <ActionButton
          label={vaultBiometricsEnabled
            ? t('actions.disableBiometric', { method: biometricMethod })
            : t('actions.enableBiometric', { method: biometricMethod })}
          variant="secondary"
          disabled={actionLocked}
          onPress={vaultBiometricsEnabled ? onDisableBiometrics : onEnableBiometrics}
        />
      ) : null}
      <ActionButton label={showMnemonic ? t('actions.hideSeed') : t('actions.showSeed')} variant="secondary" disabled={actionLocked} onPress={onToggleMnemonic} />
      {showMnemonic ? <Text selectable style={styles.mnemonic}>{wallet.mnemonic}</Text> : null}
      {seedSaved ? <ActionButton label={t('actions.deleteWallet')} variant="danger" disabled={actionLocked} onPress={onAskDelete} /> : null}
      {sensitiveAction ? (
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
          {vaultUnlockMode === 'password' || sensitiveAction === 'disableBiometrics' ? (
            <PasswordField
              value={sensitivePassword}
              onChangeText={onChangeSensitivePassword}
              placeholder={t('unlock.password')}
              visible={showSensitivePassword}
              onToggleVisible={onToggleSensitivePassword}
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
            onPress={onConfirmSensitive}
          />
          <ActionButton
            label={t('actions.cancel')}
            variant="ghost"
            disabled={actionLocked || sensitiveBusy}
            onPress={onCancelSensitive}
          />
        </View>
      ) : null}
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
      {languageSettings}
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
    : { text: '-- NITO', lines: 1 as const };

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
          numberOfLines={balanceDisplay.lines}
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
