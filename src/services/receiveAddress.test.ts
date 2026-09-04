import { describe, expect, it, vi } from 'vitest';
import { releaseReceiveAddressBeforeRefresh } from './receiveAddress';
import { WalletNetworkController } from './walletNetworkController';

vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));

describe('local receive address readiness', () => {
  it('releases the buttons before a queued network refresh completes', () => {
    let busy = true;
    const events: string[] = [];
    releaseReceiveAddressBeforeRefresh({ isCurrent: () => true,
      release: () => { busy = false; events.push('ready'); },
      queueRefresh: () => { expect(busy).toBe(false); events.push('queued'); },
    });
    expect(busy).toBe(false);
    expect(events).toEqual(['ready', 'queued']);
  });
  it('does not release another operation or schedule work for an ended session', () => {
    const release = vi.fn();
    const queueRefresh = vi.fn();
    releaseReceiveAddressBeforeRefresh({ isCurrent: () => false, release, queueRefresh });
    expect(release).not.toHaveBeenCalled();
    expect(queueRefresh).not.toHaveBeenCalled();
  });
  it('keeps newly issued addresses queued during an existing scan without locking their buttons', () => {
    const controller = new WalletNetworkController();
    const request = vi.fn();
    const release = vi.fn();
    const options = { force: true, rescanGap: true, silent: true };
    controller.startSync();
    for (let index = 0; index < 3; index += 1) {
      releaseReceiveAddressBeforeRefresh({ isCurrent: () => true, release,
        queueRefresh: () => controller.requestOrQueueSync(options, request) });
    }
    expect(release).toHaveBeenCalledTimes(3);
    expect(request).not.toHaveBeenCalled();
    controller.finishSync(request);
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(options));
  });
});
