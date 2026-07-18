import { describe, expect, it } from 'vitest';

import type { TransparentWalletSnapshot } from './transparentScan';
import { deriveP2wpkhAddress } from './transparentScan';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import { buildTransparentSend, calculateMaxTransparentSendAmount, parseNitoAmountToSats } from './transparentSend';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const crypto = createNitoWalletCryptoTestDouble();

const makeSnapshot = async (): Promise<TransparentWalletSnapshot> => {
  const primary = await deriveP2wpkhAddress(mnemonic, 'external', 0, crypto);

  return {
    confirmedSats: 100_000_000,
    unconfirmedSats: 0,
    balanceSats: 100_000_000,
    spendableSats: 100_000_000,
    utxos: [
      {
        txid: '11'.repeat(32),
        vout: 0,
        valueSats: 100_000_000,
        height: 100,
        address: primary.address,
        confirmations: 12,
      },
    ],
    history: [{ txid: '22'.repeat(32), height: 100, address: primary.address }],
    addresses: [
      {
        ...primary,
        balance: { confirmedSats: 100_000_000, unconfirmedSats: 0, totalSats: 100_000_000 },
        utxos: [],
        history: [],
        used: true,
      },
    ],
    usedAddresses: [],
    spendableAddresses: [],
    gapLimit: 20,
    scannedAt: '2026-06-15T00:00:00.000Z',
  };
};

describe('transparent send builder', () => {
  it('parses NITO amounts into satoshis without floating point math', () => {
    expect(parseNitoAmountToSats('1')).toBe(100_000_000n);
    expect(parseNitoAmountToSats('0,12345678')).toBe(12_345_678n);
    expect(parseNitoAmountToSats('99 993,87651555')).toBe(9_999_387_651_555n);
    expect(() => parseNitoAmountToSats('0.000000001')).toThrow('Montant invalide');
  });

  it('builds and signs a local P2WPKH transaction without broadcasting', async () => {
    const tx = await buildTransparentSend({
      mnemonic,
      snapshot: await makeSnapshot(),
      toAddress: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      amountSats: parseNitoAmountToSats('0.25'),
      feePerVbyte: 2n,
      crypto,
    });

    expect(tx.hex.length).toBeGreaterThan(100);
    expect(tx.txid).toHaveLength(64);
    expect(tx.feeSats).toBeGreaterThan(0);
    expect(tx.inputCount).toBe(1);
    expect(tx.changeUsed).toBe(true);
  });

  it('calculates the exact max amount without a percentage haircut', async () => {
    const snapshot = await makeSnapshot();
    snapshot.confirmedSats = 100_000_000_000;
    snapshot.balanceSats = 100_000_000_000;
    snapshot.spendableSats = 100_000_000_000;
    snapshot.utxos = Array.from({ length: 4 }, (_, index) => ({
      txid: (index + 1).toString(16).padStart(2, '0').repeat(32),
      vout: 0,
      valueSats: 25_000_000_000,
      height: 100 + index,
      address: snapshot.addresses[0]!.address,
      confirmations: 12,
    }));
    snapshot.addresses[0]!.balance = { confirmedSats: 100_000_000_000, unconfirmedSats: 0, totalSats: 100_000_000_000 };

    const max = await calculateMaxTransparentSendAmount({
      mnemonic,
      snapshot,
      toAddress: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      crypto,
    });
    const tx = await buildTransparentSend({
      mnemonic,
      snapshot,
      toAddress: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      amountSats: max.amountSats,
      crypto,
    });

    expect(max.amountSats).toBeGreaterThan(99_999_900_000n);
    expect(max.amountSats + BigInt(tx.feeSats)).toBe(BigInt(snapshot.spendableSats));
    expect(tx.changeUsed).toBe(false);
  });

  it('refuses to spend unconfirmed UTXOs by default', async () => {
    const snapshot = await makeSnapshot();
    snapshot.utxos[0]!.confirmations = 0;

    await expect(
      buildTransparentSend({
        mnemonic,
        snapshot,
        toAddress: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
        amountSats: parseNitoAmountToSats('0.25'),
        crypto,
      }),
    ).rejects.toThrow('No confirmed UTXO');
  });
});
