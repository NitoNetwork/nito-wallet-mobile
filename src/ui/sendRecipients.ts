import { MAX_SEND_RECIPIENTS } from '../constants/nito';

export type SendRecipientDraft = {
  id: number;
  address: string;
  amount: string;
};

/**
 * A transaction carries at most MAX_SEND_RECIPIENTS outputs. The cap is a
 * usability bound, not a consensus one: the reviewed transaction stays readable
 * and the fee stays predictable.
 */
export const canAddSendRecipient = (
  recipients: readonly SendRecipientDraft[],
): boolean => recipients.length < MAX_SEND_RECIPIENTS;

export const appendSendRecipient = (
  recipients: readonly SendRecipientDraft[],
  recipient: SendRecipientDraft,
): SendRecipientDraft[] => (
  canAddSendRecipient(recipients) ? [...recipients, recipient] : [...recipients]
);

export type SendRecipientField = 'address' | 'amount';
export type SendRecipientFieldErrors = Record<
  number,
  Partial<Record<SendRecipientField, string>>
>;

export const clearSendRecipientFieldError = (
  errors: SendRecipientFieldErrors,
  recipientId: number,
  field: SendRecipientField,
): SendRecipientFieldErrors => {
  const recipientErrors = errors[recipientId];
  if (!recipientErrors?.[field]) return errors;

  const nextRecipientErrors = { ...recipientErrors };
  delete nextRecipientErrors[field];
  const next = { ...errors };
  if (Object.keys(nextRecipientErrors).length === 0) {
    delete next[recipientId];
  } else {
    next[recipientId] = nextRecipientErrors;
  }
  return next;
};

export const validateSendRecipientDrafts = ({
  recipients,
  validateAddress,
  validateAmount,
  addressError,
  amountError,
  skipAmountRecipientId,
}: {
  recipients: readonly SendRecipientDraft[];
  validateAddress: (address: string) => void;
  validateAmount: (amount: string) => void;
  addressError: string;
  amountError: string;
  skipAmountRecipientId?: number;
}): SendRecipientFieldErrors => {
  const errors: SendRecipientFieldErrors = {};

  for (const recipient of recipients) {
    try {
      validateAddress(recipient.address);
    } catch {
      errors[recipient.id] = { address: addressError };
    }

    if (recipient.id === skipAmountRecipientId) continue;
    try {
      validateAmount(recipient.amount);
    } catch {
      errors[recipient.id] = { ...errors[recipient.id], amount: amountError };
    }
  }

  return errors;
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
