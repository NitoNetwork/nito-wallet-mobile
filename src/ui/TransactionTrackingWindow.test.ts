import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { makeTranslator } from '../i18n';
import type { ElectrumHistoryEntry } from '../network/electrum';
import type { TrackedTransaction } from '../services/transactionTracking';
import { TransactionTrackingWindow } from './TransactionTrackingWindow';

// Execute the real popup's JSX branches with native hosts stubbed. These tests
// assert its visible text and actions, not native layout or effect timing.
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => [0, vi.fn()],
  useEffect: vi.fn(),
}));
vi.mock('react-native', () => ({ Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', View: 'View' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }));
vi.mock('./themeContext', () => ({ useStyles: () => ({}) }));
vi.mock('./components', () => ({ ActionButton: 'ActionButton' }));
vi.mock('../wallet/transparentScan', () => ({ satoshisToNito: vi.fn() }));

type ElementProps = { children?: ReactNode; label?: string; onPress?: () => void };
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

const original: TrackedTransaction = {
  lifecycleId: 'original', walletId: 'wallet', purpose: 'send', state: 'published',
  txid: 'aa'.repeat(32), broadcastInvocations: 1, nextBroadcastAttemptAt: null,
};
const cancellation: TrackedTransaction = {
  ...original, lifecycleId: 'cancel', txid: 'bb'.repeat(32),
  replacement: { originalLifecycleId: original.lifecycleId, originalTxid: original.txid!, mode: 'cancel' },
};
const observation = (txid: string, height: number): ElectrumHistoryEntry => ({
  txid, height, address: 'address', networkObserved: true,
});

function renderWindow(history: ElectrumHistoryEntry[]) {
  const onExplorer = vi.fn();
  const tree = TransactionTrackingWindow({
    tracking: {
      walletId: 'wallet', records: [original, cancellation], window: { lifecycleId: 'cancel', open: true },
      inFlight: new Set(), storageError: false, observationFailures: new Set(),
    },
    network: {
      status: 'connected', error: '', serverUrl: '', height: 1005176, fullHistoryEnabled: true,
      snapshot: {
        history, confirmedSats: 0, unconfirmedSats: 0, balanceSats: 0, spendableSats: 0,
        utxos: [], addresses: [], usedAddresses: [], spendableAddresses: [], gapLimit: 20, scannedAt: '',
      },
    },
    visible: true, t: makeTranslator('fr'), feedbackError: '', language: 'fr', rbfReview: null,
    busy: false, onClose: vi.fn(), onExplorer, onActivity: vi.fn(), onReplace: vi.fn(),
    onConfirmReplacement: vi.fn(), onCancelReplacement: vi.fn(),
  });
  const nodes = elements(tree);
  return {
    texts: nodes.filter(({ type }) => type === 'Text').map(({ props }) => props.children),
    buttons: nodes.filter(({ type }) => type === 'ActionButton'),
    onExplorer,
  };
}

describe('rendered cancellation popup', () => {
  it.each([
    { history: [], message: 'Annulation transmise. En attente d’intégration dans la mempool.', txid: cancellation.txid! },
    { history: [observation(cancellation.txid!, 0)], message: 'Annulation présente dans la mempool, en attente de confirmation.', txid: cancellation.txid! },
    { history: [observation(cancellation.txid!, 1005176)], message: 'Annulation confirmée au bloc 1005176. L’envoi initial a été remplacé.', txid: cancellation.txid! },
    { history: [observation(original.txid!, 1005177)], message: 'Annulation non aboutie. L’envoi initial a été confirmé au bloc 1005177.', txid: original.txid! },
  ])('shows "$message" and opens the correct transaction', ({ history, message, txid }) => {
    const { texts, buttons, onExplorer } = renderWindow(history);
    expect(texts[0]).toBe('Annulation');
    expect(texts.filter((text) => text === message)).toHaveLength(1);
    expect(texts).not.toContain('Envoi');
    expect(texts).not.toContain('Transaction confirmée au bloc 1005176.');
    expect(buttons.map(({ props }) => props.label)).toEqual(['Voir la tx', 'Fermer']);
    buttons[0]!.props.onPress!();
    expect(onExplorer).toHaveBeenCalledExactlyOnceWith(txid);
  });
});
