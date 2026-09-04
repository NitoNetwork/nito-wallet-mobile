import * as btc from '@scure/btc-signer';
import { MAX_MONEY_SATS } from '../constants/nito';
import type { NitoWalletCryptoApi } from '../native/nitoWalletCryptoContract';
import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
import type { ElectrumHistoryEntry } from '../network/electrum';
import { mapWithConcurrency } from '../services/concurrency';
import type { TransactionLifecycleRecord } from '../services/transactionLifecycle';
import type { ScannedAddress, TransparentWalletSnapshot } from './transparentScan';
import { isCoinbaseTransactionHex, isTransparentUtxoSpendable } from './coinbaseMaturity';
import { deriveHdAddress } from './hdAddress';
import {
  DUST_LIMIT_SATS, NITO_SIGNER_NETWORK, RBF_SEQUENCE, prepareSpendableInputs,
  type UnsignedTransparentTx,
} from './transparentSend';

export type ReplacementMode = 'accelerate' | 'cancel';
export type RbfErrorCode = 'unavailable' | 'confirmed' | 'inconsistent' | 'insufficient' | 'feeUnavailable';
export class RbfError extends Error {
  constructor(readonly code: RbfErrorCode) { super(code); this.name = 'RbfError'; }
}
export type RbfReader = {
  getTransactionHex(txid: string): Promise<string>;
  getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]>;
};
export type RbfOriginal = {
  lifecycle: TransactionLifecycleRecord;
  transaction: btc.Transaction;
  snapshot: TransparentWalletSnapshot;
  feeSats: bigint;
};
export type RbfQuote = {
  mode: ReplacementMode;
  originalTxid: string;
  originalLifecycleId: string;
  originalFeeSats: number;
  feePerVbyte: bigint;
  estimatedVbytes: number;
  returnSats: number;
  transaction: UnsignedTransparentTx;
};
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value: string) => Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16));
const script = (address: string) => {
  const decoded = btc.Address(NITO_SIGNER_NETWORK).decode(address);
  if (!decoded) throw new RbfError('inconsistent');
  return btc.OutScript.encode(decoded);
};
const validMoney = (value: bigint) => value >= 0n && value <= MAX_MONEY_SATS && value <= BigInt(Number.MAX_SAFE_INTEGER);
const readRaw = (raw: string, txid: string) => {
  if (raw.length > 1_600_000 || !/^(?:[a-f0-9]{2})+$/i.test(raw)) throw new RbfError('inconsistent');
  try {
    const tx = btc.Transaction.fromRaw(bytes(raw));
    if (tx.id !== txid.toLowerCase()) throw new RbfError('inconsistent');
    return tx;
  } catch { throw new RbfError('inconsistent'); }
};

/** A raw transaction alone cannot prove that it is still in the mempool. */
export const assertRbfOriginalPending = async (
  reader: RbfReader, txid: string, addresses: readonly string[],
  allowMissingOriginal = false,
): Promise<Map<string, ElectrumHistoryEntry[]>> => {
  if (!addresses.length) throw new RbfError('inconsistent');
  const unique = [...new Set(addresses)];
  const histories = await mapWithConcurrency(unique, 6, (address) => reader.getAddressHistory(address));
  const entries = histories.flatMap((history) => history.filter((entry) => entry.txid === txid));
  if (entries.some((entry) => entry.height > 0)) throw new RbfError('confirmed');
  if (!allowMissingOriginal && histories.some((history) => !history.some((entry) => entry.txid === txid && entry.height <= 0))) {
    throw new RbfError('unavailable');
  }
  return new Map(unique.map((address, index) => [address, histories[index]!]));
};

