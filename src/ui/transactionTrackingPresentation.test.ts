import { describe, expect, it } from 'vitest';

import { LANGUAGES, makeTranslator, type TranslationKey } from '../i18n';
import type { ElectrumHistoryEntry } from '../network/electrum';
import type { TrackedTransaction } from '../services/transactionTracking';
import { transactionTrackingPresentation } from './transactionTrackingPresentation';

const original: TrackedTransaction = {
  lifecycleId: 'original', walletId: 'wallet', purpose: 'send', state: 'published',
  txid: 'aa'.repeat(32), broadcastInvocations: 1, nextBroadcastAttemptAt: null,
};
const cancellation: TrackedTransaction = {
  ...original, lifecycleId: 'cancel', txid: 'bb'.repeat(32),
  replacement: { originalLifecycleId: original.lifecycleId, originalTxid: original.txid!, mode: 'cancel' },
};
const records = [original, cancellation];
const observation = (record: TrackedTransaction, height: number): ElectrumHistoryEntry => ({
  txid: record.txid!, height, address: 'address', networkObserved: true,
});
const t = makeTranslator('fr');
const present = (history: ElectrumHistoryEntry[], record = cancellation, all = records) => (
  transactionTrackingPresentation(record, all, history, false, t)
);

describe('cancellation popup presentation', () => {
  it('shows the exact accepted, observed and confirmed messages for the selected cancellation', () => {
    const before = structuredClone(records);
    expect(present([])).toMatchObject({
      title: 'Annulation', message: 'Annulation transmise. En attente d’intégration dans la mempool.',
      status: 'accepted', winner: undefined, detail: null,
    });
    expect(present([observation(cancellation, 0)])).toMatchObject({
      title: 'Annulation', message: 'Annulation présente dans la mempool, en attente de confirmation.',
      status: 'mempool', winner: undefined, detail: null,
    });
    expect(present([observation(cancellation, 1005176)])).toMatchObject({
      title: 'Annulation', message: 'Annulation confirmée au bloc 1005176. L’envoi initial a été remplacé.',
      status: 'confirmed', winner: cancellation, displayedTxid: cancellation.txid, detail: null,
    });
    expect(records).toEqual(before);
  });

  it('shows failure, the winning original TXID and its actual block when the original confirms first', () => {
    expect(present([observation(cancellation, 0), observation(original, 1005200)])).toMatchObject({
      title: 'Annulation', message: 'Annulation non aboutie. L’envoi initial a été confirmé au bloc 1005200.',
      status: 'confirmed', winner: original, displayedTxid: original.txid, detail: null,
    });
  });

  it('recognizes a confirmed cancellation even if the original window was still selected', () => {
    expect(present([observation(cancellation, 1005176)], original)).toMatchObject({
      title: 'Annulation', message: t('rbf.cancelConfirmed', { height: 1005176 }),
      displayedTxid: cancellation.txid,
    });
  });

  it.each([0, -1])('does not treat height %i, a local row or a persisted confirmation as proof of cancellation', (height) => {
    expect(present([observation(cancellation, height)]).status).toBe('mempool');
    expect(present([{ ...observation(cancellation, height), networkObserved: undefined }])).toMatchObject({
      status: 'accepted', message: t('rbf.cancelAccepted'),
    });
    const saved = { ...cancellation, state: 'confirmed' as const };
    expect(present([], saved, [original, saved])).toMatchObject({
      title: 'Annulation', status: 'unresolved', winner: undefined, message: t('tracking.unresolvedHint'),
    });
  });

  it('does not retain the success message after a network snapshot removes the confirmation', () => {
    expect(present([observation(cancellation, 1005176)]).status).toBe('confirmed');
    expect(present([observation(cancellation, 0)])).toMatchObject({
      status: 'mempool', message: t('rbf.cancelMempool'),
    });
  });

  it('handles an older payment replacement winning before cancellation and a later cancellation winning', () => {
    const accelerated: TrackedTransaction = { ...cancellation, lifecycleId: 'accelerated', txid: 'cc'.repeat(32),
      replacement: { ...cancellation.replacement!, mode: 'accelerate' } };
    const last: TrackedTransaction = { ...cancellation, replacement: {
      ...cancellation.replacement!, originalLifecycleId: accelerated.lifecycleId, originalTxid: accelerated.txid!,
    } };
    const family = [original, accelerated, last];
    expect(present([observation(accelerated, 1005201)], last, family)).toMatchObject({
      message: t('rbf.cancelNotCompleted', { height: 1005201 }), displayedTxid: accelerated.txid,
    });
    expect(present([observation(last, 1005202)], accelerated, family)).toMatchObject({
      message: t('rbf.cancelConfirmed', { height: 1005202 }), displayedTxid: last.txid,
    });
  });

  it.each(['send', 'consolidation'] as const)('leaves ordinary %s states and their messages unchanged', (purpose) => {
    const record = { ...original, purpose };
    expect(present([], record, [record])).toMatchObject({
      title: t(purpose === 'send' ? 'tracking.send' : 'tracking.consolidation'),
      message: t('tracking.acceptedHint'),
    });
    expect(present([observation(record, 1005203)], record, [record])).toMatchObject({
      title: t(purpose === 'send' ? 'tracking.send' : 'tracking.consolidation'),
      message: t('tracking.confirmedHint', { height: 1005203 }), detail: null,
    });
  });

  it('does not describe a legacy acceleration confirming itself as another transaction winning', () => {
    const accelerated: TrackedTransaction = { ...cancellation,
      replacement: { ...cancellation.replacement!, mode: 'accelerate' } };
    expect(present([observation(accelerated, 1005204)], accelerated, [original, accelerated])).toMatchObject({
      title: t('rbf.replacement-confirmed'), message: t('tracking.confirmedHint', { height: 1005204 }), detail: null,
    });
  });

  it.each(LANGUAGES)('resolves all four cancellation messages from the $code dictionary', ({ code }) => {
    const translated = makeTranslator(code);
    const cases: [ElectrumHistoryEntry[], TranslationKey][] = [
      [[], 'rbf.cancelAccepted'],
      [[observation(cancellation, 0)], 'rbf.cancelMempool'],
      [[observation(cancellation, 1005176)], 'rbf.cancelConfirmed'],
      [[observation(original, 1005176)], 'rbf.cancelNotCompleted'],
    ];
    for (const [history, key] of cases) {
      const result = transactionTrackingPresentation(cancellation, records, history, false, translated);
      expect(result.title).toBe(translated('rbf.cancellation'));
      expect(result.message).toBe(translated(key, { height: 1005176 }));
      expect(result.message).not.toContain('{height}');
    }
  });
});
