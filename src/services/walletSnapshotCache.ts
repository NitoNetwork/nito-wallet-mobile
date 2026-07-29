import type {
  ElectrumBalance,
  ElectrumHistoryEntry,
  ElectrumUtxo,
} from '../network/electrum';
import type {
  ScannedAddress,
  TransparentWalletSnapshot,
} from '../wallet/transparentScan';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isSafeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value)
);

const isNonNegativeSafeInteger = (value: unknown): value is number => (
  isSafeInteger(value) && value >= 0
);

const isOptionalNonNegativeSafeInteger = (value: unknown): value is number | undefined => (
  value === undefined || isNonNegativeSafeInteger(value)
);

const isString = (value: unknown): value is string => typeof value === 'string';

const isElectrumBalance = (value: unknown): value is ElectrumBalance => {
  if (!isRecord(value)) return false;
  const { confirmedSats, unconfirmedSats, totalSats } = value;
  return (
    isSafeInteger(confirmedSats)
    && isSafeInteger(unconfirmedSats)
    && isSafeInteger(totalSats)
    && totalSats === confirmedSats + unconfirmedSats
  );
};

const isElectrumUtxo = (value: unknown): value is ElectrumUtxo => {
  if (!isRecord(value)) return false;
  return (
    isString(value.txid)
    && isNonNegativeSafeInteger(value.vout)
    && isNonNegativeSafeInteger(value.valueSats)
    && isNonNegativeSafeInteger(value.height)
    && isString(value.address)
    && isNonNegativeSafeInteger(value.confirmations)
    && (value.isCoinbase === undefined || typeof value.isCoinbase === 'boolean')
    && (value.rawTx === undefined || isString(value.rawTx))
  );
};

const isElectrumHistoryEntry = (value: unknown): value is ElectrumHistoryEntry => {
  if (!isRecord(value)) return false;
  const validDirection = (
    value.direction === undefined
    || value.direction === 'sent'
    || value.direction === 'received'
    || value.direction === 'self'
  );
  return (
    isString(value.txid)
    && isSafeInteger(value.height)
    && isString(value.address)
    && validDirection
    && isOptionalNonNegativeSafeInteger(value.amountSats)
    && isOptionalNonNegativeSafeInteger(value.feeSats)
    && (value.counterparty === undefined || isString(value.counterparty))
    && isOptionalNonNegativeSafeInteger(value.blockTime)
    && (value.provisional === undefined || typeof value.provisional === 'boolean')
  );
};

const isScannedAddress = (value: unknown): value is ScannedAddress => {
  if (!isRecord(value)) return false;
  const validScriptType = (
    value.scriptType === 'p2pkh'
    || value.scriptType === 'p2sh-p2wpkh'
    || value.scriptType === 'p2wpkh'
    || value.scriptType === 'p2tr'
  );
  return (
    isString(value.accountKey)
    && isString(value.accountLabel)
    && isString(value.accountPath)
    && validScriptType
    && typeof value.spendable === 'boolean'
    && (value.branch === 'external' || value.branch === 'internal')
    && isNonNegativeSafeInteger(value.index)
    && isString(value.path)
    && isString(value.address)
    && isElectrumBalance(value.balance)
    && Array.isArray(value.utxos)
    && value.utxos.every(isElectrumUtxo)
    && Array.isArray(value.history)
    && value.history.every(isElectrumHistoryEntry)
    && typeof value.used === 'boolean'
  );
};

export const isTransparentWalletSnapshot = (
  value: unknown,
): value is TransparentWalletSnapshot => {
  if (!isRecord(value)) return false;
  return (
    isSafeInteger(value.confirmedSats)
    && isSafeInteger(value.unconfirmedSats)
    && isSafeInteger(value.balanceSats)
    && value.balanceSats === value.confirmedSats + value.unconfirmedSats
    && isNonNegativeSafeInteger(value.spendableSats)
    // These fields did not exist in the first public cache format.
    && isOptionalNonNegativeSafeInteger(value.immatureCoinbaseSats)
    && isOptionalNonNegativeSafeInteger(value.immatureCoinbaseBlocksRemaining)
    && Array.isArray(value.utxos)
    && value.utxos.every(isElectrumUtxo)
    && Array.isArray(value.history)
    && value.history.every(isElectrumHistoryEntry)
    && Array.isArray(value.addresses)
    && value.addresses.every(isScannedAddress)
    && Array.isArray(value.usedAddresses)
    && value.usedAddresses.every(isScannedAddress)
    && Array.isArray(value.spendableAddresses)
    && value.spendableAddresses.every(isScannedAddress)
    && isNonNegativeSafeInteger(value.gapLimit)
    && value.gapLimit > 0
    && isString(value.scannedAt)
    && Number.isFinite(Date.parse(value.scannedAt))
  );
};

export const parseWalletSnapshotCache = (
  serialized: string,
): TransparentWalletSnapshot => {
  const parsed: unknown = JSON.parse(serialized);
  if (!isTransparentWalletSnapshot(parsed)) {
    throw new Error('Invalid wallet snapshot cache.');
  }
  return parsed;
};
