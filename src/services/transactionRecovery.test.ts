import { describe, expect, it, vi } from 'vitest';

import type { TransactionLifecycleRecord } from './transactionLifecycle';
import * as diagnostics from './diagnostics';
import {
  recoverPersistedTransactionBroadcasts,
  processPersistentTransactionSequence,
  TransactionBroadcastRetryScheduler,
} from './transactionRecovery';

const record = (
  overrides: Partial<TransactionLifecycleRecord> = {},
): TransactionLifecycleRecord => ({
  lifecycleId: 'lifecycle',
  walletId: 'wallet',
  purpose: 'send',
  addressIndex: 7,
  derivationPath: "m/86'/0'/0'/1/7",
  address: 'nito1pchange',
  state: 'signed',
  txid: 'ab'.repeat(32),
  rawTxHex: '00ff',
  recoveryAttempts: 0,
  broadcastInvocations: 0,
  nextBroadcastAttemptAt: null,
  lastBroadcastAttemptAt: null,
  ...overrides,
});

const ports = (overrides: Partial<Parameters<typeof recoverPersistedTransactionBroadcasts>[0]> = {}) => ({
  now: 1_000,
  records: [record()],
  claimAttempt: vi.fn(async (candidate: TransactionLifecycleRecord, now: number) => ({
    ...candidate,
    state: 'broadcast-uncertain' as const,
    recoveryAttempts: candidate.recoveryAttempts + 1,
    lastBroadcastAttemptAt: now,
    nextBroadcastAttemptAt: now + 15_000,
  })),
  recordBroadcastInvocation: vi.fn(async (candidate: TransactionLifecycleRecord, now: number) => ({
    ...candidate,
    broadcastInvocations: candidate.broadcastInvocations + 1,
    lastBroadcastAttemptAt: now,
  })),
  lookupTransaction: vi.fn(async () => {
    throw new Error('not found');
  }),
  isTransactionNotFound: vi.fn(() => true),
  broadcastTransaction: vi.fn(async (_rawTxHex: string, txid: string) => txid),
  markPublished: vi.fn(async () => undefined),
  ...overrides,
});

