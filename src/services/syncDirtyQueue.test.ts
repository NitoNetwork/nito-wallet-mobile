import { describe, expect, it, vi } from 'vitest';

import { DirtyRequestQueue, DirtySyncQueue } from './syncDirtyQueue';

describe('dirty synchronization queue', () => {
  it('guarantees one trailing sync for events received while a sync is active', () => {
    const queue = new DirtySyncQueue();
    const requestSync = vi.fn();

    expect(queue.request({
      force: true,
      silent: true,
      pendingOnly: true,
      onlyAddresses: ['address-a'],
    }, true, requestSync)).toBe('deferred');
    expect(requestSync).not.toHaveBeenCalled();

    expect(queue.flush(false, requestSync)).toBe(true);
    expect(requestSync).toHaveBeenCalledWith({
      force: true,
      silent: true,
      pendingOnly: true,
      onlyAddresses: ['address-a'],
    });
    expect(queue.flush(false, requestSync)).toBe(false);
  });

  it('merges dirty events without narrowing a required full rescan', () => {
    const queue = new DirtySyncQueue();
    const requestSync = vi.fn();

    queue.request({
      force: true,
      silent: true,
      pendingOnly: true,
      onlyAddresses: ['address-a'],
    }, true, requestSync);
    queue.request({
      force: true,
      silent: true,
      rescanGap: true,
    }, true, requestSync);
    queue.flush(false, requestSync);

    expect(requestSync).toHaveBeenCalledWith({
      force: true,
      silent: true,
      pendingOnly: false,
      rescanGap: true,
      onlyAddresses: undefined,
    });
  });
});

describe('dirty request queue', () => {
  it('guarantees exactly one trailing request while work is active', () => {
    const queue = new DirtyRequestQueue();
    const request = vi.fn();

    expect(queue.request(true, request)).toBe('deferred');
    expect(queue.request(true, request)).toBe('deferred');
    expect(request).not.toHaveBeenCalled();

    expect(queue.flush(false, request)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(queue.flush(false, request)).toBe(false);
  });

  it('drops a deferred request when the active session is cleared', () => {
    const queue = new DirtyRequestQueue();
    const request = vi.fn();

    queue.request(true, request);
    queue.clear();

    expect(queue.flush(false, request)).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
