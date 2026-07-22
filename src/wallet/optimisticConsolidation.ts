import type { ElectrumHistoryEntry, ElectrumUtxo } from '../network/electrum';
import type { TransparentWalletSnapshot } from './transparentScan';
import type { PreparedTransparentTx } from './transparentSend';

const outpointKey = ({ txid, vout }: { txid: string; vout: number }) => `${txid}:${vout}`;

export const applyOptimisticConsolidationBroadcast = ({
  snapshot,
  transaction,
  txid,
  mainAddress,
}: {
  snapshot: TransparentWalletSnapshot;
  transaction: PreparedTransparentTx;
  txid: string;
  mainAddress: string;
}): TransparentWalletSnapshot => {
  const inputs = transaction.consolidationInputs ?? [];
  const amountSats = transaction.consolidationAmountSats ?? 0;
  if (inputs.length === 0 || amountSats <= 0) return snapshot;

  const spentOutpoints = new Set(inputs.map(outpointKey));
  const existingOutput = snapshot.utxos.some((utxo) => utxo.txid === txid && utxo.vout === 0);
  const consumedUtxos = snapshot.utxos.filter((utxo) => spentOutpoints.has(outpointKey(utxo)));
  const consumedSats = consumedUtxos.reduce((total, utxo) => total + utxo.valueSats, 0);
  const pendingOutput: ElectrumUtxo = {
    txid,
    vout: 0,
    valueSats: amountSats,
    height: 0,
    address: mainAddress,
    confirmations: 0,
    isCoinbase: false,
  };
  const pendingHistory: ElectrumHistoryEntry = { txid, height: 0, address: mainAddress };

  const addresses = snapshot.addresses.map((address) => {
    const consumed = address.utxos.filter((utxo) => spentOutpoints.has(outpointKey(utxo)));
    const consumedFromAddress = consumed.reduce((total, utxo) => total + utxo.valueSats, 0);
    const addPending = address.address === mainAddress
      && !address.utxos.some((utxo) => utxo.txid === txid && utxo.vout === 0);
    const pendingForAddress = addPending ? amountSats : 0;
    const confirmedSats = Math.max(0, address.balance.confirmedSats - consumedFromAddress);
    const unconfirmedSats = address.balance.unconfirmedSats + pendingForAddress;

    return {
      ...address,
      balance: {
        confirmedSats,
        unconfirmedSats,
        totalSats: confirmedSats + unconfirmedSats,
      },
      utxos: [
        ...address.utxos.filter((utxo) => !spentOutpoints.has(outpointKey(utxo))),
        ...(addPending ? [pendingOutput] : []),
      ],
      history: address.address === mainAddress
        ? [pendingHistory, ...address.history.filter((entry) => entry.txid !== txid)]
        : address.history,
      used: address.used || address.address === mainAddress,
    };
  });

  const addedPendingSats = existingOutput ? 0 : amountSats;
  const utxos = [
    ...snapshot.utxos.filter((utxo) => !spentOutpoints.has(outpointKey(utxo))),
    ...(existingOutput ? [] : [pendingOutput]),
  ];

  return {
    ...snapshot,
    confirmedSats: Math.max(0, snapshot.confirmedSats - consumedSats),
    unconfirmedSats: snapshot.unconfirmedSats + addedPendingSats,
    balanceSats: Math.max(0, snapshot.balanceSats - consumedSats + addedPendingSats),
    spendableSats: Math.max(0, snapshot.spendableSats - consumedSats),
    utxos,
    history: [pendingHistory, ...snapshot.history.filter((entry) => entry.txid !== txid)],
    addresses,
    usedAddresses: addresses.filter((address) => address.used),
    spendableAddresses: addresses.filter((address) => address.spendable),
    scannedAt: new Date().toISOString(),
  };
};
