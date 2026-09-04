import { describe, expect, it, vi } from 'vitest';
import { submitRbfReplacement } from './transactionReplacement';
import type { RbfQuote } from '../wallet/transparentRbf';
import { confirmedTransactionFamilyMember } from './transactionLifecycle';
import { LANGUAGES, makeTranslator } from '../i18n';

const quote = { mode: 'accelerate', originalTxid: 'original', originalLifecycleId: 'original', returnSats: 500,
  transaction: { feeSats: 100, inputCount: 1, outputCount: 2 } } as RbfQuote;

describe('replacement confirmation and interruption boundaries', () => {
  it.each(['initial', 'rebuild', 'reserve', 'final', 'sign', 'persist'] as const)(
    'handles interruption at %s without losing a signature or reusing a reservation', async (step) => {
      let current = step !== 'initial';
      let rebuilds = 0;
      const events: string[] = [];
      const boundary = (name: string) => { events.push(name); if (name === step) current = false; };
      const ports = {
        review: quote, isCurrent: () => current,
        rebuild: vi.fn(async () => { boundary(++rebuilds === 1 ? 'rebuild' : 'final'); return quote; }),
        reserve: vi.fn(async () => { boundary('reserve'); return { index: 42 }; }),
        sign: vi.fn(async () => { boundary('sign'); return { rawTxHex: 'signed' }; }),
        persist: vi.fn(async () => { boundary('persist'); }),
      };
      await submitRbfReplacement(ports);
      if (step === 'sign' || step === 'persist') {
        expect(events).toEqual(['rebuild', 'reserve', 'final', 'sign', 'persist']);
        expect(ports.persist).toHaveBeenCalledWith({ index: 42 }, quote, { rawTxHex: 'signed' });
      } else {
        expect(ports.sign).not.toHaveBeenCalled();
        expect(ports.persist).not.toHaveBeenCalled();
      }
      expect(ports.reserve.mock.calls.length).toBeLessThanOrEqual(1);
    },
  );

  it.each([1, 2])('requires another confirmation if reconstruction %i changes', async (changedAt) => {
    let count = 0;
    const changed = { ...quote, transaction: { ...quote.transaction, feeSats: 150 } };
    const ports = { review: quote, isCurrent: () => true,
      rebuild: vi.fn(async () => ++count === changedAt ? changed : quote),
      reserve: vi.fn(async () => 42), sign: vi.fn(async () => 'signature'), persist: vi.fn(async () => undefined) };
    expect(await submitRbfReplacement(ports)).toEqual({ kind: 'changed', quote: changed });
    expect(ports.sign).not.toHaveBeenCalled();
    expect(ports.persist).not.toHaveBeenCalled();
    expect(ports.reserve).toHaveBeenCalledTimes(changedAt - 1);
  });

  it('propagates a persistence failure instead of reporting a transaction as sent', async () => {
    await expect(submitRbfReplacement({ review: quote, isCurrent: () => true,
      rebuild: async () => quote, reserve: async () => 42, sign: async () => 'signature',
      persist: async () => { throw new Error('storage unavailable'); },
    })).rejects.toThrow('storage unavailable');
  });

  it.each(['first', 'second', 'third'])('uses only the network snapshot to recognize %s as the winner', (id) => {
    const records = [
      { lifecycleId: 'first', txid: 'first' },
      { lifecycleId: 'second', txid: 'second', replacement: { originalLifecycleId: 'first', originalTxid: 'first', mode: 'accelerate' as const } },
      { lifecycleId: 'third', txid: 'third', replacement: { originalLifecycleId: 'second', originalTxid: 'second', mode: 'cancel' as const } },
    ];
    for (const record of records) {
      expect(confirmedTransactionFamilyMember(record, records, [])).toBeUndefined();
      expect(confirmedTransactionFamilyMember(record, records, [{ txid: id, address: 'a', height: 0 }])).toBeUndefined();
      expect(confirmedTransactionFamilyMember(record, records, [{ txid: id, address: 'a', height: 42 }])?.txid).toBe(id);
    }
  });

  it.each(LANGUAGES)('resolves the financial review and risk warnings in $code', ({ code }) => {
    const t = makeTranslator(code);
    for (const key of ['rbf.cancelHint', 'rbf.raceHint', 'rbf.reviewChanged', 'rbf.otherConfirmed', 'rbf.error.confirmed'] as const) {
      expect(t(key)).not.toBe(key);
      expect(t(key)).not.toMatch(/[—;]/);
      if (code !== 'en') expect(t(key)).not.toBe(makeTranslator('en')(key));
    }
    expect(t('rbf.newFee', { amount: '1.23' })).toContain('1.23');
  });
});
