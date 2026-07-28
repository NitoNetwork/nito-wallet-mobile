import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { CONSOLIDATION_MIN_UTXOS } from '../constants/nito';
import type { LanguageCode, Translator } from '../i18n';
import { makeConsolidationTranslator } from '../i18n.consolidation';
import { formatNitoDateTime } from '../i18n.datetime';
import { HISTORY_PAGE_SIZE } from '../services/historyEnrichmentQueue';
import type { CachedTransactionOutput } from '../services/historyExport';
import { reportNonFinancialFailure } from '../services/diagnostics';
import { loadTransactionOutputCache } from '../services/walletHistoryDb';
import { isTransparentUtxoSpendable } from '../wallet/coinbaseMaturity';
import { satoshisToNito } from '../wallet/transparentScan';
import type { PreparedTransparentConsolidation, PreparedTransparentSend } from '../wallet/transparentSend';
import { ActionButton } from './components';
import {
  canShowHistoryExport,
  formatHomeBalance,
  historyAmountBreakdown,
  historyPageFromInput,
  internalDebitSats,
  signedHistoryAmountLines,
  shortAddress,
} from './format';
import {
  canAddSendRecipient,
  duplicateRecipientAddresses,
  type SendRecipientDraft,
  type SendRecipientFieldErrors,
} from './sendRecipients';
import { QR_COLORS } from './theme';
import { useStyles, useThemeColor, useThemeName } from './themeContext';
import type { NetworkState, PendingAction, Wallet } from './types';