/** Rebuild signing data from verified parent transactions, not the spent UTXO cache. */
export const loadRbfOriginal = async ({ reader, lifecycle, snapshot, height, resumeSignedReplacement = false }: {
  reader: RbfReader; lifecycle: TransactionLifecycleRecord; snapshot: TransparentWalletSnapshot; height: number;
  resumeSignedReplacement?: boolean;
}): Promise<RbfOriginal> => {
  if (!Number.isSafeInteger(height) || height <= 0) throw new RbfError('unavailable');
  if (!lifecycle.txid || !lifecycle.rawTxHex || !['published', 'broadcast-uncertain'].includes(lifecycle.state)) {
    throw new RbfError('unavailable');
  }
  const transaction = readRaw(lifecycle.rawTxHex, lifecycle.txid);
  if (transaction.inputsLength === 0 || transaction.inputsLength > 2000) throw new RbfError('unavailable');
  const inputs = Array.from({ length: transaction.inputsLength }, (_, index) => transaction.getInput(index));
  if (inputs.some((input) => input.sequence === undefined || input.sequence >= 0xffff_fffe)) throw new RbfError('unavailable');
  const owners = new Map(snapshot.addresses.filter((owner) => owner.spendable).map((owner) => [hex(script(owner.address)), owner]));
  const parentIds = [...new Set(inputs.map((input) => {
    if (!input.txid || input.index === undefined) throw new RbfError('inconsistent');
    return hex(input.txid);
  }))];
  const parents = new Map(await mapWithConcurrency(parentIds, 6, async (txid) => {
    const raw = await reader.getTransactionHex(txid);
    return [txid, { raw, tx: readRaw(raw, txid) }] as const;
  }));
  const sources = inputs.map((input) => {
    const txid = hex(input.txid!);
    const parent = parents.get(txid)!;
    if (input.index! >= parent.tx.outputsLength) throw new RbfError('inconsistent');
    const output = parent.tx.getOutput(input.index!);
    if (!output.script || output.amount === undefined || !validMoney(output.amount)) throw new RbfError('inconsistent');
    const owner = owners.get(hex(output.script));
    if (!owner) throw new RbfError('inconsistent');
    return { txid, vout: input.index!, valueSats: Number(output.amount), address: owner.address,
      isCoinbase: isCoinbaseTransactionHex(parent.raw), rawTx: parent.raw };
  });
  if (!resumeSignedReplacement) {
    const networkRaw = await reader.getTransactionHex(lifecycle.txid);
    readRaw(networkRaw, lifecycle.txid);
    if (networkRaw.toLowerCase() !== lifecycle.rawTxHex.toLowerCase()) throw new RbfError('inconsistent');
  }
  // A previously signed replacement remains valid if a restarted server forgot
  // the original. Creation still requires observing the original in its mempool.
  const histories = await assertRbfOriginalPending(reader, lifecycle.txid, sources.map((source) => source.address), resumeSignedReplacement);
  const utxos = sources.map((source) => {
    const entry = histories.get(source.address)!.find((entry) => entry.txid === source.txid);
    // Normal sends select confirmed inputs only. A parent reorg requires a new
    // network view, never an invented confirmation or maturity value.
    if (!entry || entry.height <= 0 || entry.height > height) throw new RbfError('unavailable');
    const utxo = { ...source, height: entry.height, confirmations: height - entry.height + 1 };
    if (!isTransparentUtxoSpendable(utxo)) throw new RbfError('unavailable');
    return utxo;
  });
  if (new Set(utxos.map((utxo) => `${utxo.txid}:${utxo.vout}`)).size !== inputs.length) throw new RbfError('inconsistent');
  let outputTotal = 0n;
  for (let index = 0; index < transaction.outputsLength; index += 1) {
    const amount = transaction.getOutput(index).amount;
    if (amount === undefined || !validMoney(amount)) throw new RbfError('inconsistent');
    outputTotal += amount;
  }
  const inputTotal = utxos.reduce((sum, utxo) => sum + BigInt(utxo.valueSats), 0n);
  const feeSats = inputTotal - outputTotal;
  if (!validMoney(inputTotal) || !validMoney(outputTotal) || feeSats <= 0n) throw new RbfError('inconsistent');
  return { lifecycle, transaction, snapshot: { ...snapshot, utxos }, feeSats };
};

