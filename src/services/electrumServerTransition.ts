import type { NitoElectrumClient } from '../network/electrum';
import { reportNonFinancialFailure } from './diagnostics';
import type { WalletNetworkController } from './walletNetworkController';

export const invalidateElectrumRuntimeForServerChange = ({
  client,
  controller,
  walletId,
  clearClient,
  clearPreparedTransaction,
  clearPreparedConsolidation,
  clearDeferredNetworkWork,
}: {
  client: NitoElectrumClient | null;
  controller: WalletNetworkController;
  walletId: string | null;
  clearClient: () => void;
  clearPreparedTransaction: () => void;
  clearPreparedConsolidation: () => void;
  clearDeferredNetworkWork: () => void;
}): void => {
  controller.cancel();
  try {
    client?.disconnect(new Error('Electrum server changed.'));
  } catch (caught) {
    reportNonFinancialFailure('electrum disconnect during server change', caught);
  }
  clearClient();
  clearPreparedTransaction();
  clearPreparedConsolidation();
  clearDeferredNetworkWork();
  if (walletId) {
    controller.beginWalletSession(walletId);
  }
};
