import { describe, expect, it } from 'vitest';

import type { TransparentWalletSnapshot } from './transparentScan';
import { deriveP2wpkhAddress } from './transparentScan';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import {
  TransparentSendError,
  assertTransparentSendFitsAvailable,
  buildTransparentMultiSend,
  buildTransparentSend,
  calculateMaxTransparentSendAmount,
  estimateTransparentMultiSend,
  parseNitoAmountToSats,
} from './transparentSend';

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
        isCoinbase: false,
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
    expect(() => parseNitoAmountToSats('0.000000001')).toThrowError(
      expect.objectContaining({
        name: 'TransparentSendError',
        code: 'invalid-amount-format',
      }),
    );
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
      isCoinbase: false,
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
    ).rejects.toMatchObject({
      name: 'TransparentSendError',
      code: 'no-spendable-utxo',
    });
  });

  it('refuses the complete send when one spendable legacy UTXO lacks raw transaction data', async () => {
    const snapshot = await makeSnapshot();
    const [legacy] = await crypto.deriveAddresses(mnemonic, [{
      path: "m/44'/0'/0'/0/0",
      scriptType: 'p2pkh',
    }]);
    expect(legacy).toBeDefined();
    snapshot.addresses.push({
      ...snapshot.addresses[0]!,
      accountKey: 'legacy',
      accountLabel: 'Legacy',
      accountPath: "m/44'/0'/0'",
      scriptType: 'p2pkh',
      path: "m/44'/0'/0'/0/0",
      address: legacy!.address,
    });
    snapshot.utxos.push({
      txid: '33'.repeat(32),
      vout: 0,
      valueSats: 50_000_000,
      height: 100,
      address: legacy!.address,
      confirmations: 12,
      isCoinbase: false,
    });

    await expect(buildTransparentSend({
      mnemonic,
      snapshot,
      toAddress: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      amountSats: parseNitoAmountToSats('0.25'),
      crypto,
    })).rejects.toMatchObject({
      name: 'TransparentSendError',
      code: 'legacy-signing-data-unavailable',
    });
  });

  it('builds two recipients and applies Max to the second while keeping the first fixed', async () => {
    const snapshot = await makeSnapshot();
    const secondRecipient = await deriveP2wpkhAddress(mnemonic, 'external', 1, crypto);
    const outputs = [
      {
        address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
        amountSats: 25_000_000n,
      },
      {
        address: secondRecipient.address,
        amountSats: 0n,
      },
    ];
    const max = await calculateMaxTransparentSendAmount({
      mnemonic,
      snapshot,
      outputs,
      targetIndex: 1,
      crypto,
    });
    const tx = await buildTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs: [
        outputs[0]!,
        { ...outputs[1]!, amountSats: max.amountSats },
      ],
      crypto,
    });

    expect(tx.recipients.map((recipient) => recipient.amountSats)).toEqual([
      25_000_000n,
      max.amountSats,
    ]);
    expect(25_000_000n + max.amountSats + BigInt(tx.feeSats)).toBe(100_000_000n);
    expect(tx.changeUsed).toBe(false);
  });

  it('charges for N recipient outputs and N plus one outputs when change remains', async () => {
    const snapshot = await makeSnapshot();
    const secondRecipient = await deriveP2wpkhAddress(mnemonic, 'external', 1, crypto);
    const fixed = {
      address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      amountSats: 10_000_000n,
    };
    const target = {
      address: secondRecipient.address,
      amountSats: 0n,
    };
    const max = await calculateMaxTransparentSendAmount({
      mnemonic,
      snapshot,
      outputs: [fixed, target],
      targetIndex: 1,
      crypto,
    });
    const noChange = await buildTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs: [fixed, { ...target, amountSats: max.amountSats }],
      crypto,
    });
    const withChange = await buildTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs: [fixed, { ...target, amountSats: 10_000_000n }],
      crypto,
    });

    expect(noChange.outputCount).toBe(2);
    expect(withChange.outputCount).toBe(3);
    expect(withChange.feeSats).toBeGreaterThan(noChange.feeSats);
  });

  it('rejects the whole multi-recipient send when one output is dust', async () => {
    const secondRecipient = await deriveP2wpkhAddress(mnemonic, 'external', 1, crypto);
    await expect(buildTransparentMultiSend({
      mnemonic,
      snapshot: await makeSnapshot(),
      outputs: [
        {
          address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
          amountSats: 25_000_000n,
        },
        {
          address: secondRecipient.address,
          amountSats: 545n,
        },
      ],
      crypto,
    })).rejects.toMatchObject({
      name: 'TransparentSendError',
      code: 'recipient-output-dust',
    });
  });

  it('keeps duplicate recipients as distinct valid outputs', async () => {
    const address = 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02';
    const tx = await buildTransparentMultiSend({
      mnemonic,
      snapshot: await makeSnapshot(),
      outputs: [
        { address, amountSats: 10_000_000n },
        { address, amountSats: 20_000_000n },
      ],
      crypto,
    });

    expect(tx.recipients).toEqual([
      { address, amountSats: 10_000_000n },
      { address, amountSats: 20_000_000n },
    ]);
    expect(tx.outputCount).toBe(3);
  });

  it('keeps the single-recipient builder strictly equivalent to the multi-recipient path', async () => {
    const snapshot = await makeSnapshot();
    const address = 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02';
    const amountSats = 25_000_000n;
    const single = await buildTransparentSend({
      mnemonic,
      snapshot,
      toAddress: address,
      amountSats,
      crypto,
    });
    const multi = await buildTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs: [{ address, amountSats }],
      crypto,
    });

    expect(multi).toEqual(single);
  });

  it('quotes fees before signing and rejects an entered total equal to the available balance', async () => {
    const snapshot = await makeSnapshot();
    const quote = await estimateTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs: [{
        address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
        amountSats: BigInt(snapshot.spendableSats),
      }],
      crypto,
    });

    expect(quote.feeSats).toBeGreaterThan(0);
    expect(quote.amountSats).toBe(BigInt(snapshot.spendableSats));
    expect(quote.totalSats).toBeGreaterThan(BigInt(snapshot.spendableSats));
    expect(quote.fitsAvailable).toBe(false);
    expect(() => assertTransparentSendFitsAvailable(quote.fitsAvailable)).toThrowError(
      expect.objectContaining({
        name: 'TransparentSendError',
        code: 'insufficient-funds',
      }),
    );
    expect(() => assertTransparentSendFitsAvailable(true)).not.toThrow();
    expect(new TransparentSendError('insufficient-funds').message).toBe('insufficient-funds');
  });
});
