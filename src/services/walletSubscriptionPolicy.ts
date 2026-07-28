import type { WalletSyncOptions } from './walletNetworkController';

const authoritativeRefresh = (): WalletSyncOptions => ({
  force: true,
  silent: true,
});

export const syncRequestForAddressStatus = (addressWasUsed: boolean): WalletSyncOptions => ({
  ...authoritativeRefresh(),
  rescanGap: !addressWasUsed,
});

export const syncRequestForBlockStatus = ({
  announcedHeight,
  currentHeight,
  hasPendingWork,
}: {
  announcedHeight: number;
  currentHeight: number;
  hasPendingWork: boolean;
}): WalletSyncOptions | null => {
  if (announcedHeight > currentHeight && !hasPendingWork) {
    return null;
  }
  return authoritativeRefresh();
};

export const syncRequestAfterInitialSubscriptions = (
  subscribedUsedAddress: boolean,
): WalletSyncOptions | null => (
  subscribedUsedAddress ? authoritativeRefresh() : null
);
