import * as btc from '@scure/btc-signer';

import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
import type {
  NativeDerivedAddress,
  NativePsbtSigner,
  NitoWalletCryptoApi,
} from '../native/nitoWalletCryptoContract';
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

export type PreparedTransparentTx = {
  txid: string;
  hex: string;
  feeSats: number;
  inputCount: number;
  outputCount: number;
  changeUsed: boolean;
};

export type MaxTransparentSendAmount = {
  amountSats: bigint;
  feeSats: number;
  inputCount: number;
  outputCount: number;
  changeUsed: boolean;
};

export const parseNitoAmountToSats = (amount: string) => {
  const normalized = amount.trim().replace(/[\s\u00a0\u202f']/g, '').replace(',', '.');

  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) {
    throw new Error('Montant invalide. Utilise au maximum 8 decimales.');
  }

  const [whole = '0', fraction = ''] = normalized.split('.');
  const sats = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));

  if (sats <= 0n) {
    throw new Error('Le montant doit etre superieur a zero.');
  }

  if (sats < DUST_LIMIT_SATS) {
    throw new Error('Montant trop faible.');
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
};

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
  let skippedLegacyCount = 0;
  const candidates = snapshot.utxos
    .filter((entry) => entry.confirmations > 0)
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
      throw new Error(`Native HD material unavailable for ${owner.path}.`);
    }
    const spend = spendForMaterial(material);

    const input: Record<string, unknown> = {
      ...spend,
      txid: utxo.txid,
      index: utxo.vout,
    };

    if (owner.scriptType === 'p2pkh') {
      if (!utxo.rawTx) {
        skippedLegacyCount += 1;
        continue;
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
    });
  }

  if (spendable.length === 0) {
    if (skippedLegacyCount > 0) {
      throw new Error('Fonds visibles mais donnees de signature legacy indisponibles. Reessaie apres synchronisation.');
    }

    throw new Error('No confirmed UTXO available for this send.');
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
    throw new Error('Change address unavailable.');
  }

  return resolvedChangeAddress;
};

const selectSpend = ({
  spendable,
  toAddress,
  amountSats,
  feePerVbyte,
  changeAddress,
}: {
  spendable: PreparedSpendableInput[];
  toAddress: string;
  amountSats: bigint;
  feePerVbyte: bigint;
  changeAddress: string;
}) => {
  const inputs = spendable.map((utxo) => cloneInput(utxo.input)) as Parameters<typeof btc.selectUTXO>[0];

  return btc.selectUTXO(
    inputs,
    [{ address: toAddress.trim(), amount: amountSats }],
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

export const calculateMaxTransparentSendAmount = ({
  mnemonic,
  snapshot,
  toAddress,
  feePerVbyte = DEFAULT_FEE_PER_VBYTE,
  changeAddress,
  crypto = nitoWalletCrypto,
}: {
  mnemonic: string;
  snapshot: TransparentWalletSnapshot;
  toAddress: string;
  feePerVbyte?: bigint;
  changeAddress?: string;
  crypto?: NitoWalletCryptoApi;
}): Promise<MaxTransparentSendAmount> => {
  return (async () => {
  const { spendable, totalSats } = await prepareSpendableInputs(mnemonic, snapshot, crypto);
  const resolvedChangeAddress = resolveChangeAddress(snapshot, changeAddress);
  let low = DUST_LIMIT_SATS;
  let high = totalSats;
  let best: MaxTransparentSendAmount | null = null;

  while (low <= high) {
    const amountSats = (low + high) / 2n;
    const selected = selectSpend({
      spendable,
      toAddress,
      amountSats,
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
    throw new Error('Fonds insuffisants pour le montant et les frais.');
  }

  return best;
  })();
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
}): Promise<PreparedTransparentTx> => {
  return (async () => {
  const { spendable } = await prepareSpendableInputs(mnemonic, snapshot, crypto);
  const resolvedChangeAddress = resolveChangeAddress(snapshot, changeAddress);
  const selected = selectSpend({
    spendable,
    toAddress,
    amountSats,
    feePerVbyte,
    changeAddress: resolvedChangeAddress,
  });

  if (!selected || !selected.tx) {
    throw new Error('Fonds insuffisants pour le montant et les frais.');
  }

  const signed = await crypto.signPsbt({
    mnemonic,
    psbtBase64: bytesToBase64(selected.tx.toPSBT(0)),
    signers: spendable.map(({ signer }) => signer),
  });
  const signedTransaction = btc.Transaction.fromPSBT(base64ToBytes(signed.psbtBase64));
  signedTransaction.finalize();

  return {
    txid: signedTransaction.id,
    hex: signedTransaction.hex,
    feeSats: Number(selected.tx.fee || selected.fee),
    inputCount: selected.inputs.length,
    outputCount: selected.outputs.length,
    changeUsed: selected.change,
  };
  })();
};
