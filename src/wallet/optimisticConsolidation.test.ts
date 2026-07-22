import { describe, expect, it } from 'vitest';

import { applyOptimisticWalletBroadcast } from './optimisticConsolidation';
import type { TransparentWalletSnapshot } from './transparentScan';
import type { PreparedTransparentTx } from './transparentSend';

const mainAddress = 'nito1qmain';

const snapshot: TransparentWalletSnapshot = {
  confirmedSats: 30_000,
  unconfirmedSats: 0,
  balanceSats: 30_000,
  spendableSats: 30_000,
  utxos: [
    { txid: 'a', vout: 0, valueSats: 10_000, height: 100, address: mainAddress, confirmations: 5, isCoinbase: false },
    { txid: 'b', vout: 1, valueSats: 20_000, height: 101, address: mainAddress, confirmations: 4, isCoinbase: false },
  ],
  history: [],
  addresses: [{
    accountKey: 'bech32',
    accountLabel: 'Bech32',
    accountPath: "m/84'/0'/0'",
    address: mainAddress,
    path: "m/84'/0'/0'/0/0",
    scriptType: 'p2wpkh',
    spendable: true,
    branch: 'external',
    index: 0,
    balance: { confirmedSats: 30_000, unconfirmedSats: 0, totalSats: 30_000 },
    utxos: [
      { txid: 'a', vout: 0, valueSats: 10_000, height: 100, address: mainAddress, confirmations: 5, isCoinbase: false },
      { txid: 'b', vout: 1, valueSats: 20_000, height: 101, address: mainAddress, confirmations: 4, isCoinbase: false },
    ],
    history: [],
    used: true,
  }],
  usedAddresses: [],
  spendableAddresses: [],
  gapLimit: 20,
  scannedAt: new Date(0).toISOString(),
};

snapshot.usedAddresses = snapshot.addresses;
snapshot.spendableAddresses = snapshot.addresses;

const transaction: PreparedTransparentTx = {
  txid: 'prepared',
  hex: '00',
  feeSats: 500,
  inputCount: 2,
  outputCount: 1,
  changeUsed: false,
  walletInputs: [
    { txid: 'a', vout: 0, valueSats: 10_000, address: mainAddress },
    { txid: 'b', vout: 1, valueSats: 20_000, address: mainAddress },
  ],
  walletOutputs: [
    { vout: 0, valueSats: 29_500, address: mainAddress },
  ],
};

describe('applyOptimisticWalletBroadcast', () => {
  it('moves consolidated funds to pending immediately and only once', () => {
    const pending = applyOptimisticWalletBroadcast({
      snapshot,
      transaction,
      txid: 'broadcast',
    });

    expect(pending.spendableSats).toBe(0);
    expect(pending.confirmedSats).toBe(0);
    expect(pending.unconfirmedSats).toBe(29_500);
    expect(pending.balanceSats).toBe(29_500);
    expect(pending.utxos).toEqual([
      expect.objectContaining({ txid: 'broadcast', vout: 0, valueSats: 29_500, confirmations: 0 }),
    ]);

    const repeated = applyOptimisticWalletBroadcast({
      snapshot: pending,
      transaction,
      txid: 'broadcast',
    });
    expect(repeated.unconfirmedSats).toBe(29_500);
    expect(repeated.utxos).toHaveLength(1);
  });
});
