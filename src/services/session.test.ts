import { describe, expect, test, vi } from 'vitest';
import { AutoLock } from './session';

describe('AutoLock', () => {
  test('locks after timeout', async () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const locker = new AutoLock(onLock);

    locker.resetTimer();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(onLock).toHaveBeenCalledTimes(1);

    locker.stop();
    vi.useRealTimers();
  });
});
