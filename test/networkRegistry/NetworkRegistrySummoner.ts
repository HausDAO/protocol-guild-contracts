import { expect } from "chai";
import { ethers, getUnnamedAccounts } from "hardhat";

import { ConnextMock, NetworkRegistry, NetworkRegistrySummoner, SplitMain } from "../../types";
import { deploySplit, summonRegistry } from "../utils";
import { NetworkRegistryProps, User, registryFixture } from "./NetworkRegistry.fixture";

describe("NetworkRegistrySummoner", function () {
  let summoner: NetworkRegistrySummoner;
  let registrySingleton: NetworkRegistry;
  // TODO: shaman disabled
  // let registryShamanSingleton: NetworkRegistryShaman;
  let connext: ConnextMock;
  // let l1CalculatorLibrary: PGContribCalculator;
  let l1SplitMain: SplitMain;
  let l1SplitAddress: string;
  let l2Registry: NetworkRegistryProps;
  let l2SplitAddress: string;
  let users: { [key: string]: User };
  let members: Array<string>;
  const splitConfig = {
    percentAllocations: [400_000, 300_000, 300_000],
    distributorFee: 0,
  };

  const parentDomainId = 6648936;
  const replicaChainId = 10;
  const replicaDomainId = 1869640809;

  let l1NetworkRegistry: NetworkRegistry;
  let l2NetworkRegistry: NetworkRegistry;

  beforeEach(async function () {
    const setup = await registryFixture({});
    summoner = setup.summoner;
    registrySingleton = setup.pgRegistrySingleton;
    // TODO: shaman disabled
    // registryShamanSingleton = setup.pgRegistryShamanSingleton;
    // l1CalculatorLibrary = setup.calculatorLibrary;
    connext = setup.connext;
    l1SplitMain = setup.splitMain;
    l2Registry = setup.l2;
    users = setup.users;

    const signer = await ethers.getSigner(users.owner.address);
    const accounts = await getUnnamedAccounts();
    members = accounts
      .slice(0, splitConfig.percentAllocations.length)
      .sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));

    // Deploy Split on L1
    l1SplitAddress = await deploySplit(
      l1SplitMain,
      members,
      splitConfig.percentAllocations,
      splitConfig.distributorFee,
      users.owner.address,
    );

    // Summon Main Registry
    const l1RegistryAddress = await summonRegistry(
      summoner,
      registrySingleton.address,
      {
        connext: connext.address,
        updaterDomainId: 0, // Main Registry -> no domainId
        updaterAddress: ethers.constants.AddressZero, // Main Registry -> no updater
        splitMain: l1SplitMain.address,
        split: l1SplitAddress,
        owner: users.owner.address,
      },
      "Main Registry",
    );
    l1NetworkRegistry = (await ethers.getContractAt("NetworkRegistry", l1RegistryAddress, signer)) as NetworkRegistry;

    // Transfer Split control to L1 NetworkRegistry
    const tx_controller_l1 = await l1SplitMain.transferControl(l1SplitAddress, l1RegistryAddress);
    await tx_controller_l1.wait();
    await l1NetworkRegistry.acceptSplitControl();

    // Deploy Split on L2
    l2SplitAddress = await deploySplit(
      l2Registry.splitMain,
      members,
      splitConfig.percentAllocations,
      splitConfig.distributorFee,
      users.owner.address,
    );

    // Summon a Replica Registry
    const l2RegistryAddress = await summonRegistry(
      summoner,
      registrySingleton.address,
      {
        connext: connext.address,
        updaterDomainId: parentDomainId,
        updaterAddress: l1NetworkRegistry.address,
        splitMain: l2Registry.splitMain.address,
        split: l2SplitAddress,
        owner: ethers.constants.AddressZero, // renounceOwnership
      },
      "L2 Registry",
    );
    l2NetworkRegistry = (await ethers.getContractAt("NetworkRegistry", l2RegistryAddress, signer)) as NetworkRegistry;

    // Add replica registry to main
    const networkRegistry = {
      domainId: replicaDomainId,
      registryAddress: l2NetworkRegistry.address,
      delegate: ethers.constants.AddressZero,
    };
    const tx = await l1NetworkRegistry.updateNetworkRegistry(replicaChainId, networkRegistry);
    await tx.wait();

    // Transfer Split control to L2 NetworkRegistry
    const tx_controller_l2 = await l2Registry.splitMain.transferControl(l2SplitAddress, l2RegistryAddress);
    await tx_controller_l2.wait();
  });

  // ################################################################################################################
  // #################################                         ######################################################
  // ################################# NetworkRegistrySummoner ######################################################
  // #################################                         ######################################################
  // ################################################################################################################
  // ################################################################################################################
  // ################################################################################################################

  describe("NetworkRegistry + Summoner", function () {
    // it("Should not be able to initialize a singleton", async () => {
    //   const l1InitializationParams = ethers.utils.defaultAbiCoder.encode(
    //     ["address", "uint32", "address", "address", "address", "address"],
    //     [
    //       connext.address,
    //       0, // no domainId -> Main Registry
    //       ethers.constants.AddressZero, // no updater -> Main Registry
    //       l1SplitMain.address,
    //       l1SplitAddress,
    //       users.owner.address,
    //     ],
    //   );
    //   await expect(registrySingleton.initialize(l1InitializationParams)).to.be.revertedWithCustomError(
    //     l1NetworkRegistry,
    //     "InvalidInitialization",
    //   );
    //   // TODO: shaman disabled
    //   // await expect(registryShamanSingleton.initialize(l1InitializationParams)).to.be.revertedWithCustomError(
    //   //   l1NetworkRegistry,
    //   //   "InvalidInitialization",
    //   // );
    // });

    it("Should not be able to summon a registry with incorrect encoded init params", async () => {
      const details = "sample registry";
      await expect(summoner.summonRegistry(registrySingleton.address, details, "0x")).to.be.revertedWithoutReason();
    });

    it("Should not be able to summon a registry when connext is zero", async () => {
      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address", "address"],
        [
          ethers.constants.AddressZero, // no connext
          0, // no domain -> Main Registry
          ethers.constants.AddressZero, // no updater -> Main Registry
          l1SplitMain.address,
          l1SplitAddress,
          ethers.constants.AddressZero, // no owner
        ],
      );

      const details = "sample registry";
      await expect(
        summoner.summonRegistry(registrySingleton.address, details, initializationParams),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__InvalidConnextAddress");
    });

    it("Should not be able to summon a registry when owner and updater are zero", async () => {
      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address", "address"],
        [
          connext.address,
          0, // no domain -> Main Registry
          ethers.constants.AddressZero, // no updater -> Main Registry
          l1SplitMain.address,
          l1SplitAddress,
          ethers.constants.AddressZero, // no owner
        ],
      );

      const details = "sample registry";
      await expect(
        summoner.summonRegistry(registrySingleton.address, details, initializationParams),
      ).to.be.revertedWithCustomError(l2NetworkRegistry, "NetworkRegistry__NeitherOwnableNorReplicaUpdater");
    });

    it("Should summon a Main NetworkRegistry", async () => {
      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address", "address"],
        [
          connext.address,
          0, // no domain -> Main Registry
          ethers.constants.AddressZero, // no updater -> Main Registry
          l1SplitMain.address,
          l1SplitAddress,
          users.owner.address,
        ],
      );

      const details = "sample registry";
      const tx = await summoner.summonRegistry(registrySingleton.address, details, initializationParams);
      const receipt = await tx.wait();

      const summonedEvent = receipt.events?.find((e) => e.event === "NetworkRegistrySummoned");
      const registryAddress =
        summonedEvent?.topics?.[1] && ethers.utils.getAddress(`0x${summonedEvent.topics[1].substring(24 + 2)}`);
      await expect(tx)
        .to.emit(summoner, "NetworkRegistrySummoned")
        .withArgs(registryAddress, details, initializationParams);

      const registry = (await ethers.getContractAt(
        "NetworkRegistry",
        registryAddress || ethers.constants.AddressZero,
      )) as NetworkRegistry;
      expect(await registry.connext()).to.be.equal(connext.address);
      expect(await registry.updaterDomain()).to.be.equal(0);
      expect(await registry.updater()).to.be.equal(ethers.constants.AddressZero);
      expect(await registry.splitMain()).to.be.equal(l1SplitMain.address);
      expect(await registry.split()).to.be.equal(l1SplitAddress);
      expect(await registry.owner()).to.be.equal(users.owner.address);
    });

    it("Should summon a Replica NetworkRegistry w/no owner", async () => {
      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address", "address"],
        [
          connext.address,
          parentDomainId,
          l1NetworkRegistry.address, // updater
          l1SplitMain.address,
          l1SplitAddress,
          ethers.constants.AddressZero, // renounce ownership
        ],
      );

      const details = "sample registry";
      const tx = await summoner.summonRegistry(registrySingleton.address, details, initializationParams);
      const receipt = await tx.wait();

      const summonedEvent = receipt.events?.find((e) => e.event === "NetworkRegistrySummoned");
      const registryAddress =
        summonedEvent?.topics?.[1] && ethers.utils.getAddress(`0x${summonedEvent.topics[1].substring(24 + 2)}`);
      await expect(tx)
        .to.emit(summoner, "NetworkRegistrySummoned")
        .withArgs(registryAddress, details, initializationParams);

      const registry = (await ethers.getContractAt(
        "NetworkRegistry",
        registryAddress || ethers.constants.AddressZero,
      )) as NetworkRegistry;
      expect(await registry.connext()).to.be.equal(connext.address);
      expect(await registry.updaterDomain()).to.be.equal(parentDomainId);
      expect(await registry.updater()).to.be.equal(l1NetworkRegistry.address);
      expect(await registry.splitMain()).to.be.equal(l1SplitMain.address);
      expect(await registry.split()).to.be.equal(l1SplitAddress);
      expect(await registry.owner()).to.be.equal(ethers.constants.AddressZero);
    });

    it("Should summon a Replica NetworkRegistry w/fallback owner", async () => {
      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address", "address"],
        [
          connext.address,
          parentDomainId,
          l1NetworkRegistry.address, // updater
          l1SplitMain.address,
          l1SplitAddress,
          users.owner.address, // fallback owner
        ],
      );

      const details = "sample registry";
      const tx = await summoner.summonRegistry(registrySingleton.address, details, initializationParams);
      const receipt = await tx.wait();

      const summonedEvent = receipt.events?.find((e) => e.event === "NetworkRegistrySummoned");
      const registryAddress =
        summonedEvent?.topics?.[1] && ethers.utils.getAddress(`0x${summonedEvent.topics[1].substring(24 + 2)}`);
      await expect(tx)
        .to.emit(summoner, "NetworkRegistrySummoned")
        .withArgs(registryAddress, details, initializationParams);

      const registry = (await ethers.getContractAt(
        "NetworkRegistry",
        registryAddress || ethers.constants.AddressZero,
      )) as NetworkRegistry;
      expect(await registry.connext()).to.be.equal(connext.address);
      expect(await registry.updaterDomain()).to.be.equal(parentDomainId);
      expect(await registry.updater()).to.be.equal(l1NetworkRegistry.address);
      expect(await registry.splitMain()).to.be.equal(l1SplitMain.address);
      expect(await registry.split()).to.be.equal(l1SplitAddress);
      expect(await registry.owner()).to.be.equal(users.owner.address);
    });

    it("Should summon a NetworkRegistry with predetermined address", async () => {
      const saltNonce = `0x${Buffer.from(ethers.utils.randomBytes(32)).toString("hex")}`;
      const creationCode = [
        "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
        registrySingleton.address.replace(/0x/, "").toLowerCase(),
        "5af43d82803e903d91602b57fd5bf3",
      ].join("");

      const predictedAddress = ethers.utils.getAddress(
        `0x${ethers.utils
          .keccak256(
            `0x${["ff", summoner.address, saltNonce, ethers.utils.solidityKeccak256(["bytes"], [creationCode])]
              .map((x) => x.replace(/0x/, ""))
              .join("")}`,
          )
          .slice(-40)}`,
      );

      // const { deployer } = await getNamedAccounts();
      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint32", "address", "address", "address", "address"],
        [
          connext.address,
          0, // no domain -> Main Registry
          ethers.constants.AddressZero, // no updater -> Main Registry
          l1SplitMain.address,
          l1SplitAddress,
          users.owner.address,
        ],
      );

      const details = "sample registry";
      const tx = await summoner.summonRegistryDeterministic(
        registrySingleton.address,
        details,
        initializationParams,
        saltNonce,
      );
      await expect(tx)
        .to.emit(summoner, "NetworkRegistrySummoned")
        .withArgs(predictedAddress, details, initializationParams);
      const receipt = await tx.wait();

      const summonedEvent = receipt.events?.find((e) => e.event === "NetworkRegistrySummoned");
      const registryAddress =
        summonedEvent?.topics?.[1] && ethers.utils.getAddress(`0x${summonedEvent.topics[1].substring(24 + 2)}`);

      expect(predictedAddress).to.equal(registryAddress);
    });
  });
});
