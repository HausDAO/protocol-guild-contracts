import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { deploymentConfig } from "../constants";
import { NetworkRegistry, NetworkRegistrySummoner } from "../types";

// import { PGRegistry } from '../src/types';

const deployFn: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { companionNetworks, deployments, ethers, getChainId, getNamedAccounts, network } = hre;
  const { deployer } = await getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  console.log("deployer", deployer);
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

    const initializationParams = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint32", "address", "address", "address", "uint32", "address"],
      [
        networkConfig.connext,
        networkConfig.l2 ? deploymentConfig[parentChainId].domainId : 0,
        networkConfig.l2 ? deploymentConfig[parentChainId].pgRegistry : ethers.constants.AddressZero,
        networkConfig.splitMain,
        networkConfig.split,
        "0", // _splitDistributorFee
        networkConfig.l2 ? ethers.constants.AddressZero : networkConfig.moloch || networkConfig.safe || deployer,
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
  console.error("Not supported Network!");
};

export default deployFn;
deployFn.tags = ["NetworkRegistry", "PGNetworkRegistry"];
