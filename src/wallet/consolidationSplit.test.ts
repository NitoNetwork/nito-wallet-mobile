import { describe, expect, it, vi } from 'vitest';

import type { ScannedAddress, TransparentWalletSnapshot } from './transparentScan';
import { deriveP2wpkhAddress } from './transparentScan';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import {
  buildTransparentConsolidation,
  prepareUnsignedTransparentConsolidation,
} from './transparentSend';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const crypto = createNitoWalletCryptoTestDouble();

const makeConsolidationSnapshot = async (count: number, valueSats: number): Promise<TransparentWalletSnapshot> => {
  const primary = await deriveP2wpkhAddress(mnemonic, 'external', 0, crypto);
  const utxos = Array.from({ length: count }, (_, index) => ({
    txid: (index + 1).toString(16).padStart(64, '0'),
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

  it('forces an individually uneconomic dust input into a solvent consolidation batch', async () => {
    const snapshot = await makeConsolidationSnapshot(21, 100_000);
    const dust = { ...snapshot.utxos[0]!, valueSats: 1 };
    const utxos = [dust, ...snapshot.utxos.slice(1)];
    const total = utxos.reduce((sum, utxo) => sum + utxo.valueSats, 0);
    snapshot.utxos = utxos;
    snapshot.confirmedSats = total;
    snapshot.balanceSats = total;
    snapshot.spendableSats = total;
    snapshot.addresses[0] = {
      ...snapshot.addresses[0]!,
      balance: { confirmedSats: total, unconfirmedSats: 0, totalSats: total },
      utxos,
    };
    snapshot.usedAddresses = snapshot.addresses;
    snapshot.spendableAddresses = snapshot.addresses;

    const primary = snapshot.addresses[0]!.address;
    const plan = await buildTransparentConsolidation({
      mnemonic,
      snapshot,
      toAddress: primary,
      crypto,
    });

    const tx = plan.transactions[0]!;
    expect(tx.inputCount).toBe(21);
    expect(tx.walletInputs).toContainEqual(expect.objectContaining({
      txid: dust.txid,
      vout: dust.vout,
      valueSats: 1,
    }));
    const inputTotal = tx.walletInputs.reduce((sum, input) => sum + input.valueSats, 0);
    const outputTotal = tx.walletOutputs.reduce((sum, output) => sum + output.valueSats, 0);
    expect(inputTotal).toBe(outputTotal + tx.feeSats);
  });

  it('accepts a standard SegWit consolidation even when raw bytes exceed 100 kB', async () => {
    const snapshot = await makeConsolidationSnapshot(700, 100_000);
    const primary = snapshot.addresses[0]!.address;

    const plan = await buildTransparentConsolidation({
      mnemonic,
      snapshot,
      toAddress: primary,
      crypto,
    });

    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]!.inputCount).toBe(700);
    expect(plan.transactions[0]!.hex.length / 2).toBeGreaterThan(100_000);
  }, 15_000);

  it.each([
    [1_500, 4],
    [1_000, 2],
    [600, 1],
  ])('falls back to %i sat inputs with %i dust-safe outputs', async (valueSats, expectedOutputs) => {
    const snapshot = await makeConsolidationSnapshot(21, valueSats);
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
    expect(tx.outputCount).toBe(expectedOutputs);
    for (const output of tx.walletOutputs) {
      expect(output.valueSats).toBe(tx.walletOutputs[0]!.valueSats);
      expect(output.valueSats).toBeGreaterThanOrEqual(5_000);
    }
  });

  it('rejects consolidation when even one output would be below the safe floor', async () => {
    const snapshot = await makeConsolidationSnapshot(21, 300);
    const primary = snapshot.addresses[0]!.address;

    await expect(
      buildTransparentConsolidation({ mnemonic, snapshot, toAddress: primary, crypto }),
    ).rejects.toMatchObject({
      name: 'TransparentSendError',
      code: 'consolidation-unavailable',
    });
  });

  it('refuses to consolidate below the configured minimum UTXO count', async () => {
    const snapshot = await makeConsolidationSnapshot(20, 100_000);
    const primary = snapshot.addresses[0]!.address;

    await expect(
      buildTransparentConsolidation({ mnemonic, snapshot, toAddress: primary, crypto }),
    ).rejects.toMatchObject({
      name: 'TransparentSendError',
      code: 'consolidation-not-enough-utxos',
    });
  });

  it('prepares a 1,400-input review within the default test budget', async () => {
    const snapshot = await makeConsolidationSnapshot(1400, 100_000);
    const destinations = await crypto.deriveAddresses(mnemonic, [
      { path: "m/86'/0'/0'/1/0", scriptType: 'p2tr' },
      { path: "m/86'/0'/0'/1/1", scriptType: 'p2tr' },
    ]);
    const deriveAddresses = vi.fn(crypto.deriveAddresses);
    const signPsbt = vi.fn(crypto.signPsbt);
    const plan = await prepareUnsignedTransparentConsolidation({
      mnemonic,
      snapshot,
      toAddresses: destinations.map(({ address }) => address),
      crypto: { ...crypto, deriveAddresses, signPsbt },
    });

    expect(plan.transactions).toHaveLength(2);
    expect(deriveAddresses).toHaveBeenCalledTimes(2);
    expect(signPsbt).not.toHaveBeenCalled();
    const consumedOutpoints = new Set<string>();
    plan.transactions.forEach((transaction, index) => {
      expect(transaction).not.toHaveProperty('txid');
      expect(transaction.changeUsed).toBe(false);
      expect(transaction.walletInputs).toHaveLength(transaction.inputCount);
      expect(transaction.walletOutputs.length).toBeGreaterThan(0);
      expect(transaction.walletOutputs.every((output) => (
        output.address === destinations[index]?.address
      ))).toBe(true);
      expect(transaction.walletOutputs.every((output) => (
        output.valueSats === transaction.walletOutputs[0]?.valueSats
      ))).toBe(true);
      const inputTotal = transaction.walletInputs.reduce((sum, input) => {
        consumedOutpoints.add(`${input.txid}:${input.vout}`);
        return sum + input.valueSats;
      }, 0);
      const outputTotal = transaction.walletOutputs.reduce(
        (sum, output) => sum + output.valueSats,
        0,
      );
      expect(inputTotal).toBe(outputTotal + transaction.feeSats);
    });
    expect(consumedOutpoints.size).toBe(1400);
    expect(plan.inputCount).toBe(1400);
    expect(plan.totalFeeSats).toBe(
      plan.transactions.reduce((sum, transaction) => sum + transaction.feeSats, 0),
    );
  });
});
