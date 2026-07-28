import { describe, expect, it } from 'vitest';

import { buildHistoryExportRecords } from '../services/historyExport';
import { applyOptimisticWalletBroadcast } from './optimisticConsolidation';
import type { TransparentWalletSnapshot } from './transparentScan';
import type { PreparedTransparentSend, PreparedTransparentTx } from './transparentSend';

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

  it('enriches an outgoing mempool entry immediately just like an incoming entry', async () => {
    const outgoing: PreparedTransparentSend = {
      ...transaction,
      feeSats: 500,
      walletOutputs: [
        { vout: 1, valueSats: 19_500, address: mainAddress },
      ],
      recipients: [
        { address: 'nito1qrecipient', amountSats: 10_000n },
      ],
    };

    const pending = applyOptimisticWalletBroadcast({
      snapshot,
      transaction: outgoing,
      txid: 'outgoing-mempool',
    });
    const incoming = await buildHistoryExportRecords({
      history: [{ txid: 'incoming-mempool', height: 0, address: mainAddress }],
      walletAddresses: [mainAddress],
      reader: {
        async getVerboseTransaction(txid: string) {
          if (txid === 'incoming-mempool') {
            return {
              vin: [{ txid: 'external-parent', vout: 0 }],
              vout: [{ n: 0, value: 0.0001, scriptPubKey: { address: mainAddress } }],
            };
          }
          return {
            vin: [{ coinbase: '00' }],
            vout: [{ n: 0, value: 0.000105, scriptPubKey: { address: 'external-source' } }],
          };
        },
      },
    });

    expect(pending.history[0]).toMatchObject({
      txid: 'outgoing-mempool',
      height: 0,
      direction: 'sent',
      amountSats: 10_000,
      feeSats: 500,
      counterparty: 'nito1qrecipient',
    });
    expect(incoming[0]).toMatchObject({
      txid: 'incoming-mempool',
      status: 'pending',
      direction: 'received',
      amountSats: 10_000,
    });
  });

  it('enriches an internal mempool entry from its prepared wallet outputs', () => {
    const pending = applyOptimisticWalletBroadcast({
      snapshot,
      transaction,
      txid: 'internal-mempool',
    });

    expect(pending.history[0]).toMatchObject({
      txid: 'internal-mempool',
      height: 0,
      direction: 'self',
      amountSats: 29_500,
      feeSats: 500,
      counterparty: mainAddress,
    });
  });
});
