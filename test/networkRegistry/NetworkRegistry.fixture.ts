import { BigNumber, BigNumberish } from "ethers";
import { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
  ConnextMock,
  NetworkRegistry,
  NetworkRegistryShaman,
  NetworkRegistrySummoner,
  SplitMain,
  TestERC20,
} from "../../types";

export type NetworkRegistryOpts = {
  parentDomainId?: number;
};

export type User = {
  address: string;
  summoner: NetworkRegistrySummoner;
};

export type NetworkRegistryProps = {
  connext: ConnextMock;
  splitMain: SplitMain;
  summoner: NetworkRegistrySummoner;
  pgRegistrySingleton: NetworkRegistry;
  pgRegistryShamanSingleton: NetworkRegistryShaman;
  token: TestERC20;
};

export type RegistrySetup = NetworkRegistryProps & {
  l2: NetworkRegistryProps;
  users: {
    [key: string]: User;
  };
};

export const registryFixture = deployments.createFixture<RegistrySetup, NetworkRegistryOpts>(
  async (hre: HardhatRuntimeEnvironment, _?: NetworkRegistryOpts) => {
    const { ethers, getNamedAccounts, getUnnamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const [applicant, alice, bob] = await getUnnamedAccounts();

    const signer = await ethers.getSigner(deployer);

    // TODO: add baal fixtures or execute existing fixture under utils
    // const deployed = await deployments.fixture(['Infra', 'Summoner']);
    const deployed = await deployments.fixture(["Summoner"]);

    // Deploy registry summoner on L1
    const l1Summoner = (await ethers.getContractAt(
      "NetworkRegistrySummoner",
      deployed["NetworkRegistrySummoner"].address,
      signer,
    )) as NetworkRegistrySummoner;
    const l1RegistrySingleton = (await ethers.getContractAt(
      "NetworkRegistry",
      deployed["NetworkRegistry"].address,
      signer,
    )) as NetworkRegistry;
    const l1RegistryShamanSingleton = (await ethers.getContractAt(
      "NetworkRegistryShaman",
      deployed["NetworkRegistryShaman"].address,
      signer,
    )) as NetworkRegistryShaman;

    // Deploy Connext Mock
    const connextMockDeployed = await deployments.deploy("ConnextMock", {
      contract: "ConnextMock",
      from: deployer,
      args: [6648936], // TODO: set parentDomain as parameter
      log: false,
    });
    const connext = (await ethers.getContractAt("ConnextMock", connextMockDeployed.address, signer)) as ConnextMock;

    // Deploy 0xSplit Main contract on L1
    const l1SplitMainDeployed = await deployments.deploy("SplitMain", {
      contract: "SplitMain",
      from: deployer,
      args: [],
      log: false,
    });
    const l1SplitMain = (await ethers.getContractAt("SplitMain", l1SplitMainDeployed.address, signer)) as SplitMain;

    // Deploy registry summoner for L2
    const summonerDeployed = await deployments.deploy("NetworkRegistrySummoner", {
      contract: "NetworkRegistrySummoner",
      from: deployer,
      args: [],
      log: false,
    });
    const summoner = (await ethers.getContractAt(
      "NetworkRegistrySummoner",
      summonerDeployed.address,
      signer,
    )) as NetworkRegistrySummoner;

    const pgNetRegistryDeployed = await deployments.deploy("NetworkRegistry", {
      contract: "NetworkRegistry",
      from: deployer,
      args: [],
      log: false,
    });
    const pgRegistrySingleton = (await ethers.getContractAt(
      "NetworkRegistry",
      pgNetRegistryDeployed.address,
      signer,
    )) as NetworkRegistry;

    const pgregistryShamanDeployed = await deployments.deploy("NetworkRegistryShaman", {
      contract: "NetworkRegistryShaman",
      from: deployer,
      args: [],
      log: false,
    });
    const pgRegistryShamanSingleton = (await ethers.getContractAt(
      "NetworkRegistryShaman",
      pgregistryShamanDeployed.address,
      signer,
    )) as NetworkRegistryShaman;

    // Deploy 0xSplit Main contract on L2
    const l2splitMainDeployed = await deployments.deploy("SplitMain", {
      contract: "SplitMain",
      from: deployer,
      args: [],
      log: false,
    });
    const l2splitMain = (await ethers.getContractAt("SplitMain", l2splitMainDeployed.address, signer)) as SplitMain;

    // Deploy TestERC20
    const tokenSupply = 100_000_000; // TODO: set token supply as paramter
    const l1TokenDeployed = await deployments.deploy("TestERC20", {
      contract: "TestERC20",
      from: deployer,
      args: ["Fake DAI", "DAI", ethers.utils.parseEther(tokenSupply.toString())],
      log: false,
    });
    const l2TokenDeployed = await deployments.deploy("TestERC20", {
      contract: "TestERC20",
      from: deployer,
      args: ["Fake DAI L2", "DAI", ethers.utils.parseEther(tokenSupply.toString())],
      log: false,
    });
    const l1Token = (await ethers.getContractAt("TestERC20", l1TokenDeployed.address, signer)) as TestERC20;
    const l2Token = (await ethers.getContractAt("TestERC20", l2TokenDeployed.address, signer)) as TestERC20;

    return {
      connext,
      splitMain: l1SplitMain,
      summoner: l1Summoner,
      pgRegistrySingleton: l1RegistrySingleton,
      pgRegistryShamanSingleton: l1RegistryShamanSingleton,
      token: l1Token,
      l2: {
        connext,
        splitMain: l2splitMain,
        summoner,
        pgRegistrySingleton,
        pgRegistryShamanSingleton,
        token: l2Token,
      },
      users: {
        owner: {
          address: deployer,
          summoner: summoner.connect(await ethers.getSigner(deployer)),
        },
        applicant: {
          address: applicant,
          summoner: summoner.connect(await ethers.getSigner(applicant)),
        },
        alice: {
          address: alice,
          summoner: summoner.connect(await ethers.getSigner(alice)),
        },
        bob: {
          address: bob,
          summoner: summoner.connect(await ethers.getSigner(bob)),
        },
      },
    };
  },
);

type SplitControlOpts = {
  l1NetworkRegistry: NetworkRegistry;
  chainIds: Array<BigNumberish>;
  relayerFees: Array<BigNumber>;
};

export const acceptNetworkSplitControl = deployments.createFixture<void, SplitControlOpts>(
  async (hre: HardhatRuntimeEnvironment, options?: SplitControlOpts) => {
    // console.log('************ acceptNetworkSplitControl ****************');
    if (!options) throw new Error("Missing parameters");
    const { l1NetworkRegistry, chainIds, relayerFees } = options;
    const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));
    const tx = await l1NetworkRegistry.acceptNetworkSplitControl(chainIds, relayerFees, { value: totalValue });
    await tx.wait();
  },
);
