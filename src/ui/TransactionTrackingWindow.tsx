import { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import type { LanguageCode, Translator } from '../i18n';
import { confirmedTransactionFamilyMember, hasSignedReplacement, TRANSACTION_BROADCAST_MAX_ATTEMPTS } from '../services/transactionLifecycle';
import type { RbfQuote, ReplacementMode } from '../wallet/transparentRbf';
import { satoshisToNito } from '../wallet/transparentScan';
import { transactionReplacementOutcome, transactionTrackingStage, transactionTrackingStatus, type TransactionTrackingController } from '../services/transactionTracking';
import { ActionButton } from './components';
import { useStyles } from './themeContext';
import type { NetworkState } from './types';

export function TransactionTrackingWindow({
  tracking, network, visible, t, feedbackError, onWindowChange, onExplorer, onActivity,
  language, rbfReview, busy, onReplace, onConfirmReplacement, onCancelReplacement,
}: {
  tracking: ReturnType<TransactionTrackingController['getSnapshot']>;
  network: NetworkState;
  visible: boolean;
  t: Translator;
  feedbackError: string;
  onWindowChange: (lifecycleId: string, open: boolean) => void;
  onExplorer: (txid: string) => void;
  onActivity: () => void;
  language: LanguageCode;
  rbfReview: RbfQuote | null;
  busy: boolean;
  onReplace: (id: string, mode: ReplacementMode) => void;
  onConfirmReplacement: () => void;
  onCancelReplacement: () => void;
}) {
  const styles = useStyles();
  const [now, setNow] = useState(Date.now);
  const index = tracking.records.findIndex(({ lifecycleId }) => lifecycleId === tracking.window?.lifecycleId);
  const record = tracking.records[index];
  const winner = record ? confirmedTransactionFamilyMember(record, tracking.records, network.snapshot?.history ?? []) : undefined;
  const outcome = record ? transactionReplacementOutcome(record, tracking.records, network.snapshot?.history ?? []) : null;
  const displayed = winner ?? record;
  const status = record ? transactionTrackingStatus(
    displayed!, network.snapshot?.history ?? [], tracking.inFlight.has(record.lifecycleId),
  ) : null;
  useEffect(() => {
    if (!visible || status !== 'scheduled') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, status]);
  if (!record || !record.txid || !status) return null;
  const displayedTxid = displayed?.txid ?? record.txid;
  const replaced = hasSignedReplacement(record, tracking.records);
  const canReplace = !winner && !replaced && status === 'mempool'
    && ['published', 'broadcast-uncertain'].includes(record.state) && network.status === 'connected';
  const seconds = Math.max(0, Math.ceil(((record.nextBroadcastAttemptAt ?? 0) - now) / 1000));
  const height = network.snapshot?.history.find(({ txid }) => txid === displayedTxid)?.height;
  const previous = tracking.records[index - 1];
  const next = tracking.records[index + 1];
  const close = () => onWindowChange(record.lifecycleId, false);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={close}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.trackingOverlay} onTouchStart={onActivity}>
          <View style={[styles.card, styles.trackingCard]} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t('tracking.title')}</Text>
            <ScrollView contentContainerStyle={styles.trackingContent}>
              <Text style={styles.label}>{t(record.purpose === 'send' ? 'tracking.send' : 'tracking.consolidation')}</Text>
              <Text accessibilityLiveRegion="polite" style={styles.sectionTitle}>{outcome ? t(`rbf.${outcome}`) : t(`tracking.${status}`)}</Text>
              {busy ? <Text accessibilityLiveRegion="polite" style={styles.helper}>{t('loading.title')}</Text> : null}
              <View style={styles.trackingNavigation} accessibilityRole="progressbar"
                accessibilityLabel={t('tracking.progress')}
                accessibilityValue={{ min: 0, max: 4, now: transactionTrackingStage(status), text: t(`tracking.${status}`) }}>
                {[1, 2, 3, 4].map((stage) => <View key={stage} style={[
                  styles.trackingProgress, stage <= transactionTrackingStage(status) && styles.trackingProgressDone,
                ]} />)}
              </View>
              <Text style={styles.body}>{t(`tracking.${status}Hint`)}</Text>
              {outcome ? <Text style={styles.body}>{t(outcome === 'original-confirmed' ? 'rbf.error.confirmed' : 'rbf.otherConfirmed')}</Text> : null}
              {replaced && !winner ? <Text style={styles.helper}>{t('rbf.replacementStarted')}</Text> : null}
              {record.replacement ? <Text style={styles.body}>{t(record.replacement.mode === 'cancel' ? 'rbf.cancel' : 'rbf.accelerate')}</Text> : null}
              {record.purpose === 'consolidation' ? <Text style={styles.helper}>{t('tracking.consolidationHint')}</Text> : null}
              {status === 'confirmed' && height ? <Text style={styles.body}>{t('history.block', { height })}</Text> : null}
              {status === 'scheduled' ? (
                <Text style={styles.body}>{seconds > 0
                  ? t('tracking.retryIn', { seconds }) : t('tracking.retryReady')}</Text>
              ) : null}
              <Text style={styles.helper}>{t('tracking.attempts', {
                count: record.broadcastInvocations, max: TRANSACTION_BROADCAST_MAX_ATTEMPTS,
              })}</Text>
              {network.status !== 'connected' ? <Text style={styles.body}>{t('tracking.lastKnown')}</Text> : null}
              <Text selectable style={styles.body}>{displayedTxid}</Text>
              {tracking.storageError ? <Text style={styles.fieldError}>{t('errors.walletStorageUnavailable')}</Text> : null}
              {feedbackError ? <Text style={styles.fieldError}>{feedbackError}</Text> : null}
              <ActionButton label={t('actions.viewTx')} variant="secondary" onPress={() => onExplorer(displayedTxid)} />
              {rbfReview?.originalLifecycleId === record.lifecycleId ? (
                <View style={styles.trackingContent}>
                  <Text style={styles.sectionTitle}>{t('rbf.review')}</Text>
                  <Text style={styles.body}>{t(rbfReview.mode === 'cancel' ? 'rbf.cancelHint' : 'rbf.accelerateHint')}</Text>
                  <Text style={styles.body}>{t('rbf.previousFee', { amount: satoshisToNito(rbfReview.originalFeeSats, language) })}</Text>
                  <Text style={styles.body}>{t('rbf.newFee', { amount: satoshisToNito(rbfReview.transaction.feeSats, language) })}</Text>
                  <Text style={styles.body}>{t('rbf.return', { amount: satoshisToNito(rbfReview.returnSats, language) })}</Text>
                  <Text style={styles.helper}>{t('rbf.raceHint')}</Text>
                  <ActionButton label={t('rbf.confirm')} disabled={busy || Boolean(winner)} onPress={onConfirmReplacement} />
                  <ActionButton label={t('actions.cancel')} variant="ghost" disabled={busy} onPress={onCancelReplacement} />
                </View>
              ) : canReplace ? (
                <View style={styles.trackingContent}>
                  <ActionButton label={t('rbf.accelerate')} variant="secondary" disabled={busy}
                    onPress={() => onReplace(record.lifecycleId, 'accelerate')} />
                  <ActionButton label={t('rbf.cancel')} variant="secondary" disabled={busy}
                    onPress={() => onReplace(record.lifecycleId, 'cancel')} />
                </View>
              ) : null}
              {tracking.records.length > 1 ? (
                <>
                  <Text style={styles.helper}>{t('tracking.position', { current: index + 1, total: tracking.records.length })}</Text>
                  <View style={styles.trackingNavigation}>
                    <View style={styles.trackingNavigationItem}>
                      <ActionButton label={t('actions.previousPage')} variant="secondary" disabled={index <= 0}
                        onPress={() => { if (previous) onWindowChange(previous.lifecycleId, true); }} />
                    </View>
                    <View style={styles.trackingNavigationItem}>
                      <ActionButton label={t('actions.nextPage')} variant="secondary" disabled={index >= tracking.records.length - 1}
                        onPress={() => { if (next) onWindowChange(next.lifecycleId, true); }} />
                    </View>
                  </View>
                </>
              ) : null}
            </ScrollView>
            <ActionButton label={t('tracking.hide')} variant="ghost" onPress={close} />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