/** Electrum estimatefee is NITO/kB. A missing estimate is an explicit refusal. */
const MAX_RBF_FEE_PER_VBYTE = 10_000n;
export const rbfNetworkFeeRate = (estimate: unknown): bigint => {
  if (typeof estimate !== 'number' || !Number.isFinite(estimate) || estimate <= 0) throw new RbfError('feeUnavailable');
  const [mantissa, exponent = '0'] = estimate.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa!.split('.');
  const digits = BigInt(`${whole}${fraction}`);
  const power = 5 + Number(exponent) - fraction.length;
  const divisor = power < 0 ? 10n ** BigInt(-power) : 1n;
  const satsPerVbyte = power >= 0 ? digits * 10n ** BigInt(power) : (digits + divisor - 1n) / divisor;
  if (!validMoney(satsPerVbyte) || satsPerVbyte <= 0n) throw new RbfError('feeUnavailable');
  const rate = (satsPerVbyte * 120n + 99n) / 100n;
  if (rate > MAX_RBF_FEE_PER_VBYTE) throw new RbfError('feeUnavailable');
  return rate;
};

const INPUT_VBYTES: Record<ScannedAddress['scriptType'], number> = {
  p2pkh: 149, 'p2sh-p2wpkh': 92, p2wpkh: 69, p2tr: 58,
};
export const prepareRbfQuote = async ({ mnemonic, original, mode, returnAddress, returnIndex, networkRate, crypto = nitoWalletCrypto }: {
  mnemonic: string; original: RbfOriginal; mode: ReplacementMode; returnAddress: string;
  returnIndex: number; networkRate: bigint; crypto?: NitoWalletCryptoApi;
}): Promise<RbfQuote> => {
  if (networkRate <= 0n || networkRate > MAX_RBF_FEE_PER_VBYTE) throw new RbfError('feeUnavailable');
  const { transaction: old, lifecycle, snapshot } = original;
  const decodedReturn = btc.OutScript.decode(script(returnAddress));
  const derivedReturn = await deriveHdAddress(mnemonic, 'taproot', 'internal', returnIndex, crypto);
  if (decodedReturn.type !== 'tr' || derivedReturn.address !== returnAddress) throw new RbfError('inconsistent');
  const { spendable } = await prepareSpendableInputs(mnemonic, snapshot, crypto);
  const sources = new Map(spendable.map((source) => [`${source.signer.txid}:${source.signer.vout}`, source]));
  const ordered = Array.from({ length: old.inputsLength }, (_, index) => {
    const input = old.getInput(index);
    const source = sources.get(`${hex(input.txid!)}:${input.index}`);
    if (!source) throw new RbfError('inconsistent');
    return source;
  });
  const oldReturnScript = lifecycle.address ? hex(script(lifecycle.address)) : null;
  const preserved = [];
  const internalOutputs = [];
  let changeFound = false;
  if (mode === 'accelerate') {
    if (!snapshot.addresses.some((owner) => owner.address === lifecycle.address
      && owner.branch === 'internal' && owner.scriptType === 'p2tr'
      && owner.path === lifecycle.derivationPath && owner.index === lifecycle.addressIndex)) throw new RbfError('inconsistent');
    for (let index = 0; index < old.outputsLength; index += 1) {
      const output = old.getOutput(index);
      if (oldReturnScript && hex(output.script!) === oldReturnScript) {
        changeFound = true;
        internalOutputs.push(output.amount!);
      }
      else preserved.push({ script: output.script!, amount: output.amount! });
    }
    // Without a known internal change output, fee bumping would reduce a payment.
    if (!changeFound) throw new RbfError('insufficient');
    // Preserve consolidation splits. Only the largest internal output pays the
    // extra fee, and every internal output moves to the newly reserved address.
    internalOutputs.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    internalOutputs.pop();
    for (const amount of internalOutputs) preserved.push({ script: script(returnAddress), amount });
  }
  const feePerVbyte = networkRate > (original.feeSats + BigInt(old.vsize) - 1n) / BigInt(old.vsize) + 1n
    ? networkRate : (original.feeSats + BigInt(old.vsize) - 1n) / BigInt(old.vsize) + 1n;
  if (feePerVbyte > MAX_RBF_FEE_PER_VBYTE) throw new RbfError('feeUnavailable');
  // Conservative upper bound includes count varints and mixed-witness overhead.
  const estimatedVbytes = 18 + ordered.reduce((sum, source) => sum + INPUT_VBYTES[source.signer.scriptType], 0)
    + preserved.reduce((sum, output) => sum + 8 + 9 + output.script.length, 0) + 43;
  if (estimatedVbytes > 100_000) throw new RbfError('unavailable');
  const rateFee = feePerVbyte * BigInt(estimatedVbytes);
  // Nito Core policy/rbf.cpp PaysForRBF, default incremental relay fee 1000 sat/kB.
  const minimumFee = original.feeSats + BigInt(estimatedVbytes);
  const fee = rateFee > minimumFee ? rateFee : minimumFee;
  const inputTotal = ordered.reduce((sum, source) => sum + BigInt(source.valueSats), 0n);
  const returnSats = inputTotal - preserved.reduce((sum, output) => sum + output.amount, 0n) - fee;
  if (returnSats < DUST_LIMIT_SATS || !validMoney(fee) || !validMoney(returnSats)) throw new RbfError('insufficient');
  const tx = new btc.Transaction({ version: old.version, lockTime: old.lockTime });
  for (const source of ordered) tx.addInput({ ...source.input, sequence: RBF_SEQUENCE } as Parameters<typeof tx.addInput>[0]);
  const outputs = [...preserved, { script: script(returnAddress), amount: returnSats }]
    .sort((left, right) => left.amount === right.amount ? hex(left.script).localeCompare(hex(right.script)) : left.amount < right.amount ? -1 : 1);
  for (const output of outputs) tx.addOutput(output);
  const owned = new Map(snapshot.addresses.map((owner) => [hex(script(owner.address)), owner.address]));
  owned.set(hex(script(returnAddress)), returnAddress);
  return {
    mode, originalTxid: lifecycle.txid!, originalLifecycleId: lifecycle.lifecycleId,
    originalFeeSats: Number(original.feeSats), feePerVbyte, estimatedVbytes,
    returnSats: Number(returnSats + internalOutputs.reduce((sum, amount) => sum + amount, 0n)),
    transaction: {
      psbtBase64: btoa(Array.from(tx.toPSBT(0), (value) => String.fromCharCode(value)).join('')),
      signers: ordered.map((source) => source.signer),
      transactionInputs: ordered.map((source) => ({ txid: source.signer.txid, vout: source.signer.vout })),
      transactionOutputs: outputs.map((output) => ({ valueSats: Number(output.amount), scriptHex: hex(output.script) })),
      walletInputs: ordered.map((source) => ({ txid: source.signer.txid, vout: source.signer.vout, valueSats: source.valueSats, address: source.address })),
      walletOutputs: outputs.flatMap((output, vout) => {
        const address = owned.get(hex(output.script));
        return address ? [{ address, vout, valueSats: Number(output.amount) }] : [];
      }),
      feeSats: Number(fee), inputCount: ordered.length, outputCount: outputs.length, changeUsed: true,
    },
  };
};

