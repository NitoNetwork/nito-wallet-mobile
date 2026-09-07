import { describe, expect, it, vi } from 'vitest';
import { ReceiveAddressSelection, releaseReceiveAddressBeforeRefresh } from './receiveAddress';
import type { KnownHdAddress } from '../wallet/hdAddress';
import { WalletNetworkController } from './walletNetworkController';

vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));

describe('receive address selection across sessions', () => {
  const addresses: KnownHdAddress[] = [
    { accountKey: 'taproot', branch: 'external', index: 0, used: true },
    { accountKey: 'taproot', branch: 'external', index: 1, used: false },
    { accountKey: 'taproot', branch: 'external', index: 2, used: true },
    { accountKey: 'taproot', branch: 'external', index: 3, used: false },
  ];

  it('starts at zero and reoffers previously generated unused addresses after reconnecting', () => {
    const session = new ReceiveAddressSelection();
    expect(session.current('taproot')).toBe(0);
    expect(session.next('taproot', addresses, 20)).toBe(1);
    session.select('taproot', 1);
    expect(session.next('taproot', addresses, 20)).toBe(3);
    session.select('taproot', 3);
    expect(session.current('legacy')).toBe(0);
    expect(session.current('taproot')).toBe(3);
    const reopened = new ReceiveAddressSelection();
    expect(reopened.current('taproot')).toBe(0);
    expect(reopened.next('taproot', addresses, 20)).toBe(1);
  });

  it('skips an address as soon as a mempool reception marks it used, including after reconnecting', () => {
    const received = addresses.map((address) => address.index === 1 ? { ...address, used: true } : address);
    expect(new ReceiveAddressSelection().next('taproot', received, 20)).toBe(3);
  });

  it('does not confuse other families or change addresses with receive usage', () => {
    expect(new ReceiveAddressSelection().next('taproot', [
      { accountKey: 'legacy', branch: 'external', index: 1, used: true },
      { accountKey: 'taproot', branch: 'internal', index: 1, used: true },
    ], 20)).toBe(1);
  });

  it('preserves the restoration gap and makes its unused slots available again next session', () => {
    const session = new ReceiveAddressSelection();
    session.select('taproot', 19);
    expect(() => session.next('taproot', [], 20)).toThrow('HD_ADDRESS_GAP_LIMIT_REACHED');
    expect(new ReceiveAddressSelection().next('taproot', [], 20)).toBe(1);
  });
});

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
