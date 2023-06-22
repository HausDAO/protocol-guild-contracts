import { round, sum } from 'lodash';

import { PERCENTAGE_SCALE } from '../constants';


export type Member = {
    memberAddress: string;
    shares: string;
    activityModifier: number;
    percentAllocation: number;
};

// Takes a count and returns an array of evenly distributed random BigNumbers that sum to ALLOCATION_TOTAL
export function getRandomAllocations(count: number): number[] {
  const allocations = Array.from({ length: count }, () => Math.random());
  const totalAllocation = sum(allocations);
  const scaledAllocations = allocations.map((alloc) =>
    round((PERCENTAGE_SCALE.toNumber() * alloc) / totalAllocation),
  );
  // fix precision / rounding errors before converting to BN
  scaledAllocations[0] =
    PERCENTAGE_SCALE.toNumber() - sum(scaledAllocations.slice(1));
  if (scaledAllocations.some((alloc) => alloc === 0))
    return getRandomAllocations(count)
  return scaledAllocations
};
