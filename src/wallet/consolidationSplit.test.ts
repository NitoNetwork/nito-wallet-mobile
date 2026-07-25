import { describe, expect, it } from 'vitest';

import type { ScannedAddress, TransparentWalletSnapshot } from './transparentScan';
import { deriveP2wpkhAddress } from './transparentScan';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import { buildTransparentConsolidation } from './transparentSend';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const crypto = createNitoWalletCryptoTestDouble();

const makeConsolidationSnapshot = async (count: number, valueSats: number): Promise<TransparentWalletSnapshot> => {
  const primary = await deriveP2wpkhAddress(mnemonic, 'external', 0, crypto);
  const utxos = Array.from({ length: count }, (_, index) => ({
    txid: (index + 1).toString(16).padStart(2, '0').repeat(32),
    vout: 0,
    valueSats,
    height: 100 + index,
    address: primary.address,
    confirmations: 20,
    isCoinbase: false,
  }));
  const total = count * valueSats;
  const scanned: ScannedAddress = {
    ...primary,
    balance: { confirmedSats: total, unconfirmedSats: 0, totalSats: total },
    utxos,
    history: [],
    used: true,
  };

  return {
    confirmedSats: total,
    unconfirmedSats: 0,
    balanceSats: total,
    spendableSats: total,
    utxos,
    history: [],
    addresses: [scanned],
    usedAddresses: [scanned],
    spendableAddresses: [scanned],
    gapLimit: 20,
    scannedAt: '2026-06-15T00:00:00.000Z',
  };
};

describe('consolidation multi-output', () => {
  it('splits confirmed UTXOs into equal outputs on the primary address', async () => {
    const snapshot = await makeConsolidationSnapshot(21, 100_000);
    const primary = snapshot.addresses[0]!.address;

    const plan = await buildTransparentConsolidation({
      mnemonic,
      snapshot,
      toAddress: primary,
      crypto,
    });

    expect(plan.transactions).toHaveLength(1);
    const tx = plan.transactions[0]!;
    expect(tx.inputCount).toBe(21);
    expect(tx.changeUsed).toBe(false);
    expect(tx.outputCount).toBe(9);
    expect(plan.outputCount).toBe(9);

    expect(tx.walletOutputs).toHaveLength(9);
    for (const output of tx.walletOutputs) {
      expect(output.address).toBe(primary);
      expect(output.valueSats).toBe(tx.walletOutputs[0]!.valueSats);
    }

    const outputTotal = tx.walletOutputs.reduce((sum, output) => sum + output.valueSats, 0);
    expect(outputTotal + tx.feeSats).toBe(2_100_000);
  });

  it('reduces the number of outputs when amounts would fall below the dust-safe floor', async () => {
    const snapshot = await makeConsolidationSnapshot(21, 1_500);
    const primary = snapshot.addresses[0]!.address;

    const plan = await buildTransparentConsolidation({
      mnemonic,
      snapshot,
      toAddress: primary,
      crypto,
    });

    const tx = plan.transactions[0]!;
    expect(tx.inputCount).toBe(21);
    expect(tx.changeUsed).toBe(false);
    expect(tx.outputCount).toBeGreaterThanOrEqual(1);
    expect(tx.outputCount).toBeLessThan(9);
    for (const output of tx.walletOutputs) {
      expect(output.valueSats).toBe(tx.walletOutputs[0]!.valueSats);
      expect(output.valueSats).toBeGreaterThanOrEqual(5_000);
    }
  });

  it('refuses to consolidate below the configured minimum UTXO count', async () => {
    const snapshot = await makeConsolidationSnapshot(20, 100_000);
    const primary = snapshot.addresses[0]!.address;

    await expect(
      buildTransparentConsolidation({ mnemonic, snapshot, toAddress: primary, crypto }),
    ).rejects.toThrow('confirmed spendable outputs are required');
  });
});
