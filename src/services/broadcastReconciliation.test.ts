import { afterEach, describe, expect, it, vi } from 'vitest';

import { ElectrumRpcError, type NitoElectrumClient } from '../network/electrum';
import { reconcileBroadcastTransactions } from './walletNetworkController';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

describe('broadcast reconciliation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('continues through delayed passes until a freshly broadcast transaction is visible', async () => {
    vi.useFakeTimers();
    const getTransactionHex = vi.fn()
      .mockRejectedValueOnce(new ElectrumRpcError('No such mempool or blockchain transaction'))
      .mockRejectedValueOnce(new ElectrumRpcError('No such mempool or blockchain transaction'))
      .mockResolvedValueOnce('00');
    const client = { connected: true, getTransactionHex } as unknown as NitoElectrumClient;

    const reconciliation = reconcileBroadcastTransactions({
      txids: ['ab'.repeat(32)],
      client,
      isCurrent: () => true,
    });
    await vi.runAllTimersAsync();

    await expect(reconciliation).resolves.toBe(true);
    expect(getTransactionHex).toHaveBeenCalledTimes(3);
  });

  it('does not hide malformed or unrelated Electrum failures as an absent transaction', async () => {
    vi.useFakeTimers();
    const client = {
      connected: true,
      getTransactionHex: vi.fn().mockRejectedValue(new Error('malformed response')),
    } as unknown as NitoElectrumClient;

    const reconciliation = reconcileBroadcastTransactions({
      txids: ['ab'.repeat(32)],
      client,
      isCurrent: () => true,
    });
    const failure = expect(reconciliation).rejects.toThrow('malformed response');
    await vi.advanceTimersByTimeAsync(250);

    await failure;
  });
});
