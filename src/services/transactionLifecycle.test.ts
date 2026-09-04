import { describe, expect, it } from 'vitest';

import {
  assertLifecycleTransition,
  nextTransactionBroadcastAttemptAt,
  reconciledLifecycleState,
} from './transactionLifecycle';

describe('transaction lifecycle', () => {
  it('reconciles uncertain and published transactions without publishing signed-only data', () => {
    const mempool = [{ txid: 'mempool', height: 0, address: 'nito1pchange' }];
    const confirmed = [{ txid: 'confirmed', height: 42, address: 'nito1pchange' }];

    expect(reconciledLifecycleState('broadcast-uncertain', 'mempool', mempool)).toBe('published');
    expect(reconciledLifecycleState('published', 'confirmed', confirmed)).toBe('confirmed');
    expect(reconciledLifecycleState('signed', 'mempool', mempool)).toBe('signed');
  });

  it('never permits a lifecycle state to move backwards', () => {
    expect(() => assertLifecycleTransition('signed', 'published')).not.toThrow();
    expect(() => assertLifecycleTransition('published', 'signed')).toThrow(
      'Invalid transaction lifecycle transition',
    );
  });

  it('backs recovery checks off to fifteen minutes without abandoning a first broadcast', () => {
    expect(nextTransactionBroadcastAttemptAt(1, 1_000)).toBe(16_000);
    expect(nextTransactionBroadcastAttemptAt(2, 1_000)).toBe(61_000);
    expect(nextTransactionBroadcastAttemptAt(3, 1_000)).toBe(301_000);
    expect(nextTransactionBroadcastAttemptAt(4, 1_000)).toBe(901_000);
    expect(nextTransactionBroadcastAttemptAt(5, 1_000)).toBe(901_000);
    expect(nextTransactionBroadcastAttemptAt(20, 1_000)).toBe(901_000);
  });
});