export const sameRbfReview = (left: RbfQuote, right: RbfQuote): boolean => (
  left.mode === right.mode && left.originalTxid === right.originalTxid
  && left.transaction.feeSats === right.transaction.feeSats && left.returnSats === right.returnSats
  && left.transaction.inputCount === right.transaction.inputCount
  && left.transaction.outputCount === right.transaction.outputCount
);

export const assertSignedRbfFee = (quote: RbfQuote, rawTxHex: string, txid: string): void => {
  const tx = readRaw(rawTxHex, txid);
  const inputTotal = quote.transaction.walletInputs.reduce((sum, input) => sum + BigInt(input.valueSats), 0n);
  let outputTotal = 0n;
  for (let index = 0; index < tx.outputsLength; index += 1) outputTotal += tx.getOutput(index).amount!;
  if (inputTotal - outputTotal !== BigInt(quote.transaction.feeSats)
    || Array.from({ length: tx.inputsLength }, (_, index) => tx.getInput(index)).some((input) => input.sequence !== RBF_SEQUENCE)) {
    throw new RbfError('inconsistent');
  }
  if (tx.vsize > quote.estimatedVbytes || BigInt(quote.transaction.feeSats) < quote.feePerVbyte * BigInt(tx.vsize)
    || quote.transaction.feeSats - quote.originalFeeSats < tx.vsize) throw new RbfError('inconsistent');
};
