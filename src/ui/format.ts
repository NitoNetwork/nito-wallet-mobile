export const escapeCsvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export const shortAddress = (address: string) => `${address.slice(0, 13)}...${address.slice(-8)}`;

export const isValidTransactionId = (txid: string): boolean => /^[0-9a-f]{64}$/i.test(txid);

export const transactionExplorerUrl = (txid: string) =>
  `https://mempool-explorer.nito.network/tx/${txid.toLowerCase()}`;
