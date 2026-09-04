import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { WalletSessionGuard } from './walletSession';
import { TransactionTrackingController, publicTransactionTrackingRecord, transactionTrackingStage, transactionTrackingStatus, type TransactionTrackingData } from './transactionTracking';
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

describe('single persistent transaction window', () => {
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

  it('restores the same selection after lock, unlock and a new controller instance', async () => {
    const { controller, ports, session, sessions } = setup();
    await controller.restore(session);
    expect(controller.getSnapshot().window).toEqual({ lifecycleId: 'first', open: true });
    sessions.invalidate();
    controller.reset();
    expect(controller.getSnapshot().records).toEqual([]);
    const reopened = sessions.begin('wallet');
    await controller.restore(reopened);
    expect(controller.getSnapshot().window?.open).toBe(true);
    const restarted = new TransactionTrackingController(ports);
    await restarted.restore(reopened);
    expect(restarted.getSnapshot().window?.open).toBe(true);
    await restarted.setWindow(reopened, { lifecycleId: 'first', open: false });
    const restartedHidden = new TransactionTrackingController(ports);
    await restartedHidden.restore(reopened);
    expect(restartedHidden.getSnapshot().window?.open).toBe(false);
    expect(restartedHidden.getSnapshot().records).toHaveLength(1);
  });

  it('updates a single window in place for successive consolidation transactions', async () => {
    const { controller, session, ports } = setup();
    await controller.restore(session);
    const second = record({ lifecycleId: 'second', txid: 'cd'.repeat(32), purpose: 'consolidation' });
    controller.update(session, record({ state: 'published' }), false);
    controller.update(session, second, true);
    controller.update(session, { ...second, state: 'broadcast-uncertain' }, false);
    expect(controller.getSnapshot().records).toHaveLength(2);
    expect(controller.getSnapshot().inFlight.size).toBe(0);
    await controller.setWindow(session, { lifecycleId: 'second', open: true });
    expect(controller.getSnapshot().window).toEqual({ lifecycleId: 'second', open: true });
    expect(ports.writeWindow).toHaveBeenCalledTimes(1);
  });

  it('rejects a delayed read and delayed recovery events from a previous session of the same wallet', async () => {
    const { controller, session, sessions, ports } = setup();
    const read = deferred<TransactionTrackingData>();
    const started = deferred<void>();
    ports.read.mockImplementationOnce(() => { started.resolve(); return read.promise; });
    const restoring = controller.restore(session);
    await started.promise;
    sessions.invalidate();
    controller.reset();
    const reopened = sessions.begin('wallet');
    await controller.restore(reopened);
    controller.update(session, record({ state: 'confirmed' }), true);
    read.resolve({ records: [], window: null });
    await restoring;
    expect(controller.getSnapshot().records[0]?.state).toBe('signed');
    expect(controller.getSnapshot().window?.open).toBe(true);
  });

  it('does not let a stale read overwrite a live recovery event or reopen a hidden window', async () => {
    const { controller, session, ports } = setup();
    await controller.restore(session);
    const read = deferred<TransactionTrackingData>();
    const started = deferred<void>();
    ports.read.mockImplementationOnce(() => { started.resolve(); return read.promise; });
    const refreshing = controller.refresh(session);
    await started.promise;
    controller.update(session, record({ state: 'published' }), false);
    await controller.setWindow(session, { lifecycleId: 'first', open: false });
    read.resolve({ records: [record()], window: { lifecycleId: 'first', open: true } });
    await refreshing;
    expect(controller.getSnapshot().records[0]?.state).toBe('published');
    expect(controller.getSnapshot().window?.open).toBe(false);
  });

  it('reports storage failure explicitly and never writes financial data or exposes signing payloads', async () => {
    const { controller, session, ports } = setup();
    await controller.restore(session);
    controller.update(session, record(), true);
    expect(controller.getSnapshot().records[0]).not.toHaveProperty('rawTxHex');
    expect(controller.getSnapshot().records[0]).not.toHaveProperty('derivationPath');
    ports.writeWindow.mockRejectedValueOnce(new Error('storage unavailable'));
    await controller.setWindow(session, { lifecycleId: 'first', open: false });
    expect(controller.getSnapshot().storageError).toBe(true);
    expect(ports.reportError).toHaveBeenCalledTimes(1);
    expect(ports.writeWindow).toHaveBeenCalledWith('wallet', { lifecycleId: 'first', open: false });
    ports.read.mockRejectedValueOnce(new Error('read unavailable'));
    await controller.refresh(session);
    expect(controller.getSnapshot().records).toHaveLength(1);
    expect(controller.getSnapshot().storageError).toBe(true);
  });

  it.each([
    { lifecycleId: 'first', open: false },
    { lifecycleId: 'second', open: true },
  ])('preserves the user choice $lifecycleId / $open during a delayed SQLite write and concurrent refresh', async (window) => {
    const { controller, session, ports } = setup();
    const data: TransactionTrackingData = {
      records: [record(), record({ lifecycleId: 'second' })],
      window: { lifecycleId: 'first', open: true },
    };
    ports.read.mockImplementation(async () => structuredClone(data));
    await controller.restore(session);
    const started = deferred<void>();
    const release = deferred<void>();
    ports.writeWindow.mockImplementation(async (_walletId, next) => {
      started.resolve();
      await release.promise;
      data.window = next;
    });
    const observed: typeof window[] = [];
    controller.subscribe(() => {
      const current = controller.getSnapshot().window;
      if (current) observed.push(current);
    });
    const saving = controller.setWindow(session, window);
    await started.promise;
    const refreshing = controller.refresh(session);
    // Signal completion of a concurrent read if the implementation starts one.
    // No clock or arbitrary sleep is needed to expose the stale persisted value.
    await Promise.resolve();
    release.resolve();
    await Promise.all([saving, refreshing]);
    expect(observed.every((current) => current.lifecycleId === window.lifecycleId && current.open === window.open)).toBe(true);
    expect(controller.getSnapshot().window).toEqual(window);
    expect(data.window).toEqual(window);
  });

  it('serializes successive user actions and restores only the latest selection after concurrent refreshes', async () => {
    const { controller, session, ports } = setup();
    const data: TransactionTrackingData = { records: [record(), record({ lifecycleId: 'second' })], window: null };
    ports.read.mockImplementation(async () => structuredClone(data));
    await controller.restore(session);
    const releases = [deferred<void>(), deferred<void>(), deferred<void>()] as const;
    const starts = [deferred<void>(), deferred<void>(), deferred<void>()] as const;
    const choices = [
      { lifecycleId: 'first', open: false },
      { lifecycleId: 'second', open: true },
      { lifecycleId: 'second', open: false },
    ] as const;
    let writes = 0;
    const completed: number[] = [];
    ports.writeWindow.mockImplementation(async (_walletId, window) => {
      const index = writes++;
      starts[index]!.resolve();
      await releases[index]!.promise;
      data.window = window;
      completed.push(index);
    });
    const first = controller.setWindow(session, choices[0]);
    await starts[0].promise;
    const refreshFirst = controller.refresh(session);
    const second = controller.setWindow(session, choices[1]);
    const refreshSecond = controller.refresh(session);
    const third = controller.setWindow(session, choices[2]);
    const refreshThird = controller.refresh(session);
    // Release the last operation first. It must still wait for earlier writes.
    releases[2].resolve();
    await Promise.resolve();
    releases[0].resolve();
    await starts[1].promise;
    releases[1].resolve();
    await Promise.all([first, second, third, refreshFirst, refreshSecond, refreshThird]);
    expect(completed).toEqual([0, 1, 2]);
    expect(controller.getSnapshot().window).toEqual(choices[2]);
    const restarted = new TransactionTrackingController(ports);
    await restarted.restore(session);
    expect(restarted.getSnapshot().window).toEqual(choices[2]);
  });

  it('keeps a failed user choice visible with its error until a later save succeeds', async () => {
    const { controller, session, ports } = setup();
    await controller.restore(session);
    const failure = deferred<void>();
    ports.writeWindow.mockReturnValueOnce(failure.promise);
    const saving = controller.setWindow(session, { lifecycleId: 'first', open: false });
    const refreshing = controller.refresh(session);
    failure.reject(new Error('write failed'));
    await Promise.all([saving, refreshing]);
    await controller.refresh(session);
    expect(controller.getSnapshot().window?.open).toBe(false);
    expect(controller.getSnapshot().storageError).toBe(true);
    await controller.setWindow(session, { lifecycleId: 'first', open: false });
    await controller.refresh(session);
    expect(controller.getSnapshot().window?.open).toBe(false);
    expect(controller.getSnapshot().storageError).toBe(false);
    expect(ports.reportError).toHaveBeenCalledTimes(1);
  });

  it('waits for already requested saves across lock and unlock without publishing into the old session', async () => {
    const { controller, session, sessions, ports } = setup();
    await controller.restore(session);
    const started = deferred<void>();
    const release = deferred<void>();
    const save = ports.writeWindow.getMockImplementation()!;
    ports.writeWindow.mockImplementationOnce(async (walletId, window) => {
      started.resolve();
      await release.promise;
      await save(walletId, window);
    });
    const saving = controller.setWindow(session, { lifecycleId: 'first', open: false });
    await started.promise;
    sessions.invalidate();
    controller.reset();
    const reopened = sessions.begin('wallet');
    const restoring = controller.restore(reopened);
    await Promise.resolve();
    release.resolve();
    await Promise.all([saving, restoring]);
    expect(controller.getSnapshot().window?.open).toBe(false);
    expect(controller.getSnapshot().storageError).toBe(false);
  });

  it('restores ongoing lot 3 records without requiring a vault migration', async () => {
    const { controller, session, ports } = setup();
    ports.read.mockResolvedValue({ records: [record(), record({ lifecycleId: 'reserved', state: 'reserved' })], window: null });
    await controller.restore(session);
    expect(controller.getSnapshot().records).toHaveLength(1);
    expect(controller.getSnapshot().window).toEqual({ lifecycleId: 'first', open: true });
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
  });
});
