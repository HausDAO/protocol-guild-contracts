import { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ConnextMock, PGContribCalculator, PullSplitFactory, SplitsWarehouse, TestERC20 } from "../../types";

export type NetworkRegistryOpts = {
  parentDomainId?: number;
};

export type User = {
  address: string;
};

export type NetworkRegistryProps = {
  calculatorLibrary: PGContribCalculator;
  connext: ConnextMock;
  splitV2Factory: PullSplitFactory;
  splitWarehouse: SplitsWarehouse;
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

    const l1CalculatorLibrary = (await ethers.getContractAt(
      "PGContribCalculator",
      deployed["PGContribCalculator"].address,
      signer,
    )) as PGContribCalculator;

    // Deploy Connext Mock
    const connextMockDeployed = await deployments.deploy("ConnextMock", {
      contract: "ConnextMock",
      from: deployer,
      args: [6648936], // TODO: set parentDomain as parameter
      log: false,
    });
    const connext = (await ethers.getContractAt("ConnextMock", connextMockDeployed.address, signer)) as ConnextMock;

    // Deploy SplitsWarehouse contract on L1
    const l1SplitsWarehouseDeployed = await deployments.deploy("SplitsWarehouse", {
      contract: "SplitsWarehouse",
      from: deployer,
      args: ["Ethereum", "ETH"],
      log: false,
    });

    const l1SplitWarehouse = (await ethers.getContractAt(
      "SplitsWarehouse",
      l1SplitsWarehouseDeployed.address,
      signer,
    )) as SplitsWarehouse;

    // Deploy 0xSplitV2 Factory on L1
    const l1SplitV2FactoryDeployed = await deployments.deploy("PullSplitFactory", {
      contract: "PullSplitFactory",
      from: deployer,
      args: [l1SplitsWarehouseDeployed.address],
      log: false,
    });

    const l1SplitV2Factory = (await ethers.getContractAt(
      "PullSplitFactory",
      l1SplitV2FactoryDeployed.address,
      signer,
    )) as PullSplitFactory;

    // Deploy Calculator Library on L2
    const l2CalculatorLibraryDeployed = await deployments.deploy("PGContribCalculator", {
      contract: "PGContribCalculator",
      from: deployer,
      args: [],
      log: true,
    });

    const l2CalculatorLibrary = (await ethers.getContractAt(
      "PGContribCalculator",
      l2CalculatorLibraryDeployed.address,
      signer,
    )) as PGContribCalculator;

    // Deploy SplitsWarehouse contract on L2
    const l2SplitsWarehouseDeployed = await deployments.deploy("SplitsWarehouse", {
      contract: "SplitsWarehouse",
      from: deployer,
      args: ["Ethereum L2", "ETH"],
      log: false,
    });

    const l2SplitWarehouse = (await ethers.getContractAt(
      "SplitsWarehouse",
      l2SplitsWarehouseDeployed.address,
      signer,
    )) as SplitsWarehouse;

    // Deploy 0xSplitV2 Factory on L1
    const l2SplitV2FactoryDeployed = await deployments.deploy("PullSplitFactory", {
      contract: "PullSplitFactory",
      from: deployer,
      args: [l2SplitsWarehouseDeployed.address],
      log: false,
    });
    const l2SplitV2Factory = (await ethers.getContractAt(
      "PullSplitFactory",
      l2SplitV2FactoryDeployed.address,
      signer,
    )) as PullSplitFactory;

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
      calculatorLibrary: l1CalculatorLibrary,
      connext,
      splitV2Factory: l1SplitV2Factory,
      splitWarehouse: l1SplitWarehouse,
      token: l1Token,
      l2: {
        calculatorLibrary: l2CalculatorLibrary,
        connext,
        splitV2Factory: l2SplitV2Factory,
        splitWarehouse: l2SplitWarehouse,
        token: l2Token,
      },
      users: {
        owner: {
          address: deployer,
        },
        applicant: {
          address: applicant,
        },
        alice: {
          address: alice,
        },
        bob: {
          address: bob,
        },
      },
    };
  },
);