describe('persistent transaction broadcast recovery', () => {
  it('does not let a display observer failure change the publication outcome', async () => {
    const report = vi.spyOn(diagnostics, 'reportNonFinancialFailure').mockImplementation(() => undefined);
    try {
      const recovery = ports({ onRecordChanged: () => { throw new Error('display observer failed'); } });
      const result = await recoverPersistedTransactionBroadcasts(recovery);
      expect(result.publishedTxids).toEqual(['ab'.repeat(32)]);
      expect(result.failures).toEqual([]);
      expect(recovery.markPublished).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith('transaction tracking observer', expect.any(Error));
    } finally {
      report.mockRestore();
    }
  });
  it('updates the live window from the persisted invocation and clears in-flight state on acceptance', async () => {
    const changes: { state: string; invocations: number; active: boolean }[] = [];
    await recoverPersistedTransactionBroadcasts(ports({
      onRecordChanged: (candidate, active) => changes.push({
        state: candidate.state, invocations: candidate.broadcastInvocations, active,
      }),
    }));
    expect(changes).toEqual([
      { state: 'broadcast-uncertain', invocations: 0, active: true },
      { state: 'broadcast-uncertain', invocations: 1, active: true },
      { state: 'published', invocations: 1, active: false },
    ]);
  });

  it('leaves a timed-out final invocation visibly unresolved, not permanently in flight', async () => {
    const changes: { count: number; active: boolean }[] = [];
    const recovery = ports({
      records: [record({ broadcastInvocations: 4, state: 'broadcast-uncertain' })],
      broadcastTransaction: vi.fn(async () => { throw new Error('timeout'); }),
      onRecordChanged: (candidate, active) => changes.push({ count: candidate.broadcastInvocations, active }),
    });
    await recoverPersistedTransactionBroadcasts(recovery);
    expect(changes.at(-1)).toEqual({ count: 5, active: false });
    expect(recovery.markPublished).not.toHaveBeenCalled();
  });

  it('resumes a signed transaction after restart and persists uncertainty before broadcasting', async () => {
    const events: string[] = [];
    const recoveryPorts = ports({
      claimAttempt: vi.fn(async (candidate, now) => {
        events.push('claim');
        return {
          ...candidate,
          state: 'broadcast-uncertain',
          recoveryAttempts: 1,
          lastBroadcastAttemptAt: now,
          nextBroadcastAttemptAt: now + 15_000,
        };
      }),
      lookupTransaction: vi.fn(async () => {
        events.push('lookup');
        throw new Error('not found');
      }),
      broadcastTransaction: vi.fn(async (_hex, txid) => {
        events.push('broadcast');
        return txid;
      }),
      markPublished: vi.fn(async () => {
        events.push('published');
      }),
    });

    const result = await recoverPersistedTransactionBroadcasts(recoveryPorts);

    expect(events).toEqual(['claim', 'lookup', 'broadcast', 'published']);
    expect(result.publishedTxids).toEqual(['ab'.repeat(32)]);
  });

  it('keeps a signed transaction scheduled when uncertainty persistence is interrupted', async () => {
    const recoveryPorts = ports({
      claimAttempt: vi.fn(async () => {
        throw new Error('storage interrupted');
      }),
    });

    const result = await recoverPersistedTransactionBroadcasts(recoveryPorts);

    expect(recoveryPorts.lookupTransaction).not.toHaveBeenCalled();
    expect(recoveryPorts.broadcastTransaction).not.toHaveBeenCalled();
    expect(result.failures).toHaveLength(1);
    expect(result.nextAttemptAt).toBe(16_000);
  });

  it('recovers idempotently after interruption before, during and after network acceptance', async () => {
    const missing = new Error('not found');
    const acceptedThenDisconnected = ports({
      records: [record({ state: 'broadcast-uncertain' })],
      lookupTransaction: vi.fn()
        .mockRejectedValueOnce(missing)
        .mockResolvedValueOnce(undefined),
      broadcastTransaction: vi.fn(async () => {
        throw new Error('connection closed after acceptance');
      }),
    });

    const result = await recoverPersistedTransactionBroadcasts(acceptedThenDisconnected);

    expect(acceptedThenDisconnected.broadcastTransaction).toHaveBeenCalledTimes(1);
    expect(acceptedThenDisconnected.markPublished).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([]);
  });

  it('does not spam the network before the retry deadline or after five broadcasts', async () => {
    const recoveryPorts = ports({
      records: [
        record({
          lifecycleId: 'waiting',
          state: 'broadcast-uncertain',
          recoveryAttempts: 1,
          nextBroadcastAttemptAt: 2_000,
        }),
        record({
          lifecycleId: 'exhausted',
          state: 'broadcast-uncertain',
          recoveryAttempts: 5,
          broadcastInvocations: 5,
          nextBroadcastAttemptAt: null,
        }),
      ],
    });

    const result = await recoverPersistedTransactionBroadcasts(recoveryPorts);

    expect(recoveryPorts.claimAttempt).not.toHaveBeenCalled();
    expect(recoveryPorts.lookupTransaction).not.toHaveBeenCalled();
    expect(recoveryPorts.broadcastTransaction).not.toHaveBeenCalled();
    expect(result.nextAttemptAt).toBe(2_000);
  });

  it('does not consume the broadcast quota when the availability check itself is offline', async () => {
    const recoveryPorts = ports({
      records: [record({
        state: 'broadcast-uncertain',
        recoveryAttempts: 8,
        broadcastInvocations: 0,
        nextBroadcastAttemptAt: 1_000,
      })],
      lookupTransaction: vi.fn(async () => {
        throw new Error('offline');
      }),
      isTransactionNotFound: vi.fn(() => false),
    });

    const result = await recoverPersistedTransactionBroadcasts(recoveryPorts);

    expect(recoveryPorts.recordBroadcastInvocation).not.toHaveBeenCalled();
    expect(recoveryPorts.broadcastTransaction).not.toHaveBeenCalled();
    expect(result.failures).toHaveLength(1);
    expect(result.nextAttemptAt).toBe(16_000);
  });

  it('stops after one failed broadcast and exposes the next persisted deadline', async () => {
    const recoveryPorts = ports({
      broadcastTransaction: vi.fn(async () => {
        throw new Error('offline');
      }),
    });

    const result = await recoverPersistedTransactionBroadcasts(recoveryPorts);

    expect(recoveryPorts.broadcastTransaction).toHaveBeenCalledTimes(1);
    expect(result.failures).toHaveLength(1);
    expect(result.nextAttemptAt).toBe(16_000);
  });

  it('does not advance a consolidation batch while its current transaction is uncertain', async () => {
    const recoveryPorts = ports({
      records: [
        record({ lifecycleId: 'first', purpose: 'consolidation' }),
        record({ lifecycleId: 'second', purpose: 'consolidation', txid: 'cd'.repeat(32) }),
      ],
      broadcastTransaction: vi.fn(async () => {
        throw new Error('offline');
      }),
    });

    await recoverPersistedTransactionBroadcasts(recoveryPorts);

    expect(recoveryPorts.claimAttempt).toHaveBeenCalledTimes(1);
    expect(recoveryPorts.broadcastTransaction).toHaveBeenCalledTimes(1);
  });

  it('recovers after network acceptance interrupted the published-state write', async () => {
    const notFound = new Error('not found');
    const firstPorts = ports({
      lookupTransaction: vi.fn(async () => {
        throw notFound;
      }),
      markPublished: vi.fn(async () => {
        throw new Error('storage interrupted');
      }),
    });

    const first = await recoverPersistedTransactionBroadcasts(firstPorts);
    expect(firstPorts.broadcastTransaction).toHaveBeenCalledTimes(1);
    expect(first.failures).toHaveLength(1);

    const secondPorts = ports({
      now: 16_000,
      records: [record({
        state: 'broadcast-uncertain',
        recoveryAttempts: 1,
        nextBroadcastAttemptAt: 16_000,
        lastBroadcastAttemptAt: 1_000,
      })],
      lookupTransaction: vi.fn(async () => undefined),
    });
    const second = await recoverPersistedTransactionBroadcasts(secondPorts);

    expect(secondPorts.broadcastTransaction).not.toHaveBeenCalled();
    expect(secondPorts.markPublished).toHaveBeenCalledTimes(1);
    expect(second.publishedTxids).toEqual(['ab'.repeat(32)]);
  });

  it('schedules exactly one bounded retry callback', () => {
    vi.useFakeTimers();
    const scheduler = new TransactionBroadcastRetryScheduler();
    const callback = vi.fn();

    scheduler.schedule(16_000, callback, 1_000);
    vi.advanceTimersByTime(14_999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    scheduler.cancel();
    vi.useRealTimers();
  });

  it.each([
    ['after reservation', 'sign', ['sign:0']],
    ['after signature', 'persist', ['sign:0', 'persist:0']],
    ['after persistence and before broadcast', 'broadcast', ['sign:0', 'persist:0', 'broadcast:0']],
    ['after publication', 'published', ['sign:0', 'persist:0', 'broadcast:0', 'published:0']],
  ] as const)('stops safely when interrupted %s', async (_label, failureStep, expectedEvents) => {
    const events: string[] = [];
    const stop = async (step: string, index: number) => {
      events.push(`${step}:${index}`);
      if (step === failureStep) throw new Error(`interrupted ${step}`);
    };

    await expect(processPersistentTransactionSequence({
      items: ['first', 'second'],
      sign: async (_item, index) => {
        await stop('sign', index);
        return { txid: String(index) };
      },
      persistSigned: async (_item, _signed, index) => stop('persist', index),
      broadcastPersisted: async (_item, _signed, index) => stop('broadcast', index),
      afterPublished: async (_item, _signed, index) => stop('published', index),
    })).rejects.toThrow(`interrupted ${failureStep}`);

    expect(events).toEqual(expectedEvents);
    expect(events).not.toContain('sign:1');
  });

  it('finishes each consolidation transaction before signing the next one', async () => {
    const events: string[] = [];

    await processPersistentTransactionSequence({
      items: ['first', 'second'],
      sign: async (_item, index) => {
        events.push(`sign:${index}`);
        return { txid: String(index) };
      },
      persistSigned: async (_item, _signed, index) => {
        events.push(`persist:${index}`);
      },
      broadcastPersisted: async (_item, _signed, index) => {
        events.push(`broadcast:${index}`);
      },
      afterPublished: async (_item, _signed, index) => {
        events.push(`published:${index}`);
      },
    });

    expect(events).toEqual([
      'sign:0', 'persist:0', 'broadcast:0', 'published:0',
      'sign:1', 'persist:1', 'broadcast:1', 'published:1',
    ]);
  });
});
