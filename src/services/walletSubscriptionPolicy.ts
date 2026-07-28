import type { WalletSyncOptions } from './walletNetworkController';

export class WalletSubscriptionRunGuard {
  private generation = 0;

  capture(): number {
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

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
