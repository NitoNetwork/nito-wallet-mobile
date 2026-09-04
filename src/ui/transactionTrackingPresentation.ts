import type { TranslationKey, Translator } from '../i18n';
import type { ElectrumHistoryEntry } from '../network/electrum';
import { confirmedTransactionFamilyMember } from '../services/transactionLifecycle';
import { transactionReplacementOutcome, transactionTrackingStatus, type TrackedTransaction } from '../services/transactionTracking';

/** Display only. A saved confirmation never substitutes for the network snapshot. */
export function transactionTrackingPresentation(
  record: TrackedTransaction,
  records: readonly TrackedTransaction[],
  history: readonly ElectrumHistoryEntry[],
  inFlight: boolean,
  t: Translator,
) {
  const winner = confirmedTransactionFamilyMember(record, records, history);
  const displayed = winner ?? record;
  const status = transactionTrackingStatus(displayed, history, inFlight);
  const outcome = transactionReplacementOutcome(record, records, history);
  const height = history.find(({ txid }) => txid === displayed.txid)?.height;
  const cancellation = record.replacement?.mode === 'cancel' || winner?.replacement?.mode === 'cancel';
  let titleKey: TranslationKey = outcome ? `rbf.${outcome}`
    : record.purpose === 'send' ? 'tracking.send' : 'tracking.consolidation';
  let messageKey: TranslationKey = `tracking.${status}Hint`;
  let detail: string | null = null;

  if (cancellation) {
    titleKey = 'rbf.cancellation';
    if (winner) {
      messageKey = winner.replacement?.mode === 'cancel'
        ? 'rbf.cancelConfirmed' : 'rbf.cancelNotCompleted';
    } else if (status === 'accepted') {
      messageKey = 'rbf.cancelAccepted';
    } else if (status === 'mempool') {
      messageKey = 'rbf.cancelMempool';
    }
  } else if (outcome && winner?.lifecycleId !== record.lifecycleId) {
    detail = t(outcome === 'original-confirmed' ? 'rbf.error.confirmed' : 'rbf.otherConfirmed');
  }

  return {
    winner,
    status,
    displayedTxid: displayed.txid,
    title: t(titleKey),
    message: t(messageKey, { height: height ?? '' }),
    detail,
  };
}
