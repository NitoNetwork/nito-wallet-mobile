export type OptionalCacheRead<T> =
  | { status: 'hit'; value: T }
  | { status: 'miss'; value: null }
  | { status: 'failed'; error: Error };

const toError = (caught: unknown) => (
  caught instanceof Error ? caught : new Error(String(caught))
);

export const readOptionalCache = async <T>(
  read: () => Promise<T | null>,
): Promise<OptionalCacheRead<T>> => {
  try {
    const value = await read();
    return value === null
      ? { status: 'miss', value: null }
      : { status: 'hit', value };
  } catch (caught) {
    return { status: 'failed', error: toError(caught) };
  }
};
