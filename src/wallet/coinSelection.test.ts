import { describe, expect, it } from 'vitest';
import { chooseCoinSelection } from './coinSelection';

const candidate = (id: string, feeSats: bigint, inputValueSats = 100_000n, inputCount = 1) => (
  { id, feeSats, inputValueSats, inputCount }
);

describe('bounded coin selection fee tolerance', () => {
  it.each([
    [100n, 125n],
    [101n, 126n],
    [3_999n, 4_998n],
    [4_000n, 5_000n],
    [10_000n, 11_000n],
    [0n, 0n],
  ])('accepts the exact ceiling %s -> %s and rejects one nitoshi above it', (minimum, ceiling) => {
    const cheapest = candidate('cheapest', minimum, 1_000_000n);
    expect(chooseCoinSelection([cheapest, candidate('closer', ceiling)])?.id).toBe('closer');
    expect(chooseCoinSelection([cheapest, candidate('too costly', ceiling + 1n)])?.id).toBe('cheapest');
  });

  it('anchors the tolerance to the actual minimum regardless of candidate order', () => {
    const choices = [candidate('cheapest', 100n, 1_000_000n), candidate('allowed', 125n, 100_000n), candidate('creeping', 150n, 10_000n)];
    for (const order of [choices, [...choices].reverse(), [choices[1]!, choices[0]!, choices[2]!]]) {
      const before = structuredClone(order);
      expect(chooseCoinSelection(order)?.id).toBe('allowed');
      expect(order).toEqual(before);
    }
  });

  it('limits fragmentation before preferring a closer input total', () => {
    expect(chooseCoinSelection([
      candidate('two smaller inputs', 100n, 10_000n, 2),
      candidate('one input', 125n, 100_000n),
    ])?.id).toBe('one input');
  });

  it('breaks equal input count and amount ties by lower fees', () => {
    expect(chooseCoinSelection([candidate('costlier', 125n), candidate('cheaper', 100n)])?.id).toBe('cheaper');
  });

  it('never exceeds either fee limit over a range of integer costs', () => {
    for (const minimum of [1n, 7n, 282n, 999n, 4_001n, 50_001n]) {
      const choices = [candidate('minimum', minimum, 10_000_000n), ...Array.from({ length: 50 }, (_, i) => (
        candidate(`alternative-${i}`, minimum + BigInt(i * 53), 1_000_000n - BigInt(i))
      ))];
      const best = chooseCoinSelection(choices)!;
      expect((best.feeSats - minimum) * 4n <= minimum).toBe(true);
      expect(best.feeSats - minimum <= 1_000n).toBe(true);
    }
  });

  it('returns no candidate when funding failed and rejects invalid fee metadata', () => {
    expect(chooseCoinSelection([])).toBeUndefined();
    expect(() => chooseCoinSelection([candidate('invalid', -1n)])).toThrow('Invalid coin selection cost.');
  });
});
