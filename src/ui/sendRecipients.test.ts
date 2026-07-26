import { describe, expect, it } from 'vitest';

import {
  duplicateRecipientAddresses,
  summarizeRecipientSpend,
  updateRecipientAddress,
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
});
