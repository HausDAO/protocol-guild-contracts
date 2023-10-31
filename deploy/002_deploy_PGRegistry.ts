import { Baal } from "@daohaus/baal-contracts";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { deploymentConfig } from "../constants";
import { NetworkRegistrySummoner } from "../types";

// import { PGRegistry } from '../src/types';

const deployFn: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { companionNetworks, deployments, ethers, getChainId, getNamedAccounts, network } = hre;
  const { deployer } = await getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const chainId = await getChainId();

  if (Object.keys(deploymentConfig).includes(chainId)) {
    const networkConfig = deploymentConfig[chainId];
    const parentChainId = companionNetworks.l1 && (await companionNetworks.l1.getChainId());
    console.log("Is L2?", networkConfig.l2, parentChainId);

    const summonerDeployed = await deployments.get("NetworkRegistrySummoner");
    console.log("summoner", summonerDeployed.address);
    const registrySingletonDeployed = await deployments.get("NetworkRegistry");
    console.log("registrySingleton", registrySingletonDeployed.address);
    const summoner = (await ethers.getContractAt(
      "NetworkRegistrySummoner",
      summonerDeployed.address,
      signer,
    )) as NetworkRegistrySummoner;

    console.log("networkConfig", networkConfig);

    let safeAddress = networkConfig.safe;
    if (networkConfig.moloch && !networkConfig.safe) {
      const baal = (await ethers.getContractAt("Baal", networkConfig.moloch, signer)) as Baal;
      safeAddress = await baal.avatar();
    }
    const owner = networkConfig.l2
      ? networkConfig.registryOwner || ethers.constants.AddressZero
      : safeAddress || deployer;

    console.log("Registry will be owned by", owner, "Is L2?", networkConfig.l2, "Is Safe?", owner === safeAddress);

    const initializationParams = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint32", "address", "address", "address", "address"],
      [
        networkConfig.connext,
        networkConfig.l2 ? deploymentConfig[parentChainId].domainId : 0,
        networkConfig.l2 ? deploymentConfig[parentChainId].pgRegistry : ethers.constants.AddressZero,
        networkConfig.splitMain,
        networkConfig.split,
        owner,
      ],
    );

    const tx = await summoner.summonRegistry(
      registrySingletonDeployed.address,
      `PGNetworkRegistry-${network.name}`,
      initializationParams,
    );
    const receipt = await tx.wait();

    const registryAddress =
      receipt.events?.[3].topics[1] &&
      ethers.utils.defaultAbiCoder.decode(["address"], receipt.events?.[3].topics[1])[0];
    if (!registryAddress) throw new Error("Failed to summon a Network Registry");

    console.log(`PG NetworkRegistry deployed on ${network.name} chain at ${registryAddress}`);

    return;
  }
  console.error("PGRegistry: Not supported Network!");
};

export default deployFn;
deployFn.tags = ["NetworkRegistry", "PGNetworkRegistry"];
