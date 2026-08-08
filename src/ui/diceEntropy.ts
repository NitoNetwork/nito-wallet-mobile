import { sha256 } from '@noble/hashes/sha2.js';

export const DICE_ENTROPY_POOL_LENGTH = 32;

export type DiceEntropySample = {
  dateNowMs: number;
  performanceNowMs: number;
  nativeTimestampMs: number;
  locationX: number;
  locationY: number;
  pageX: number;
  pageY: number;
  force: number;
  counter: number;
};

const FLOAT_FIELD_COUNT = 8;
const SAMPLE_BYTE_LENGTH = (FLOAT_FIELD_COUNT * Float64Array.BYTES_PER_ELEMENT)
  + Uint32Array.BYTES_PER_ELEMENT;

const finiteOrZero = (value: number): number => (Number.isFinite(value) ? value : 0);

export const packDiceEntropySample = (sample: DiceEntropySample): Uint8Array => {
  const packed = new Uint8Array(SAMPLE_BYTE_LENGTH);
  const view = new DataView(packed.buffer);
  const floatValues = [
    sample.dateNowMs,
    sample.performanceNowMs,
    sample.nativeTimestampMs,
    sample.locationX,
    sample.locationY,
    sample.pageX,
    sample.pageY,
    sample.force,
  ];
  floatValues.forEach((value, index) => {
    view.setFloat64(index * Float64Array.BYTES_PER_ELEMENT, finiteOrZero(value), false);
  });
  view.setUint32(
    FLOAT_FIELD_COUNT * Float64Array.BYTES_PER_ELEMENT,
    sample.counter >>> 0,
    false,
  );
  return packed;
};

export const mixDiceEntropyPool = (
  pool: Uint8Array,
  sample: Uint8Array,
): Uint8Array => {
  if (pool.length !== DICE_ENTROPY_POOL_LENGTH) {
    throw new Error(`Dice entropy pool must contain ${DICE_ENTROPY_POOL_LENGTH} bytes.`);
  }
  return sha256.create().update(pool).update(sample).digest();
};

export const diceEntropyPoolToBase64 = (pool: Uint8Array): string => {
  if (pool.length !== DICE_ENTROPY_POOL_LENGTH) {
    throw new Error(`Dice entropy pool must contain ${DICE_ENTROPY_POOL_LENGTH} bytes.`);
  }
  return btoa(String.fromCharCode(...pool));
};
