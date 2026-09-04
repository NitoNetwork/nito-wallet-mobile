import { describe, expect, it, vi } from 'vitest';
import { observePublishedTransactions } from './transactionObservation';

const setup = () => ({ isCurrent: vi.fn(() => true), refresh: vi.fn(async () => true),
  onFailure: vi.fn(), isRetryable: vi.fn(() => true), wait: vi.fn(async (_ms: number) => {}) });

describe('read-only post-broadcast observation', () => {
  it('retries a not-yet-visible transaction and a transient read error after three seconds, without reporting a failed payment', async () => {
    const ports = setup();
    ports.refresh.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('not ready'));
    expect(await observePublishedTransactions(ports)).toBe('observed');
    expect(ports.refresh).toHaveBeenCalledTimes(3);
    expect(ports.wait.mock.calls).toEqual([[3_000], [3_000]]);
    expect(ports.onFailure).not.toHaveBeenCalled();
  });
  it('bounds failures to three reads and exposes the last error instead of inventing confirmation', async () => {
    const ports = setup();
    const error = new Error('offline');
    ports.refresh.mockRejectedValue(error);
    expect(await observePublishedTransactions(ports)).toBe('failed');
    expect(ports.refresh).toHaveBeenCalledTimes(3);
    expect(ports.onFailure).toHaveBeenCalledExactlyOnceWith(error);
  });
  it('distinguishes three successful reads with no observation from a network error', async () => {
    const ports = setup();
    ports.refresh.mockResolvedValue(false);
    expect(await observePublishedTransactions(ports)).toBe('pending');
    expect(ports.onFailure).not.toHaveBeenCalled();
  });
  it('stops after a lock or server change, including during a read', async () => {
    const ports = setup();
    ports.wait.mockImplementation(async () => { ports.isCurrent.mockReturnValue(false); });
    ports.refresh.mockResolvedValue(false);
    expect(await observePublishedTransactions(ports)).toBe('interrupted');
    expect(ports.refresh).toHaveBeenCalledTimes(1);
    const active = setup();
    active.refresh.mockImplementation(async () => { active.isCurrent.mockReturnValue(false); throw new Error('closed'); });
    expect(await observePublishedTransactions(active)).toBe('interrupted');
    expect(active.onFailure).not.toHaveBeenCalled();
  });
  it('does not retry a non-network storage or validation failure', async () => {
    const ports = setup();
    ports.isRetryable.mockReturnValue(false);
    ports.refresh.mockRejectedValue(new Error('storage'));
    expect(await observePublishedTransactions(ports)).toBe('failed');
    expect(ports.refresh).toHaveBeenCalledTimes(1);
  });
});
