import * as btc from '@scure/btc-signer';

import {
  CONSOLIDATION_MIN_SATS_PER_OUTPUT,
  CONSOLIDATION_MIN_UTXOS,
  CONSOLIDATION_TARGET_OUTPUTS,
  MAX_MONEY_SATS,
  MAX_NITO_AMOUNT_INPUT_LENGTH,
} from '../constants/nito';
import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
import type {
  NativeDerivedAddress,
  NativePsbtSigner,
  NitoWalletCryptoApi,
} from '../native/nitoWalletCryptoContract';
import { isTransparentUtxoSpendable } from './coinbaseMaturity';
import type { ScannedAddress, TransparentWalletSnapshot } from './transparentScan';

export const NITO_SIGNER_NETWORK = {
  bech32: 'nito',
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
};

export const DEFAULT_FEE_PER_VBYTE = 2n;
export const DUST_LIMIT_SATS = 546n;

export type TransparentSendErrorCode =
  | 'invalid-amount-format'
  | 'amount-above-max-money'
  | 'amount-not-positive'
  | 'amount-below-dust'
  | 'signing-material-unavailable'
  | 'legacy-signing-data-unavailable'
  | 'no-spendable-utxo'
  | 'change-address-unavailable'
  | 'recipient-required'
  | 'recipient-address-required'
  | 'recipient-output-dust'
  | 'max-recipient-unavailable'
  | 'insufficient-funds'
  | 'consolidation-not-enough-utxos'
  | 'consolidation-unavailable'
  | 'consolidation-too-large';

export class TransparentSendError extends Error {
  readonly code: TransparentSendErrorCode;
  readonly detail?: unknown;

  constructor(code: TransparentSendErrorCode, detail?: unknown) {
    super(code);
    this.name = 'TransparentSendError';
    this.code = code;
    this.detail = detail;
  }
}

export const assertTransparentSendFitsAvailable = (fitsAvailable: boolean): void => {
  if (!fitsAvailable) {
    throw new TransparentSendError('insufficient-funds');
  }
};

export type PreparedTransparentTx = {
  txid: string;
  hex: string;
  feeSats: number;
  inputCount: number;
  outputCount: number;
  changeUsed: boolean;
  walletInputs: {
    txid: string;
    vout: number;
    valueSats: number;
    address: string;
  }[];
  walletOutputs: {
    vout: number;
    valueSats: number;
    address: string;
  }[];
};

type PlannedTransparentOutput = {
  valueSats: number;
  scriptHex: string;
};

export type UnsignedTransparentTx = Omit<PreparedTransparentTx, 'txid' | 'hex'> & {
  psbtBase64: string;
  signers: NativePsbtSigner[];
  transactionInputs: {
    txid: string;
    vout: number;
  }[];
  transactionOutputs: PlannedTransparentOutput[];
};

export type TransparentSendOutput = {
  address: string;
  amountSats: bigint;
};

export type PreparedTransparentSend = PreparedTransparentTx & {
  recipients: TransparentSendOutput[];
};

export type UnsignedTransparentSend = UnsignedTransparentTx & {
  recipients: TransparentSendOutput[];
};

export type MaxTransparentSendAmount = {
  amountSats: bigint;
  feeSats: number;
  inputCount: number;
  outputCount: number;
  changeUsed: boolean;
};

export type TransparentSendEstimate = Omit<MaxTransparentSendAmount, 'amountSats'> & {
  amountSats: bigint;
  totalSats: bigint;
  fitsAvailable: boolean;
};

export const parseNitoAmountToSats = (amount: string) => {
  if (amount.length > MAX_NITO_AMOUNT_INPUT_LENGTH) {
    throw new TransparentSendError('invalid-amount-format');
  }

  const normalized = amount.trim().replace(/[\s\u00a0\u202f']/g, '').replace(',', '.');

  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) {
    throw new TransparentSendError('invalid-amount-format');
  }

  const [whole = '0', fraction = ''] = normalized.split('.');
  const sats = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));

  if (sats <= 0n) {
    throw new TransparentSendError('amount-not-positive');
  }

  if (sats > MAX_MONEY_SATS) {
    throw new TransparentSendError('amount-above-max-money');
  }

  if (sats < DUST_LIMIT_SATS) {
    throw new TransparentSendError('amount-below-dust');
  }

  return sats;
};

