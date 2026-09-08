import { assertGapSafeIssuedIndex, type HdAccountKey, type KnownHdAddress } from '../wallet/hdAddress';

/** Durable scan tracking and derivation must finish before calling this.
 * Subscription/scan work is queued, not part of the local address operation. */
export const releaseReceiveAddressBeforeRefresh = (ports: {
  isCurrent: () => boolean;
  release: () => void;
  queueRefresh: () => void;
}): void => {
  if (!ports.isCurrent()) return;
  ports.release();
  ports.queueRefresh();
};

/** Display selection is session-only. Durable issuance is not evidence of use. */
export class ReceiveAddressSelection {
  private readonly selected = new Map<HdAccountKey, number>();

  current(family: HdAccountKey): number {
    return this.selected.get(family) ?? 0;
  }

  select(family: HdAccountKey, index: number): void {
    this.selected.set(family, index);
  }

  next(family: HdAccountKey, addresses: readonly KnownHdAddress[], gapLimit: number): number {
    const used = new Set(addresses.filter((address) => (
      address.accountKey === family && address.branch === 'external' && address.used
    )).map((address) => address.index));
    let index = this.current(family) + 1;
    while (used.has(index)) index += 1;
    assertGapSafeIssuedIndex({ addresses, sequence: { accountKey: family, branch: 'external' }, index, gapLimit });
    return index;
  }
}
