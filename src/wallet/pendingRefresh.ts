import type { TransparentWalletSnapshot } from './transparentScan';

const COINBASE_MATURITY = 101;

const isUnsettled = (utxo: { confirmations: number; isCoinbase?: boolean }) =>
  utxo.confirmations <= 0
  || (
    utxo.confirmations < COINBASE_MATURITY
    && utxo.isCoinbase !== false
  );

export const hasPendingWork = (snapshot: TransparentWalletSnapshot): boolean =>
  snapshot.unconfirmedSats !== 0
  || (snapshot.immatureCoinbaseSats ?? 0) > 0
  || snapshot.history.some((entry) => entry.height <= 0)
  || snapshot.utxos.some(isUnsettled);

export const pendingRefreshAddresses = (
  snapshot: TransparentWalletSnapshot,
): string[] => snapshot.addresses
  .filter((address) => (
    address.balance.unconfirmedSats !== 0
    || address.history.some((entry) => entry.height <= 0)
    || address.utxos.some(isUnsettled)
  ))
  .map((address) => address.address);
