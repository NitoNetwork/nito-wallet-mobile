import { sameRbfReview, type RbfQuote } from '../wallet/transparentRbf';

/** Persist a signature even if locking wins while the native signer is running.
 * An unsigned preview owns no address. Reservations are never recycled here. */
export const submitRbfReplacement = async <TReservation, TSigned>(ports: {
  review: RbfQuote;
  isCurrent: () => boolean;
  rebuild: (reservation?: TReservation) => Promise<RbfQuote>;
  reserve: () => Promise<TReservation>;
  sign: (quote: RbfQuote) => Promise<TSigned>;
  persist: (reservation: TReservation, quote: RbfQuote, signed: TSigned) => Promise<void>;
}): Promise<{ kind: 'changed'; quote: RbfQuote } | { kind: 'signed'; signed: TSigned } | { kind: 'interrupted' }> => {
  if (!ports.isCurrent()) return { kind: 'interrupted' };
  const latest = await ports.rebuild();
  if (!ports.isCurrent()) return { kind: 'interrupted' };
  if (!sameRbfReview(ports.review, latest)) return { kind: 'changed', quote: latest };
  const reservation = await ports.reserve();
  if (!ports.isCurrent()) return { kind: 'interrupted' };
  const final = await ports.rebuild(reservation);
  if (!ports.isCurrent()) return { kind: 'interrupted' };
  if (!sameRbfReview(ports.review, final)) return { kind: 'changed', quote: final };
  const signed = await ports.sign(final);
  await ports.persist(reservation, final, signed);
  return { kind: 'signed', signed };
};
