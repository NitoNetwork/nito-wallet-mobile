export const escapeCsvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export const shortAddress = (address: string) => `${address.slice(0, 13)}...${address.slice(-8)}`;

export const isValidTransactionId = (txid: string): boolean => /^[0-9a-f]{64}$/i.test(txid);

export const transactionExplorerUrl = (txid: string) =>
  `https://mempool-explorer.nito.network/tx/${txid.toLowerCase()}`;

export const BALANCE_DECIMAL_OPTIONS = [2, 8] as const;
export type BalanceDecimals = (typeof BALANCE_DECIMAL_OPTIONS)[number];

export const isBalanceDecimals = (
  value: unknown,
): value is BalanceDecimals | `${BalanceDecimals}` =>
  BALANCE_DECIMAL_OPTIONS.some((option) => String(option) === String(value));

export const canShowHistoryExport = ({
  entries,
  historyProgress,
  historySyncing,
  networkStatus,
}: {
  entries: readonly { direction?: unknown }[];
  historyProgress: { done: number; total: number } | null;
  historySyncing: boolean;
  networkStatus: string;
}): boolean =>
  entries.length > 0
  && entries.every((entry) => entry.direction !== undefined)
  && historyProgress === null
  && !historySyncing
  && networkStatus !== 'syncing';

export const historyPageFromInput = (value: string, pageCount: number): number | null => {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }

  const requestedPage = Number(trimmed);
  if (!Number.isFinite(requestedPage)) {
    return null;
  }

  const lastPage = Math.max(1, Math.floor(pageCount));
  return Math.min(lastPage, Math.max(1, requestedPage)) - 1;
};

export const formatHomeBalance = (
  satoshis: number,
  decimals: BalanceDecimals,
): { text: string } => {
  const normalizedSatoshis = Math.trunc(satoshis);
  const sign = normalizedSatoshis < 0 ? '−' : '';
  const absoluteSatoshis = Math.abs(normalizedSatoshis);
  const whole = Math.floor(absoluteSatoshis / 100_000_000);
  const formattedWhole = whole.toLocaleString('fr-FR');
  const allDecimals = String(absoluteSatoshis % 100_000_000).padStart(8, '0');
  const visibleDecimals = allDecimals.slice(0, decimals);
  const hiddenSignificantDecimals = allDecimals.slice(decimals).includes('1')
    || /[2-9]/.test(allDecimals.slice(decimals));
  const suffix = hiddenSignificantDecimals ? '…' : '';

  return { text: `${sign}${formattedWhole},${visibleDecimals}${suffix}` };
};
