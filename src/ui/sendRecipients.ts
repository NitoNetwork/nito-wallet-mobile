export type SendRecipientDraft = {
  id: number;
  address: string;
  amount: string;
};

export const updateRecipientAddress = (
  recipients: SendRecipientDraft[],
  recipientId: number,
  address: string,
) => recipients.map((recipient) => (
  recipient.id === recipientId ? { ...recipient, address } : recipient
));

export const duplicateRecipientAddresses = (recipients: SendRecipientDraft[]) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const recipient of recipients) {
    const normalized = recipient.address.trim().toLowerCase();
    if (!normalized) continue;
    if (seen.has(normalized)) duplicates.add(normalized);
    seen.add(normalized);
  }

  return [...duplicates];
};

export const summarizeRecipientSpend = (
  amounts: bigint[],
  feeSats: bigint,
  availableSats: bigint,
) => {
  const amountSats = amounts.reduce((total, amount) => total + amount, 0n);
  const totalSats = amountSats + feeSats;

  return {
    amountSats,
    feeSats,
    totalSats,
    fitsAvailable: totalSats <= availableSats,
  };
};
