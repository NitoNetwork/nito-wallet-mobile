export type CoinSelectionCost = {
  feeSats: bigint;
  inputCount: number;
  inputValueSats: bigint;
};

/** A single ceiling derived from the cheapest complete candidate, never from
 * the previous winner. Integer division cannot round the 25% allowance up. */
export const chooseCoinSelection = <T extends CoinSelectionCost>(candidates: readonly T[]): T | undefined => {
  let minimumFee: bigint | undefined;
  for (const candidate of candidates) {
    if (candidate.feeSats < 0n || candidate.inputValueSats < candidate.feeSats
      || !Number.isSafeInteger(candidate.inputCount) || candidate.inputCount < 1) {
      throw new Error('Invalid coin selection cost.');
    }
    if (minimumFee === undefined || candidate.feeSats < minimumFee) minimumFee = candidate.feeSats;
  }
  if (minimumFee === undefined) return undefined;
  const proportionalAllowance = minimumFee / 4n;
  const maximumFee = minimumFee + (proportionalAllowance < 1_000n ? proportionalAllowance : 1_000n);
  let best: T | undefined;
  for (const candidate of candidates) {
    if (candidate.feeSats > maximumFee) continue;
    if (!best || candidate.inputCount < best.inputCount
      || (candidate.inputCount === best.inputCount && (candidate.inputValueSats < best.inputValueSats
        || (candidate.inputValueSats === best.inputValueSats && candidate.feeSats < best.feeSats)))) {
      best = candidate;
    }
  }
  return best;
};
