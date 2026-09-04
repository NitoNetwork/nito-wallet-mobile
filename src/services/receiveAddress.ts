/** The durable reservation and derivation must finish before calling this.
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
