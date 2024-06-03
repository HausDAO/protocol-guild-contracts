import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  impersonateAccount,
  setBalance,
  stopImpersonatingAccount,
  time,
} from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber, Event } from "ethers";
import { deployments, ethers, getNamedAccounts, getUnnamedAccounts } from "hardhat";

import { PERCENTAGE_SCALE } from "../../constants";
import {
  ConnextMock,
  NetworkRegistry,
  NetworkRegistryV2,
  NetworkRegistryV2Harness,
  NetworkRegistryV21Mock,
  PGContribCalculator,
  PullSplitFactory,
  SplitMain,
  SplitWalletV2,
} from "../../types";
import { Member } from "../types";
import {
  deploySplit,
  deploySplitV2,
  generateMemberBatch,
  hashSplitV2,
  summonNetworkRegistryProxy,
  summonNetworkRegistryV2Proxy,
} from "../utils";
import { NetworkRegistryProps, User, registryFixture } from "./NetworkRegistryV2.fixture";

describe("NetworkRegistryV2", function () {
  let connext: ConnextMock;
  let l1CalculatorLibrary: PGContribCalculator;
  let splitV2Factory: PullSplitFactory;
  let l1SplitV2Address: string;
  let l1SplitWalletV2: SplitWalletV2;
  let l2Registry: NetworkRegistryProps;
  let l2SplitV2Address: string;
  let l2SplitWalletV2: SplitWalletV2;
  let users: { [key: string]: User };
  let members: Array<string>;
  const splitConfig = {
    percentAllocations: [400_000, 300_000, 300_000],
    distributorFee: 0,
  };

  const parentDomainId = 6648936;
  const replicaChainId = 10;
  const replicaDomainId = 1869640809;

  let l1NetworkRegistry: NetworkRegistryV2;
  let l2NetworkRegistry: NetworkRegistryV2;

  const defaultRelayerFee = ethers.utils.parseEther("0.001");

  beforeEach(async function () {
    const setup = await registryFixture({});
    l1CalculatorLibrary = setup.calculatorLibrary;
    connext = setup.connext;
    splitV2Factory = setup.splitV2Factory;
    l2Registry = setup.l2;
    users = setup.users;

    const signer = await ethers.getSigner(users.owner.address);
    const accounts = await getUnnamedAccounts();
    members = accounts
      .slice(0, splitConfig.percentAllocations.length)
      .sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));

    // Deploy Split V2 on L1
    l1SplitV2Address = await deploySplitV2(
      splitV2Factory,
      members,
      splitConfig.percentAllocations,
      splitConfig.distributorFee,
      PERCENTAGE_SCALE,
      users.owner.address,
    );
    l1SplitWalletV2 = (await ethers.getContractAt("SplitWalletV2", l1SplitV2Address, signer)) as SplitWalletV2;

    // Summon Main Registry
    const l1RegistryAddress = await summonNetworkRegistryV2Proxy(
      l1CalculatorLibrary.address,
      {
        connext: connext.address,
        updaterDomainId: 0, // Main Registry -> no domainId
        updaterAddress: ethers.constants.AddressZero, // Main Registry -> no updater
        split: l1SplitV2Address,
        owner: users.owner.address,
      },
      "MainNetworkRegistry",
    );
    l1NetworkRegistry = (await ethers.getContractAt(
      "NetworkRegistryV2",
      l1RegistryAddress,
      signer,
    )) as NetworkRegistryV2;

    // Transfer Split ownership to L1 NetworkRegistry
    const tx_ownership_l1 = await l1SplitWalletV2.transferOwnership(l1RegistryAddress);
    await tx_ownership_l1.wait();

    // Deploy Split on L2
    l2SplitV2Address = await deploySplitV2(
      splitV2Factory,
      members,
      splitConfig.percentAllocations,
      splitConfig.distributorFee,
      PERCENTAGE_SCALE,
      users.owner.address,
    );
    l2SplitWalletV2 = (await ethers.getContractAt("SplitWalletV2", l2SplitV2Address, signer)) as SplitWalletV2;

    // Summon a Replica Registry
    const l2RegistryAddress = await summonNetworkRegistryV2Proxy(
      l2Registry.calculatorLibrary.address,
      {
        connext: connext.address,
        updaterDomainId: parentDomainId,
        updaterAddress: l1NetworkRegistry.address,
        split: l2SplitV2Address,
        owner: ethers.constants.AddressZero, // renounceOwnership
      },
      "ReplicaNetworkRegistry",
    );
    l2NetworkRegistry = (await ethers.getContractAt(
      "NetworkRegistryV2",
      l2RegistryAddress,
      signer,
    )) as NetworkRegistryV2;

    // Add replica registry to main
    const networkRegistry = {
      domainId: replicaDomainId,
      registryAddress: l2NetworkRegistry.address,
      delegate: ethers.constants.AddressZero,
    };
    const tx = await l1NetworkRegistry.updateNetworkRegistry(replicaChainId, networkRegistry);
    await tx.wait();

    // Transfer Split control to L2 NetworkRegistry
    const tx_ownership_l2 = await l2SplitWalletV2.transferOwnership(l2RegistryAddress);
    await tx_ownership_l2.wait();
  });

  // ###############################################################################################################
  // #################################                        ######################################################
  // ################################# NetworkRegistry Config ######################################################
  // #################################                        ######################################################
  // ###############################################################################################################
  // ###############################################################################################################
  // ###############################################################################################################

  describe("NetworkRegistryV2 Config", function () {
    it("Should be not be able to initialize proxy with wrong parameters", async () => {
      const { deployer } = await getNamedAccounts();

      let initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address"],
        [
          ethers.constants.AddressZero, // invalid Connext address
          0, // updaterDomain
          ethers.constants.AddressZero, // updater address
          l1SplitV2Address, // split address
          deployer, // owner
        ],
      );

      await expect(
        deployments.deploy("NetworkRegistryV2", {
          contract: "NetworkRegistryV2",
          from: deployer,
          args: [],
          libraries: {
            PGContribCalculator: l1CalculatorLibrary.address,
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
        }),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__InvalidConnextAddress");

      initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address"],
        [
          connext.address, // connext address
          0, // updaterDomain
          ethers.constants.AddressZero, // updater address -> WRONG if owner is also address(0)
          l1SplitV2Address, // split address
          ethers.constants.AddressZero, // owner address -> WRONG if updater address is also address(0)
        ],
      );

      await expect(
        deployments.deploy("NetworkRegistryV2", {
          contract: "NetworkRegistryV2",
          from: deployer,
          args: [],
          libraries: {
            PGContribCalculator: l1CalculatorLibrary.address,
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
        }),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NeitherOwnableNorReplicaUpdater");
    });

    it("Should not be able to initialize the implementation contract", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const l1InitializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address"],
        [
          connext.address,
          0, // no domainId -> Main Registry
          ethers.constants.AddressZero, // no updater -> Main Registry
          l1SplitV2Address,
          users.owner.address,
        ],
      );
      const implSlot = BigNumber.from("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
      const slotValue = await ethers.provider.getStorageAt(l1NetworkRegistry.address, implSlot);
      const implementationAddress = `0x${slotValue.substring(26, 66)}`;
      const implementation = (await ethers.getContractAt(
        "NetworkRegistryV2",
        implementationAddress,
        signer,
      )) as NetworkRegistryV2;
      await expect(implementation.initialize(l1InitializationParams)).to.be.revertedWithCustomError(
        implementation,
        "InvalidInitialization",
      );
    });

    it("Should not be able to call init functions if contract is not initializing", async () => {
      const { deployer } = await getNamedAccounts();
      const signer = await ethers.getSigner(deployer);
      const implDeployed = await deployments.deploy("NetworkRegistryV2Harness", {
        contract: "NetworkRegistryV2Harness",
        from: deployer,
        args: [],
        libraries: {
          PGContribCalculator: l1CalculatorLibrary.address,
        },
        log: true,
      });
      const registry = (await ethers.getContractAt(
        "NetworkRegistryV2Harness",
        implDeployed.address,
        signer,
      )) as NetworkRegistryV2Harness;

      await expect(registry.exposed__MemberRegistry_init_unchained()).to.be.revertedWithCustomError(
        registry,
        "NotInitializing",
      );

      await expect(registry.exposed__MemberRegistry_init()).to.be.revertedWithCustomError(registry, "NotInitializing");

      await expect(
        registry.exposed__NetworkRegistryV2_init_unchained(
          ethers.constants.AddressZero,
          0,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
        ),
      ).to.be.revertedWithCustomError(registry, "NotInitializing");

      await expect(
        registry.exposed__NetworkRegistryV2_init(
          ethers.constants.AddressZero,
          0,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
        ),
      ).to.be.revertedWithCustomError(registry, "NotInitializing");
    });

    it("Should have owner on L1", async () => {
      expect(await l1NetworkRegistry.owner()).to.equal(users.owner.address);
    });

    it("Should not have owner on L2", async () => {
      expect(await l2NetworkRegistry.owner()).to.equal(ethers.constants.AddressZero);
    });

    it("Should not be able to transferOwnership to zero address", async () => {
      await expect(l1NetworkRegistry.transferOwnership(ethers.constants.AddressZero)).to.revertedWithCustomError(
        l1NetworkRegistry,
        "OwnableInvalidOwner",
      );
    });

    it("Should have connext properly setup", async () => {
      const l1ConnextAddress = await l1NetworkRegistry.connext();
      const l1UpdaterDomain = await l1NetworkRegistry.updaterDomain();
      const l1Updater = await l1NetworkRegistry.updater();
      expect(l1ConnextAddress).to.equal(connext.address);
      expect(l1UpdaterDomain).to.equal(0);
      expect(l1Updater).to.equal(ethers.constants.AddressZero);
      const l2ConnextAddress = await l2NetworkRegistry.connext();
      const l2UpdaterDomain = await l2NetworkRegistry.updaterDomain();
      const l2Updater = await l2NetworkRegistry.updater();
      expect(l2ConnextAddress).to.equal(connext.address);
      expect(l2UpdaterDomain).to.equal(parentDomainId);
      expect(l2Updater).to.equal(l1NetworkRegistry.address);
    });

    it("Should have an L2 NetworkRegistry setup", async () => {
      const replicaRegistry = await l1NetworkRegistry.replicaRegistry(replicaChainId);
      expect(replicaRegistry).to.have.ordered.members([
        replicaDomainId,
        l2NetworkRegistry.address,
        ethers.constants.AddressZero,
      ]);
    });

    it("Should not be able to call config methods if not owner or updater", async () => {
      const signer = await ethers.getSigner(users.applicant.address);
      const applicantRegistry = l1NetworkRegistry.connect(signer);

      await expect(
        applicantRegistry.updateNetworkRegistry(replicaChainId, {
          domainId: replicaDomainId,
          registryAddress: l2NetworkRegistry.address,
          delegate: ethers.constants.AddressZero,
        }),
      ).to.be.revertedWithCustomError(applicantRegistry, "OwnableUnauthorizedAccount");
      await expect(
        applicantRegistry.setUpdaterConfig(connext.address, parentDomainId, connext.address),
      ).to.be.revertedWithCustomError(applicantRegistry, "NetworkRegistry__OnlyOwnerOrUpdater");
      await expect(applicantRegistry.setSplit(l1SplitV2Address)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "NetworkRegistry__OnlyOwnerOrUpdater",
      );
      await expect(applicantRegistry.transferSplitOwnership(users.applicant.address)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "NetworkRegistry__OnlyOwnerOrUpdater",
      );
      await expect(applicantRegistry.pauseSplit(true)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "NetworkRegistry__OnlyOwnerOrUpdater",
      );
      await expect(
        applicantRegistry.splitWalletExecCalls([{ data: "0x", to: users.applicant.address, value: "0" }]),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyOwnerOrUpdater");

      // Replica
      await expect(
        l2NetworkRegistry.updateNetworkRegistry(replicaChainId, {
          domainId: replicaDomainId,
          registryAddress: l2NetworkRegistry.address,
          delegate: ethers.constants.AddressZero,
        }),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "OwnableUnauthorizedAccount");
      await expect(
        l2NetworkRegistry.upgradeNetworkRegistryImplementation(
          [replicaChainId],
          [ethers.constants.AddressZero],
          ["0x"],
          ["0"],
        ),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "OwnableUnauthorizedAccount");
      await expect(
        l2NetworkRegistry.setUpdaterConfig(connext.address, parentDomainId, connext.address),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__OnlyOwnerOrUpdater");
      await expect(l2NetworkRegistry.setSplit(l2SplitV2Address)).to.be.revertedWithCustomError(
        l2NetworkRegistry,
        "NetworkRegistry__OnlyOwnerOrUpdater",
      );
      await expect(l2NetworkRegistry.transferSplitOwnership(users.applicant.address)).to.be.revertedWithCustomError(
        l2NetworkRegistry,
        "NetworkRegistry__OnlyOwnerOrUpdater",
      );
      await expect(l2NetworkRegistry.pauseSplit(true)).to.be.revertedWithCustomError(
        l2NetworkRegistry,
        "NetworkRegistry__OnlyOwnerOrUpdater",
      );
      await expect(
        l2NetworkRegistry.splitWalletExecCalls([{ data: "0x", to: users.applicant.address, value: "0" }]),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__OnlyOwnerOrUpdater");

      // Syncing methods
      await expect(
        applicantRegistry.setNetworkUpdaterConfig(
          [replicaChainId],
          [connext.address],
          [parentDomainId],
          [l1NetworkRegistry.address],
          [0],
        ),
      ).to.be.revertedWithCustomError(applicantRegistry, "OwnableUnauthorizedAccount");
      await expect(
        applicantRegistry.updateNetworkSplit([replicaChainId], [l2SplitV2Address], [0]),
      ).to.be.revertedWithCustomError(applicantRegistry, "OwnableUnauthorizedAccount");
      await expect(
        applicantRegistry.transferNetworkSplitOwnership([replicaChainId], [users.applicant.address], [0]),
      ).to.be.revertedWithCustomError(applicantRegistry, "OwnableUnauthorizedAccount");

      await expect(applicantRegistry.pauseNetworkSplit([replicaChainId], [true], [0])).to.be.revertedWithCustomError(
        applicantRegistry,
        "OwnableUnauthorizedAccount",
      );
      await expect(
        applicantRegistry.networkSplitWalletExecCalls(
          [replicaChainId],
          [{ data: "0x", to: users.applicant.address, value: "0" }],
          [0],
        ),
      ).to.be.revertedWithCustomError(applicantRegistry, "OwnableUnauthorizedAccount");
    });

    it("Should not be able to set an invalid Connext address", async () => {
      await expect(
        l1NetworkRegistry.setUpdaterConfig(ethers.constants.AddressZero, 0, ethers.constants.AddressZero),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__InvalidConnextAddress");
    });

    it("Should be able to set new updater settings", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      // Summon a Replica Registry
      const l2RegistryAddress = await summonNetworkRegistryV2Proxy(
        l2Registry.calculatorLibrary.address,
        {
          connext: connext.address,
          updaterDomainId: parentDomainId,
          updaterAddress: l1NetworkRegistry.address,
          split: l2SplitV2Address,
          owner: signer.address,
        },
        "L2 Registry",
      );
      const l2NetworkRegistry = (await ethers.getContractAt(
        "NetworkRegistryV2",
        l2RegistryAddress,
        signer,
      )) as NetworkRegistryV2;

      await expect(l2NetworkRegistry.setUpdaterConfig(connext.address, 0, ethers.constants.AddressZero))
        .to.emit(l2NetworkRegistry, "NewUpdaterConfig")
        .withArgs(connext.address, 0, ethers.constants.AddressZero);
    });

    it("Should not be able to add an empty replica registry", async () => {
      const replicaChainId = 420420420;
      let networkRegistry = {
        domainId: 0,
        registryAddress: ethers.constants.AddressZero,
        delegate: ethers.constants.AddressZero,
      };
      await expect(
        l1NetworkRegistry.updateNetworkRegistry(replicaChainId, networkRegistry),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__InvalidReplica");

      networkRegistry = {
        domainId: 420420420,
        registryAddress: ethers.constants.AddressZero,
        delegate: ethers.constants.AddressZero,
      };
      await expect(
        l1NetworkRegistry.updateNetworkRegistry(replicaChainId, networkRegistry),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__InvalidReplica");
    });

    it("Should be able to add a replica network registry", async () => {
      const newReplicaChainId = 442;
      const networkRegistry = {
        domainId: 442000000,
        registryAddress: l2NetworkRegistry.address,
        delegate: ethers.constants.AddressZero,
      };

      const tx = await l1NetworkRegistry.updateNetworkRegistry(newReplicaChainId, networkRegistry);
      await expect(tx)
        .to.emit(l1NetworkRegistry, "NetworkRegistryUpdated")
        .withArgs(
          newReplicaChainId,
          networkRegistry.registryAddress,
          networkRegistry.domainId,
          networkRegistry.delegate,
        );

      const netRegistry = await l1NetworkRegistry.replicaRegistry(newReplicaChainId);
      expect(netRegistry).to.eql(Object.values(networkRegistry));
    });

    it("Should be able to remove a replica", async () => {
      const networkRegistry = {
        domainId: 0,
        registryAddress: ethers.constants.AddressZero,
        delegate: ethers.constants.AddressZero,
      };

      await expect(l1NetworkRegistry.updateNetworkRegistry(replicaChainId, networkRegistry))
        .to.emit(l1NetworkRegistry, "NetworkRegistryUpdated")
        .withArgs(replicaChainId, networkRegistry.registryAddress, networkRegistry.domainId, networkRegistry.delegate);

      const netRegistry = await l1NetworkRegistry.replicaRegistry(replicaChainId);
      expect(netRegistry).to.eql(Object.values(networkRegistry));
    });

    it("Should control a 0xSplit contract on L1", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const l1SplitAddress = await l1NetworkRegistry.split();
      const splitWalletV2 = (await ethers.getContractAt("SplitWalletV2", l1SplitAddress, signer)) as SplitWalletV2;
      expect(await splitWalletV2.owner()).to.equal(l1NetworkRegistry.address);
    });

    it("Should not be able to set a non-existent 0xSplit contract", async () => {
      const dummySplitAddress = users.applicant.address;
      await expect(l1NetworkRegistry.setSplit(dummySplitAddress)).to.be.revertedWithoutReason();

      const newSplitAddress = await deploySplitV2(
        splitV2Factory,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        PERCENTAGE_SCALE,
        ethers.constants.AddressZero, // immutable
      );
      await expect(l1NetworkRegistry.setSplit(newSplitAddress)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "Split__InvalidOrImmutable",
      );
    });

    it("Should not be able to update 0xSplit contract if ownership is not handed over first", async () => {
      const newSplitAddress = await deploySplitV2(
        splitV2Factory,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        PERCENTAGE_SCALE,
        users.owner.address,
      );

      await expect(l1NetworkRegistry.setSplit(newSplitAddress)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "Split__ControlNotHandedOver",
      );
    });

    it("Should be able to update 0xSplit contract and get ownership over it", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const newSplitAddress = await deploySplitV2(
        splitV2Factory,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        PERCENTAGE_SCALE,
        users.owner.address,
      );
      const newSplitWallet = (await ethers.getContractAt("SplitWalletV2", newSplitAddress, signer)) as SplitWalletV2;
      const txTransfer = await newSplitWallet.transferOwnership(l1NetworkRegistry.address);
      await txTransfer.wait();
      await expect(txTransfer)
        .to.emit(newSplitWallet, "OwnershipTransferred")
        .withArgs(users.owner.address, l1NetworkRegistry.address);

      const tx = await l1NetworkRegistry.setSplit(newSplitAddress);

      await expect(tx).to.emit(l1NetworkRegistry, "SplitUpdated").withArgs(newSplitAddress);
    });

    it("Should be able to transfer 0xSplit control", async () => {
      const newController = users.applicant.address;
      const tx = await l1NetworkRegistry.transferSplitOwnership(newController);
      await tx.wait();
      expect(await l1SplitWalletV2.owner()).to.equal(newController);
    });

    it("Should be able to pause 0xSplit", async () => {
      const tx = await l1NetworkRegistry.pauseSplit(true);
      await expect(tx).to.emit(l1SplitWalletV2, "SetPaused").withArgs(true);
    });

    it("Should be able to execute calls through 0xSplit wallet", async () => {
      const to = users.applicant.address;
      const value = ethers.utils.parseEther("1");
      const calls = [
        {
          to,
          value,
          data: "0x",
        },
      ];
      const balanceBefore = await ethers.provider.getBalance(to);
      const tx = await l1NetworkRegistry.splitWalletExecCalls(calls, { value });
      await expect(tx)
        .to.emit(l1SplitWalletV2, "ExecCalls")
        .withArgs((value: any) => {
          expect(value.length).to.equal(1);
          expect(value[0]).to.deep.equal(calls.map((c) => [c.to, c.value, c.data])[0]);
          return true;
        });
      const balanceAfter = await ethers.provider.getBalance(to);
      expect(balanceAfter).to.be.equal(balanceBefore.add(value));
    });
  });

  // ################################################################################################################
  // ##################################                         #####################################################
  // ################################## NetworkRegistry Actions #####################################################
  // ##################################                         #####################################################
  // ################################################################################################################
  // ################################################################################################################
  // ################################################################################################################

  describe("NetworkRegistryV2 Actions", function () {
    it("Should not be able to update a main registry using non-sync functions", async () => {
      const signer = await ethers.getSigner(users.applicant.address);
      const applicantRegistry = l1NetworkRegistry.connect(signer);
      await expect(
        applicantRegistry.batchNewMembers([users.applicant.address], [100], [0]),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyReplicaRegistrySync");
      await expect(
        applicantRegistry.batchUpdateMembersActivity([users.applicant.address], [100]),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyReplicaRegistrySync");
      await expect(applicantRegistry.batchRemoveMembers([users.applicant.address])).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "NetworkRegistry__OnlyReplicaRegistrySync",
      );
      await expect(
        applicantRegistry.addOrUpdateMembersBatch([users.applicant.address], [100], [await time.latest()], [0]),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyReplicaRegistrySync");
      await expect(applicantRegistry.updateSecondsActive(0)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "NetworkRegistry__OnlyReplicaRegistry",
      );
      await expect(applicantRegistry.updateSplits([users.applicant.address], 10_000)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "NetworkRegistry__OnlyReplicaRegistry",
      );
      await expect(applicantRegistry.updateAll(0, [users.applicant.address], 10_000)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "NetworkRegistry__OnlyReplicaRegistry",
      );
    });

    it("Should not be able to update a replica registry if not submitted by the updater through Connext", async () => {
      await expect(
        l2NetworkRegistry.batchNewMembers([users.applicant.address], [100], [0]),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__OnlyReplicaRegistrySync");
      await expect(
        l2NetworkRegistry.batchUpdateMembersActivity([users.applicant.address], [100]),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__OnlyReplicaRegistrySync");
      await expect(
        l2NetworkRegistry.addOrUpdateMembersBatch([users.applicant.address], [100], [await time.latest()], [0]),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__OnlyReplicaRegistrySync");
    });

    it("Should not be able to add new members in batch if param sizes mismatch", async () => {
      const startDate = await time.latest();

      await expect(
        l1NetworkRegistry.syncBatchNewMembers([], [10], [Number(startDate)], [], []),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");

      await expect(
        l1NetworkRegistry.syncBatchNewMembers([ethers.constants.AddressZero], [10], [], [], []),
        // ).to.revertedWithPanic(
        //   "0x32",
        // ); // Array accessed at an out-of-bounds or negative index
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");

      await expect(
        l1NetworkRegistry.syncBatchNewMembers([ethers.constants.AddressZero], [], [Number(startDate)], [], []),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
    });

    it("Should not be able to add new members in batch if activityMultiplier=0", async () => {
      const newMembers = await generateMemberBatch(10);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      activityMultipliers[0] = 0;
      const startDates = newMembers.map((m: Member) => m.startDate);
      await expect(l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []))
        .to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__InvalidActivityMultiplier")
        .withArgs(members[0], 0);
    });

    it("Should be able to add a new member with correct parameters", async () => {
      const [, , , member1, member2] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const startDate = await time.latest();

      await expect(
        l1NetworkRegistry.syncBatchNewMembers(
          [ethers.constants.AddressZero],
          [activityMultiplier],
          [startDate],
          [],
          [],
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__InvalidAddress");

      await expect(l1NetworkRegistry.syncBatchNewMembers([member1], [activityMultiplier + 1], [startDate], [], []))
        .to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__InvalidActivityMultiplier")
        .withArgs(member1, activityMultiplier + 1);

      await expect(l1NetworkRegistry.syncBatchNewMembers([member1], [0], [startDate], [], []))
        .to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__InvalidActivityMultiplier")
        .withArgs(member1, 0);

      await expect(
        l1NetworkRegistry.syncBatchNewMembers([member1], [activityMultiplier], [0], [], []),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__InvalidStartDate");

      await expect(
        l1NetworkRegistry.syncBatchNewMembers([member1], [activityMultiplier], [(await time.latest()) + 1e6], [], []),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__InvalidStartDate");

      // tx success
      const tx = await l1NetworkRegistry.syncBatchNewMembers([member1], [activityMultiplier], [startDate], [], []);
      await expect(tx).to.emit(l1NetworkRegistry, "NewMember").withArgs(member1, Number(startDate), activityMultiplier);

      await expect(
        l1NetworkRegistry.syncBatchNewMembers([member1], [activityMultiplier], [startDate], [], []),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__AlreadyRegistered");

      const members = await l1NetworkRegistry.getMembers();
      const totalMembers = await l1NetworkRegistry.totalMembers();
      const totalActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      expect(members.length).to.be.equal(totalMembers);
      expect(totalMembers).to.be.equal(totalActiveMembers);
      expect(members[0]).to.have.ordered.members([member1, 0, Number(startDate), activityMultiplier]);

      const member = await l1NetworkRegistry.getMember(member1);
      expect(member).to.have.ordered.members([member1, 0, Number(startDate), activityMultiplier]);

      await expect(l1NetworkRegistry.getMember(member2)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "MemberRegistry__NotRegistered",
      );
    });

    it("Should be able to add new members in batch", async () => {
      const newMembers = await generateMemberBatch(10);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      for (let i = 0; i < newMembers.length; i++) {
        await expect(tx)
          .to.emit(l1NetworkRegistry, "NewMember")
          .withArgs(newMembers[i].account, Number(newMembers[i].startDate), newMembers[i].activityMultiplier);
      }
      const totalActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      expect(totalActiveMembers).to.be.equal(members.length);
    });

    it("Should not be able to update members in batch if param sizes mismatch", async () => {
      await expect(
        l1NetworkRegistry.syncBatchUpdateMembersActivity(members.slice(0, 1), [], [], []),
        // ).to.revertedWithPanic("0x32"); // Array accessed at an out-of-bounds or negative index
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");

      await expect(
        l1NetworkRegistry.syncBatchUpdateMembersActivity([], [100], [], []),
        // ).to.revertedWithPanic("0x32"); // Array accessed at an out-of-bounds or negative index
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
    });

    it("Should be able to update an existing member with correct parameters", async () => {
      const [, , , member1, member2] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const modActivityMultiplier = activityMultiplier / 2;
      const startDate = await time.latest();

      await expect(
        l1NetworkRegistry.syncBatchUpdateMembersActivity([member2], [activityMultiplier], [], []),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__NotRegistered");

      const newTx = await l1NetworkRegistry.syncBatchNewMembers([member1], [activityMultiplier], [startDate], [], []);
      await newTx.wait();
      const totalMembersBefore = await l1NetworkRegistry.totalMembers();

      await expect(
        l1NetworkRegistry.syncBatchUpdateMembersActivity([member1], [activityMultiplier + 1], [], []),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__InvalidActivityMultiplier");

      // should revert if member.secondsActive = 0
      await expect(
        l1NetworkRegistry.syncBatchUpdateMembersActivity([member1], [0], [], []),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "MemberRegistry__InvalidActivityMultiplier");

      let member = await l1NetworkRegistry.getMember(member1);

      let tx = await l1NetworkRegistry.syncBatchUpdateMembersActivity([member1], [modActivityMultiplier], [], []);
      await expect(tx)
        .to.emit(l1NetworkRegistry, "UpdateMember")
        .withArgs(member1, modActivityMultiplier, member.startDate, member.secondsActive);

      member = await l1NetworkRegistry.getMember(member1);
      let totalMembersAfter = await l1NetworkRegistry.totalMembers();
      let totalActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      expect(totalMembersBefore).to.be.equal(totalMembersAfter);
      expect(totalMembersAfter).to.be.equal(totalActiveMembers);

      expect(member).to.have.ordered.members([member1, 0, Number(startDate), modActivityMultiplier]);

      // update registry activity
      tx = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await tx.wait();

      // deactivate member at next epoch
      tx = await l1NetworkRegistry.syncBatchUpdateMembersActivity([member1], [0], [], []);
      await expect(tx).to.emit(l1NetworkRegistry, "UpdateMember").withArgs(member1, 0, member.startDate, anyValue);
      totalMembersAfter = await l1NetworkRegistry.totalMembers();
      totalActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      expect(totalMembersBefore).to.be.equal(totalMembersAfter);
      expect(totalActiveMembers).to.be.equal(0);
    });

    it("Should be able to update members in batch", async () => {
      const newMembers = await generateMemberBatch(10);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const modActivityMultipliers = newMembers.map((_, i) => (i % 2 === 0 ? 100 : 0));
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batchTx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batchTx.wait();

      const updateTx = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await updateTx.wait();

      const tx = await l1NetworkRegistry.syncBatchUpdateMembersActivity(members, modActivityMultipliers, [], []);
      for (let i = 0; i < newMembers.length; i++) {
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMember")
          .withArgs(newMembers[i].account, modActivityMultipliers[i], newMembers[i].startDate, anyValue);
      }
      const totalActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      expect(totalActiveMembers).to.be.equal(modActivityMultipliers.filter((v) => v === 0).length);
    });

    it("Should not be able to remove an unregistered member", async () => {
      const [, , , member] = await getUnnamedAccounts();
      await expect(l1NetworkRegistry.syncBatchRemoveMembers([member], [], [])).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "MemberRegistry__NotRegistered",
      );
    });

    it("Should be able to remove members from the registry", async () => {
      const batchSize = 5;
      const newMembers: Member[] = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batchAddTx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batchAddTx.wait();

      const updateTx = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await updateTx.wait();

      const batchUpdateTx = await l1NetworkRegistry.syncBatchUpdateMembersActivity(members.slice(0, 2), [0, 0], [], []);
      await batchUpdateTx.wait();

      const toBeMembers = [members[1], members[3]];

      const totalMembersBefore = await l1NetworkRegistry.totalMembers();
      const totalActiveMembersBefore = await l1NetworkRegistry.totalActiveMembers();

      const removeMembers = members.filter((_, i) => i % 2 === 0);
      const tx = await l1NetworkRegistry.syncBatchRemoveMembers(removeMembers, [], []);
      for (let i = 1; i < removeMembers.length; i++) {
        await expect(tx).to.emit(l1NetworkRegistry, "RemoveMember").withArgs(removeMembers[i]);
      }
      const totalMembersAfter = await l1NetworkRegistry.totalMembers();
      expect(totalMembersAfter).to.be.equal(totalMembersBefore.sub(removeMembers.length));
      const totalActiveMembersAfter = await l1NetworkRegistry.totalActiveMembers();
      expect(totalActiveMembersAfter).to.be.equal(totalActiveMembersBefore.sub(removeMembers.length - 1));

      const memberList = await l1NetworkRegistry.getMembers();
      expect(memberList.map((m) => m.account).every((m) => toBeMembers.includes(m))).to.be.true;
      expect(
        (
          await Promise.all(
            toBeMembers.map(async (address) => (await l1NetworkRegistry.getMember(address)).account === address),
          )
        ).every((v) => v),
      ).to.be.true;
    });

    it("Should be able to update registry activity", async () => {
      const batchSize = 5;
      const newMembers: Member[] = await generateMemberBatch(batchSize * 3);
      const batch1 = newMembers.slice(0, batchSize);
      let members = batch1.map((m: Member) => m.account);
      let activityMultipliers = batch1.map((m: Member) => m.activityMultiplier);
      let startDates = batch1.map((m: Member) => m.startDate);
      const batch1Date = Number(startDates[0]);
      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      ///////// BATCH 2

      const batch2 = newMembers.slice(batchSize, batchSize * 2);
      members = batch2.map((m: Member) => m.account);
      activityMultipliers = batch2.map((m: Member) => m.activityMultiplier);
      startDates = batch1.map((m: Member) => Number(m.startDate) + 3600 * 24 * 15); // 15 days later
      const batch2Date = Number(startDates[0]);
      const batch2Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch2Tx.wait();

      let tx = await l1NetworkRegistry.syncUpdateSecondsActive([], []);

      let lastBlockTimestamp = await time.latest();

      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch1[i].account,
            Math.floor(((lastBlockTimestamp - batch1Date) * Number(batch1[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch2[i].account,
            Math.floor(((lastBlockTimestamp - batch2Date) * Number(batch2[i].activityMultiplier)) / 100),
          );
      }
      let totalMembers = await l1NetworkRegistry.totalMembers();
      await expect(tx).to.emit(l1NetworkRegistry, "RegistryActivityUpdate").withArgs(lastBlockTimestamp, totalMembers);

      await time.increase(3600 * 24 * 30); // next block in 30 days

      ///////// BATCH 3

      const batch3 = newMembers.slice(batchSize * 2, batchSize * 3);
      members = batch3.map((m: Member) => m.account);
      activityMultipliers = batch3.map(() => 100); // make sure all new members are active
      startDates = batch3.map((m: Member) => Number(m.startDate) + 3600 * 24 * 45); // 45 days later
      const batch3Date = Number(startDates[0]);
      const batch3Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch3Tx.wait();

      const lastActivityUpdate = await l1NetworkRegistry.lastActivityUpdate();

      tx = await l1NetworkRegistry.syncUpdateSecondsActive([], []);

      lastBlockTimestamp = await time.latest();

      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch1[i].account,
            Math.floor(((lastBlockTimestamp - lastActivityUpdate) * Number(batch1[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch2[i].account,
            Math.floor(((lastBlockTimestamp - lastActivityUpdate) * Number(batch2[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch3[i].account,
            Math.floor(((lastBlockTimestamp - batch3Date) * Number(activityMultipliers[i])) / 100),
          );
      }
      totalMembers = await l1NetworkRegistry.totalMembers();
      await expect(tx).to.emit(l1NetworkRegistry, "RegistryActivityUpdate").withArgs(lastBlockTimestamp, totalMembers);
    });

    it("Should not be able to update registry activity on replica with wrong cutoff date parameter", async () => {
      await expect(l2NetworkRegistry.updateSecondsActive(1)).to.be.revertedWithCustomError(
        l2NetworkRegistry,
        "MemberRegistry__InvalidCutoffDate",
      );

      await expect(
        l2NetworkRegistry.updateSecondsActive(4294967294), // Max allowed timestamp (uint32): Feb 07, 2106
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "MemberRegistry__InvalidCutoffDate");
    });

    it("Should be able to update registry activity on replica with zero cutoff date parameter", async () => {
      // if cutoff date is set to zero it will use the current block timestamp
      const tx = await l2NetworkRegistry.updateSecondsActive(0);
      await tx.wait();
      const blockTimestamp = await time.latest();
      const totalMembers = await l2NetworkRegistry.totalMembers();
      await expect(tx).to.emit(l2NetworkRegistry, "RegistryActivityUpdate").withArgs(blockTimestamp, totalMembers);
    });

    it("Should not be able to update Split distribution if submitted member list is invalid", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await txUpdate.wait();

      const splitDistributorFee = splitConfig.distributorFee;

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      await expect(
        l1NetworkRegistry.syncUpdateAll(
          sortedMembers.map(() => sortedMembers[0]),
          splitDistributorFee,
          [], []
        ),
      ).to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__AccountsOutOfOrderOrInvalid");

      // first member in sortedList becomes inactive
      const batch2Tx = await l1NetworkRegistry.syncBatchUpdateMembersActivity(sortedMembers.slice(0, 1), [0], [], []);
      await batch2Tx.wait();

      await expect(
        l1NetworkRegistry.syncUpdateSplits(members, splitDistributorFee, [], []),
      ).to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__MemberListSizeMismatch");

      sortedMembers.pop(); // remove the last member in sortedList
      // try to execute a split distribution with first member in sortedList as inactive
      await expect(l1NetworkRegistry.syncUpdateSplits(sortedMembers, splitDistributorFee, [], []))
        .to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__InactiveMember")
        .withArgs(sortedMembers[0]);

      const activeMembers = sortedMembers.slice(1); // remove inactive member from sortedList
      const unregisteredMemberAddr = ethers.utils.getAddress(`0x${"f".repeat(40)}`); // replace last member in sortedList
      await expect(
        l1NetworkRegistry.syncUpdateSplits([...activeMembers, unregisteredMemberAddr], splitDistributorFee, [], []),
      )
        .to.be.revertedWithCustomError(l1CalculatorLibrary, "MemberRegistry__NotRegistered")
        .withArgs(unregisteredMemberAddr);
    });

    it("Should not be able to update a Split distribution if there is no active members", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      let activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);

      const splitDistributorFee = splitConfig.distributorFee;

      // no updates applied
      let txUpdate = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await txUpdate.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      await expect(
        l1NetworkRegistry.syncUpdateSplits(sortedMembers, splitDistributorFee, [], []),
      ).to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__NoActiveMembers");

      // add some members to the registry
      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      txUpdate = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await txUpdate.wait();

      // now all members become inactive
      activityMultipliers = newMembers.map(() => 0);
      const batch2Tx = await l1NetworkRegistry.syncBatchUpdateMembersActivity(members, activityMultipliers, [], []);
      await batch2Tx.wait();

      expect(await l1NetworkRegistry.totalActiveMembers()).to.be.equal(0);

      await time.increase(3600 * 24 * 30); // next block in 30 days

      // no updates applied
      txUpdate = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await txUpdate.wait();

      await expect(
        l1NetworkRegistry.syncUpdateSplits(sortedMembers, splitDistributorFee, [], []),
      ).to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__NoActiveMembers");
    });

    it("Should be able to calculate Split allocations that sum up to PERCENTAGE_SCALE", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      // same activityMultipliers and startDates to enforce allocations to sum up to PERCENTAGE_SCALE
      const activityMultipliers = newMembers.map(() => 100);
      const startDates = newMembers.map(() => newMembers[0].startDate);

      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await txUpdate.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      const { _recipients, _allocations } = await l1NetworkRegistry.calculate(sortedMembers);

      // fetch last calculated contributions on registry
      const contributions = await Promise.all(
        newMembers.map(async (member: Member) => await l1NetworkRegistry["calculateContributionOf"](member.account)),
      );
      const totalContributions = contributions.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      // calculate allocations on active members
      const calculatedAllocations = contributions.map((contr: BigNumber) =>
        contr.mul(PERCENTAGE_SCALE).div(totalContributions),
      );

      expect(_recipients).to.be.eql(newMembers.map((m: Member) => m.account));
      expect(_allocations).to.be.eql(calculatedAllocations);
    });

    it("Should be able to calculate Split allocations", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);

      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await txUpdate.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      const { _recipients, _allocations } = await l1NetworkRegistry.calculate(sortedMembers);

      // filter active members
      const activeMembers = newMembers.filter((member: Member) => Number(member.activityMultiplier) > 0);
      // fetch last calculated contributions on registry
      const contributions = await Promise.all(
        activeMembers.map(async (member: Member) => await l1NetworkRegistry["calculateContributionOf"](member.account)),
      );
      const totalContributions = contributions.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      // calculate allocations on active members
      const calculatedAllocations = contributions.map((contr: BigNumber) =>
        contr.mul(PERCENTAGE_SCALE).div(totalContributions),
      );
      const totalAllocations = calculatedAllocations.reduce(
        (a: BigNumber, b: BigNumber) => a.add(b),
        BigNumber.from(0),
      );
      // NOTICE: dust (remainder) should be added to the member with the lowest allocation
      if (totalAllocations.lt(PERCENTAGE_SCALE)) {
        const contribAsNumber: number[] = contributions.map((c) => c.toNumber());
        const minValue = Math.min(...contribAsNumber);
        const minIndex = contribAsNumber.indexOf(minValue);
        calculatedAllocations[minIndex] = calculatedAllocations[minIndex].add(PERCENTAGE_SCALE.sub(totalAllocations));
      }

      expect(_recipients).to.be.eql(activeMembers.map((m: Member) => m.account));
      expect(_allocations).to.be.eql(calculatedAllocations);
    });

    it("Should not be able to produce an empty Split distribution", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      members.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));

      await expect(l1NetworkRegistry.calculate(members)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__EmptyDistribution",
      );

      const splitDistributorFee = splitConfig.distributorFee;

      await expect(
        l1NetworkRegistry.syncUpdateSplits(members, splitDistributorFee, [], []),
      ).to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__EmptyDistribution");
    });

    it("Should be able to update Split values from last update", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await txUpdate.wait();

      members.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));
      const splitDistributorFee = splitConfig.distributorFee;

      // pre-calculate to get split hash
      const { _recipients, _allocations } = await l1NetworkRegistry.calculate(members);

      const splitHash = hashSplitV2(_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee);

      const tx = await l1NetworkRegistry.syncUpdateSplits(members, splitDistributorFee, [], []);

      await expect(tx)
        .to.emit(l1SplitWalletV2, "SplitUpdated")
        .withArgs((value: any) => {
          expect(value).to.deep.equal([_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee]);
          return true;
        });
      await expect(tx)
        .to.emit(l1NetworkRegistry, "SplitsDistributionUpdated")
        .withArgs(l1SplitV2Address, splitHash, splitDistributorFee);
      expect(await l1SplitWalletV2.splitHash()).to.equal(splitHash);
    });

    it("Should not be able to update all if submitted member list is invalid", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const splitDistributorFee = splitConfig.distributorFee;
      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      await time.increase(3600 * 24 * 30); // next block in 30 days
      const updateTx = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await updateTx.wait();

      await expect(
        l1NetworkRegistry.syncUpdateAll(
          sortedMembers.map(() => sortedMembers[0]),
          splitDistributorFee,
          [], []
        ),
      ).to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__AccountsOutOfOrderOrInvalid");

      // first member in sortedList becomes inactive
      const batch2Tx = await l1NetworkRegistry.syncBatchUpdateMembersActivity(sortedMembers.slice(0, 1), [0], [], []);
      await batch2Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      await expect(l1NetworkRegistry.syncUpdateAll(members, splitDistributorFee, [], [])).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__MemberListSizeMismatch",
      );

      sortedMembers.pop(); // remove the last member in sortedList
      // try to execute a update all with first member in sortedList as inactive
      await expect(l1NetworkRegistry.syncUpdateAll(sortedMembers, splitDistributorFee, [], []))
        .to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__InactiveMember")
        .withArgs(sortedMembers[0]);

      const activeMembers = sortedMembers.slice(1); // remove inactive member from sortedList
      const unregisteredMemberAddr = ethers.utils.getAddress(`0x${"f".repeat(40)}`); // replace last member in sortedList
      await expect(
        l1NetworkRegistry.syncUpdateAll([...activeMembers, unregisteredMemberAddr], splitDistributorFee, [], []),
      )
        .to.be.revertedWithCustomError(l1CalculatorLibrary, "MemberRegistry__NotRegistered")
        .withArgs(unregisteredMemberAddr);
    });

    it("Should be able to update all (member's activity + Splits)", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batch1Date = Number(startDates[0]);
      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      members.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));
      const splitDistributorFee = splitConfig.distributorFee;

      const tx = await l1NetworkRegistry.syncUpdateAll(members, splitDistributorFee, [], []);
      await tx.wait();

      const lastBlockTimestamp = await time.latest();

      // MUST get calculations after the updateAll call so it uses the latest activeSeconds
      const { _recipients, _allocations } = await l1NetworkRegistry.calculate(members);
      const splitHash = hashSplitV2(_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee);

      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            newMembers[i].account,
            Math.floor(((lastBlockTimestamp - batch1Date) * Number(newMembers[i].activityMultiplier)) / 100),
          );
      }
      const totalMembers = await l1NetworkRegistry.totalMembers();
      await expect(tx).to.emit(l1NetworkRegistry, "RegistryActivityUpdate").withArgs(lastBlockTimestamp, totalMembers);

      await expect(tx)
        .to.emit(l1SplitWalletV2, "SplitUpdated")
        .withArgs((value: any) => {
          expect(value).to.deep.equal([_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee]);
          return true;
        });
      await expect(tx)
        .to.emit(l1NetworkRegistry, "SplitsDistributionUpdated")
        .withArgs(l1SplitV2Address, splitHash, splitDistributorFee);
      expect(await l1SplitWalletV2.splitHash()).to.equal(splitHash);
    });
  });

  // ############################################################################################################
  // #################################                      #####################################################
  // #################################    NetworkRegistry   #####################################################
  // #################################       Getters        #####################################################
  // ############################################################################################################
  // ############################################################################################################
  // ############################################################################################################

  describe("NetworkRegistryV2 getters", function () {
    const batchSize: number = 10;
    let newMembers: Array<Member>;

    beforeEach(async function () {
      newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await tx.wait();
    });

    it("Should be able to get the current number of registered members", async () => {
      const totalMembers = await l1NetworkRegistry.totalMembers();
      expect(totalMembers).to.equal(newMembers.length);
    });

    it("Should be able to get the current number of active members", async () => {
      expect(await l1NetworkRegistry.totalActiveMembers()).to.equal(newMembers.length);

      const updateTx = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await updateTx.wait();

      const tx = await l1NetworkRegistry.syncBatchUpdateMembersActivity([members[0]], [0], [], []);
      await tx.wait();

      expect(await l1NetworkRegistry.totalActiveMembers()).to.equal(newMembers.length - 1);
    });

    it("Should throw an error when trying to fetch an unregistered user", async () => {
      await expect(l1NetworkRegistry.getMember(users.owner.address)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "MemberRegistry__NotRegistered",
      );
      await expect(l1NetworkRegistry.getMembersProperties([users.owner.address])).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "MemberRegistry__NotRegistered",
      );
    });

    it("Should be able to fetch a registered member", async () => {
      const member = await l1NetworkRegistry.getMember(newMembers[0].account);
      expect(member.account).to.equal(newMembers[0].account);
      expect(member.activityMultiplier).to.equal(newMembers[0].activityMultiplier);
      expect(member.startDate).to.equal(newMembers[0].startDate);
      expect(member.secondsActive).to.equal(0);

      const memberProperties = await l1NetworkRegistry.getMembersProperties([newMembers[0].account]);
      expect(memberProperties[0][0]).to.equal(newMembers[0].activityMultiplier);
      expect(memberProperties[1][0]).to.equal(newMembers[0].startDate);
      expect(memberProperties[2][0]).to.equal(0);
    });

    it("Should be able to fetch all registered members", async () => {
      const members = await l1NetworkRegistry.getMembers();
      for (let i = 0; i < newMembers.length; i++) {
        expect(members[i].account).to.equal(newMembers[i].account);
        expect(members[i].activityMultiplier).to.equal(newMembers[i].activityMultiplier);
        expect(members[i].startDate).to.equal(newMembers[i].startDate);
        expect(members[i].secondsActive).to.equal(0);
      }
    });

    it("Should not be able to fetch members paginated if index is out of bounds", async () => {
      await expect(l1NetworkRegistry.getMembersPaginated(100, 10000)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "MemberRegistry__IndexOutOfBounds",
      );
      await expect(l1NetworkRegistry.getMembersPaginated(0, 100)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "MemberRegistry__IndexOutOfBounds",
      );
    });

    it("Should be able to fetch members paginated", async () => {
      const toIndex = 5;
      const members = await l1NetworkRegistry.getMembersPaginated(0, toIndex);
      expect(members.length).to.equal(toIndex + 1);
    });

    it("Should be able to calculate members total contributions", async () => {
      // update registry activity
      const syncUpdateTx = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await syncUpdateTx.wait();

      const totalContribBefore = await l1NetworkRegistry.calculateTotalContributions();

      // get member contribution before getting inactive
      const member = newMembers[newMembers.length - 1].account;
      const memberContrib = await l1NetworkRegistry.calculateContributionOf(member);

      // member gets inactive
      const syncTx = await l1NetworkRegistry.syncBatchUpdateMembersActivity([member], [0], [], []);
      await syncTx.wait();

      const totalContribAfter = await l1NetworkRegistry.calculateTotalContributions();
      expect(totalContribBefore).to.eql(totalContribAfter.add(memberContrib));
    });
  });

  // ############################################################################################################
  // #################################                      #####################################################
  // #################################    NetworkRegistry   #####################################################
  // #################################       xReceive       #####################################################
  // ############################################################################################################
  // ############################################################################################################
  // ############################################################################################################

  describe("NetworkRegistryV2 xReceive", function () {
    it("Should revert if origin <> updaterDomain", async () => {
      await expect(
        l2NetworkRegistry.xReceive(
          ethers.utils.formatBytes32String("dummyId"),
          0,
          ethers.constants.AddressZero,
          l1NetworkRegistry.address, // right updater
          "0xdead", // wrong updaterDomain
          "0x", // any calldata
        ),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__ConnextOnly");
    });

    it("Should revert if originSender <> updater", async () => {
      await expect(
        l2NetworkRegistry.xReceive(
          ethers.utils.formatBytes32String("dummyId"),
          0,
          ethers.constants.AddressZero,
          l2NetworkRegistry.address, // wrong updater
          parentDomainId, // right updaterDomain
          "0x", // any calldata
        ),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__ConnextOnly");
    });

    it("Should revert if msg.sender is not Connext", async () => {
      await expect(
        l2NetworkRegistry.xReceive(
          ethers.utils.formatBytes32String("dummyId"),
          0,
          ethers.constants.AddressZero,
          l1NetworkRegistry.address, // right updater
          parentDomainId, // right updaterDomain
          "0x", // any calldata
        ),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__ConnextOnly");
    });

    it("Should revert when submitting a sync message for unauthorized/unknown actions", async () => {
      const transferId = ethers.utils.formatBytes32String("dummyId");
      // dummy action
      const action = l1SplitWalletV2.interface.getSighash("transferOwnership(address)");
      // encode unknown action calldata
      const calldata = ethers.utils.defaultAbiCoder.encode(
        ["bytes4", "address", "address"],
        [action, l1SplitV2Address, ethers.constants.AddressZero],
      );
      // TODO: impersonate connext
      await impersonateAccount(connext.address);
      const signer = await ethers.getSigner(connext.address);
      await setBalance(connext.address, ethers.utils.parseEther("1"));

      await expect(
        l2NetworkRegistry.connect(signer).xReceive(
          transferId,
          0,
          ethers.constants.AddressZero,
          l1NetworkRegistry.address, // right updater
          parentDomainId, // right updaterDomain
          calldata,
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__UnAuthorizedCalldata");

      await stopImpersonatingAccount(connext.address);
    });
  });

  // ############################################################################################################
  // #################################                      #####################################################
  // ################################# NetworkRegistry Sync #####################################################
  // #################################        Actions       #####################################################
  // ############################################################################################################
  // ############################################################################################################
  // ############################################################################################################

  describe("NetworkRegistryV2 Sync Actions", function () {
    it("Should have network registries properly setup", async () => {
      // Main registry
      expect(await l1NetworkRegistry.updaterDomain()).to.equal(0);
      expect(await l1NetworkRegistry.updater()).to.equal(ethers.constants.AddressZero);
      expect(await l1NetworkRegistry.isMainRegistry()).to.equal(true);
      const l2Registry = await l1NetworkRegistry.replicaRegistry(replicaChainId);
      expect(l2Registry).to.have.deep.members([
        replicaDomainId,
        l2NetworkRegistry.address,
        ethers.constants.AddressZero,
      ]);
      // Replica registry
      expect(await l2NetworkRegistry.updaterDomain()).to.equal(parentDomainId);
      expect(await l2NetworkRegistry.updater()).to.equal(l1NetworkRegistry.address);
      expect(await l2NetworkRegistry.owner()).to.equal(ethers.constants.AddressZero);
      expect(await l2NetworkRegistry.isMainRegistry()).to.equal(false);
    });

    it("Should not xReceive a sync message if sent by an unauthorized updater through Connext", async () => {
      await expect(
        l1NetworkRegistry.xReceive(
          ethers.utils.randomBytes(32),
          0,
          ethers.constants.AddressZero,
          users.applicant.address,
          parentDomainId,
          "0x",
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ConnextOnly");
      const connextCaller = await ethers.getSigner(users.applicant.address);
      const l2RegistryAddress = await summonNetworkRegistryV2Proxy(
        l2Registry.calculatorLibrary.address,
        {
          connext: users.applicant.address, // fake connext caller
          updaterDomainId: parentDomainId,
          updaterAddress: l1NetworkRegistry.address,
          split: l2SplitV2Address,
          owner: ethers.constants.AddressZero, // renounceOwnership
        },
        "L2Registry1",
      );
      const l2NewRegistry = (await ethers.getContractAt(
        "NetworkRegistryV2",
        l2RegistryAddress,
        connextCaller,
      )) as NetworkRegistryV2;
      await expect(
        l2NewRegistry.xReceive(
          ethers.utils.randomBytes(32),
          0,
          ethers.constants.AddressZero,
          users.applicant.address, // originSender != updaterAddress
          parentDomainId,
          "0x",
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ConnextOnly");
    });

    it("Should not be able to sync the registry if not called by the updater", async () => {
      const signer = await ethers.getSigner(users.applicant.address);
      const applicantRegistry = l1NetworkRegistry.connect(signer);

      await expect(
        applicantRegistry.syncBatchNewMembers([users.applicant.address], [100], [0], [replicaChainId], [0]),
      ).to.be.revertedWithCustomError(applicantRegistry, "OwnableUnauthorizedAccount");
      await expect(
        applicantRegistry.syncNetworkMemberRegistry([], [replicaChainId], [0]),
      ).to.be.revertedWithCustomError(applicantRegistry, "OwnableUnauthorizedAccount");
      await expect(
        applicantRegistry.syncBatchUpdateMembersActivity([users.applicant.address], [100], [replicaChainId], [0]),
      ).to.be.revertedWithCustomError(applicantRegistry, "OwnableUnauthorizedAccount");
      await expect(
        applicantRegistry.syncBatchRemoveMembers([users.applicant.address], [replicaChainId], [0]),
      ).to.be.revertedWithCustomError(applicantRegistry, "OwnableUnauthorizedAccount");
    });

    it("Should not be able to call sync actions on a replica registry", async () => {
      const [, , , member] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const startDate = (new Date().getTime() / 1000).toFixed(0);
      const parentChainId = 1;

      const signer = await ethers.getSigner(users.owner.address);
      const l2RegistryAddress = await summonNetworkRegistryV2Proxy(
        l2Registry.calculatorLibrary.address,
        {
          connext: connext.address,
          updaterDomainId: parentDomainId,
          updaterAddress: l1NetworkRegistry.address,
          split: l2SplitV2Address,
          owner: signer.address,
        },
        "L2Registry2",
      );
      const replicaRegistry = (await ethers.getContractAt(
        "NetworkRegistryV2",
        l2RegistryAddress,
        signer,
      )) as NetworkRegistryV2;
      await expect(
        replicaRegistry.syncBatchNewMembers(
          [member],
          [activityMultiplier],
          [startDate],
          [parentDomainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.syncNetworkMemberRegistry(
          [member],
          [parentDomainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.syncBatchUpdateMembersActivity(
          [member],
          [activityMultiplier],
          [parentDomainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.syncBatchRemoveMembers(
          [member],
          [parentDomainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.syncUpdateSecondsActive(
          [parentDomainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.syncUpdateSplits(
          [users.applicant.address],
          [0],
          [parentDomainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.syncUpdateAll(
          [users.applicant.address],
          [0],
          [parentDomainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.updateNetworkRegistry(replicaChainId, {
          domainId: parentDomainId,
          registryAddress: l1NetworkRegistry.address,
          delegate: ethers.constants.AddressZero,
        }),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.upgradeNetworkRegistryImplementation(
          [replicaChainId],
          [ethers.constants.AddressZero],
          ["0x"],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.setNetworkUpdaterConfig(
          [parentChainId],
          [connext.address],
          [parentDomainId],
          [l1NetworkRegistry.address],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.updateNetworkSplit([parentChainId], [l1SplitV2Address], [defaultRelayerFee], {
          value: defaultRelayerFee,
        }),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.transferNetworkSplitOwnership(
          [parentChainId],
          [ethers.constants.AddressZero],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.pauseNetworkSplit([parentChainId], [true], [defaultRelayerFee], { value: defaultRelayerFee }),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
      await expect(
        replicaRegistry.networkSplitWalletExecCalls(
          [parentChainId],
          [{ to: l2RegistryAddress, value: "0", data: "0x" }],
          [defaultRelayerFee],
          {
            value: defaultRelayerFee,
          },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
    });

    it("Should not be able to call sync actions if param sizes mismatch", async () => {
      const [, , , member] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const startDate = (new Date().getTime() / 1000).toFixed(0);
      await expect(
        l1NetworkRegistry.syncBatchNewMembers(
          [member],
          [activityMultiplier],
          [startDate],
          [parentDomainId, replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
      await expect(
        l1NetworkRegistry.syncNetworkMemberRegistry(
          [], // members
          [parentDomainId, replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
      await expect(
        l1NetworkRegistry.syncBatchUpdateMembersActivity(
          [member],
          [activityMultiplier],
          [parentDomainId, replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
      await expect(
        l1NetworkRegistry.syncBatchRemoveMembers(
          [member],
          [parentDomainId, replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
      await expect(
        l1NetworkRegistry.syncUpdateSecondsActive(
          [parentDomainId, replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
      await expect(
        l1NetworkRegistry.syncUpdateSplits(
          [users.applicant.address],
          [0],
          [parentDomainId, replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
      await expect(
        l1NetworkRegistry.syncUpdateAll(
          [users.applicant.address],
          [0],
          [parentDomainId, replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
    });

    it("Should not be able to execute sync actions if not enough ETH is sent to cover relayer fees", async () => {
      const [, , , member] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const startDate = (new Date().getTime() / 1000).toFixed(0);
      await expect(
        l1NetworkRegistry.syncBatchNewMembers(
          [member],
          [activityMultiplier],
          [startDate],
          [replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");
      await expect(
        l1NetworkRegistry.syncNetworkMemberRegistry(
          [], // members
          [replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");
      await expect(
        l1NetworkRegistry.syncBatchUpdateMembersActivity(
          [member],
          [activityMultiplier],
          [replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");
      await expect(
        l1NetworkRegistry.syncBatchRemoveMembers(
          [member],
          [replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");
      await expect(
        l1NetworkRegistry.syncUpdateSecondsActive(
          [replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");
      await expect(
        l1NetworkRegistry.syncUpdateSplits(
          [users.applicant.address],
          [0],
          [replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");
      await expect(
        l1NetworkRegistry.syncUpdateAll(
          [users.applicant.address],
          [0],
          [replicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");
      await expect(
        l1NetworkRegistry.upgradeNetworkRegistryImplementation(
          [replicaChainId],
          [ethers.constants.AddressZero],
          ["0x"],
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");
      await expect(
        l1NetworkRegistry.setNetworkUpdaterConfig(
          [replicaChainId],
          [ethers.constants.AddressZero],
          [replicaDomainId],
          [ethers.constants.AddressZero],
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");

      await expect(
        l1NetworkRegistry.updateNetworkSplit(
          [replicaChainId],
          [l1SplitV2Address],
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");

      await expect(
        l1NetworkRegistry.transferNetworkSplitOwnership(
          [replicaChainId],
          [ethers.constants.AddressZero],
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");

      await expect(
        l1NetworkRegistry.pauseNetworkSplit(
          [replicaChainId],
          [true],
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");

      await expect(
        l1NetworkRegistry.networkSplitWalletExecCalls(
          [replicaChainId],
          [{ to: ethers.constants.AddressZero, value: "0", data: "0x" }],
          [defaultRelayerFee], // relayerFees
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__ValueSentLessThanRelayerFees");
    });

    it("Should not be able to submit a sync message to an unregistered replica", async () => {
      const [, , , member, member2, member3] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const startDate = await time.latest();
      const unregisteredReplicaChainId = Number("0xdeadbeef");

      await expect(
        l1NetworkRegistry.syncBatchNewMembers(
          [member, member2, member3],
          [activityMultiplier, activityMultiplier, activityMultiplier],
          [startDate, startDate, startDate],
          [unregisteredReplicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);
      await expect(
        l1NetworkRegistry.syncNetworkMemberRegistry(
          [], // members
          [unregisteredReplicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);

      // Adding a few members
      const tx = await l1NetworkRegistry.syncBatchNewMembers(
        [member, member2, member3],
        [activityMultiplier, activityMultiplier, activityMultiplier],
        [startDate, startDate, startDate],
        [replicaChainId], // chainIds
        [defaultRelayerFee], // relayerFees
        { value: defaultRelayerFee },
      );
      await tx.wait();

      await expect(
        l1NetworkRegistry.syncBatchUpdateMembersActivity(
          [member],
          [activityMultiplier],
          [unregisteredReplicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);
      await expect(
        l1NetworkRegistry.syncBatchRemoveMembers(
          [member],
          [unregisteredReplicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);
      await expect(
        l1NetworkRegistry.syncUpdateSecondsActive(
          [unregisteredReplicaChainId], // chainIds
          [defaultRelayerFee], // relayerFees
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);

      // Update members activity
      const tx2 = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await tx2.wait();

      await expect(
        l1NetworkRegistry.syncUpdateSplits(
          [member, member2, member3].sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1)),
          "0",
          [unregisteredReplicaChainId],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);

      await expect(
        l1NetworkRegistry.syncUpdateAll(
          [member, member2, member3].sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1)),
          "0",
          [unregisteredReplicaChainId],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);

      await expect(
        l1NetworkRegistry.upgradeNetworkRegistryImplementation(
          [unregisteredReplicaChainId],
          [ethers.constants.AddressZero],
          ["0x"],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);

      await expect(
        l1NetworkRegistry.setNetworkUpdaterConfig(
          [unregisteredReplicaChainId],
          [l2Registry.connext.address],
          [parentDomainId],
          [l1NetworkRegistry.address],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);

      await expect(
        l1NetworkRegistry.updateNetworkSplit([unregisteredReplicaChainId], [l2SplitV2Address], [defaultRelayerFee], {
          value: defaultRelayerFee,
        }),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);

      await expect(
        l1NetworkRegistry.transferNetworkSplitOwnership(
          [unregisteredReplicaChainId],
          [ethers.constants.AddressZero],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);

      await expect(
        l1NetworkRegistry.pauseNetworkSplit([unregisteredReplicaChainId], [true], [defaultRelayerFee], {
          value: defaultRelayerFee,
        }),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);

      await expect(
        l1NetworkRegistry.networkSplitWalletExecCalls(
          [unregisteredReplicaChainId],
          [{ to: ethers.constants.AddressZero, value: "0", data: "0x" }],
          [defaultRelayerFee],
          {
            value: defaultRelayerFee,
          },
        ),
      )
        .to.be.revertedWithCustomError(l1NetworkRegistry, "NetworkRegistry__NoReplicaOnNetwork")
        .withArgs(unregisteredReplicaChainId);
    });

    it("Should be able to set new updater settings on a replica registry", async () => {
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const action = l2NetworkRegistry.interface.getSighash("setUpdaterConfig(address,uint32,address)");

      await expect(
        l1NetworkRegistry.setNetworkUpdaterConfig(
          chainIds,
          [],
          [parentDomainId],
          [l1NetworkRegistry.address],
          relayerFees,
          { value: totalValue },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
      await expect(
        l1NetworkRegistry.setNetworkUpdaterConfig(
          chainIds,
          [ethers.constants.AddressZero],
          [],
          [l1NetworkRegistry.address],
          relayerFees,
          { value: totalValue },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
      await expect(
        l1NetworkRegistry.setNetworkUpdaterConfig(
          chainIds,
          [ethers.constants.AddressZero],
          [parentDomainId],
          [],
          relayerFees,
          { value: totalValue },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");

      // Fails because NetworkRegistry__InvalidConnextAddress
      await expect(
        l1NetworkRegistry.setNetworkUpdaterConfig(
          chainIds,
          [ethers.constants.AddressZero], // invalid connext address
          [parentDomainId],
          [l1NetworkRegistry.address],
          relayerFees,
          { value: totalValue },
        ),
      )
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, false, l1NetworkRegistry.address);

      const updaterDomainId = parentDomainId + 1; // dummy domain iD
      const syncTx = await l1NetworkRegistry.setNetworkUpdaterConfig(
        chainIds,
        [connext.address],
        [updaterDomainId],
        [l1NetworkRegistry.address],
        relayerFees,
        { value: totalValue },
      );

      await expect(syncTx)
        .to.emit(l1NetworkRegistry, "SyncMessageSubmitted")
        .withArgs(anyValue, replicaChainId, action, l2NetworkRegistry.address);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "NewUpdaterConfig")
        .withArgs(connext.address, updaterDomainId, l1NetworkRegistry.address);
    });

    it("Should be able to update 0xSplit contract on a replica registry and get ownership over it", async () => {
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const newSplitAddress = await deploySplitV2(
        splitV2Factory,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        PERCENTAGE_SCALE,
        users.owner.address,
      );

      const signer = await ethers.getSigner(users.owner.address);
      const l2SplitWalletV2 = (await ethers.getContractAt("SplitWalletV2", newSplitAddress, signer)) as SplitWalletV2;
      const txTransfer = await l2SplitWalletV2.transferOwnership(l2NetworkRegistry.address);
      await txTransfer.wait();
      await expect(txTransfer)
        .to.emit(l2SplitWalletV2, "OwnershipTransferred")
        .withArgs(users.owner.address, l2NetworkRegistry.address);

      const action = l2NetworkRegistry.interface.getSighash("setSplit(address)");

      await expect(
        l1NetworkRegistry.updateNetworkSplit(chainIds, [], relayerFees, { value: totalValue }),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");

      const syncTx = await l1NetworkRegistry.updateNetworkSplit(chainIds, [newSplitAddress], relayerFees, {
        value: totalValue,
      });

      await expect(syncTx)
        .to.emit(l1NetworkRegistry, "SyncMessageSubmitted")
        .withArgs(anyValue, replicaChainId, action, l2NetworkRegistry.address);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      await expect(syncTx).to.emit(l2NetworkRegistry, "SplitUpdated").withArgs(newSplitAddress);
    });

    it("Should be able to transfer 0xSplit ownership on replica registry", async () => {
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const action = l2NetworkRegistry.interface.getSighash("transferSplitOwnership(address)");

      await expect(
        l1NetworkRegistry.transferNetworkSplitOwnership(chainIds, [], relayerFees, { value: totalValue }),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");

      const syncTx = await l1NetworkRegistry.transferNetworkSplitOwnership(
        chainIds,
        [users.alice.address], // newOwner
        relayerFees,
        { value: totalValue },
      );

      await expect(syncTx)
        .to.emit(l1NetworkRegistry, "SyncMessageSubmitted")
        .withArgs(anyValue, replicaChainId, action, l2NetworkRegistry.address);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      await expect(syncTx)
        .to.emit(l2SplitWalletV2, "OwnershipTransferred")
        .withArgs(l2NetworkRegistry.address, users.alice.address);
      expect(await l2SplitWalletV2.owner()).to.equal(users.alice.address);
    });

    it("Should be able to pause 0xSplit on replica registry", async () => {
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      await expect(
        l1NetworkRegistry.pauseNetworkSplit(chainIds, [], relayerFees, { value: totalValue })
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");

      const action = l2NetworkRegistry.interface.getSighash("pauseSplit(bool)");
      const syncTx = await l1NetworkRegistry.pauseNetworkSplit(chainIds, [true], relayerFees, { value: totalValue });

      await expect(syncTx)
        .to.emit(l1NetworkRegistry, "SyncMessageSubmitted")
        .withArgs(anyValue, replicaChainId, action, l2NetworkRegistry.address);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      await expect(syncTx).to.emit(l2SplitWalletV2, "SetPaused").withArgs(true);
    });

    it("Should be able to execute calls through 0xSplit wallet on replica registry", async () => {
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const action = l2NetworkRegistry.interface.getSighash(
        l2NetworkRegistry.interface.getFunction("splitWalletExecCalls"),
      );
      const calls = [
        {
          to: users.owner.address,
          value: "0",
          data: "0x",
        },
      ];

      await expect(
        l1NetworkRegistry.networkSplitWalletExecCalls(chainIds, [], relayerFees, { value: totalValue })
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");

      const syncTx = await l1NetworkRegistry.networkSplitWalletExecCalls(chainIds, calls, relayerFees, {
        value: totalValue,
      });

      await expect(syncTx)
        .to.emit(l1NetworkRegistry, "SyncMessageSubmitted")
        .withArgs(anyValue, replicaChainId, action, l2NetworkRegistry.address);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      await expect(syncTx)
        .to.emit(l2SplitWalletV2, "ExecCalls")
        .withArgs((value: any) => {
          expect(value.length).to.equal(1);
          expect(value[0]).to.deep.equal(calls.map((c) => [c.to, c.value, c.data])[0]);
          return true;
        });
    });

    it("Should sync a new member", async () => {
      const [, , , member] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const startDate = await time.latest();
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];

      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      await expect(l1NetworkRegistry.getMember(member)).to.revertedWithCustomError(
        l1NetworkRegistry,
        "MemberRegistry__NotRegistered",
      );
      await expect(l2NetworkRegistry.getMember(member)).to.revertedWithCustomError(
        l2NetworkRegistry,
        "MemberRegistry__NotRegistered",
      );

      const syncTx = await l1NetworkRegistry.syncBatchNewMembers(
        [member],
        [activityMultiplier],
        [startDate],
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      const receipt = await syncTx.wait();

      await expect(syncTx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
      const transferId = receipt.events?.[4].topics?.[1];
      const action = receipt.events?.[4].topics?.[3].substring(0, 10);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

      const l1ActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      const l2ActiveMembers = await l2NetworkRegistry.totalActiveMembers();
      expect(l1ActiveMembers).to.equal(l2ActiveMembers);

      await expect(syncTx)
        .to.emit(l1NetworkRegistry, "NewMember")
        .withArgs(member, Number(startDate), activityMultiplier);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "NewMember")
        .withArgs(member, Number(startDate), activityMultiplier);

      const l1Member = await l1NetworkRegistry.getMember(member);
      const l2Member = await l2NetworkRegistry.getMember(member);
      expect(l1Member).to.eql(l2Member);
      expect(await l1NetworkRegistry.getMember(member)).to.eql(l1Member);
      expect(await l1NetworkRegistry.totalMembers()).to.equal(1);
      expect(await l2NetworkRegistry.getMember(member)).to.eql(l2Member);
      expect(await l2NetworkRegistry.totalMembers()).to.equal(1);
    });

    it("Should sync an updated member", async () => {
      const [, , , member] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const startDate = await time.latest();
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];

      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const syncNewTx = await l1NetworkRegistry.syncBatchNewMembers(
        [member],
        [activityMultiplier],
        [startDate],
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      await syncNewTx.wait();

      const syncUpdateTx = await l1NetworkRegistry.syncUpdateSecondsActive(chainIds, relayerFees, {
        value: totalValue,
      });
      await syncUpdateTx.wait();

      // const updatedMultiplier = activityMultiplier / 2; // part-time
      const updatedMultiplier = 0; // inactive

      const syncTx = await l1NetworkRegistry.syncBatchUpdateMembersActivity(
        [member],
        [updatedMultiplier],
        chainIds,
        relayerFees,
        {
          value: totalValue,
        },
      );
      const receipt = await syncTx.wait();

      await expect(syncTx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
      const transferId = receipt.events?.[4].topics?.[1];
      const action = receipt.events?.[4].topics?.[3].substring(0, 10);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

      const l1ActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      const l2ActiveMembers = await l2NetworkRegistry.totalActiveMembers();
      expect(l1ActiveMembers).to.equal(l2ActiveMembers);

      await expect(syncTx)
        .to.emit(l1NetworkRegistry, "UpdateMember")
        .withArgs(member, updatedMultiplier, startDate, anyValue);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "UpdateMember")
        .withArgs(member, updatedMultiplier, startDate, anyValue);

      expect(await l1NetworkRegistry.getMember(member)).to.eql(await l2NetworkRegistry.getMember(member));
    });

    it("Should sync a removed member", async () => {
      const [, , , member] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const startDate = await time.latest();
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];

      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const syncNewTx = await l1NetworkRegistry.syncBatchNewMembers(
        [member],
        [activityMultiplier],
        [startDate],
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      await syncNewTx.wait();

      const syncTx = await l1NetworkRegistry.syncBatchRemoveMembers([member], chainIds, relayerFees, {
        value: totalValue,
      });
      const receipt = await syncTx.wait();

      await expect(syncTx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
      const transferId = receipt.events?.[4].topics?.[1];
      const action = receipt.events?.[4].topics?.[3].substring(0, 10);
      await expect(syncTx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

      const l1ActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      const l2ActiveMembers = await l2NetworkRegistry.totalActiveMembers();
      expect(l1ActiveMembers).to.equal(l2ActiveMembers);

      await expect(syncTx).to.emit(l1NetworkRegistry, "RemoveMember").withArgs(member);
      await expect(syncTx).to.emit(l2NetworkRegistry, "RemoveMember").withArgs(member);

      await expect(l1NetworkRegistry.getMember(member)).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "MemberRegistry__NotRegistered",
      );
      await expect(l2NetworkRegistry.getMember(member)).to.be.revertedWithCustomError(
        l2NetworkRegistry,
        "MemberRegistry__NotRegistered",
      );
    });

    it("Should be able to sync a new batch of members", async () => {
      const newMembers = await generateMemberBatch(10);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const tx = await l1NetworkRegistry.syncBatchNewMembers(
        members,
        activityMultipliers,
        startDates,
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      const receipt = await tx.wait();

      await expect(tx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
      const event = receipt.events?.find((e: Event) => e.event === "SyncMessageSubmitted");
      const transferId = event?.topics?.[1];
      const action = event?.topics?.[3].substring(0, 10);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

      const l1ActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      const l2ActiveMembers = await l2NetworkRegistry.totalActiveMembers();
      expect(l1ActiveMembers).to.equal(l2ActiveMembers);

      for (let i = 0; i < newMembers.length; i++) {
        await expect(tx)
          .to.emit(l1NetworkRegistry, "NewMember")
          .withArgs(newMembers[i].account, Number(newMembers[i].startDate), newMembers[i].activityMultiplier);
        await expect(tx)
          .to.emit(l2NetworkRegistry, "NewMember")
          .withArgs(newMembers[i].account, Number(newMembers[i].startDate), newMembers[i].activityMultiplier);
      }
    });

    it("Should be able to fully sync a replica registry from current state in main", async () => {
      const newMembers = await generateMemberBatch(10);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      // batch new members without syncing with replica
      const batchTx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batchTx.wait();

      const tx = await l1NetworkRegistry.syncNetworkMemberRegistry(members, chainIds, relayerFees, {
        value: totalValue,
      });
      const receipt = await tx.wait();

      await expect(tx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
      const event = receipt.events?.find((e: Event) => e.event === "SyncMessageSubmitted");
      const transferId = event?.topics?.[1];
      const action = event?.topics?.[3].substring(0, 10);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

      const l1ActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      const l2ActiveMembers = await l2NetworkRegistry.totalActiveMembers();
      expect(l1ActiveMembers).to.equal(l2ActiveMembers);

      for (let i = 0; i < newMembers.length; i++) {
        await expect(tx)
          .to.emit(l2NetworkRegistry, "NewMember")
          .withArgs(newMembers[i].account, Number(newMembers[i].startDate), newMembers[i].activityMultiplier);
      }
    });

    it("Should be able to fully sync an already initialized replica registry from current state in main", async () => {
      const replicaChainId = 100;
      const replicaDomainId = 6778479;

      const totalMembers = 10;
      const newMembers = await generateMemberBatch(totalMembers);
      const members = newMembers.map((m: Member) => m.account);
      const members1 = newMembers.slice(0, totalMembers / 2);
      const members2 = newMembers.slice(totalMembers / 2);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const signer = await ethers.getSigner(users.owner.address);
      const l2RegistryAddress = await summonNetworkRegistryV2Proxy(
        l2Registry.calculatorLibrary.address,
        {
          connext: connext.address,
          updaterDomainId: 0,
          updaterAddress: ethers.constants.AddressZero,
          split: l2SplitV2Address,
          owner: signer.address,
        },
        "L2Registry3",
      );
      const l2NetworkRegistry = (await ethers.getContractAt(
        "NetworkRegistryV2",
        l2RegistryAddress,
        signer,
      )) as NetworkRegistryV2;

      // Adding a few members on L2 registry before and then sync registries
      let batchL2Tx = await l2NetworkRegistry.syncBatchNewMembers(
        members1.map((m: Member) => m.account),
        members1.map((m: Member) => m.activityMultiplier),
        members1.map((m: Member) => m.startDate),
        [],
        [],
      );
      await batchL2Tx.wait();

      // update registry activity on the L2
      const updateL2Tx = await l2NetworkRegistry.syncUpdateSecondsActive([], []);
      await updateL2Tx.wait();

      // turn inactive one of the members in l2
      batchL2Tx = await l2NetworkRegistry.syncBatchUpdateMembersActivity([members1[0].account], [0], [], []);
      await batchL2Tx.wait();

      // Set updater settings on L2 registry
      const updaterL2Tx = await l2NetworkRegistry.setUpdaterConfig(
        connext.address,
        parentDomainId,
        l1NetworkRegistry.address,
      );
      await updaterL2Tx.wait();

      // Add replica registry to main
      const networkRegistry = {
        domainId: replicaDomainId,
        registryAddress: l2NetworkRegistry.address,
        delegate: ethers.constants.AddressZero,
      };
      const txAddReplica = await l1NetworkRegistry.updateNetworkRegistry(replicaChainId, networkRegistry);
      await txAddReplica.wait();

      // batch new members without syncing with replica
      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(members, activityMultipliers, startDates, [], []);
      await batch1Tx.wait();

      // update registry activity on the L1
      const updateL1Tx = await l1NetworkRegistry.syncUpdateSecondsActive([], []);
      await updateL1Tx.wait();

      // half of members get inactive on main replica
      const batch2Tx = await l1NetworkRegistry.syncBatchUpdateMembersActivity(
        [...members1.map((m: Member) => m.account), ...members2.map((m: Member) => m.account)],
        [...members1.map((_, i) => (i % 2 === 0 ? 100 : 0)), ...members2.map((_, i) => (i % 2 === 0 ? 100 : 0))],
        [],
        [],
      );
      await batch2Tx.wait();

      // sync registries
      const tx = await l1NetworkRegistry.syncNetworkMemberRegistry(members, chainIds, relayerFees, {
        value: totalValue,
      });
      const receipt = await tx.wait();

      await expect(tx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
      const event = receipt.events?.find((e: Event) => e.event === "SyncMessageSubmitted");
      const transferId = event?.topics?.[1];
      const action = event?.topics?.[3].substring(0, 10);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

      const l1ActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      const l2ActiveMembers = await l2NetworkRegistry.totalActiveMembers();
      expect(l1ActiveMembers).to.equal(l2ActiveMembers);

      for (let i = 0; i < members1.length; i++) {
        await expect(tx)
          .to.emit(l2NetworkRegistry, "UpdateMember")
          .withArgs(members1[i].account, i % 2 === 0 ? 100 : 0, Number(members1[i].startDate), anyValue);
      }

      for (let i = 0; i < members2.length; i++) {
        await expect(tx)
          .to.emit(l2NetworkRegistry, "NewMember")
          .withArgs(members2[i].account, Number(members2[i].startDate), i % 2 === 0 ? 100 : 0);
      }
    });

    it("Should be able to sync update a batch of members", async () => {
      const newMembers = await generateMemberBatch(10);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const modActivityMultipliers = newMembers.map(() => 100);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const newBatchTx = await l1NetworkRegistry.syncBatchNewMembers(
        members,
        activityMultipliers,
        startDates,
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      await newBatchTx.wait();

      const tx = await l1NetworkRegistry.syncBatchUpdateMembersActivity(
        members,
        modActivityMultipliers,
        chainIds,
        relayerFees,
        {
          value: totalValue,
        },
      );
      const receipt = await tx.wait();

      await expect(tx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
      const event = receipt.events?.find((e: Event) => e.event === "SyncMessageSubmitted");
      const transferId = event?.topics?.[1];
      const action = event?.topics?.[3].substring(0, 10);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

      const l1ActiveMembers = await l1NetworkRegistry.totalActiveMembers();
      const l2ActiveMembers = await l2NetworkRegistry.totalActiveMembers();
      expect(l1ActiveMembers).to.equal(l2ActiveMembers);

      for (let i = 0; i < newMembers.length; i++) {
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMember")
          .withArgs(newMembers[i].account, modActivityMultipliers[i], newMembers[i].startDate, 0);
        await expect(tx)
          .to.emit(l2NetworkRegistry, "UpdateMember")
          .withArgs(newMembers[i].account, modActivityMultipliers[i], newMembers[i].startDate, 0);
      }
    });

    it("Should be able to sync update registry activity", async () => {
      const batchSize = 5;
      const newMembers = await generateMemberBatch(batchSize * 2);
      const batch1 = newMembers.slice(0, batchSize);
      let members = batch1.map((m: Member) => m.account);
      let activityMultipliers = batch1.map((m: Member) => m.activityMultiplier);
      let startDates = batch1.map((m: Member) => m.startDate);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const batch1Date = Number(startDates[0]);
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const newBatch1Tx = await l1NetworkRegistry.syncBatchNewMembers(
        members,
        activityMultipliers,
        startDates,
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      await newBatch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const batch2 = newMembers.slice(batchSize);
      members = batch2.map((m: Member) => m.account);
      activityMultipliers = batch2.map((m: Member) => m.activityMultiplier);
      startDates = batch1.map((m: Member) => Number(m.startDate) + 3600 * 24 * 15); // 15 days later
      const batch2Date = Number(startDates[0]);
      const newBatch2Tx = await l1NetworkRegistry.syncBatchNewMembers(
        members,
        activityMultipliers,
        startDates,
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      await newBatch2Tx.wait();

      const tx = await l1NetworkRegistry.syncUpdateSecondsActive(chainIds, relayerFees, { value: totalValue });
      const receipt = await tx.wait();
      // console.log('receipt', receipt.events);

      await expect(tx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
      const event = receipt.events?.find((e: Event) => e.event === "SyncMessageSubmitted");
      const transferId = event?.topics?.[1];
      const action = event?.topics?.[3].substring(0, 10);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

      const lastBlockTimestamp = await time.latest();

      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch1[i].account,
            Math.floor(((lastBlockTimestamp - batch1Date) * Number(batch1[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(l2NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch1[i].account,
            Math.floor(((lastBlockTimestamp - batch1Date) * Number(batch1[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch2[i].account,
            Math.floor(((lastBlockTimestamp - batch2Date) * Number(batch2[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(l2NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch2[i].account,
            Math.floor(((lastBlockTimestamp - batch2Date) * Number(batch2[i].activityMultiplier)) / 100),
          );
      }
      const totalMembersL1 = await l1NetworkRegistry.totalMembers();
      const totalMembersL2 = await l2NetworkRegistry.totalMembers();
      await expect(tx)
        .to.emit(l1NetworkRegistry, "RegistryActivityUpdate")
        .withArgs(lastBlockTimestamp, totalMembersL1);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "RegistryActivityUpdate")
        .withArgs(lastBlockTimestamp, totalMembersL2);
    });

    it("Should be able to sync update Split values from last update", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      // await acceptNetworkSplitControl({
      //   l1NetworkRegistry,
      //   chainIds,
      //   relayerFees,
      // });

      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(
        members,
        activityMultipliers,
        startDates,
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await l1NetworkRegistry.syncUpdateSecondsActive(chainIds, relayerFees, { value: totalValue });
      await txUpdate.wait();

      members.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));
      const splitDistributorFee = splitConfig.distributorFee;

      const { _recipients, _allocations } = await l1NetworkRegistry.calculate(members);

      const splitHash = hashSplitV2(_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee);

      const action = l2NetworkRegistry.interface.getSighash(l2NetworkRegistry.interface.getFunction("updateSplits"));
      const tx = await l1NetworkRegistry.syncUpdateSplits(members, splitDistributorFee, chainIds, relayerFees, {
        value: totalValue,
      });

      await expect(tx)
        .to.emit(l1NetworkRegistry, "SyncMessageSubmitted")
        .withArgs(anyValue, replicaChainId, action, l2NetworkRegistry.address);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      await expect(tx)
        .to.emit(l1SplitWalletV2, "SplitUpdated")
        .withArgs((value: any) => {
          expect(value).to.deep.equal([_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee]);
          return true;
        });
      await expect(tx)
        .to.emit(l2SplitWalletV2, "SplitUpdated")
        .withArgs((value: any) => {
          expect(value).to.deep.equal([_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee]);
          return true;
        });
      // TODO: when fails
      // await expect(tx).to.emit(l2NetworkRegistry, 'SyncActionPerformed').withArgs(anyValue, parentDomainId, action, false, l1NetworkRegistry.address);
      await expect(tx)
        .to.emit(l1NetworkRegistry, "SplitsDistributionUpdated")
        .withArgs(l1SplitV2Address, splitHash, splitDistributorFee);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SplitsDistributionUpdated")
        .withArgs(l2SplitV2Address, splitHash, splitDistributorFee);
      expect(await l1SplitWalletV2.splitHash()).to.equal(splitHash);
      expect(await l2SplitWalletV2.splitHash()).to.equal(splitHash);
    });

    it("Should be able to sync update all (registry activity + Splits)", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batch1Date = Number(startDates[0]);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      // await acceptNetworkSplitControl({
      //   l1NetworkRegistry,
      //   chainIds,
      //   relayerFees,
      // });

      const batch1Tx = await l1NetworkRegistry.syncBatchNewMembers(
        members,
        activityMultipliers,
        startDates,
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      members.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));
      const splitDistributorFee = splitConfig.distributorFee;

      const action = l2NetworkRegistry.interface.getSighash(l2NetworkRegistry.interface.getFunction("updateAll"));
      const tx = await l1NetworkRegistry.syncUpdateAll(members, splitDistributorFee, chainIds, relayerFees, {
        value: totalValue,
      });
      await tx.wait();

      const lastBlockTimestamp = await time.latest();

      // MUST get calculations after the updateAll call so it uses the latest activeSeconds
      const { _recipients, _allocations } = await l1NetworkRegistry.calculate(members);
      const splitHash = hashSplitV2(_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee);

      await expect(tx)
        .to.emit(l1NetworkRegistry, "SyncMessageSubmitted")
        .withArgs(anyValue, replicaChainId, action, l2NetworkRegistry.address);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(l1NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            newMembers[i].account,
            Math.floor(((lastBlockTimestamp - batch1Date) * Number(newMembers[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(l2NetworkRegistry, "UpdateMemberSeconds")
          .withArgs(
            newMembers[i].account,
            Math.floor(((lastBlockTimestamp - batch1Date) * Number(newMembers[i].activityMultiplier)) / 100),
          );
      }
      const totalMembersL1 = await l1NetworkRegistry.totalMembers();
      const totalMembersL2 = await l2NetworkRegistry.totalMembers();
      await expect(tx)
        .to.emit(l1NetworkRegistry, "RegistryActivityUpdate")
        .withArgs(lastBlockTimestamp, totalMembersL1);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "RegistryActivityUpdate")
        .withArgs(lastBlockTimestamp, totalMembersL2);

      await expect(tx)
        .to.emit(l1SplitWalletV2, "SplitUpdated")
        .withArgs((value: any) => {
          expect(value).to.deep.equal([_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee]);
          return true;
        });
      await expect(tx)
        .to.emit(l2SplitWalletV2, "SplitUpdated")
        .withArgs((value: any) => {
          expect(value).to.deep.equal([_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee]);
          return true;
        });
      await expect(tx)
        .to.emit(l1NetworkRegistry, "SplitsDistributionUpdated")
        .withArgs(l1SplitV2Address, splitHash, splitDistributorFee);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SplitsDistributionUpdated")
        .withArgs(l2SplitV2Address, splitHash, splitDistributorFee);
      expect(await l1SplitWalletV2.splitHash()).to.equal(splitHash);
      expect(await l2SplitWalletV2.splitHash()).to.equal(splitHash);
    });
  });

  // ############################################################################################################
  // #################################                      #####################################################
  // #################################    NetworkRegistry   #####################################################
  // #################################       UUPS Proxy     #####################################################
  // ############################################################################################################
  // ############################################################################################################
  // ############################################################################################################

  describe("NetworkRegistryV2 UUPS Upgradeability", function () {
    let newRegistryImplementation: NetworkRegistryV21Mock;

    beforeEach(async () => {
      const { deployer } = await getNamedAccounts();
      const signer = await ethers.getSigner(deployer);
      const implDeployed = await deployments.deploy("NetworkRegistryV21Mock", {
        contract: "NetworkRegistryV21Mock",
        from: deployer,
        args: [],
        libraries: {
          PGContribCalculator: l1CalculatorLibrary.address,
        },
        log: true,
      });
      newRegistryImplementation = await ethers.getContractAt("NetworkRegistryV21Mock", implDeployed.address, signer);
    });

    it("Should not be able to upgrade the implementation of a registry if not owner", async () => {
      const [, , , , outsider] = await getUnnamedAccounts();
      const signer = await ethers.getSigner(outsider);
      const l1NetRegistry = l1NetworkRegistry.connect(signer);
      const l2NetRegistry = l2NetworkRegistry.connect(signer);
      await expect(l1NetRegistry.upgradeToAndCall(ethers.constants.AddressZero, "0x")).to.be.revertedWithCustomError(
        l1NetworkRegistry,
        "Registry__UnauthorizedToUpgrade",
      );
      await expect(l2NetRegistry.upgradeToAndCall(ethers.constants.AddressZero, "0x")).to.be.revertedWithCustomError(
        l2NetworkRegistry,
        "Registry__UnauthorizedToUpgrade",
      );
    });

    it("Should not be able to upgrade the implementation of a registry if not UUPS compliant", async () => {
      await expect(
        l1NetworkRegistry.upgradeToAndCall(
          l1CalculatorLibrary.address, // wrong contract implementation
          "0x",
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "ERC1967InvalidImplementation");
    });

    it("Should be able to upgrade the implementation of a main registry if owner", async () => {
      await expect(l1NetworkRegistry.upgradeToAndCall(newRegistryImplementation.address, "0x"))
        .to.emit(l1NetworkRegistry, "Upgraded")
        .withArgs(newRegistryImplementation.address);

      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address"],
        [connext.address, 0, ethers.constants.AddressZero, l1SplitV2Address, users.owner.address],
      );

      const calldata = newRegistryImplementation.interface.encodeFunctionData("initialize", [initializationParams]);

      const tx = await l1NetworkRegistry.upgradeToAndCall(newRegistryImplementation.address, calldata);
      await tx.wait();

      await expect(tx).to.emit(l1NetworkRegistry, "Upgraded").withArgs(newRegistryImplementation.address);
      await expect(tx).to.emit(l1NetworkRegistry, "Initialized").withArgs(2);
    });

    it("Should not be able upgrade replica contract if param sizes mismatch", async () => {
      await expect(
        l1NetworkRegistry.upgradeNetworkRegistryImplementation([replicaChainId], [], ["0x"], [defaultRelayerFee], {
          value: defaultRelayerFee,
        }),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");

      await expect(
        l1NetworkRegistry.upgradeNetworkRegistryImplementation(
          [replicaChainId],
          [ethers.constants.AddressZero],
          [],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l1NetworkRegistry, "Registry__ParamsSizeMismatch");
    });

    it("Should not be able upgrade replica contract by direct call", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const l2RegistryAddress = await summonNetworkRegistryV2Proxy(
        l2Registry.calculatorLibrary.address,
        {
          connext: connext.address,
          updaterDomainId: parentDomainId,
          updaterAddress: l1NetworkRegistry.address,
          split: l2SplitV2Address,
          owner: users.owner.address,
        },
        "L2NetworkRegistry",
      );
      const l2NetworkRegistry = (await ethers.getContractAt(
        "NetworkRegistryV2",
        l2RegistryAddress,
        signer,
      )) as NetworkRegistryV2;
      await expect(
        l2NetworkRegistry.upgradeNetworkRegistryImplementation(
          [replicaChainId],
          [newRegistryImplementation.address],
          ["0x"],
          [defaultRelayerFee],
          { value: defaultRelayerFee },
        ),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__OnlyMainRegistry");
    });

    it("Should be able to upgrade the implementation of a replica registry through Connext", async () => {
      const action = l2NetworkRegistry.interface.getSighash("upgradeToAndCall(address,bytes)");
      const tx = await l1NetworkRegistry.upgradeNetworkRegistryImplementation(
        [replicaChainId],
        [newRegistryImplementation.address],
        ["0x"],
        [defaultRelayerFee],
        { value: defaultRelayerFee },
      );
      await tx.wait();

      await expect(tx)
        .to.emit(l1NetworkRegistry, "SyncMessageSubmitted")
        .withArgs(anyValue, replicaChainId, action, l2NetworkRegistry.address);
      await expect(tx)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      await expect(tx).to.emit(l2NetworkRegistry, "Upgraded").withArgs(newRegistryImplementation.address);

      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address"],
        [connext.address, parentDomainId, l1NetworkRegistry.address, l2SplitV2Address, ethers.constants.AddressZero],
      );

      const calldata = newRegistryImplementation.interface.encodeFunctionData("initialize", [initializationParams]);

      const tx_2 = await l1NetworkRegistry.upgradeNetworkRegistryImplementation(
        [replicaChainId],
        [newRegistryImplementation.address],
        [calldata],
        [defaultRelayerFee],
        { value: defaultRelayerFee },
      );
      await tx_2.wait();

      await expect(tx_2)
        .to.emit(l1NetworkRegistry, "SyncMessageSubmitted")
        .withArgs(anyValue, replicaChainId, action, l2NetworkRegistry.address);
      await expect(tx_2)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      await expect(tx_2).to.emit(l2NetworkRegistry, "Upgraded").withArgs(newRegistryImplementation.address);
      await expect(tx_2).to.emit(l2NetworkRegistry, "Initialized").withArgs(2);
    });

    it("Should be able to upgrade from V1 to V2 registry", async () => {
      const { deployer } = await getNamedAccounts();
      const signer = await ethers.getSigner(users.owner.address);

      // Deploy SplitMain V1
      const l1SplitMainDeployed = await deployments.deploy("SplitMain", {
        contract: "SplitMain",
        from: deployer,
        args: [],
        log: false,
      });
      const l1SplitV1Main = (await ethers.getContractAt("SplitMain", l1SplitMainDeployed.address, signer)) as SplitMain;
      // Deploy Split V1
      const l1SplitAddress = await deploySplit(
        l1SplitV1Main,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        users.owner.address,
      );
      // Summon RegistryV1
      const registryV1Address = await summonNetworkRegistryProxy(
        l1CalculatorLibrary.address,
        {
          connext: connext.address,
          updaterDomainId: parentDomainId,
          updaterAddress: l1NetworkRegistry.address,
          splitMain: l1SplitV1Main.address,
          split: l1SplitAddress,
          owner: users.owner.address,
        },
        "NetworkRegistryV1",
      );
      const networkRegistryV1 = (await ethers.getContractAt(
        "NetworkRegistry",
        registryV1Address,
        signer,
      )) as NetworkRegistry;

      // Registry V2
      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address"],
        [connext.address, 0, ethers.constants.AddressZero, l1SplitV2Address, users.owner.address],
      );

      const calldata = newRegistryImplementation.interface.encodeFunctionData("initialize", [initializationParams]);

      const tx = await networkRegistryV1.upgradeToAndCall(newRegistryImplementation.address, calldata);
      await tx.wait();

      await expect(tx).to.emit(networkRegistryV1, "Upgraded").withArgs(newRegistryImplementation.address);
      await expect(tx).to.emit(networkRegistryV1, "Initialized").withArgs(2);
      expect(await networkRegistryV1.split()).to.be.equal(l1SplitV2Address);
    });
  });
});
