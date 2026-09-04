import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import { WalletSessionGuard } from './walletSession';
import { TransactionTrackingController, publicTransactionTrackingRecord, transactionReplacementOutcome, transactionTrackingStage, transactionTrackingStatus, type TransactionTrackingData } from './transactionTracking';
import type { TransactionLifecycleRecord } from './transactionLifecycle';
import { mergeWalletHistoryPublication } from './walletHistory';
import { LANGUAGES, makeTranslator } from '../i18n';

const record = (overrides: Partial<TransactionLifecycleRecord> = {}): TransactionLifecycleRecord => ({
  lifecycleId: 'first', walletId: 'wallet', purpose: 'send', state: 'signed',
  addressIndex: 1, derivationPath: "m/86'/0'/0'/1/1", address: 'change',
  txid: 'ab'.repeat(32), rawTxHex: '0000', broadcastInvocations: 0,
  recoveryAttempts: 0, nextBroadcastAttemptAt: null, lastBroadcastAttemptAt: null,
  ...overrides,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const setup = () => {
  const sessions = new WalletSessionGuard();
  const session = sessions.begin('wallet');
  let data: TransactionTrackingData = {
    records: [publicTransactionTrackingRecord(record())], window: { lifecycleId: 'first', open: true },
  };
  const ports = {
    isCurrent: (token: typeof session) => sessions.isCurrent(token),
    read: vi.fn(async () => structuredClone(data)),
    writeWindow: vi.fn(async (_walletId: string, window: NonNullable<TransactionTrackingData['window']>) => {
      data = { ...data, window };
    }),
    reportError: vi.fn(),
  };
  return { sessions, session, ports, controller: new TransactionTrackingController(ports) };
};

describe('single session-local transaction window with durable recovery', () => {
  it('distinguishes original winning from a later replacement winning in the same window', () => {
    const first = record({ lifecycleId: 'first', txid: 'first', state: 'published' });
    const second = record({ lifecycleId: 'second', txid: 'second', replacement: { originalLifecycleId: 'first', originalTxid: 'first', mode: 'accelerate' } });
    const third = record({ lifecycleId: 'third', txid: 'third', replacement: { originalLifecycleId: 'second', originalTxid: 'second', mode: 'cancel' } });
    const records = [first, second, third];
    const history = (txid: string, height = 42) => [{ txid, height, address: 'address' }];
    expect(transactionReplacementOutcome(third, records, history('first'))).toBe('original-confirmed');
    expect(transactionReplacementOutcome(second, records, history('third'))).toBe('replacement-confirmed');
    expect(transactionReplacementOutcome(first, records, history('third'))).toBe('replacement-confirmed');
    expect(transactionReplacementOutcome(third, records, history('third'))).toBeNull();
    expect(transactionReplacementOutcome(third, records, history('first', 0))).toBeNull();
  });

  it('distinguishes all seven stages without treating local history or server acceptance as a mempool observation', () => {
    const original = record();
    const pending = { txid: original.txid!, height: 0, address: 'change' };
    expect(transactionTrackingStatus(original, [], false)).toBe('signed');
    expect(transactionTrackingStatus(original, [], true)).toBe('broadcasting');
    expect(transactionTrackingStatus(record({ state: 'broadcast-uncertain', nextBroadcastAttemptAt: 15_000 }), [], false)).toBe('scheduled');
    expect(transactionTrackingStatus(record({ state: 'published' }), [pending], false)).toBe('accepted');
    expect(transactionTrackingStatus(original, [{ ...pending, networkObserved: true }], false)).toBe('mempool');
    expect(transactionTrackingStatus(original, [{ ...pending, height: -1, networkObserved: true }], false)).toBe('mempool');
    expect(transactionTrackingStatus(original, [{ ...pending, height: 100 }], true)).toBe('confirmed');
    expect(transactionTrackingStatus(record({ state: 'broadcast-uncertain', broadcastInvocations: 5 }), [], false)).toBe('unresolved');
    expect(transactionTrackingStatus(record({ state: 'broadcast-uncertain', broadcastInvocations: 5 }), [], true)).toBe('broadcasting');
    expect(transactionTrackingStatus(record({ state: 'confirmed' }), [], false)).toBe('unresolved');
  });

  it('does not lose a genuine network observation when merging enriched local history', () => {
    const local = { txid: 'tx', address: 'a', height: 0, direction: 'self' as const, amountSats: 5, feeSats: 1 };
    const observed = { txid: 'tx', address: 'b', height: 0, networkObserved: true };
    for (const mode of ['partial', 'authoritative'] as const) {
      const merged = mergeWalletHistoryPublication([local], [observed], mode);
      expect(merged[0]).toMatchObject({ networkObserved: true, amountSats: 5, feeSats: 1 });
    }
    expect(local).not.toHaveProperty('networkObserved');
  });

  it('advances the progress indicator only at observed milestones, never with elapsed time', () => {
    expect(transactionTrackingStage('signed')).toBe(1);
    expect(transactionTrackingStage('broadcasting')).toBe(1);
    expect(transactionTrackingStage('scheduled')).toBe(1);
    expect(transactionTrackingStage('unresolved')).toBe(1);
    expect(transactionTrackingStage('accepted')).toBe(2);
    expect(transactionTrackingStage('mempool')).toBe(3);
    expect(transactionTrackingStage('confirmed')).toBe(4);
  });

  it('restores signed records but ignores persisted visibility after lock or restart', async () => {
    const { controller, ports, session, sessions } = setup();
    await controller.restore(session);
    expect(controller.getSnapshot().window).toBeNull();
    await controller.showSigned(session, 'first');
    expect(controller.getSnapshot().window?.open).toBe(true);
    sessions.invalidate();
    controller.reset();
    expect(controller.getSnapshot().records).toEqual([]);
    const reopened = sessions.begin('wallet');
    await controller.restore(reopened);
    expect(controller.getSnapshot().window).toBeNull();
    const restarted = new TransactionTrackingController(ports);
    await restarted.restore(reopened);
    expect(restarted.getSnapshot().window).toBeNull();
    expect(restarted.getSnapshot().records).toHaveLength(1);
    expect(ports.writeWindow).not.toHaveBeenCalled();
  });

  it('does not select an old transaction when the current transaction is absent from a refresh', async () => {
    const { controller, ports, session } = setup();
    await controller.showSigned(session, 'first');
    ports.read.mockResolvedValue({
      records: [record({ lifecycleId: 'old', txid: 'old', state: 'confirmed' })],
      window: { lifecycleId: 'old', open: true },
    });
    await controller.refresh(session);
    expect(controller.getSnapshot().window).toBeNull();
    expect(controller.getSnapshot().records).toHaveLength(1);
  });

  it('has no historical navigation, reopen entry point or TXID copy in the current transaction window', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    const window = readFileSync(new URL('../ui/TransactionTrackingWindow.tsx', import.meta.url), 'utf8');
    expect(app.includes("'tracking.reopen'")).toBe(false);
    for (const removed of ['tracking.position', 'actions.previousPage', 'actions.nextPage', 'onCopyTxid', 'trackingNavigationItem']) {
      expect(window.includes(removed), removed).toBe(false);
    }
  });

  it('places the explorer and cancellation buttons in the same full-width container and variant', () => {
    const source = readFileSync(new URL('../ui/TransactionTrackingWindow.tsx', import.meta.url), 'utf8');
    const tree = ts.createSourceFile('TransactionTrackingWindow.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const buttons: ts.JsxSelfClosingElement[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'ActionButton') buttons.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    const button = (key: string) => buttons.find((node) => node.attributes.properties.some((attribute) => (
      ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'label'
      && attribute.initializer?.getText(tree) === `{t('${key}')}`
    )))!;
    const container = (node: ts.Node): ts.Node | undefined => {
      let parent = node.parent;
      while (parent && !ts.isJsxElement(parent)) parent = parent.parent;
      return parent;
    };
    const explorer = button('actions.viewTx');
    const cancel = button('rbf.cancel');
    expect(explorer).toBeDefined();
    expect(cancel).toBeDefined();
    expect(container(explorer)).toBe(container(cancel));
    for (const node of [explorer, cancel]) {
      expect(node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
        && attribute.name.getText(tree) === 'variant' && attribute.initializer?.getText(tree) === '"secondary"')).toBe(true);
    }
  });

  it('updates successive consolidation records without reopening a hidden window', async () => {
    const { controller, session, ports } = setup();
    await controller.restore(session);
    await controller.showSigned(session, 'first');
    controller.closeWindow(session, 'first');
    controller.update(session, record({ state: 'published' }), false);
    controller.update(session, record({ lifecycleId: 'second', txid: 'cd'.repeat(32) }), true);
    ports.read.mockResolvedValue({ records: [record(), record({ lifecycleId: 'second' })], window: null });
    await controller.advanceSigned(session, 'first', 'second');
    expect(controller.getSnapshot().records).toHaveLength(2);
    expect(controller.getSnapshot().window).toBeNull();
    expect(ports.writeWindow).not.toHaveBeenCalled();
  });

  it('follows the current consolidation transaction without exposing unrelated history', async () => {
    const { controller, session, ports } = setup();
    ports.read.mockResolvedValue({ records: [record(), record({ lifecycleId: 'second' }), record({ lifecycleId: 'old', state: 'confirmed' })], window: null });
    await controller.restore(session);
    await controller.showSigned(session, 'first');
    await controller.advanceSigned(session, 'first', 'second');
    expect(controller.getSnapshot().window).toEqual({ lifecycleId: 'second', open: true });
    controller.update(session, record({ lifecycleId: 'old', state: 'confirmed' }), false);
    await controller.refresh(session);
    expect(controller.getSnapshot().window).toEqual({ lifecycleId: 'second', open: true });
    expect(controller.getSnapshot().records).toHaveLength(3);
    controller.closeWindow(session, 'first');
    expect(controller.getSnapshot().window?.lifecycleId).toBe('second');
  });

  it('never opens from recovery events but opens a newly signed send or replacement', async () => {
    const { controller, session, ports } = setup();
    const second = record({ lifecycleId: 'second', txid: 'second' });
    const cancellation = record({ lifecycleId: 'cancel', txid: 'cancel', replacement: {
      originalLifecycleId: 'second', originalTxid: 'second', mode: 'cancel',
    } });
    ports.read.mockResolvedValue({ records: [record(), second, cancellation], window: null });
    await controller.restore(session);
    controller.update(session, record({ state: 'published' }), true);
    await controller.refresh(session);
    expect(controller.getSnapshot().window).toBeNull();
    await controller.showSigned(session, 'second');
    expect(controller.getSnapshot().window).toEqual({ lifecycleId: 'second', open: true });
    await controller.showSigned(session, 'cancel');
    expect(controller.getSnapshot().window).toEqual({ lifecycleId: 'cancel', open: true });
    controller.closeWindow(session, 'cancel');
    controller.update(session, cancellation, false);
    await controller.refresh(session);
    expect(controller.getSnapshot().window).toBeNull();
  });

  it('rejects a delayed read and recovery event from a previous session', async () => {
    const { controller, session, sessions, ports } = setup();
    const read = deferred<TransactionTrackingData>();
    ports.read.mockReturnValueOnce(read.promise);
    const restoring = controller.restore(session);
    sessions.invalidate();
    controller.reset();
    const reopened = sessions.begin('wallet');
    await controller.restore(reopened);
    controller.update(session, record({ state: 'confirmed' }), true);
    read.resolve({ records: [], window: { lifecycleId: 'first', open: true } });
    await restoring;
    expect(controller.getSnapshot().records[0]?.state).toBe('signed');
    expect(controller.getSnapshot().window).toBeNull();
  });

  it.each(['close', 'new signature'] as const)('preserves %s during concurrent reads of delayed legacy SQLite writes', async (action) => {
    const { controller, session, ports } = setup();
    ports.read.mockResolvedValue({ records: [record(), record({ lifecycleId: 'second' })], window: null });
    await controller.restore(session);
    await controller.showSigned(session, 'first');
    const read = deferred<TransactionTrackingData>();
    ports.read.mockReturnValueOnce(read.promise);
    const refreshing = controller.refresh(session);
    if (action === 'close') controller.closeWindow(session, 'first');
    else await controller.showSigned(session, 'second');
    read.resolve({ records: [record()], window: { lifecycleId: 'first', open: true } });
    await refreshing;
    expect(controller.getSnapshot().window).toEqual(action === 'close' ? null : { lifecycleId: 'second', open: true });
    expect(ports.writeWindow).not.toHaveBeenCalled();
  });

  it('retains the last of several immediate user choices across concurrent refreshes', async () => {
    const { controller, session, ports } = setup();
    ports.read.mockResolvedValue({ records: [record(), record({ lifecycleId: 'second' })], window: null });
    await controller.restore(session);
    const reads = [deferred<TransactionTrackingData>(), deferred<TransactionTrackingData>()];
    ports.read.mockReturnValueOnce(reads[0]!.promise).mockReturnValueOnce(reads[1]!.promise);
    const first = controller.showSigned(session, 'first');
    const second = controller.showSigned(session, 'second');
    controller.closeWindow(session, 'second');
    reads[1]!.resolve({ records: [record()], window: { lifecycleId: 'first', open: true } });
    reads[0]!.resolve({ records: [record()], window: null });
    await Promise.all([first, second]);
    expect(controller.getSnapshot().window).toBeNull();
  });

  it('does not reopen when signing refresh finishes after the user closes the window', async () => {
    const { controller, session, ports } = setup();
    await controller.restore(session);
    const read = deferred<TransactionTrackingData>();
    const started = deferred<void>();
    ports.read.mockImplementationOnce(() => { started.resolve(); return read.promise; });
    const showing = controller.showSigned(session, 'first');
    await started.promise;
    controller.closeWindow(session, 'first');
    read.resolve({ records: [record()], window: { lifecycleId: 'first', open: true } });
    await showing;
    expect(controller.getSnapshot().window).toBeNull();
  });

  it('does not restore a previous consolidation selection after close or a newer send', async () => {
    const { controller, session, ports } = setup();
    ports.read.mockResolvedValue({ records: [record(), record({ lifecycleId: 'second' }), record({ lifecycleId: 'new-send' })], window: null });
    await controller.showSigned(session, 'first');
    const read = deferred<TransactionTrackingData>();
    ports.read.mockReturnValueOnce(read.promise);
    const advancing = controller.advanceSigned(session, 'first', 'second');
    controller.closeWindow(session, 'second');
    read.resolve({ records: [record(), record({ lifecycleId: 'second' })], window: null });
    await advancing;
    expect(controller.getSnapshot().window).toBeNull();
    await controller.showSigned(session, 'new-send');
    await controller.advanceSigned(session, 'first', 'second');
    expect(controller.getSnapshot().window).toEqual({ lifecycleId: 'new-send', open: true });
  });

  it('reports failed reads without losing data or exposing signed payloads', async () => {
    const { controller, session, ports } = setup();
    await controller.restore(session);
    expect(controller.getSnapshot().records[0]).not.toHaveProperty('rawTxHex');
    expect(controller.getSnapshot().records[0]).not.toHaveProperty('derivationPath');
    ports.read.mockRejectedValueOnce(new Error('storage unavailable'));
    await controller.refresh(session);
    expect(controller.getSnapshot().storageError).toBe(true);
    expect(controller.getSnapshot().records).toHaveLength(1);
    expect(ports.reportError).toHaveBeenCalledTimes(1);
  });

  it('scopes failed observations by txid and clears them on success or lock', async () => {
    const { controller, session, sessions } = setup();
    await controller.restore(session);
    controller.observationResult(session, ['first'], true);
    expect([...controller.getSnapshot().observationFailures]).toEqual(['first']);
    controller.observationResult(session, ['second'], false);
    expect([...controller.getSnapshot().observationFailures]).toEqual(['first']);
    controller.observationResult(session, ['first'], false);
    expect(controller.getSnapshot().observationFailures.size).toBe(0);
    sessions.invalidate();
    controller.reset();
    controller.observationResult(session, ['first'], true);
    expect(controller.getSnapshot().observationFailures.size).toBe(0);
  });

  it.each(Object.entries({
    "fr": ["En attente de détection dans la mempool.","Transaction présente dans la mempool, en attente de confirmation.","Transaction confirmée au bloc 1005010."],
    "en": ["Waiting for the transaction to appear in the mempool.","Transaction in the mempool, awaiting confirmation.","Transaction confirmed in block 1005010."],
    "de": ["Die Transaktion wurde noch nicht im Mempool erkannt.","Transaktion im Mempool, wartet auf Bestätigung.","Transaktion in Block 1005010 bestätigt."],
    "es": ["Esperando a detectar la transacción en la mempool.","Transacción en la mempool, pendiente de confirmación.","Transacción confirmada en el bloque 1005010."],
    "pt": ["Aguardando a detecção da transação na mempool.","Transação na mempool, aguardando confirmação.","Transação confirmada no bloco 1005010."],
    "ru": ["Ожидание появления транзакции в мемпуле.","Транзакция в мемпуле, ожидает подтверждения.","Транзакция подтверждена в блоке 1005010."],
    "zh": ["等待在内存池中检测到交易。","交易已在内存池中，等待确认。","交易已在区块 1005010 中确认。"],
    "ja": ["メモリプールでの取引の検出を待っています。","取引はメモリプール内にあり、承認待ちです。","取引はブロック 1005010 で承認されました。"],
    "tr": ["İşlemin mempool içinde görülmesi bekleniyor.","İşlem mempool içinde, onay bekleniyor.","İşlem 1005010 numaralı blokta onaylandı."],
  }))('resolves the compact accepted, mempool and confirmed texts in %s', (code, expected) => {
    const t = makeTranslator(code as (typeof LANGUAGES)[number]['code']);
    expect((['accepted', 'mempool', 'confirmed'] as const).map((state) => t(`tracking.${state}Hint`, { height: 1005010 })))
      .toEqual(expected);
    for (const key of ['rbf.cancelHint', 'rbf.review', 'rbf.confirm', 'tracking.observationFailed'] as const) {
      expect(t(key)).not.toBe(key);
      expect(t(key)).not.toMatch(/[—;]/);
    }
  });

  it('has translated distinct states and hints in every supported language', () => {
    const states = ['signed', 'broadcasting', 'scheduled', 'accepted', 'mempool', 'confirmed', 'unresolved'] as const;
    for (const { code } of LANGUAGES) {
      const t = makeTranslator(code);
      expect(new Set(states.map((status) => t(`tracking.${status}`))).size).toBe(7);
      states.forEach((status) => expect(t(`tracking.${status}Hint`)).not.toContain('tracking.'));
    }
  });

  it('mounts one tracking window and removes completed-transaction alert stacking without a financial writer', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    const tracking = readFileSync(new URL('./transactionTracking.ts', import.meta.url), 'utf8');
    expect(app.match(/<TransactionTrackingWindow\s/g)).toHaveLength(1);
    expect(app).not.toContain("Alert.alert(consolidationT('successTitle')");
    expect(app).not.toContain("Alert.alert(consolidationT('partialTitle')");
    expect(app).not.toContain("t('dialog.sentTitle')");
    expect(tracking).not.toMatch(/publishNetwork|setNetwork|saveWalletSnapshot|balanceSats|spendableSats/);
    expect(app).toContain('transactionTrackingController.restore(trackingSession)');
    expect(app).toContain('transactionTrackingController.reset()');
    expect(app).toContain('if (previousLifecycleId === undefined)');
    expect(app).toContain('transactionTrackingController.advanceSigned(session, previousLifecycleId, reservation.lifecycleId)');
    expect(app).toContain('feedbackError={replacementError}');
    const window = readFileSync(new URL('../ui/TransactionTrackingWindow.tsx', import.meta.url), 'utf8');
    expect(window).not.toContain("'rbf.accelerate'");
    expect(window).not.toContain("'tracking.attempts'");
    expect(window).not.toContain("'tracking.consolidationHint'");
    expect(window).not.toContain("'rbf.return'");
    expect(window).toContain('shortAddress(displayedTxid)');
    expect(window).toContain('onExplorer(displayedTxid)');
  });
});