const addressOwnerMap = (snapshot: TransparentWalletSnapshot) => {
  const owners = new Map<string, ScannedAddress>();

  for (const address of snapshot.addresses) {
    owners.set(address.address, address);
  }

  return owners;
};

const hexToBytes = (value: string) => Uint8Array.from(value.match(/.{1,2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
const bytesToBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const spendForMaterial = (material: NativeDerivedAddress) => {
  const spend: Record<string, unknown> = {
    address: material.address,
    script: hexToBytes(material.scriptHex),
  };
  if (material.redeemScriptHex) {
    spend.redeemScript = hexToBytes(material.redeemScriptHex);
  }
  if (material.tapInternalKeyHex) {
    spend.tapInternalKey = hexToBytes(material.tapInternalKeyHex);
  }
  return spend;
};

type PreparedSpendableInput = {
  input: Record<string, unknown>;
  signer: NativePsbtSigner;
  valueSats: number;
  address: string;
};

const bytesToHex = (value: Uint8Array) => Array.from(
  value,
  (byte) => byte.toString(16).padStart(2, '0'),
).join('');

const cloneInput = (input: Record<string, unknown>) => ({
  ...input,
  witnessUtxo:
    input.witnessUtxo && typeof input.witnessUtxo === 'object'
      ? { ...(input.witnessUtxo as Record<string, unknown>) }
      : input.witnessUtxo,
});

const prepareSpendableInputs = async (
  mnemonic: string,
  snapshot: TransparentWalletSnapshot,
  crypto: NitoWalletCryptoApi,
) => {
  const owners = addressOwnerMap(snapshot);
  const spendable: PreparedSpendableInput[] = [];
  const candidates = snapshot.utxos
    .filter(isTransparentUtxoSpendable)
    .map((utxo) => ({ utxo, owner: owners.get(utxo.address) }))
    .filter((candidate): candidate is typeof candidate & { owner: ScannedAddress } => Boolean(candidate.owner?.spendable));
  const uniqueOwners = [...new Map(candidates.map(({ owner }) => [owner.path, owner])).values()];
  const materials = uniqueOwners.length > 0
    ? await crypto.deriveAddresses(
        mnemonic,
        uniqueOwners.map((owner) => ({ path: owner.path, scriptType: owner.scriptType })),
      )
    : [];
  const materialByPath = new Map(materials.map((material) => [material.path, material]));

  for (const { utxo, owner } of candidates) {
    const material = materialByPath.get(owner.path);
    if (!material) {
      throw new TransparentSendError(
        'signing-material-unavailable',
        new Error(`Native HD material unavailable for ${owner.path}.`),
      );
    }
    const spend = spendForMaterial(material);

    const input: Record<string, unknown> = {
      ...spend,
      txid: utxo.txid,
      index: utxo.vout,
    };

    if (owner.scriptType === 'p2pkh') {
      if (!utxo.rawTx) {
        throw new TransparentSendError('legacy-signing-data-unavailable');
      }

      input.nonWitnessUtxo = utxo.rawTx;
    } else {
      input.witnessUtxo = {
        script: spend.script,
        amount: BigInt(utxo.valueSats),
      };
    }

    spendable.push({
      input,
      signer: {
        txid: utxo.txid,
        vout: utxo.vout,
        path: owner.path,
        scriptType: owner.scriptType,
      },
      valueSats: utxo.valueSats,
      address: utxo.address,
    });
  }

  if (spendable.length === 0) {
    throw new TransparentSendError('no-spendable-utxo');
  }

  return {
    spendable,
    totalSats: spendable.reduce((total, utxo) => total + BigInt(utxo.valueSats), 0n),
  };
};

const resolveChangeAddress = (snapshot: TransparentWalletSnapshot, changeAddress?: string) => {
  const primaryChange = snapshot.addresses.find(
    (address) => address.branch === 'external' && address.index === 0 && address.scriptType === 'p2wpkh',
  )?.address;
  const resolvedChangeAddress = changeAddress || primaryChange;

  if (!resolvedChangeAddress) {
    throw new TransparentSendError('change-address-unavailable');
  }

  return resolvedChangeAddress;
};

const selectSpend = ({
  spendable,
  outputs,
  feePerVbyte,
  changeAddress,
}: {
  spendable: PreparedSpendableInput[];
  outputs: { address: string; amount: bigint }[];
  feePerVbyte: bigint;
  changeAddress: string;
}) => {
  const inputs = spendable.map((utxo) => cloneInput(utxo.input)) as Parameters<typeof btc.selectUTXO>[0];

  return btc.selectUTXO(
    inputs,
    outputs.map((output) => ({ address: output.address.trim(), amount: output.amount })),
    'default',
    {
      changeAddress,
      feePerByte: feePerVbyte,
      bip69: true,
      createTx: true,
      network: NITO_SIGNER_NETWORK,
    },
  );
};

type CalculateMaxTransparentSendAmountArgs = {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  feePerVbyte?: bigint;
  changeAddress?: string;
  crypto?: NitoWalletCryptoApi;
} & (
  {
    toAddress: string;
    outputs?: never;
    targetIndex?: never;
  }
  | {
    toAddress?: never;
    outputs: TransparentSendOutput[];
    targetIndex: number;
  }
);

const normalizeSendOutputs = (outputs: TransparentSendOutput[]) => {
  if (outputs.length === 0) {
    throw new TransparentSendError('recipient-required');
  }

  let totalSats = 0n;
  return outputs.map((output) => {
    const address = output.address.trim();
    if (!address) {
      throw new TransparentSendError('recipient-address-required');
    }
    if (output.amountSats < DUST_LIMIT_SATS) {
      throw new TransparentSendError('recipient-output-dust');
    }
    if (output.amountSats > MAX_MONEY_SATS) {
      throw new TransparentSendError('amount-above-max-money');
    }
    totalSats += output.amountSats;
    if (totalSats > MAX_MONEY_SATS) {
      throw new TransparentSendError('amount-above-max-money');
    }
    return { address, amountSats: output.amountSats };
  });
};

export const calculateMaxTransparentSendAmount = (
  args: CalculateMaxTransparentSendAmountArgs,
): Promise<MaxTransparentSendAmount> => {
  return (async () => {
  const {
    mnemonic,
    snapshot,
    feePerVbyte = DEFAULT_FEE_PER_VBYTE,
    changeAddress,
    crypto = nitoWalletCrypto,
  } = args;
  const { spendable, totalSats } = await prepareSpendableInputs(mnemonic, snapshot, crypto);
  const resolvedChangeAddress = resolveChangeAddress(snapshot, changeAddress);
  const multiOutputs = args.outputs;
  const targetIndex = multiOutputs ? (args.targetIndex ?? 0) : 0;
  const candidateOutputs = multiOutputs
    ? multiOutputs.map((output) => ({ ...output, address: output.address.trim() }))
    : [{ address: args.toAddress.trim(), amountSats: 0n }];
  if (
    targetIndex < 0
    || targetIndex >= candidateOutputs.length
    || !candidateOutputs[targetIndex]?.address
  ) {
    throw new TransparentSendError('max-recipient-unavailable');
  }
  const fixedOutputs = candidateOutputs.filter((_, index) => index !== targetIndex);
  if (fixedOutputs.length > 0) {
    normalizeSendOutputs(fixedOutputs);
  }
  const fixedTotalSats = fixedOutputs.reduce((total, output) => total + output.amountSats, 0n);
  let low = DUST_LIMIT_SATS;
  const availableForTarget = totalSats - fixedTotalSats;
  const policyForTarget = MAX_MONEY_SATS - fixedTotalSats;
  let high = availableForTarget < policyForTarget ? availableForTarget : policyForTarget;
  let best: MaxTransparentSendAmount | null = null;

  while (low <= high) {
    const amountSats = (low + high) / 2n;
    const selected = selectSpend({
      spendable,
      outputs: candidateOutputs.map((output, index) => ({
        address: output.address,
        amount: index === targetIndex ? amountSats : output.amountSats,
      })),
      feePerVbyte,
      changeAddress: resolvedChangeAddress,
    });

    if (selected?.tx) {
      best = {
        amountSats,
        feeSats: Number(selected.tx.fee || selected.fee),
        inputCount: selected.inputs.length,
        outputCount: selected.outputs.length,
        changeUsed: selected.change,
      };
      low = amountSats + 1n;
    } else {
      high = amountSats - 1n;
    }
  }

  if (!best) {
    throw new TransparentSendError('insufficient-funds');
  }

  return best;
  })();
};

export const estimateTransparentMultiSend = async ({
  mnemonic,
  snapshot,
  outputs,
  feePerVbyte = DEFAULT_FEE_PER_VBYTE,
  changeAddress,
  crypto = nitoWalletCrypto,
}: {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  outputs: TransparentSendOutput[];
  feePerVbyte?: bigint;
  changeAddress?: string;
  crypto?: NitoWalletCryptoApi;
}): Promise<TransparentSendEstimate> => {
  const normalizedOutputs = normalizeSendOutputs(outputs);
  const { spendable } = await prepareSpendableInputs(mnemonic, snapshot, crypto);
  const selected = selectSpend({
    spendable,
    outputs: normalizedOutputs.map((output) => ({
      address: output.address,
      amount: output.amountSats,
    })),
    feePerVbyte,
    changeAddress: resolveChangeAddress(snapshot, changeAddress),
  });
  const amountSats = normalizedOutputs.reduce(
    (total, output) => total + output.amountSats,
    0n,
  );

  if (selected?.tx) {
    const feeSats = Number(selected.tx.fee || selected.fee);
    return {
      amountSats,
      feeSats,
      totalSats: amountSats + BigInt(feeSats),
      fitsAvailable: true,
      inputCount: selected.inputs.length,
      outputCount: selected.outputs.length,
      changeUsed: selected.change,
    };
  }

  const targetIndex = normalizedOutputs.length - 1;
  const max = await calculateMaxTransparentSendAmount({
    mnemonic,
    snapshot,
    outputs: normalizedOutputs,
    targetIndex,
    feePerVbyte,
    changeAddress,
    crypto,
  });

  return {
    amountSats,
    feeSats: max.feeSats,
    totalSats: amountSats + BigInt(max.feeSats),
    fitsAvailable: false,
    inputCount: max.inputCount,
    outputCount: max.outputCount,
    changeUsed: max.changeUsed,
  };
};

const MAX_STANDARD_CONSOLIDATION_VBYTES = 90_000;
const CONSOLIDATION_TX_OVERHEAD_VBYTES = 11;
const CONSOLIDATION_OUTPUT_VBYTES = 31;
const CONSOLIDATION_INPUT_VBYTES: Record<string, number> = {
  'p2pkh': 148,
  'p2sh-p2wpkh': 91,
  'p2wpkh': 68,
  'p2tr': 58,
};
const CONSOLIDATION_OUTPUT_STEPS = [CONSOLIDATION_TARGET_OUTPUTS, 4, 2, 1];

export type PreparedTransparentConsolidation = {
  transactions: PreparedTransparentTx[];
  inputCount: number;
  outputCount: number;
  totalFeeSats: number;
};

export type UnsignedTransparentConsolidation = {
  transactions: UnsignedTransparentTx[];
  inputCount: number;
  outputCount: number;
  totalFeeSats: number;
};

const calculateMaxEqualSplit = async ({
  mnemonic,
  snapshot,
  toAddress,
  outputCount,
  feePerVbyte,
  crypto,
}: {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  toAddress: string;
  outputCount: number;
  feePerVbyte: bigint;
  crypto: NitoWalletCryptoApi;
}): Promise<bigint | null> => {
  const { spendable, totalSats } = await prepareSpendableInputs(mnemonic, snapshot, crypto);
  const resolvedChangeAddress = resolveChangeAddress(snapshot, toAddress);
  const count = BigInt(outputCount);
  let low = DUST_LIMIT_SATS;
  let high = totalSats / count;
  let best: bigint | null = null;

  while (low <= high) {
    const perOutput = (low + high) / 2n;
    const outputs = Array.from({ length: outputCount }, () => ({ address: toAddress, amount: perOutput }));
    const selected = selectSpend({ spendable, outputs, feePerVbyte, changeAddress: resolvedChangeAddress });

    if (selected?.tx) {
      best = perOutput;
      low = perOutput + 1n;
    } else {
      high = perOutput - 1n;
    }
  }

  return best;
};

export const prepareUnsignedTransparentConsolidation = async ({
  mnemonic,
  snapshot,
  toAddresses,
  feePerVbyte = DEFAULT_FEE_PER_VBYTE,
  crypto = nitoWalletCrypto,
}: {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  toAddresses: readonly string[];
  feePerVbyte?: bigint;
  crypto?: NitoWalletCryptoApi;
}): Promise<UnsignedTransparentConsolidation> => {
  if (toAddresses.length === 0 || toAddresses.some((address) => address.trim() === '')) {
    throw new TransparentSendError('change-address-unavailable');
  }
  const confirmedUtxos = snapshot.utxos
    .filter(isTransparentUtxoSpendable)
    .sort((left, right) => left.valueSats - right.valueSats);
  if (confirmedUtxos.length < CONSOLIDATION_MIN_UTXOS) {
    throw new TransparentSendError('consolidation-not-enough-utxos');
  }

  const scriptTypes = new Map(
    snapshot.addresses.map((address) => [address.address, address.scriptType] as const),
  );
  const outputsBaseVbytes = CONSOLIDATION_TX_OVERHEAD_VBYTES + CONSOLIDATION_TARGET_OUTPUTS * CONSOLIDATION_OUTPUT_VBYTES;
  const batches: typeof confirmedUtxos[] = [];
  let batch: typeof confirmedUtxos = [];
  let estimatedVbytes = outputsBaseVbytes;

  for (const utxo of confirmedUtxos) {
    const inputVbytes = CONSOLIDATION_INPUT_VBYTES[scriptTypes.get(utxo.address) ?? 'p2wpkh'] ?? 148;
    if (batch.length > 0 && estimatedVbytes + inputVbytes > MAX_STANDARD_CONSOLIDATION_VBYTES) {
      batches.push(batch);
      batch = [];
      estimatedVbytes = outputsBaseVbytes;
    }
    batch.push(utxo);
    estimatedVbytes += inputVbytes;
  }
  if (batch.length > 0) batches.push(batch);

  const usefulBatches = batches.filter((candidate) => candidate.length >= 2);
  if (usefulBatches.length === 0) {
    throw new TransparentSendError('consolidation-unavailable');
  }

  const transactions: UnsignedTransparentTx[] = [];
  for (const [batchIndex, utxos] of usefulBatches.entries()) {
    const batchSnapshot: TransparentWalletSnapshot = { ...snapshot, utxos };
    const toAddress = toAddresses[Math.min(batchIndex, toAddresses.length - 1)]!;
    let built: UnsignedTransparentTx | null = null;

    for (const target of CONSOLIDATION_OUTPUT_STEPS) {
      const outputCount = Math.min(target, utxos.length);
      if (outputCount < 1) continue;

      const perOutput = await calculateMaxEqualSplit({
        mnemonic,
        snapshot: batchSnapshot,
        toAddress,
        outputCount,
        feePerVbyte,
        crypto,
      });
      if (perOutput === null || perOutput < BigInt(CONSOLIDATION_MIN_SATS_PER_OUTPUT)) {
        continue;
      }

      const outputs = Array.from({ length: outputCount }, () => ({ address: toAddress, amount: perOutput }));
      const transaction = await prepareUnsignedTransparentTx({
        mnemonic,
        snapshot: batchSnapshot,
        outputs,
        feePerVbyte,
        changeAddress: toAddress,
        ownedOutputAddresses: [toAddress],
        crypto,
      });
      if (
        transaction.inputCount !== utxos.length
        || transaction.changeUsed
        || transaction.outputCount !== outputCount
      ) {
        continue;
      }
      built = transaction;
      break;
    }

    if (!built) {
      throw new TransparentSendError('consolidation-unavailable');
    }
    transactions.push(built);
  }

  return {
    transactions,
    inputCount: transactions.reduce((total, transaction) => total + transaction.inputCount, 0),
    outputCount: transactions.reduce((total, transaction) => total + transaction.outputCount, 0),
    totalFeeSats: transactions.reduce((total, transaction) => total + transaction.feeSats, 0),
  };
};

const prepareUnsignedTransparentTx = ({
  mnemonic,
  snapshot,
  outputs,
  feePerVbyte = DEFAULT_FEE_PER_VBYTE,
  changeAddress,
  ownedOutputAddresses = [],
  crypto = nitoWalletCrypto,
}: {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  outputs: { address: string; amount: bigint }[];
  feePerVbyte?: bigint;
  changeAddress?: string;
  ownedOutputAddresses?: readonly string[];
  crypto?: NitoWalletCryptoApi;
}): Promise<UnsignedTransparentTx> => {
  return (async () => {
  const { spendable } = await prepareSpendableInputs(mnemonic, snapshot, crypto);
  const resolvedChangeAddress = resolveChangeAddress(snapshot, changeAddress);
  const selected = selectSpend({
    spendable,
    outputs,
    feePerVbyte,
    changeAddress: resolvedChangeAddress,
  });

  if (!selected || !selected.tx) {
    throw new TransparentSendError('insufficient-funds');
  }

  const spendableByOutpoint = new Map(spendable.map((item) => [
    `${item.signer.txid}:${item.signer.vout}`,
    item,
  ]));
  const walletInputs = selected.inputs.flatMap((input) => {
    if (input.index === undefined) return [];
    const txids = typeof input.txid === 'string'
      ? [input.txid]
      : input.txid instanceof Uint8Array
        ? [bytesToHex(input.txid), bytesToHex(Uint8Array.from(input.txid).reverse())]
        : [];
    const source = txids
      .map((txid) => spendableByOutpoint.get(`${txid}:${input.index}`))
      .find((candidate) => candidate !== undefined);
    return source ? [{
      txid: source.signer.txid,
      vout: source.signer.vout,
      valueSats: source.valueSats,
      address: source.address,
    }] : [];
  });

  const addressCodec = btc.Address(NITO_SIGNER_NETWORK);
  const ownedAddressByScript = new Map<string, string>();
  for (const owner of snapshot.addresses) {
    const script = btc.OutScript.encode(
      addressCodec.decode(owner.address) as Parameters<typeof btc.OutScript.encode>[0],
    );
    ownedAddressByScript.set(bytesToHex(script), owner.address);
  }
  const ownedAddressByAddress = new Map(
    [
      ...snapshot.addresses.map((owner) => owner.address),
      resolvedChangeAddress,
      ...ownedOutputAddresses,
    ].map((address) => [address.toLowerCase(), address]),
  );
  const walletOutputs = selected.outputs.flatMap((output, vout) => {
    const address = 'address' in output
      ? ownedAddressByAddress.get(output.address.toLowerCase())
      : output.script instanceof Uint8Array
        ? ownedAddressByScript.get(bytesToHex(output.script))
        : undefined;
    return address ? [{ vout, valueSats: Number(output.amount), address }] : [];
  });

  const selectedOutpoints = new Set(walletInputs.map((input) => `${input.txid}:${input.vout}`));
  const signers = spendable
    .filter(({ signer }) => selectedOutpoints.has(`${signer.txid}:${signer.vout}`))
    .map(({ signer }) => signer);
  if (signers.length !== selected.inputs.length || walletInputs.length !== selected.inputs.length) {
    throw new TransparentSendError('signing-material-unavailable');
  }

  return {
    psbtBase64: bytesToBase64(selected.tx.toPSBT(0)),
    signers,
    transactionInputs: walletInputs.map(({ txid, vout }) => ({ txid, vout })),
    transactionOutputs: selected.outputs.map((output) => ({
      valueSats: Number(output.amount),
      scriptHex: 'address' in output
        ? bytesToHex(btc.OutScript.encode(
          addressCodec.decode(output.address) as Parameters<typeof btc.OutScript.encode>[0],
        ))
        : bytesToHex(output.script),
    })),
    feeSats: Number(selected.tx.fee || selected.fee),
    inputCount: selected.inputs.length,
    outputCount: selected.outputs.length,
    changeUsed: selected.change,
    walletInputs,
    walletOutputs,
  };
  })();
};

const inputTxidCandidates = (txid: string | Uint8Array | undefined): string[] => {
  if (typeof txid === 'string') return [txid.toLowerCase()];
  if (!(txid instanceof Uint8Array)) return [];
  return [bytesToHex(txid), bytesToHex(Uint8Array.from(txid).reverse())];
};

export const signUnsignedTransparentTx = async ({
  mnemonic,
  transaction,
  crypto = nitoWalletCrypto,
}: {
  mnemonic: string;
  transaction: UnsignedTransparentTx;
  crypto?: NitoWalletCryptoApi;
}): Promise<PreparedTransparentTx> => {
  const signed = await crypto.signPsbt({
    mnemonic,
    psbtBase64: transaction.psbtBase64,
    signers: transaction.signers,
  });
  const signedTransaction = btc.Transaction.fromPSBT(base64ToBytes(signed.psbtBase64));
  if (signedTransaction.inputsLength !== transaction.transactionInputs.length) {
    throw new TransparentSendError('signing-material-unavailable');
  }
  transaction.transactionInputs.forEach((expected, index) => {
    const input = signedTransaction.getInput(index);
    if (
      input.index !== expected.vout
      || !inputTxidCandidates(input.txid).includes(expected.txid.toLowerCase())
    ) {
      throw new TransparentSendError('signing-material-unavailable');
    }
  });
  if (signedTransaction.outputsLength !== transaction.transactionOutputs.length) {
    throw new TransparentSendError('signing-material-unavailable');
  }
  transaction.transactionOutputs.forEach((expected, index) => {
    const output = signedTransaction.getOutput(index);
    if (
      Number(output.amount) !== expected.valueSats
      || !(output.script instanceof Uint8Array)
      || bytesToHex(output.script) !== expected.scriptHex
    ) {
      throw new TransparentSendError('signing-material-unavailable');
    }
  });
  signedTransaction.finalize();
  if (signedTransaction.hex.length / 2 > 100_000) {
    throw new TransparentSendError('consolidation-too-large');
  }
  return {
    txid: signedTransaction.id,
    hex: signedTransaction.hex,
    feeSats: transaction.feeSats,
    inputCount: transaction.inputCount,
    outputCount: transaction.outputCount,
    changeUsed: transaction.changeUsed,
    walletInputs: transaction.walletInputs,
    walletOutputs: transaction.walletOutputs,
  };
};

const sameInputs = (
  left: UnsignedTransparentTx,
  right: UnsignedTransparentTx,
) => left.transactionInputs.length === right.transactionInputs.length
  && left.transactionInputs.every((input, index) => {
    const candidate = right.transactionInputs[index];
    return candidate?.txid === input.txid && candidate.vout === input.vout;
  });

const assertTransactionPlanMatches = (
  preview: UnsignedTransparentTx,
  rebuilt: UnsignedTransparentTx,
): void => {
  const previewOutputValues = preview.transactionOutputs
    .map((output) => output.valueSats)
    .sort((left, right) => left - right);
  const rebuiltOutputValues = rebuilt.transactionOutputs
    .map((output) => output.valueSats)
    .sort((left, right) => left - right);
  if (
    preview.feeSats !== rebuilt.feeSats
    || preview.inputCount !== rebuilt.inputCount
    || preview.outputCount !== rebuilt.outputCount
    || preview.changeUsed !== rebuilt.changeUsed
    || !sameInputs(preview, rebuilt)
    || preview.transactionOutputs.length !== rebuilt.transactionOutputs.length
    || previewOutputValues.some((value, index) => (
      value !== rebuiltOutputValues[index]
    ))
  ) {
    throw new TransparentSendError('insufficient-funds');
  }
};

export const assertUnsignedTransparentInputsAvailable = (
  transaction: UnsignedTransparentTx,
  snapshot: TransparentWalletSnapshot,
): void => {
  const spendableByOutpoint = new Map(
    snapshot.utxos
      .filter(isTransparentUtxoSpendable)
      .map((utxo) => [`${utxo.txid}:${utxo.vout}`, utxo] as const),
  );
  if (transaction.walletInputs.some((input) => {
    const current = spendableByOutpoint.get(`${input.txid}:${input.vout}`);
    return !current
      || current.valueSats !== input.valueSats
      || current.address !== input.address;
  })) {
    throw new TransparentSendError('insufficient-funds');
  }
};

export const assertTransparentSendPlanMatches = (
  preview: UnsignedTransparentSend,
  rebuilt: UnsignedTransparentSend,
): void => {
  assertTransactionPlanMatches(preview, rebuilt);
  if (
    preview.recipients.length !== rebuilt.recipients.length
    || preview.recipients.some((recipient, index) => {
      const candidate = rebuilt.recipients[index];
      return candidate?.address !== recipient.address
        || candidate.amountSats !== recipient.amountSats;
    })
  ) {
    throw new TransparentSendError('insufficient-funds');
  }
};

export const assertTransparentConsolidationPlanMatches = (
  preview: UnsignedTransparentConsolidation,
  rebuilt: UnsignedTransparentConsolidation,
): void => {
  if (preview.transactions.length !== rebuilt.transactions.length) {
    throw new TransparentSendError('consolidation-unavailable');
  }
  preview.transactions.forEach((transaction, index) => {
    const candidate = rebuilt.transactions[index];
    if (!candidate) throw new TransparentSendError('consolidation-unavailable');
    assertTransactionPlanMatches(transaction, candidate);
  });
};

export const prepareUnsignedTransparentMultiSend = async ({
  mnemonic,
  snapshot,
  outputs,
  feePerVbyte = DEFAULT_FEE_PER_VBYTE,
  changeAddress,
  crypto = nitoWalletCrypto,
}: {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  outputs: TransparentSendOutput[];
  feePerVbyte?: bigint;
  changeAddress?: string;
  crypto?: NitoWalletCryptoApi;
}): Promise<UnsignedTransparentSend> => {
  const recipients = normalizeSendOutputs(outputs);
  const transaction = await prepareUnsignedTransparentTx({
    mnemonic,
    snapshot,
    outputs: recipients.map((recipient) => ({
      address: recipient.address,
      amount: recipient.amountSats,
    })),
    feePerVbyte,
    changeAddress,
    ownedOutputAddresses: changeAddress ? [changeAddress] : [],
    crypto,
  });
  return { ...transaction, recipients };
};

export const buildTransparentMultiSend = async ({
  mnemonic,
  snapshot,
  outputs,
  feePerVbyte = DEFAULT_FEE_PER_VBYTE,
  changeAddress,
  crypto = nitoWalletCrypto,
}: {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  outputs: TransparentSendOutput[];
  feePerVbyte?: bigint;
  changeAddress?: string;
  crypto?: NitoWalletCryptoApi;
}): Promise<PreparedTransparentSend> => {
  const unsigned = await prepareUnsignedTransparentMultiSend({
    mnemonic,
    snapshot,
    outputs,
    feePerVbyte,
    changeAddress,
    crypto,
  });
  const transaction = await signUnsignedTransparentTx({ mnemonic, transaction: unsigned, crypto });
  return { ...transaction, recipients: unsigned.recipients };
};

export const buildTransparentConsolidation = async ({
  mnemonic,
  snapshot,
  toAddress,
  feePerVbyte = DEFAULT_FEE_PER_VBYTE,
  crypto = nitoWalletCrypto,
}: {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  toAddress: string;
  feePerVbyte?: bigint;
  crypto?: NitoWalletCryptoApi;
}): Promise<PreparedTransparentConsolidation> => {
  const unsigned = await prepareUnsignedTransparentConsolidation({
    mnemonic,
    snapshot,
    toAddresses: [toAddress],
    feePerVbyte,
    crypto,
  });
  const transactions: PreparedTransparentTx[] = [];
  for (const transaction of unsigned.transactions) {
    transactions.push(await signUnsignedTransparentTx({ mnemonic, transaction, crypto }));
  }
  return {
    transactions,
    inputCount: unsigned.inputCount,
    outputCount: unsigned.outputCount,
    totalFeeSats: unsigned.totalFeeSats,
  };
};

export const buildTransparentSend = ({
  mnemonic,
  snapshot,
  toAddress,
  amountSats,
  feePerVbyte = DEFAULT_FEE_PER_VBYTE,
  changeAddress,
  crypto = nitoWalletCrypto,
}: {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  toAddress: string;
  amountSats: bigint;
  feePerVbyte?: bigint;
  changeAddress?: string;
  crypto?: NitoWalletCryptoApi;
}): Promise<PreparedTransparentSend> =>
  buildTransparentMultiSend({
    mnemonic,
    snapshot,
    outputs: [{ address: toAddress, amountSats }],
    feePerVbyte,
    changeAddress,
    crypto,
  });
