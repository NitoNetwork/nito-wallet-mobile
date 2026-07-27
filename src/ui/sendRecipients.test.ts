import { describe, expect, it } from 'vitest';

import {
  appendSendRecipient,
  canAddSendRecipient,
  clearSendRecipientFieldError,
  duplicateRecipientAddresses,
  summarizeRecipientSpend,
  updateRecipientAddress,
  validateSendRecipientDrafts,
  type SendRecipientDraft,
} from './sendRecipients';
import { MAX_SEND_RECIPIENTS } from '../constants/nito';

const recipients: SendRecipientDraft[] = [
  { id: 1, address: 'nito1qfirst', amount: '1' },
  { id: 2, address: 'nito1qsecond', amount: '2' },
];

describe('send recipient helpers', () => {
  it('updates only the recipient row that opened the QR scanner', () => {
    expect(updateRecipientAddress(recipients, 2, 'nito1qscanned')).toEqual([
      recipients[0],
      { id: 2, address: 'nito1qscanned', amount: '2' },
    ]);
  });

  it('warns about duplicate addresses without rejecting them', () => {
    expect(duplicateRecipientAddresses([
      { id: 1, address: ' NITO1QDUPLICATE ', amount: '1' },
      { id: 2, address: 'nito1qduplicate', amount: '2' },
    ])).toEqual(['nito1qduplicate']);
  });

  it('compares the entered total plus the exact fee with the available balance', () => {
    expect(summarizeRecipientSpend([40_000n, 59_000n], 1_001n, 100_000n)).toEqual({
      amountSats: 99_000n,
      feeSats: 1_001n,
      totalSats: 100_001n,
      fitsAvailable: false,
    });
  });

  it('reports address and amount validation errors on their recipient fields', () => {
    const fieldErrors = validateSendRecipientDrafts({
      recipients: [
        { id: 1, address: 'bad-address', amount: '1' },
        { id: 2, address: 'nito1qvalid', amount: 'bad-amount' },
      ],
      validateAddress: (address) => {
        if (address !== 'nito1qvalid') throw new Error('invalid address');
      },
      validateAmount: (amount) => {
        if (amount !== '1') throw new Error('invalid amount');
      },
      addressError: 'Valid address required',
      amountError: 'Valid amount required',
    });

    expect(fieldErrors).toEqual({
      1: { address: 'Valid address required' },
      2: { amount: 'Valid amount required' },
    });
    expect(clearSendRecipientFieldError(fieldErrors, 1, 'address')).toEqual({
      2: { amount: 'Valid amount required' },
    });
  });

  it('can validate a Max request without requiring the target amount first', () => {
    expect(validateSendRecipientDrafts({
      recipients: [{ id: 1, address: 'nito1qvalid', amount: '' }],
      validateAddress: () => undefined,
      validateAmount: () => {
        throw new Error('amount should be skipped');
      },
      addressError: 'Valid address required',
      amountError: 'Valid amount required',
      skipAmountRecipientId: 1,
    })).toEqual({});
  });
});

describe('send recipient cap', () => {
  const draft = (id: number) => ({ id, address: '', amount: '' });
  const fill = (count: number) => Array.from({ length: count }, (_, index) => draft(index));

  it('allows adding recipients below the cap', () => {
    expect(canAddSendRecipient(fill(0))).toBe(true);
    expect(canAddSendRecipient(fill(MAX_SEND_RECIPIENTS - 1))).toBe(true);
  });

  it('blocks adding recipients exactly at the cap', () => {
    expect(canAddSendRecipient(fill(MAX_SEND_RECIPIENTS))).toBe(false);
  });

  it('never appends past the cap and leaves the list untouched', () => {
    const full = fill(MAX_SEND_RECIPIENTS);
    const result = appendSendRecipient(full, draft(999));

    expect(result).toHaveLength(MAX_SEND_RECIPIENTS);
    expect(result.some((recipient) => recipient.id === 999)).toBe(false);
  });

  it('appends normally below the cap', () => {
    const result = appendSendRecipient(fill(MAX_SEND_RECIPIENTS - 1), draft(999));

    expect(result).toHaveLength(MAX_SEND_RECIPIENTS);
    expect(result[result.length - 1]?.id).toBe(999);
  });
});
