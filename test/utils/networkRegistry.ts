import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployments, ethers, getNamedAccounts, getUnnamedAccounts } from "hardhat";

// import { NetworkRegistrySummoner } from "../../types";
import { GuildRegistryArgs, Member, NetworkRegistryArgs } from "../types";

// export const summonRegistry = async (
//   summoner: NetworkRegistrySummoner,
//   registrySingleton: string,
//   registryArgs: NetworkRegistryArgs,
//   registryName: string = "SampleRegistry",
// ) => {
//   const { connext, updaterDomainId, updaterAddress, splitMain, split, owner } = registryArgs;
//   const initializationParams = ethers.utils.defaultAbiCoder.encode(
//     ["address", "uint32", "address", "address", "address", "address"],
//     [connext, updaterDomainId, updaterAddress, splitMain, split, owner],
//   );

//   const tx = await summoner.summonRegistry(registrySingleton, registryName, initializationParams);
//   const receipt = await tx.wait();

//   const summonedEvent = receipt.events?.find((e) => e.event === "NetworkRegistrySummoned");

//   const registryAddress =
//     summonedEvent?.topics?.[1] && ethers.utils.defaultAbiCoder.decode(["address"], summonedEvent.topics[1])[0];
//   if (!registryAddress) throw new Error("Failed to summon a Network Registry");
//   return registryAddress;
// };

const summonRegistryProxy = async (
  calculatorLibraryAddress: string,
  initializationParams: string,
  registryName: string = "NetworkRegistry",
  registryContract: string = "NetworkRegistry",
) => {
  const { deployer } = await getNamedAccounts();

  const registryDeployed = await deployments.deploy(registryName, {
    contract: registryContract,
    from: deployer,
    args: [],
    libraries: {
      PGContribCalculator: calculatorLibraryAddress,
    },
    proxy: {
      execute: {
        methodName: "initialize",
        args: [initializationParams],
      },
      proxyContract: "ERC1967Proxy",
      proxyArgs: ["{implementation}", "{data}"],
    },
    log: true,
  });
  return registryDeployed.address;
};

export const summonNetworkRegistryProxy = async (
  calculatorLibraryAddress: string,
  registryArgs: NetworkRegistryArgs,
  registryName: string = "NetworkRegistry",
) => {
  const { connext, updaterDomainId, updaterAddress, splitMain, split, owner } = registryArgs;
  const initializationParams = ethers.utils.defaultAbiCoder.encode(
    ["address", "uint32", "address", "address", "address", "address"],
    [connext, updaterDomainId, updaterAddress, splitMain, split, owner],
  );

  return await summonRegistryProxy(calculatorLibraryAddress, initializationParams, registryName, "NetworkRegistry");
};

export const summonGuildRegistryProxy = async (
  calculatorLibraryAddress: string,
  registryArgs: GuildRegistryArgs,
  registryName: string = "GuildRegistry",
) => {
  const { splitMain, split, owner } = registryArgs;
  const initializationParams = ethers.utils.defaultAbiCoder.encode(
    ["address", "address", "address"],
    [splitMain, split, owner],
  );

  return await summonRegistryProxy(calculatorLibraryAddress, initializationParams, registryName, "GuildRegistry");
};

export const generateMemberBatch = async (totalMembers: number): Promise<Array<Member>> => {
  const accounts = await getUnnamedAccounts();
  const members = accounts.slice(0, totalMembers);
  const startDate = await time.latest();
  return members.map((m: string, idx: number) => {
    return {
      account: m,
      activityMultiplier: idx < 3 ? 100 : Math.floor(Math.random() * 100) > 50 ? 100 : 50,
      startDate,
    };
  });
};
