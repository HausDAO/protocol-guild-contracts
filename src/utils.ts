import csv from "csv-parser";
import fs from "fs";
import { round, sum } from "lodash";

import { PERCENTAGE_SCALE } from "../constants";

export type Member = {
  memberAddress: string;
  shares: string;
  activityModifier: number;
  percentAllocation: number;
};

export type SampleSplit = {
  address: string;
  startDateSeconds: number;
  secondsActive: number;
  activityMultiplier: number;
  calcContribution: number;
  allocation: number;
  splitAllocation: number;
};

// Takes a count and returns an array of evenly distributed random BigNumbers that sum to ALLOCATION_TOTAL
export const getRandomAllocations = (count: number): number[] => {
  const allocations: Array<number> = Array.from({ length: count }, () => Math.random());
  const totalAllocation = sum(allocations);
  const scaledAllocations = allocations.map((alloc) => round((PERCENTAGE_SCALE.toNumber() * alloc) / totalAllocation));
  // fix precision / rounding errors before converting to BN
  scaledAllocations[0] = PERCENTAGE_SCALE.toNumber() - sum(scaledAllocations.slice(1));
  if (scaledAllocations.some((alloc) => alloc === 0)) return getRandomAllocations(count);
  return scaledAllocations;
};

export const readSampleSplit = async (csvFilePath: string): Promise<Array<SampleSplit>> => {
  const results: Array<SampleSplit> = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on("data", (data) => {
        results.push({
          address: data.address,
          startDateSeconds: Number(data.startDateSeconds),
          secondsActive: Number(data.secondsActive),
          activityMultiplier: Number(data.activityMultiplier),
          calcContribution: Number(data.calcContribution.replace(",", "")),
          allocation: Number(data.allocation),
          splitAllocation: Number(data.splitAllocation.replace(",", "")),
        });
      })
      .on("end", () => resolve(results))
      .on("error", (error) => reject(error));
  });
};

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export const arrayToFile = async (array: Array<any>) => {
  const stream = fs.createWriteStream("output.log");
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  array.forEach((val: any) => stream.write(`${val}\n`));
  stream.end();
};
