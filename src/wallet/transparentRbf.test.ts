import * as btc from '@scure/btc-signer';
import { describe, expect, it, vi } from 'vitest';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import { deriveHdAddress, HD_ACCOUNT_TEMPLATES } from './hdAddress';
import { NITO_SIGNER_NETWORK, RBF_SEQUENCE, buildTransparentMultiSend, signUnsignedTransparentTx, prepareUnsignedTransparentConsolidation } from './transparentSend';
import { loadRbfOriginal, prepareRbfQuote, rbfNetworkFeeRate, sameRbfReview, assertSignedRbfFee } from './transparentRbf';
import type { TransactionLifecycleRecord } from '../services/transactionLifecycle';
import type { TransparentWalletSnapshot, ScannedAddress } from './transparentScan';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const crypto = createNitoWalletCryptoTestDouble();
const toHex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const fixture = async (accountKey: typeof HD_ACCOUNT_TEMPLATES[number]['key'] = 'bech32', fundingOutputs = 1) => {
  const input = await deriveHdAddress(mnemonic, accountKey, 'external', 0, crypto);
  const change = await deriveHdAddress(mnemonic, 'taproot', 'internal', 1, crypto);
  const destination = await deriveHdAddress(mnemonic, 'bech32', 'external', 5, crypto);
  const address = (derived: typeof input): ScannedAddress => ({ ...derived, accountLabel: accountKey,
    accountPath: derived.path.split('/').slice(0, 4).join('/'), spendable: true, used: true,
    utxos: [], history: [], balance: { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 } });
  const parent = new btc.Transaction();
  for (let index = 0; index < fundingOutputs; index += 1) parent.addOutputAddress(input.address, 100_000_000n / BigInt(fundingOutputs), NITO_SIGNER_NETWORK);
  parent.addInput({ txid: '11'.repeat(32), index: 0, finalScriptSig: new Uint8Array([0]) });
  const rawParent = toHex(parent.toBytes(true, true));
  const snapshot: TransparentWalletSnapshot = {
    confirmedSats: 100_000_000, unconfirmedSats: 0, balanceSats: 100_000_000, spendableSats: 100_000_000,
    addresses: [address(input), address(change)], usedAddresses: [], spendableAddresses: [],
    history: [], gapLimit: 20, scannedAt: new Date(0).toISOString(),
    utxos: Array.from({ length: fundingOutputs }, (_, vout) => ({ txid: parent.id, vout, valueSats: 100_000_000 / fundingOutputs, address: input.address, height: 10,
      confirmations: 200, isCoinbase: false, rawTx: rawParent })),
  };
  const original = await buildTransparentMultiSend({ mnemonic, snapshot, crypto, changeAddress: change.address,
    outputs: [{ address: destination.address, amountSats: 25_000_000n }, { address: destination.address, amountSats: 5_000_000n }] });
  const lifecycle: TransactionLifecycleRecord = {
    lifecycleId: 'original', walletId: 'wallet', purpose: 'send', state: 'published', txid: original.txid,
    rawTxHex: original.hex, address: change.address, derivationPath: change.path, addressIndex: change.index,
    broadcastInvocations: 1, recoveryAttempts: 1, nextBroadcastAttemptAt: null, lastBroadcastAttemptAt: 0,
  };
  const reader = {
    getTransactionHex: vi.fn(async (txid: string) => txid === original.txid ? original.hex : rawParent),
    getAddressHistory: vi.fn(async (address: string) => [
      { txid: original.txid, height: 0, address }, { txid: parent.id, height: 10, address },
    ]),
  };
  const next = await deriveHdAddress(mnemonic, 'taproot', 'internal', 2, crypto);
  return { snapshot, original, lifecycle, reader, next, input, parent, rawParent, destination };
};

