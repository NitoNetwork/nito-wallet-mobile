import { describe, expect, it, vi } from 'vitest';

import { isDuplicateColumnError, retrySqliteWrite } from './sqliteReliability';

describe('SQLite reliability policy', () => {
  it('retries a failed write and returns only after it succeeds', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('database busy'))
      .mockRejectedValueOnce(new Error('database busy'))
      .mockResolvedValue('written');

    await expect(retrySqliteWrite(operation, { delayMs: 0 })).resolves.toBe('written');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('propagates a write error after the final attempt', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('disk full'));

    await expect(retrySqliteWrite(operation, { delayMs: 0 })).rejects.toThrow('disk full');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('only recognizes the expected duplicate-column migration error', () => {
    expect(isDuplicateColumnError(new Error('duplicate column name: block_time'))).toBe(true);
    expect(isDuplicateColumnError(new Error('database disk image is malformed'))).toBe(false);
  });
});
