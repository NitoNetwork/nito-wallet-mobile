import { describe, expect, it } from 'vitest';

import {
  DICE_ENTROPY_POOL_LENGTH,
  diceEntropyPoolToBase64,
  mixDiceEntropyPool,
  packDiceEntropySample,
  type DiceEntropySample,
} from './diceEntropy';

const sample = (counter: number): DiceEntropySample => ({
  dateNowMs: 1_786_200_000_000,
  performanceNowMs: 12_345.678,
  nativeTimestampMs: 54_321.123,
  locationX: 20.5,
  locationY: 41.25,
  pageX: 120.5,
  pageY: 341.25,
  force: 0.75,
  counter,
});

describe('dice entropy pool', () => {
  it('packs every timing, touch, force, and counter field as binary data', () => {
    const packed = packDiceEntropySample(sample(7));

    expect(packed).toBeInstanceOf(Uint8Array);
    expect(packed).toHaveLength(68);
    expect([...packed]).not.toEqual(new Array(68).fill(0));
  });

  it('mixes the previous 32-byte pool and changes when the sample changes', () => {
    const pool = Uint8Array.from({ length: DICE_ENTROPY_POOL_LENGTH }, (_, index) => index);
    const firstSample = packDiceEntropySample(sample(1));
    const secondSample = packDiceEntropySample(sample(2));
    const first = mixDiceEntropyPool(pool, firstSample);
    const repeated = mixDiceEntropyPool(pool, firstSample);
    const second = mixDiceEntropyPool(pool, secondSample);

    expect(first).toHaveLength(DICE_ENTROPY_POOL_LENGTH);
    expect(first).toEqual(repeated);
    expect(first).not.toEqual(second);
    expect(pool).toEqual(Uint8Array.from({ length: DICE_ENTROPY_POOL_LENGTH }, (_, index) => index));
  });

  it('rejects malformed pools and exports exactly 32 bytes', () => {
    expect(() => mixDiceEntropyPool(new Uint8Array(31), new Uint8Array(1))).toThrow();
    expect(() => diceEntropyPoolToBase64(new Uint8Array(33))).toThrow();

    const pool = new Uint8Array(DICE_ENTROPY_POOL_LENGTH);
    expect(Uint8Array.from(atob(diceEntropyPoolToBase64(pool)), (value) => value.charCodeAt(0)))
      .toEqual(pool);
  });
});
