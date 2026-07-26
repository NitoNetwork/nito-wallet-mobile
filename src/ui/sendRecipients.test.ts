import { describe, expect, it } from 'vitest';

import {
  clearSendRecipientFieldError,
  duplicateRecipientAddresses,
  summarizeRecipientSpend,
  updateRecipientAddress,
  validateSendRecipientDrafts,
  type SendRecipientDraft,
} from './sendRecipients';

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