export function ReceiveTab({ wallet, t, pendingAction, actionLocked, onCopyAddress }: {
  wallet: Wallet;
  t: Translator;
  pendingAction: PendingAction | null;
  actionLocked: boolean;
  onCopyAddress: () => void;
}) {
  const styles = useStyles();
  const qrColors = QR_COLORS[useThemeName()];
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('receive.title')}</Text>
      <View style={styles.qrPlaceholder}>
        <QRCode value={wallet.address} size={204} quietZone={12} color={qrColors.foreground} backgroundColor={qrColors.background} />
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
  recipients,
  recipientErrors,
  sendEstimate,
  sendEstimatePending,
  preparedTx,
  preparedConsolidation,
  onChangeRecipient,
  onAddRecipient,
  onRemoveRecipient,
  onOpenQrScanner,
  onFillMax,
  onPrepareSend,
  onBroadcastTx,
  onBroadcastConsolidation,
  onPreparedReviewLayout,
}: {
  t: Translator;
  language: LanguageCode;
  network: NetworkState;
  actionLocked: boolean;
  pendingAction: PendingAction | null;
  broadcasting: boolean;
  recipients: SendRecipientDraft[];
  recipientErrors: SendRecipientFieldErrors;
  sendEstimate: { feeSats: number; totalSats: bigint; fitsAvailable: boolean } | null;
  sendEstimatePending: boolean;
  preparedTx: PreparedTransparentSend | null;
  preparedConsolidation: PreparedTransparentConsolidation | null;
  onChangeRecipient: (recipientId: number, field: 'address' | 'amount', value: string) => void;
  onAddRecipient: () => void;
  onRemoveRecipient: (recipientId: number) => void;
  onOpenQrScanner: (recipientId: number) => void;
  onFillMax: (recipientId: number) => void;
  onPrepareSend: () => void;
  onBroadcastTx: () => void;
  onBroadcastConsolidation: () => void;
  onPreparedReviewLayout: () => void;
}) {
  const styles = useStyles();
  const themeColor = useThemeColor();
  const consolidationT = makeConsolidationTranslator(language);
  const duplicateAddresses = duplicateRecipientAddresses(recipients);
  const canAddRecipient = canAddSendRecipient(recipients);
  const recipientsComplete = recipients.every(
    (recipient) => recipient.address.trim() && recipient.amount.trim(),
  );
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('send.title')}</Text>
      <Text style={styles.body}>{t('send.body')}</Text>
      <View style={styles.recipientList}>
        {recipients.map((recipient, index) => {
          const maxDisabled = actionLocked
            || !network.snapshot
            || network.status === 'syncing'
            || !recipient.address.trim()
            || recipients.some((candidate) => (
              candidate.id !== recipient.id
              && (!candidate.address.trim() || !candidate.amount.trim())
            ));
          return (
            <View key={recipient.id} style={styles.recipientCard}>
              <View style={styles.recipientHeader}>
                <Text style={styles.label}>
                  {t('send.recipientLabel', { index: index + 1 })}
                </Text>
                {recipients.length > 1 ? (
                  <TouchableOpacity
                    disabled={actionLocked}
                    onPress={() => onRemoveRecipient(recipient.id)}
                    style={styles.recipientRemoveButton}
                  >
                    <Text style={styles.recipientRemoveText}>{t('send.removeRecipient')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={styles.destinationRow}>
                <TextInput
                  value={recipient.address}
                  onChangeText={(value) => onChangeRecipient(recipient.id, 'address', value)}
                  placeholder={t('send.destination')}
                  placeholderTextColor={themeColor('#6d7892')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, styles.destinationInput]}
                />
                <TouchableOpacity
                  disabled={actionLocked}
                  onPress={() => onOpenQrScanner(recipient.id)}
                  style={[styles.scanButton, actionLocked && styles.scanButtonDisabled]}
                >
                  <Text style={styles.scanButtonText}>{t('actions.scanQr')}</Text>
                </TouchableOpacity>
              </View>
              {recipientErrors[recipient.id]?.address ? (
                <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
                  {recipientErrors[recipient.id]?.address}
                </Text>
              ) : null}
              <View style={styles.amountRow}>
                <TextInput
                  value={recipient.amount}
                  onChangeText={(value) => onChangeRecipient(recipient.id, 'amount', value)}
                  placeholder={t('send.amount')}
                  placeholderTextColor={themeColor('#6d7892')}
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.amountInput]}
                />
                <TouchableOpacity
                  disabled={maxDisabled}
                  onPress={() => onFillMax(recipient.id)}
                  style={[styles.maxButton, maxDisabled && styles.maxButtonDisabled]}
                >
                  <Text style={styles.maxButtonText}>{t('actions.max')}</Text>
                </TouchableOpacity>
              </View>
              {recipientErrors[recipient.id]?.amount ? (
                <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
                  {recipientErrors[recipient.id]?.amount}
                </Text>
              ) : null}
            </View>
          );
        })}
        <TouchableOpacity
          disabled={actionLocked || !canAddRecipient}
          onPress={onAddRecipient}
          style={[
            styles.addRecipientButton,
            (actionLocked || !canAddRecipient) && styles.scanButtonDisabled,
          ]}
        >
          <Text style={styles.addRecipientText}>{t('send.addRecipient')}</Text>
        </TouchableOpacity>
        {!canAddRecipient ? (
          <Text style={styles.helper}>{t('send.maxRecipients')}</Text>
        ) : null}
      </View>
      {duplicateAddresses.length > 0 ? (
        <Text style={styles.settingsWarning}>{t('send.duplicateRecipientWarning')}</Text>
      ) : null}
      <ActionButton
        label={network.status === 'syncing' ? t('send.updating') : t('actions.prepareSend')}
        loading={pendingAction === 'prepare'}
        disabled={
          actionLocked
          || !network.snapshot
          || network.status === 'syncing'
          || !recipientsComplete
          || sendEstimatePending
          || sendEstimate?.fitsAvailable === false
        }
        onPress={onPrepareSend}
      />
      {sendEstimatePending ? (
        <Text style={styles.helper}>{t('send.totalChecking')}</Text>
      ) : sendEstimate ? (
        <Text style={sendEstimate.fitsAvailable ? styles.helper : styles.settingsWarning}>
          {t('send.totalWithFees', { amount: satoshisToNito(sendEstimate.totalSats, language) })}
        </Text>
      ) : null}
      <Text style={styles.helper}>
        {t('send.available', { amount: network.snapshot ? satoshisToNito(network.snapshot.spendableSats, language) : '0' })}
      </Text>
      {preparedTx ? (
        <View style={styles.txBox} onLayout={onPreparedReviewLayout}>
          <Text style={styles.label}>{t('send.transactionReady')}</Text>
          <Text style={styles.label}>{t('send.recipientsReview')}</Text>
          {preparedTx.recipients.map((recipient, index) => (
            <View key={`${recipient.address}:${index}`} style={styles.reviewRecipient}>
              <Text style={styles.previewAddress}>
                {`${satoshisToNito(recipient.amountSats, language)} NITO`}
              </Text>
              <Text selectable style={styles.helper}>{shortAddress(recipient.address)}</Text>
            </View>
          ))}
          <Text style={styles.previewAddress}>{t('send.fee', { amount: satoshisToNito(preparedTx.feeSats, language) })}</Text>
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
        <View style={styles.txBox} onLayout={onPreparedReviewLayout}>
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
            {`${consolidationT('fees')}: ${satoshisToNito(preparedConsolidation.totalFeeSats, language)} NITO`}
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
  const styles = useStyles();
  const themeColor = useThemeColor();
  return (
    <View style={styles.historyLoadingStatus}>
      <ActivityIndicator
        accessibilityLabel={t('history.syncing')}
        color={themeColor('#dbeaff')}
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
  language,
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
  language: LanguageCode;
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
  const styles = useStyles();
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
            const debitSats = entry.direction === undefined
              ? null
              : internalDebitSats(entry.direction, entry.amountSats ?? 0, entry.feeSats);
            const amountLines = amountBreakdown && entry.direction
              ? signedHistoryAmountLines(
                entry.direction,
                amountBreakdown.amountsSats.map((amountSats) => (
                  satoshisToNito(amountSats, language)
                )),
                debitSats === null ? null : satoshisToNito(debitSats, language),
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
                        entry.blockTime ? formatNitoDateTime(entry.blockTime, language) : '',
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

export function HomeTab({
  t,
  language,
  wallet,
  network,
  actionLocked,
  pendingAction,
  balanceRefreshing,
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
  preparedConsolidation: PreparedTransparentConsolidation | null;
  onRefreshBalance: () => void;
  onConfirmConsolidation: () => void;
}) {
  const styles = useStyles();
  const spendableAddressSet = new Set(
    (network.snapshot?.spendableAddresses ?? []).map((address) => address.address),
  );
  const eligibleUtxos = (network.snapshot?.utxos ?? []).filter(
    (utxo) => isTransparentUtxoSpendable(utxo) && spendableAddressSet.has(utxo.address),
  );
  const refreshDisabled = actionLocked || balanceRefreshing || network.status === 'syncing';
  const balanceDisplay = network.snapshot
    ? formatHomeBalance(network.snapshot.spendableSats, language)
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
            {t('home.pendingBalance', { amount: satoshisToNito(network.snapshot.unconfirmedSats, language) })}
          </Text>
        ) : null}
        {network.snapshot && (network.snapshot.immatureCoinbaseSats ?? 0) > 0 ? (
          <Text style={styles.immatureCoinbaseBalance}>
            {t('home.immatureMiningRewards', {
              amount: satoshisToNito(network.snapshot.immatureCoinbaseSats ?? 0, language),
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
