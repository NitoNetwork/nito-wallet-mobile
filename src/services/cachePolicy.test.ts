import { describe, expect, it } from 'vitest';

import { readOptionalCache } from './cachePolicy';

describe('wallet cache read policy', () => {
  it('distinguishes a cache miss from a failed cache read', async () => {
    await expect(readOptionalCache(async () => null)).resolves.toEqual({
      status: 'miss',
      value: null,
    });

    const failed = await readOptionalCache(async () => {
      throw new Error('database unreadable');
    });
    expect(failed.status).toBe('failed');
    expect(failed).toMatchObject({ error: expect.objectContaining({ message: 'database unreadable' }) });
  });
});
