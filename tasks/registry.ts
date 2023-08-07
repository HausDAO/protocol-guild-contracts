import {
  /*SdkBase, */
  SdkConfig,
  create,
} from "@connext/sdk";
import { BigNumber } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import { deploymentConfig } from "../constants";
import { ISplitMain, NetworkRegistry } from "../types";

task("registry:ownSplit", "Transfer Split ownerhip to registry contract").setAction(async function (
  taskArguments: TaskArguments,
  { ethers, getChainId, getNamedAccounts, network },
) {
  const { deployer } = await getNamedAccounts();
  const signer = await ethers.getSigner(deployer);

  const chainId = await getChainId();

  if (!deploymentConfig[chainId]?.pgRegistry) {
    console.error(`NetworkRegistry not found for ${network.name} network`, chainId);
    return;
  }

  const registryAddress = deploymentConfig[chainId].pgRegistry;
  const splitAddress = deploymentConfig[chainId].split;

  const splitMain = (await ethers.getContractAt(
    "ISplitMain",
    deploymentConfig[chainId]?.splitMain,
    signer,
  )) as ISplitMain;
  const transferTx = await splitMain.transferControl(splitAddress, registryAddress);
  await transferTx.wait();

  console.log(`Split Trasfer control at TxHash (${transferTx.hash})`);

  if (!deploymentConfig[chainId].l2) {
    const registry = (await ethers.getContractAt("NetworkRegistry", registryAddress, signer)) as NetworkRegistry;
    const acceptTx = await registry.acceptSplitControl();
    await acceptTx.wait();

    console.log(`Split Trasfer control accepted at TxHash (${acceptTx.hash})`);
  }
});

task("registry:addNetwork", "Add a network registry to be synced through Connext cross-chain communication")
  // .addParam("registryAddress", "NetworkRegistry address")
  .addParam("foreignChainId", "Foreign network chain Id")
  .addParam("foreignDomainId", "Connext Network domain Id")
  .addParam("foreignRegistryAddress", "Foreign NetworkRegistry address")
  .setAction(async function (taskArguments: TaskArguments, { ethers, getChainId, getNamedAccounts, network }) {
    const {
      foreignChainId,
      foreignDomainId,
      foreignRegistryAddress,
      // registryAddress,
    } = taskArguments;

    const chainId = await getChainId();

    if (!deploymentConfig[chainId]?.pgRegistry) {
      console.error(`NetworkRegistry not found for ${network.name} network`, chainId);
      return;
    }

    const registryAddress = deploymentConfig[chainId].pgRegistry;

    const { deployer } = await getNamedAccounts();

    const signer = await ethers.getSigner(deployer);

    const registry = (await ethers.getContractAt("NetworkRegistry", registryAddress, signer)) as NetworkRegistry;

    // TODO: validate if foreign registry is not already registered

    const tx = await registry.updateNetworkRegistry(foreignChainId, {
      domainId: foreignDomainId,
      registryAddress: foreignRegistryAddress,
      delegate: ethers.constants.AddressZero, // TODO: do we really need a delegate?
    });
    await tx.wait();

    console.log("Done.", `(txhash: ${tx.hash})`);
  });

task("registry:newMember", "Add a new member & sync with other networks")
  .addParam("member", "New member address")
  .addParam("multiplier", "Activity Multiplier (e.g. 50, 100")
  // .addParam("foreignDomainId", "Connext Network domain Id")
  // .addParam("foreignRegistryAddress", "Foreign NetworkRegistry address")
  .setAction(async function (taskArguments: TaskArguments, { ethers, getChainId, getNamedAccounts, network }) {
    const { deployer } = await getNamedAccounts();
    const signer = await ethers.getSigner(deployer);
    const chainId = await getChainId();

    if (!deploymentConfig[chainId]?.pgRegistry) {
      console.error(`NetworkRegistry not found for ${network.name} network`, chainId);
      return;
    }

    const networkConfig = deploymentConfig[chainId];
    const registryAddress = networkConfig.pgRegistry;

    const { member, multiplier } = taskArguments;

    const sdkConfig: SdkConfig = {
      signerAddress: deployer,
      // Use `mainnet` when you're ready...
      network: "testnet",
      // Add more chains here! Use mainnet domains if `network: mainnet`.
      // This information can be found at https://docs.connext.network/resources/supported-chains
      chains: {
        1735353714: {
          // Goerli domain ID
          providers: ["https://rpc.ankr.com/eth_goerli"],
        },
        1735356532: {
          // Optimism-Goerli domain ID
          providers: ["https://goerli.optimism.io"],
        },
        1734439522: {
          // Arbitrum-Goerli domain ID
          providers: ["https://goerli-rollup.arbitrum.io/rpc"],
        },
      },
      logLevel: "silent",
    };

    const originDomain = "1735353714";
    const optimismDomain = "1735356532";
    const arbitrumDomain = "1734439522";

    const { sdkBase } = await create(sdkConfig);
    const optimismGoerliFee = await sdkBase.estimateRelayerFee({
      originDomain,
      destinationDomain: optimismDomain,
    });
    const arbitrumGoerliFee = await sdkBase.estimateRelayerFee({
      originDomain,
      destinationDomain: arbitrumDomain,
    });

    const relayerFees = [optimismGoerliFee, arbitrumGoerliFee];
    const totalFees = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0)).toString();

    console.log(
      "relayerFees",
      relayerFees.map((f: BigNumber) => f.toString()),
    );
    console.log("total", totalFees);

    const registry = (await ethers.getContractAt("NetworkRegistry", registryAddress, signer)) as NetworkRegistry;

    const tx = await registry.syncSetNewMember(
      member,
      multiplier,
      (new Date().getTime() / 1000).toFixed(),
      [420, 421613],
      relayerFees,
      { value: totalFees },
    );
    await tx.wait();

    console.log(`Done. (txhash: ${tx.hash})`);
  });

task("registry:transferOwnership", "transfer ownership of registry (to DAO Safe")
  // .addParam("registryAddress", "NetworkRegistry address")
  .addParam("ownerAddress", "New Owner Address")
  .setAction(async function (taskArguments: TaskArguments, { ethers, getChainId, getNamedAccounts, network }) {
    const { ownerAddress } = taskArguments;

    const chainId = await getChainId();

    if (!deploymentConfig[chainId]?.pgRegistry) {
      console.error(`NetworkRegistry not found for ${network.name} network`, chainId);
      return;
    }

    const registryAddress = deploymentConfig[chainId].pgRegistry;

    const { deployer } = await getNamedAccounts();

    const signer = await ethers.getSigner(deployer);

    const registry = (await ethers.getContractAt("NetworkRegistry", registryAddress, signer)) as NetworkRegistry;

    // TODO: validate if foreign registry is not already registered

    const tx = await registry.transferOwnership(ownerAddress);
    await tx.wait();

    console.log("Done.", `(txhash: ${tx.hash})`);
  });
