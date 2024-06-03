import { BigNumberish, utils } from "ethers";
import { ethers } from "hardhat";

import { PullSplitFactory, SplitMain } from "../../types";

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

export const deploySplitV2 = async (
  splitV2Factory: PullSplitFactory,
  recipients: Array<string>,
  allocations: Array<number>,
  distributionIncentive: BigNumberish,
  totalAllocation: BigNumberish,
  owner: string,
): Promise<string> => {
  const tx = await splitV2Factory.createSplit(
    {
      recipients,
      allocations,
      distributionIncentive,
      totalAllocation,
    },
    owner,
    owner,
  );
  const receipt = await tx.wait();
  const splitAddress =
    receipt.events?.[1].topics[1] && ethers.utils.defaultAbiCoder.decode(["address"], receipt.events?.[1].topics[1])[0];
  if (!splitAddress) throw new Error("Failed to deploy Split");
  return splitAddress;
};

export const hashSplitV2: (arg0: string[], arg1: BigNumberish[], arg2: BigNumberish, arg3: number) => string = (
  recipients,
  allocations,
  totalAllocation,
  distributionIncentive,
) => {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["tuple(address[],uint256[],uint256,uint16)"],
      [[recipients, allocations, totalAllocation, distributionIncentive]],
    ),
  );
};
