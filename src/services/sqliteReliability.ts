const DEFAULT_SQLITE_WRITE_ATTEMPTS = 3;
const DEFAULT_SQLITE_WRITE_RETRY_DELAY_MS = 50;

const toError = (caught: unknown) => (
  caught instanceof Error ? caught : new Error(String(caught))
);

export const isDuplicateColumnError = (caught: unknown) =>
  /\bduplicate column name\b/i.test(toError(caught).message);

export const retrySqliteWrite = async <T>(
  operation: () => Promise<T>,
  {
    attempts = DEFAULT_SQLITE_WRITE_ATTEMPTS,
    delayMs = DEFAULT_SQLITE_WRITE_RETRY_DELAY_MS,
  }: {
    attempts?: number;
    delayMs?: number;
  } = {},
): Promise<T> => {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('SQLite write attempts must be a positive integer.');
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error('SQLite retry delay must be non-negative.');
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (caught) {
      lastError = toError(caught);
      if (attempt < attempts && delayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs * attempt);
        });
      }
    }
  }

  throw lastError ?? new Error('SQLite write failed.');
};
