import { describe, expect, it, vi } from 'vitest';
import * as btc from '@scure/btc-signer';

import { MAX_MONEY_SATS, MAX_NITO_AMOUNT_INPUT_LENGTH } from '../constants/nito';
import type { TransparentWalletSnapshot } from './transparentScan';
import { deriveP2wpkhAddress } from './transparentScan';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import { deriveHdAddress, HD_ACCOUNT_TEMPLATES } from './hdAddress';
import {
  DUST_LIMIT_SATS,
  NITO_SIGNER_NETWORK,
  TransparentSendError,
  assertTransparentSendFitsAvailable,
  assertTransparentSendPlanMatches,
  assertUnsignedTransparentInputsAvailable,
  buildTransparentMultiSend,
  buildTransparentSend,
  calculateMaxTransparentSendAmount,
  changeAccountForRecipients,
  estimateTransparentMultiSend,
  parseNitoAmountToSats,
  prepareUnsignedTransparentMultiSend,
  signUnsignedTransparentTx,
} from './transparentSend';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const crypto = createNitoWalletCryptoTestDouble();

vi.mock('@scure/btc-signer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@scure/btc-signer')>();
  return { ...actual, selectUTXO: vi.fn(actual.selectUTXO) };
});

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
  it('chooses Core-compatible change for each family and mixed recipients independently of their order', async () => {
    const addresses = await Promise.all(HD_ACCOUNT_TEMPLATES.map(({ key }) => deriveHdAddress(mnemonic, key, 'external', 0, crypto)));
    for (const [index, address] of addresses.entries()) {
      expect(changeAccountForRecipients([address.address])).toBe(address.accountKey);
      const mixed = addresses.slice(0, index + 1).map((item) => item.address);
      expect(changeAccountForRecipients(mixed)).toBe(address.accountKey);
      expect(changeAccountForRecipients(mixed.reverse())).toBe(address.accountKey);
    }
    expect(changeAccountForRecipients([])).toBe('taproot');
    const witnessScript = btc.Address(NITO_SIGNER_NETWORK).encode({ type: 'wsh', hash: new Uint8Array(32).fill(1) });
    expect(changeAccountForRecipients([witnessScript])).toBe('bech32');
    expect(() => changeAccountForRecipients(['invalid'])).toThrow();
  });

  it.each([9_000_000n, 19_000_000_000n, 210_000_000_000n])('selects a sufficient single input for %s without immobilizing an unnecessarily large coin', async (amountSats) => {
    const snapshot = await makeSnapshot();
    snapshot.utxos = [200_000_000_000, 10_000_000, 20_000_000_000].map((valueSats, index) => ({
      ...snapshot.utxos[0]!, valueSats, txid: `${index + 1}`.repeat(64),
    }));
    snapshot.spendableSats = snapshot.utxos.reduce((sum, utxo) => sum + utxo.valueSats, 0);
    const prepared = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot,
      outputs: [{ address: snapshot.addresses[0]!.address, amountSats }], crypto });
    if (amountSats === 9_000_000n) expect(prepared.walletInputs.map((input) => input.valueSats)).toEqual([10_000_000]);
    if (amountSats === 19_000_000_000n) expect(prepared.walletInputs.map((input) => input.valueSats)).toEqual([20_000_000_000]);
    if (amountSats === 210_000_000_000n) expect(prepared.walletInputs.map((input) => input.valueSats).sort((a, b) => a - b)).toEqual([20_000_000_000, 200_000_000_000]);
    expect(prepared.walletInputs.reduce((sum, input) => sum + BigInt(input.valueSats), 0n))
      .toBe(prepared.transactionOutputs.reduce((sum, output) => sum + BigInt(output.valueSats), 0n) + BigInt(prepared.feeSats));
  });

  it('does not choose an input covering only the payment and excludes immature coins', async () => {
    const snapshot = await makeSnapshot();
    snapshot.utxos = [9_000_000, 10_000_000, 20_000_000].map((valueSats, index) => ({
      ...snapshot.utxos[0]!, valueSats, txid: `${index + 1}`.repeat(64), isCoinbase: index === 1, confirmations: 1,
    }));
    const prepared = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot,
      outputs: [{ address: snapshot.addresses[0]!.address, amountSats: 9_000_000n }], crypto });
    expect(prepared.walletInputs.map((input) => input.valueSats)).toEqual([20_000_000]);
  });

  it.each([2n, 100n])('accepts a smaller Bech32 input only within the fee tolerance at %s sat/vB', async (feePerVbyte) => {
    const snapshot = await makeSnapshot();
    const taproot = await deriveHdAddress(mnemonic, 'taproot', 'external', 0, crypto);
    snapshot.addresses.push({ ...snapshot.addresses[0]!, ...taproot });
    snapshot.utxos = [
      { ...snapshot.utxos[0]!, valueSats: 10_000_000 },
      { ...snapshot.utxos[0]!, txid: '33'.repeat(32), address: taproot.address, valueSats: 20_000_000 },
    ];
    const prepared = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot, crypto, feePerVbyte,
      outputs: [{ address: snapshot.addresses[0]!.address, amountSats: 9_000_000n }] });
    expect(prepared.walletInputs.map((input) => input.address))
      .toEqual([feePerVbyte === 2n ? snapshot.addresses[0]!.address : taproot.address]);
  });

  it.each([1n, 20n])('keeps real fees including dust within tolerance near the funding boundary at %s sat/vB', async (feePerVbyte) => {
    const snapshot = await makeSnapshot();
    const outputs = [{ address: snapshot.addresses[0]!.address, amountSats: 9_000_000n }];
    snapshot.utxos = [100_000, 2_000, 800, 300, 10_000, 500, 1_000].map((extra, index) => ({
      ...snapshot.utxos[0]!, valueSats: 9_000_000 + extra, txid: `${index + 1}`.repeat(64),
    }));
    const candidates = [];
    for (const utxo of snapshot.utxos) {
      try {
        candidates.push(await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot: { ...snapshot, utxos: [utxo] }, outputs, feePerVbyte, crypto }));
      } catch (error) {
        expect(error).toMatchObject({ code: 'insufficient-funds' });
      }
    }
    const minimumFee = Math.min(...candidates.map((candidate) => candidate.feeSats));
    const maximumFee = minimumFee + Math.min(Math.floor(minimumFee / 4), 1_000);
    const eligible = candidates.filter((candidate) => candidate.feeSats <= maximumFee)
      .sort((a, b) => a.walletInputs[0]!.valueSats - b.walletInputs[0]!.valueSats || a.feeSats - b.feeSats);
    const selected = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot, outputs, feePerVbyte, crypto });
    expect(selected.feeSats).toBe(eligible[0]!.feeSats);
    expect(selected.feeSats).toBeLessThanOrEqual(maximumFee);
    expect(selected.walletInputs).toEqual(eligible[0]!.walletInputs);
  });

  it('bounds the candidate search for 1500 UTXOs instead of trying every subset', async () => {
    const snapshot = await makeSnapshot();
    snapshot.utxos = Array.from({ length: 1500 }, (_, index) => ({ ...snapshot.utxos[0]!,
      valueSats: 10_000_000 + index * 100_000, txid: (index + 1).toString(16).padStart(64, '0') }));
    const select = vi.mocked(btc.selectUTXO);
    select.mockClear();
    try {
      const prepared = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot, crypto,
        outputs: [{ address: snapshot.addresses[0]!.address, amountSats: 9_000_000n }] });
      expect(prepared.walletInputs.map((input) => input.valueSats)).toEqual([10_000_000]);
      expect(select.mock.calls.length).toBeLessThanOrEqual(26);
    } finally {
      select.mockClear();
    }
  });

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

  it('accepts the consensus money limit and rejects larger or oversized input', () => {
    expect(parseNitoAmountToSats('1284565890.00000000')).toBe(MAX_MONEY_SATS);
    expect(() => parseNitoAmountToSats('1284565890.00000001')).toThrowError(
      expect.objectContaining({
        name: 'TransparentSendError',
        code: 'amount-above-max-money',
      }),
    );
    expect(() => parseNitoAmountToSats(`1${'0'.repeat(MAX_NITO_AMOUNT_INPUT_LENGTH)}`)).toThrowError(
      expect.objectContaining({
        name: 'TransparentSendError',
        code: 'invalid-amount-format',
      }),
    );
  });

  it('rejects a final recipient total above the consensus money limit', async () => {
    await expect(buildTransparentMultiSend({
      mnemonic,
      snapshot: await makeSnapshot(),
      outputs: [
        {
          address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
          amountSats: MAX_MONEY_SATS,
        },
        {
          address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
          amountSats: DUST_LIMIT_SATS,
        },
      ],
      crypto,
    })).rejects.toMatchObject({
      name: 'TransparentSendError',
      code: 'amount-above-max-money',
    });
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

  it('keeps review unsigned and signs only after a matching final reconstruction', async () => {
    const snapshot = await makeSnapshot();
    const signPsbt = vi.fn(crypto.signPsbt);
    const signingCrypto = { ...crypto, signPsbt };
    const outputs = [{
      address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      amountSats: 25_000_000n,
    }];
    const preview = await prepareUnsignedTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs,
      crypto: signingCrypto,
    });

    expect(signPsbt).not.toHaveBeenCalled();
    expect(preview).not.toHaveProperty('txid');
    expect(preview).not.toHaveProperty('hex');

    const rebuilt = await prepareUnsignedTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs,
      crypto: signingCrypto,
    });
    expect(() => assertTransparentSendPlanMatches(preview, rebuilt)).not.toThrow();
    const signed = await signUnsignedTransparentTx({
      mnemonic,
      transaction: rebuilt,
      crypto: signingCrypto,
    });

    expect(signPsbt).toHaveBeenCalledTimes(1);
    expect(signed.txid).toHaveLength(64);
    expect(signed.hex.length).toBeGreaterThan(100);
  });

  it('refuses to sign when the rebuilt fee differs from the reviewed plan', async () => {
    const snapshot = await makeSnapshot();
    const outputs = [{
      address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      amountSats: 25_000_000n,
    }];
    const preview = await prepareUnsignedTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs,
      feePerVbyte: 2n,
      crypto,
    });
    const rebuilt = await prepareUnsignedTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs,
      feePerVbyte: 3n,
      crypto,
    });

    expect(() => assertTransparentSendPlanMatches(preview, rebuilt)).toThrowError(
      expect.objectContaining({ code: 'review-changed' }),
    );
  });

  it('refuses a reviewed plan when its selected input disappeared before signing', async () => {
    const snapshot = await makeSnapshot();
    const transaction = await prepareUnsignedTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs: [{
        address: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
        amountSats: 25_000_000n,
      }],
      crypto,
    });
    const changed = { ...snapshot, utxos: [] };

    expect(() => assertUnsignedTransparentInputsAvailable(transaction, changed)).toThrowError(
      expect.objectContaining({ code: 'insufficient-funds' }),
    );
  });

  it('rejects a signer response that changes a reviewed transaction output', async () => {
    const snapshot = await makeSnapshot();
    const address = 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02';
    const reviewed = await prepareUnsignedTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs: [{ address, amountSats: 25_000_000n }],
      crypto,
    });
    const altered = await prepareUnsignedTransparentMultiSend({
      mnemonic,
      snapshot,
      outputs: [{ address, amountSats: 20_000_000n }],
      crypto,
    });
    const tamperingCrypto = {
      ...crypto,
      signPsbt: async () => crypto.signPsbt({
        mnemonic,
        psbtBase64: altered.psbtBase64,
        signers: altered.signers,
      }),
    };

    await expect(signUnsignedTransparentTx({
      mnemonic,
      transaction: reviewed,
      crypto: tamperingCrypto,
    })).rejects.toMatchObject({
      name: 'TransparentSendError',
      code: 'signing-material-unavailable',
    });
  });

  it('receives and spends a restored internal Taproot output with the native signing boundary', async () => {
    const snapshot = await makeSnapshot();
    const [internal] = await crypto.deriveAddresses(mnemonic, [{
      path: "m/86'/0'/0'/1/4",
      scriptType: 'p2tr',
    }]);
    expect(internal).toBeDefined();
    snapshot.addresses = [{
      ...snapshot.addresses[0]!,
      accountKey: 'taproot',
      accountLabel: 'Taproot',
      accountPath: "m/86'/0'/0'",
      scriptType: 'p2tr',
      branch: 'internal',
      index: 4,
      path: internal!.path,
      address: internal!.address,
      balance: { confirmedSats: 100_000_000, unconfirmedSats: 0, totalSats: 100_000_000 },
    }];
    snapshot.usedAddresses = snapshot.addresses;
    snapshot.spendableAddresses = snapshot.addresses;
    snapshot.utxos = [{
      txid: '4a'.repeat(32),
      vout: 0,
      valueSats: 100_000_000,
      height: 500,
      address: internal!.address,
      confirmations: 8,
      isCoinbase: false,
    }];

    const transaction = await buildTransparentSend({
      mnemonic,
      snapshot,
      toAddress: 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
      amountSats: 25_000_000n,
      changeAddress: internal!.address,
      crypto,
    });

    expect(transaction.walletInputs).toEqual([expect.objectContaining({
      txid: '4a'.repeat(32),
      address: internal!.address,
      valueSats: 100_000_000,
    })]);
    expect(transaction.txid).toHaveLength(64);
  });
});
