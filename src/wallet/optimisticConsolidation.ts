import type { ElectrumHistoryEntry, ElectrumUtxo } from '../network/electrum';
import type { TransparentWalletSnapshot } from './transparentScan';
import type { PreparedTransparentTx } from './transparentSend';

const outpointKey = ({ txid, vout }: { txid: string; vout: number }) => `${txid}:${vout}`;

export const applyOptimisticWalletBroadcast = ({
  snapshot,
  transaction,
  txid,
}: {
  snapshot: TransparentWalletSnapshot;
  transaction: PreparedTransparentTx;
  txid: string;
}): TransparentWalletSnapshot => {
  const inputs = transaction.walletInputs;
  const outputs = transaction.walletOutputs;
  if (inputs.length === 0 && outputs.length === 0) return snapshot;

  const spentOutpoints = new Set(inputs.map(outpointKey));
  const consumedUtxos = snapshot.utxos.filter((utxo) => spentOutpoints.has(outpointKey(utxo)));
  const consumedSats = consumedUtxos.reduce((total, utxo) => total + utxo.valueSats, 0);
  const existingOutpoints = new Set(snapshot.utxos.map(outpointKey));
  const ownerByAddress = new Map(snapshot.addresses.map((owner) => [owner.address, owner]));
  const pendingOutputs: ElectrumUtxo[] = outputs
    .filter((output) => !existingOutpoints.has(`${txid}:${output.vout}`))
    .flatMap((output) => ownerByAddress.has(output.address) ? [{
      txid,
      vout: output.vout,
      valueSats: output.valueSats,
      height: 0,
      address: output.address,
      confirmations: 0,
      isCoinbase: false,
    }] : []);
  const historyAddress = outputs[0]?.address ?? inputs[0]?.address ?? '';
  const pendingHistory: ElectrumHistoryEntry = { txid, height: 0, address: historyAddress };

  const addresses = snapshot.addresses.map((address) => {
    const consumed = address.utxos.filter((utxo) => spentOutpoints.has(outpointKey(utxo)));
    const consumedFromAddress = consumed.reduce((total, utxo) => total + utxo.valueSats, 0);
    const addressPendingOutputs = pendingOutputs.filter((utxo) => utxo.address === address.address);
    const pendingForAddress = addressPendingOutputs.reduce((total, utxo) => total + utxo.valueSats, 0);
    const confirmedSats = Math.max(0, address.balance.confirmedSats - consumedFromAddress);
    const unconfirmedSats = address.balance.unconfirmedSats + pendingForAddress;
    const involved = consumed.length > 0 || addressPendingOutputs.length > 0;

    return {
      ...address,
      balance: {
        confirmedSats,
        unconfirmedSats,
        totalSats: confirmedSats + unconfirmedSats,
      },
      utxos: [
        ...address.utxos.filter((utxo) => !spentOutpoints.has(outpointKey(utxo))),
        ...addressPendingOutputs,
      ],
      history: involved
        ? [pendingHistory, ...address.history.filter((entry) => entry.txid !== txid)]
        : address.history,
      used: address.used || involved,
    };
  });

  const addedPendingSats = pendingOutputs.reduce((total, utxo) => total + utxo.valueSats, 0);
  const utxos = [
    ...snapshot.utxos.filter((utxo) => !spentOutpoints.has(outpointKey(utxo))),
    ...pendingOutputs,
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
