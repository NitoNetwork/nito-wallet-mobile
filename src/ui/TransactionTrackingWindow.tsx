import { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import type { LanguageCode, Translator } from '../i18n';
import { hasSignedReplacement } from '../services/transactionLifecycle';
import type { RbfQuote, ReplacementMode } from '../wallet/transparentRbf';
import { satoshisToNito } from '../wallet/transparentScan';
import { transactionTrackingStage, type TransactionTrackingController } from '../services/transactionTracking';
import { ActionButton } from './components';
import { shortAddress } from './format';
import { useStyles } from './themeContext';
import { transactionTrackingPresentation } from './transactionTrackingPresentation';
import type { NetworkState } from './types';

export function TransactionTrackingWindow({
  tracking, network, visible, t, feedbackError, onClose, onExplorer, onActivity,
  language, rbfReview, busy, onReplace, onConfirmReplacement, onCancelReplacement,
}: {
  tracking: ReturnType<TransactionTrackingController['getSnapshot']>;
  network: NetworkState;
  visible: boolean;
  t: Translator;
  feedbackError: string;
  onClose: (lifecycleId: string) => void;
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
  const record = tracking.records.find(({ lifecycleId }) => lifecycleId === tracking.window?.lifecycleId);
  const presentation = record ? transactionTrackingPresentation(
    record, tracking.records, network.snapshot?.history ?? [], tracking.inFlight.has(record.lifecycleId), t,
  ) : null;
  const status = presentation?.status;
  useEffect(() => {
    if (!visible || status !== 'scheduled') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, status]);
  if (!record || !record.txid || !status || !presentation) return null;
  const { winner } = presentation;
  const displayedTxid = presentation.displayedTxid ?? record.txid;
  const replaced = hasSignedReplacement(record, tracking.records);
  const canCancel = !winner && !replaced && record.replacement?.mode !== 'cancel' && status === 'mempool'
    && ['published', 'broadcast-uncertain'].includes(record.state) && network.status === 'connected';
  const seconds = Math.max(0, Math.ceil(((record.nextBroadcastAttemptAt ?? 0) - now) / 1000));
  const review = rbfReview?.originalLifecycleId === record.lifecycleId ? rbfReview : null;
  const close = () => onClose(record.lifecycleId);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={close}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.trackingOverlay} onTouchStart={onActivity}>
          <View style={[styles.card, styles.trackingCard]} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={[styles.sectionTitle, styles.trackingTitle]}>
              {review ? t('rbf.review') : presentation.title}
            </Text>
            <ScrollView contentContainerStyle={styles.trackingContent}>
              {review ? (
                <>
                  <Text style={styles.body}>{t('rbf.cancelHint')}</Text>
                  <Text style={styles.body}>{t('rbf.previousFee', { amount: satoshisToNito(review.originalFeeSats, language) })}</Text>
                  <Text style={styles.body}>{t('rbf.newFee', { amount: satoshisToNito(review.transaction.feeSats, language) })}</Text>
                  {feedbackError ? <Text style={styles.fieldError}>{feedbackError}</Text> : null}
                </>
              ) : (
                <>
                  <View style={styles.trackingProgressRow} accessibilityRole="progressbar"
                    accessibilityLabel={t('tracking.progress')}
                    accessibilityValue={{ min: 0, max: 4, now: transactionTrackingStage(status), text: t(`tracking.${status}`) }}>
                    {[1, 2, 3, 4].map((stage) => <View key={stage} style={[
                      styles.trackingProgress, stage <= transactionTrackingStage(status) && styles.trackingProgressDone,
                    ]} />)}
                  </View>
                  {presentation.detail ? <Text style={styles.body}>{presentation.detail}</Text> : null}
                  <Text accessibilityLiveRegion="polite" style={styles.body}>{presentation.message}</Text>
                  {replaced && !winner ? <Text style={styles.helper}>{t('rbf.replacementStarted')}</Text> : null}
                  {status === 'scheduled' ? <Text style={styles.helper}>{seconds > 0
                    ? t('tracking.retryIn', { seconds }) : t('tracking.retryReady')}</Text> : null}
                  {tracking.observationFailures.has(displayedTxid) ? <Text style={styles.fieldError}>{t('tracking.observationFailed')}</Text> : null}
                  {tracking.storageError ? <Text style={styles.fieldError}>{t('errors.walletStorageUnavailable')}</Text> : null}
                  {feedbackError ? <Text style={styles.fieldError}>{feedbackError}</Text> : null}
                  <Text style={styles.helper}>{shortAddress(displayedTxid)}</Text>
                  <ActionButton label={t('actions.viewTx')} variant="secondary" onPress={() => onExplorer(displayedTxid)} />
                  {canCancel ? <ActionButton label={t('rbf.cancel')} variant="secondary" disabled={busy}
                    onPress={() => onReplace(record.lifecycleId, 'cancel')} /> : null}
                </>
              )}
            </ScrollView>
            {review ? (
              <>
                <ActionButton label={t('rbf.confirm')} disabled={busy || Boolean(winner)} onPress={onConfirmReplacement} />
                <ActionButton label={t('actions.back')} variant="ghost" disabled={busy} onPress={onCancelReplacement} />
              </>
            ) : <ActionButton label={t('tracking.hide')} variant="ghost" onPress={close} />}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
