import { ethers, getUnnamedAccounts } from "hardhat";
import { NetworkRegistrySummoner } from "../../types";
import { Member, NetworkRegistryArgs, NetworkRegistryShamanArgs } from "../types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export const summonRegistry = async (
    summoner: NetworkRegistrySummoner,
    registrySingleton: string,
    registryArgs: NetworkRegistryArgs,
    registryName: string = 'SampleRegistry'
  ) => {
    const { connext, updaterDomainId, updaterAddress, splitMain, split, owner } = registryArgs;
    const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint32', 'address', 'address', 'address', 'address'],
        [connext, updaterDomainId, updaterAddress, splitMain, split, owner]
    );
    // const eventIndex = 2 + Number(registryArgs.renounceOwnership);
    const eventIndex = 3; // NetworkRegistrySummoned

    const tx = await summoner.summonRegistry(registrySingleton, registryName, initializationParams);
    const receipt = await tx.wait();

    const registryAddress =
        receipt.events?.[eventIndex].topics[1] &&
        ethers.utils.defaultAbiCoder.decode(['address'], receipt.events?.[eventIndex].topics[1])[0];
    if (!registryAddress) throw new Error('Failed to summon a Network Registry');
    return registryAddress;
};

export const summonRegistryShaman = async (
    summoner: NetworkRegistrySummoner,
    registrySingleton: string,
    registryArgs: NetworkRegistryShamanArgs,
    registryName: string = 'SampleRegistry'
  ) => {
    const { connext, updaterDomainId, updaterAddress, splitMain, split, baal, sharesToMint, burnShares } = registryArgs;
    const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint32', 'address', 'address', 'address', 'address', 'uint256', 'bool'],
        [connext, updaterDomainId, updaterAddress, splitMain, split, baal, sharesToMint, burnShares]
    );
    // const eventIndex = 2 + Number(registryArgs.renounceOwnership);
    const eventIndex = 3; // NetworkRegistrySummoned

    const tx = await summoner.summonRegistry(registrySingleton, registryName, initializationParams);
    const receipt = await tx.wait();

    const registryAddress =
        receipt.events?.[eventIndex].topics[1] &&
        ethers.utils.defaultAbiCoder.decode(['address'], receipt.events?.[eventIndex].topics[1])[0];
    if (!registryAddress) throw new Error('Failed to summon a Network Registry');
    return registryAddress;
};

export const generateMemberBatch = async (
    totalMembers: number
): Promise<Array<Member>> => {
    const accounts = await getUnnamedAccounts();
    const members = accounts.slice(0, totalMembers);
    const startDate = await time.latest();
    return members.map((m: string, idx: number) => {
        return {
            account: m,
            activityMultiplier: idx < 3 ? 100 : (idx % 5 === 0 ? 0 : (Math.floor(Math.random() * 100) > 50 ? 100 : 50)),
            startDate,
        }
    });
};