describe('Nito replacement transactions', () => {
  it('keeps consolidation output count and split values while moving internal outputs to a fresh address', async () => {
    const f = await fixture('bech32', 32);
    const consolidation = await prepareUnsignedTransparentConsolidation({ mnemonic, snapshot: f.snapshot,
      toAddresses: [f.lifecycle.address!], crypto });
    // Use an actual multi-output template, with three equal internal destinations.
    const template = btc.Transaction.fromPSBT(Buffer.from(consolidation.transactions[0]!.psbtBase64, 'base64'));
    const split = new btc.Transaction();
    for (let index = 0; index < template.inputsLength; index += 1) split.addInput(template.getInput(index));
    for (const amount of [20_000_000n, 30_000_000n, 49_999_000n]) split.addOutputAddress(f.lifecycle.address!, amount, NITO_SIGNER_NETWORK);
    const outputs = Array.from({ length: split.outputsLength }, (_, index) => split.getOutput(index));
    const plan = { ...consolidation.transactions[0]!, psbtBase64: Buffer.from(split.toPSBT(0)).toString('base64'), feeSats: 1000,
      outputCount: 3, transactionOutputs: outputs.map((output) => ({ valueSats: Number(output.amount), scriptHex: toHex(output.script!) })) };
    const signed = await signUnsignedTransparentTx({ mnemonic, transaction: plan, crypto });
    const lifecycle = { ...f.lifecycle, txid: signed.txid, rawTxHex: signed.hex, purpose: 'consolidation' as const };
    f.reader.getTransactionHex.mockImplementation(async (id) => id === signed.txid ? signed.hex : f.rawParent);
    f.reader.getAddressHistory.mockResolvedValue([{ txid: signed.txid, height: 0, address: f.input.address }, { txid: f.parent.id, height: 10, address: f.input.address }]);
    const original = await loadRbfOriginal({ ...f, lifecycle, height: 210 });
    const quote = await prepareRbfQuote({ mnemonic, original, mode: 'accelerate', returnAddress: f.next.address, returnIndex: 2, networkRate: 20n, crypto });
    expect(quote.transaction.outputCount).toBe(3);
    expect(quote.transaction.walletOutputs.map((output) => output.address)).toEqual([f.next.address, f.next.address, f.next.address]);
    expect(quote.transaction.walletOutputs.map((output) => output.valueSats)).toContain(20_000_000);
    expect(quote.transaction.walletOutputs.map((output) => output.valueSats)).toContain(30_000_000);
    expect(quote.returnSats + quote.transaction.feeSats).toBe(100_000_000);
    const replacement = await signUnsignedTransparentTx({ mnemonic, transaction: quote.transaction, crypto });
    expect(() => assertSignedRbfFee(quote, replacement.hex, replacement.txid)).not.toThrow();
  });

  it('rejects a signer that silently removes RBF signaling', async () => {
    const f = await fixture();
    const original = await loadRbfOriginal({ ...f, height: 210 });
    const quote = await prepareRbfQuote({ mnemonic, original, mode: 'cancel', returnAddress: f.next.address, returnIndex: 2, networkRate: 3n, crypto });
    const altered = btc.Transaction.fromPSBT(Buffer.from(quote.transaction.psbtBase64, 'base64'));
    altered.updateInput(0, { sequence: 0xffff_ffff });
    await expect(signUnsignedTransparentTx({ mnemonic, transaction: quote.transaction,
      crypto: { ...crypto, signPsbt: async (request) => crypto.signPsbt({ ...request, psbtBase64: Buffer.from(altered.toPSBT(0)).toString('base64') }) },
    })).rejects.toMatchObject({ code: 'signing-material-unavailable' });
  });

  it.each(HD_ACCOUNT_TEMPLATES.map(({ key }) => key))('signals RBF and replaces exact %s inputs without reducing recipients', async (key) => {
    const f = await fixture(key);
    const before = structuredClone(f.snapshot);
    const original = await loadRbfOriginal({ ...f, height: 210 });
    const quote = await prepareRbfQuote({ mnemonic, original, mode: 'accelerate', returnAddress: f.next.address,
      returnIndex: 2, networkRate: rbfNetworkFeeRate(0.00002), crypto });
    const signed = await signUnsignedTransparentTx({ mnemonic, transaction: quote.transaction, crypto });
    const tx = btc.Transaction.fromRaw(Buffer.from(signed.hex, 'hex'));
    expect(tx.getInput(0).sequence).toBe(RBF_SEQUENCE);
    expect(toHex(tx.getInput(0).txid!)).toBe(f.parent.id);
    expect(quote.transaction.walletInputs).toEqual(f.original.walletInputs);
    const values = Array.from({ length: tx.outputsLength }, (_, i) => tx.getOutput(i).amount);
    expect(values).toContain(25_000_000n);
    expect(values).toContain(5_000_000n);
    expect(quote.transaction.feeSats).toBeGreaterThan(f.original.feeSats);
    expect(() => assertSignedRbfFee(quote, signed.hex, signed.txid)).not.toThrow();
    expect(f.snapshot).toEqual(before);
  });

  it('cancels to one newly derived internal output and requires a new review when fees change', async () => {
    const f = await fixture();
    const original = await loadRbfOriginal({ ...f, height: 210 });
    const args = { mnemonic, original, mode: 'cancel' as const, returnAddress: f.next.address, returnIndex: 2, networkRate: 3n, crypto };
    const quote = await prepareRbfQuote(args);
    expect(quote.transaction.outputCount).toBe(1);
    expect(quote.returnSats + quote.transaction.feeSats).toBe(100_000_000);
    expect(quote.transaction.walletOutputs[0]?.address).toBe(f.next.address);
    expect(sameRbfReview(quote, await prepareRbfQuote({ ...args, networkRate: 20n }))).toBe(false);
    await expect(prepareRbfQuote({ ...args, returnAddress: f.destination.address })).rejects.toMatchObject({ code: 'inconsistent' });
    await expect(prepareRbfQuote({ ...args, networkRate: 1_000_000n })).rejects.toMatchObject({ code: 'feeUnavailable' });
    await expect(prepareRbfQuote({ ...args, networkRate: 10_000n, original: { ...original,
      snapshot: { ...original.snapshot, utxos: original.snapshot.utxos.map((utxo) => ({ ...utxo, valueSats: 1000 })) },
    } })).rejects.toMatchObject({ code: 'insufficient' });
  });

  it('refuses a confirmed original, missing history, a malformed parent or an unknown owner', async () => {
    const f = await fixture();
    f.reader.getAddressHistory.mockResolvedValueOnce([{ txid: f.original.txid, height: 100, address: f.input.address }]);
    await expect(loadRbfOriginal({ ...f, height: 210 })).rejects.toMatchObject({ code: 'confirmed' });
    f.reader.getAddressHistory.mockResolvedValueOnce([]);
    await expect(loadRbfOriginal({ ...f, height: 210 })).rejects.toMatchObject({ code: 'unavailable' });
    f.reader.getTransactionHex.mockResolvedValueOnce('00');
    await expect(loadRbfOriginal({ ...f, height: 210 })).rejects.toMatchObject({ code: 'inconsistent' });
    await expect(loadRbfOriginal({ ...f, height: 210, snapshot: { ...f.snapshot, addresses: [] } })).rejects.toMatchObject({ code: 'inconsistent' });
  });

  it('refuses final sequences and never silently substitutes an unavailable network fee', async () => {
    const f = await fixture();
    const tx = new btc.Transaction();
    tx.addOutputAddress(f.next.address, 99_999_000n, NITO_SIGNER_NETWORK);
    tx.addInput({ txid: f.parent.id, index: 0, sequence: 0xffff_ffff, finalScriptSig: new Uint8Array([0]) });
    await expect(loadRbfOriginal({ ...f, height: 210, lifecycle: { ...f.lifecycle, txid: tx.id, rawTxHex: toHex(tx.toBytes(true, true)) } })).rejects.toMatchObject({ code: 'unavailable' });
    for (const value of [-1, 0, NaN, Infinity, '0.00002', null]) expect(() => rbfNetworkFeeRate(value)).toThrow();
    expect(rbfNetworkFeeRate(0.00002)).toBe(3n);
    expect(() => rbfNetworkFeeRate(0.1)).toThrow();
  });

  it('can resume an already signed replacement after mempool eviction but never after original confirmation', async () => {
    const f = await fixture();
    f.reader.getAddressHistory.mockResolvedValue([{ txid: f.parent.id, height: 10, address: f.input.address }]);
    f.reader.getTransactionHex.mockImplementation(async (id) => {
      if (id === f.original.txid) throw new Error('transaction not found');
      return f.rawParent;
    });
    const recovered = await loadRbfOriginal({ ...f, height: 210, resumeSignedReplacement: true });
    expect(recovered.transaction.id).toBe(f.original.txid);
    await expect(loadRbfOriginal({ ...f, height: 210 })).rejects.toThrow('transaction not found');
    f.reader.getAddressHistory.mockResolvedValue([{ txid: f.original.txid, height: 100, address: f.input.address }]);
    await expect(loadRbfOriginal({ ...f, height: 210, resumeSignedReplacement: true })).rejects.toMatchObject({ code: 'confirmed' });
  });
});
