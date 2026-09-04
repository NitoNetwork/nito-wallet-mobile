import { afterEach, describe, expect, it, vi } from 'vitest';
import { observePublishedTransactions } from './transactionObservation';

describe('broadcast reconciliation timing', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('waits three seconds between real observation passes until a fresh transaction appears', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('not yet indexed')).mockResolvedValue(true);
    const onFailure = vi.fn();
    const reconciliation = observePublishedTransactions({ refresh, isCurrent: () => true, onFailure, isRetryable: () => true });
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(reconciliation).resolves.toBe('observed');
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(onFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a persistent malformed response after three attempts rather than an absent transaction', async () => {
    vi.useFakeTimers();
    const error = new Error('malformed response');
    const refresh = vi.fn().mockRejectedValue(error);
    const onFailure = vi.fn();
    const reconciliation = observePublishedTransactions({ refresh, isCurrent: () => true, onFailure, isRetryable: () => true });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(reconciliation).resolves.toBe('failed');
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
