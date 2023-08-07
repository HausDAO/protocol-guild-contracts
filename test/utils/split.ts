import { utils } from "ethers";
import { ethers } from "hardhat";

import { SplitMain } from "../../types";

export const deploySplit = async (
  splitMain: SplitMain,
  members: Array<string>,
  percentAllocations: Array<number>,
  distributorFee: number,
  controller: string,
): Promise<string> => {
  const tx = await splitMain.createSplit(members, percentAllocations, distributorFee, controller);
  const receipt = await tx.wait();
  const splitAddress =
    receipt.events?.[0].topics[1] && ethers.utils.defaultAbiCoder.decode(["address"], receipt.events?.[0].topics[1])[0];
  if (!splitAddress) throw new Error("Failed to deploy Split");
  return splitAddress;
};

export const hashSplit: (arg0: string[], arg1: number[], arg2: number) => string = (
  accounts,
  percentAllocations,
  distributionFee,
) => {
  return utils.solidityKeccak256(["address[]", "uint32[]", "uint32"], [accounts, percentAllocations, distributionFee]);
};
