import { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ConnextMock, NetworkRegistry, NetworkRegistryShaman, NetworkRegistrySummoner, SplitMain } from "../../types";
import { getRandomAllocations } from "../../src/utils";

export type NetworkRegistryOpts = {
};

export type User = {
  address: string;
  summoner: NetworkRegistrySummoner
};

export type NetworkRegistryProps = {
  connext: ConnextMock;
  splitMain: SplitMain;
  summoner: NetworkRegistrySummoner;
  pgRegistrySingleton: NetworkRegistry;
  pgRegistryShamanSingleton: NetworkRegistryShaman;
};

export type RegistrySetup = NetworkRegistryProps & {
  l2: NetworkRegistryProps;
  users: {
    [key: string]: User;
  };
}

export const registryFixture = deployments.createFixture<RegistrySetup, NetworkRegistryOpts>(
  async (hre: HardhatRuntimeEnvironment, options?: NetworkRegistryOpts
  ) => {
    const { ethers, getChainId, getNamedAccounts, getUnnamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const [applicant, alice, bob] = await getUnnamedAccounts();

    const chainId = await getChainId();
    const signer = await ethers.getSigner(deployer);

    // TODO: add baal fixtures or execute existing fixture under utils
    const deployed = await deployments.fixture(['Infra', 'Summoner']);
    
    const l1Summoner = (
      await ethers.getContractAt('NetworkRegistrySummoner', deployed['NetworkRegistrySummoner'].address, signer)
    ) as NetworkRegistrySummoner;
    const l1RegistrySingleton = (
      await ethers.getContractAt('NetworkRegistry', deployed['NetworkRegistry'].address, signer)
    ) as NetworkRegistry;
    const l1RegistryShamanSingleton = (
      await ethers.getContractAt('NetworkRegistryShaman', deployed['NetworkRegistryShaman'].address, signer)
    ) as NetworkRegistryShaman;

    const connextMockDeployed = await deployments.deploy('ConnextMock', {
      contract: 'ConnextMock',
        from: deployer,
        args: [6648936], // TODO: set parentDomain as parameter
        log: false,
    });
    const connext = (await ethers.getContractAt('ConnextMock', connextMockDeployed.address, signer)) as ConnextMock;

    const l1SplitMainDeployed = await deployments.deploy('SplitMain', {
      contract: 'SplitMain',
        from: deployer,
        args: [],
        log: false,
    });
    const l1SplitMain = (await ethers.getContractAt('SplitMain', l1SplitMainDeployed.address, signer)) as SplitMain;

    // L2 Network Registry
    const summonerDeployed = await deployments.deploy('NetworkRegistrySummoner', {
      contract: 'NetworkRegistrySummoner',
        from: deployer,
        args: [],
        log: false,
    });
    const summoner = (
      await ethers.getContractAt('NetworkRegistrySummoner', summonerDeployed.address, signer)
    ) as NetworkRegistrySummoner;

    const pgNetRegistryDeployed = await deployments.deploy('NetworkRegistry', {
      contract: 'NetworkRegistry',
        from: deployer,
        args: [],
        log: false,
    });
    const pgRegistrySingleton = (
      await ethers.getContractAt('NetworkRegistry', pgNetRegistryDeployed.address, signer)
    ) as NetworkRegistry;

    const pgregistryShamanDeployed = await deployments.deploy('NetworkRegistryShaman', {
      contract: 'NetworkRegistryShaman',
        from: deployer,
        args: [],
        log: false,
    });
    const pgRegistryShamanSingleton = (
      await ethers.getContractAt('NetworkRegistryShaman', pgregistryShamanDeployed.address, signer)
    ) as NetworkRegistryShaman;

    const splitMainDeployed = await deployments.deploy('SplitMain', {
      contract: 'SplitMain',
        from: deployer,
        args: [],
        log: false,
    });
    const splitMain = (await ethers.getContractAt('SplitMain', splitMainDeployed.address, signer)) as SplitMain;

    return {
      connext,
      splitMain: l1SplitMain,
      summoner: l1Summoner,
      pgRegistrySingleton: l1RegistrySingleton,
      pgRegistryShamanSingleton: l1RegistryShamanSingleton,
      l2: {
        connext,
        splitMain,
        summoner,
        pgRegistrySingleton,
        pgRegistryShamanSingleton,
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
      }
    };
  });
