import { Baal } from "@daohaus/baal-contracts";
// import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { deploymentConfig } from "../constants";

const deployFn: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { companionNetworks, deployments, ethers, getChainId, getNamedAccounts, network } = hre;
  const { deployer } = await getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const chainId = network.name === "hardhat" ? "5" : await getChainId(); // hardhat -> Forking mode

  const { deploy } = deployments;

  // uncomment if you get gas-related errors and need current network fee data to update params
  // console.log("Feedata", await ethers.provider.getFeeData());

  if (Object.keys(deploymentConfig).includes(chainId)) {
    const networkConfig = deploymentConfig[chainId];
    const parentChainId = companionNetworks.l1 && (await companionNetworks.l1.getChainId());
    console.log("Is L2?", networkConfig.l2, parentChainId);

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

    const calculatorLibraryDeployed = await deploy("PGContribCalculator", {
      contract: "PGContribCalculator",
      from: deployer,
      args: [],
      log: true,
    });

    const registryDeployed = await deploy("NetworkRegistry", {
      contract: "NetworkRegistry",
      from: deployer,
      args: [],
      libraries: {
        PGContribCalculator: calculatorLibraryDeployed.address,
      },
      proxy: {
        execute: {
          init: {
            methodName: "initialize",
            args: [initializationParams],
          },
        },
        owner,
        proxyContract: "ERC1967Proxy",
        proxyArgs: ["{implementation}", "{data}"],
      },
      log: true,
    });
    const registryAddress = registryDeployed.address;

    console.log(`PG NetworkRegistry deployed on ${network.name} chain at ${registryAddress}`);

    return;
  }
  console.error("PGRegistry: Not supported Network!");
};

export default deployFn;
deployFn.tags = ["NetworkRegistry", "UpgradeablePGNetworkRegistry"];
