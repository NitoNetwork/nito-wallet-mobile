/** Read-only retries after publication. Retrying observation never signs or broadcasts. */
export const observePublishedTransactions = async (ports: {
  isCurrent: () => boolean;
  refresh: () => Promise<boolean>;
  onFailure: (error: unknown) => void;
  isRetryable: (error: unknown) => boolean;
  wait?: (ms: number) => Promise<void>;
}): Promise<'observed' | 'pending' | 'failed' | 'interrupted'> => {
  const wait = ports.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await wait(3_000);
    if (!ports.isCurrent()) return 'interrupted';
    try {
      const observed = await ports.refresh();
      if (!ports.isCurrent()) return 'interrupted';
      if (observed) return 'observed';
      if (attempt === 2) return 'pending';
    } catch (error) {
      if (!ports.isCurrent()) return 'interrupted';
      if (attempt === 2 || !ports.isRetryable(error)) {
        ports.onFailure(error);
        return 'failed';
      }
    }
  }
  return 'pending';
};
