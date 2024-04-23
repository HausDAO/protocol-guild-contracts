import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { deployments, ethers, getNamedAccounts, getUnnamedAccounts } from "hardhat";

import { PERCENTAGE_SCALE } from "../../constants";
import { GuildRegistry, GuildRegistryHarness, GuildRegistryV2Mock, PGContribCalculator, SplitMain } from "../../types";
import { User, registryFixture } from "../networkRegistry/NetworkRegistry.fixture";
import { Member } from "../types";
import { deploySplit, generateMemberBatch, hashSplit, summonGuildRegistryProxy } from "../utils";

describe("GuildRegistry", function () {
  let l1CalculatorLibrary: PGContribCalculator;
  let l1SplitMain: SplitMain;
  let l1SplitAddress: string;
  let users: { [key: string]: User };
  let members: Array<string>;
  const splitConfig = {
    percentAllocations: [400_000, 300_000, 300_000],
    distributorFee: 0,
  };

  let guildRegistry: GuildRegistry;

  beforeEach(async function () {
    const setup = await registryFixture({});
    l1CalculatorLibrary = setup.calculatorLibrary;
    l1SplitMain = setup.splitMain;
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

    // Summon Registry
    const registryAddress = await summonGuildRegistryProxy(
      l1CalculatorLibrary.address,
      {
        splitMain: l1SplitMain.address,
        split: l1SplitAddress,
        owner: users.owner.address,
      },
      "GuildRegistry",
    );
    guildRegistry = (await ethers.getContractAt("GuildRegistry", registryAddress, signer)) as GuildRegistry;

    // Transfer Split control to GuildRegistry
    const tx_controller_l1 = await l1SplitMain.transferControl(l1SplitAddress, registryAddress);
    await tx_controller_l1.wait();
    await guildRegistry.acceptSplitControl();
  });

  // ##############################################################################################################
  // ##################################                      ######################################################
  // ################################## GuildRegistry Config ######################################################
  // ##################################                      ######################################################
  // ##############################################################################################################
  // ##############################################################################################################
  // ##############################################################################################################

  describe("GuildRegistry Config", function () {
    it("Should be not be able to initialize proxy with wrong parameters", async () => {
      const { deployer } = await getNamedAccounts();
      let initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address"],
        [
          ethers.constants.AddressZero, // splitMain address
          l1SplitAddress, // split address
          ethers.constants.AddressZero, // owner
        ],
      );

      await expect(
        deployments.deploy("Guild Registry", {
          contract: "GuildRegistry",
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
      ).to.be.revertedWithCustomError(guildRegistry, "Split_InvalidAddress");

      initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address"],
        [
          l1SplitMain.address, // splitMain address
          ethers.constants.AddressZero, // split address
          ethers.constants.AddressZero, // owner
        ],
      );

      await expect(
        deployments.deploy("Guild Registry", {
          contract: "GuildRegistry",
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
      ).to.be.revertedWithCustomError(guildRegistry, "Split_InvalidAddress");

      initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address"],
        [
          l1SplitMain.address, // splitMain address
          l1SplitAddress, // split address
          ethers.constants.AddressZero, // owner address
        ],
      );

      await expect(
        deployments.deploy("Guild Registry", {
          contract: "GuildRegistry",
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
      )
        .to.be.revertedWithCustomError(guildRegistry, "OwnableInvalidOwner")
        .withArgs(ethers.constants.AddressZero);
    });

    it("Should not be able to initialize the implementation contract", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const l1InitializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address"],
        [l1SplitMain.address, l1SplitAddress, users.owner.address],
      );
      const implSlot = BigNumber.from("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
      const slotValue = await ethers.provider.getStorageAt(guildRegistry.address, implSlot);
      const implementationAddress = `0x${slotValue.substring(26, 66)}`;
      const implementation = (await ethers.getContractAt(
        "GuildRegistry",
        implementationAddress,
        signer,
      )) as GuildRegistry;
      await expect(implementation.initialize(l1InitializationParams)).to.be.revertedWithCustomError(
        implementation,
        "InvalidInitialization",
      );
    });

    it("Should not be able to call init functions if contract is not initializing", async () => {
      const { deployer } = await getNamedAccounts();
      const signer = await ethers.getSigner(deployer);
      const implDeployed = await deployments.deploy("GuildRegistryHarness", {
        contract: "GuildRegistryHarness",
        from: deployer,
        args: [],
        libraries: {
          PGContribCalculator: l1CalculatorLibrary.address,
        },
        log: true,
      });
      const registry = (await ethers.getContractAt(
        "GuildRegistryHarness",
        implDeployed.address,
        signer,
      )) as GuildRegistryHarness;

      await expect(registry.exposed__MemberRegistry_init_unchained()).to.be.revertedWithCustomError(
        registry,
        "NotInitializing",
      );

      await expect(registry.exposed__MemberRegistry_init()).to.be.revertedWithCustomError(registry, "NotInitializing");

      await expect(
        registry.exposed__GuildRegistry_init_unchained(ethers.constants.AddressZero, ethers.constants.AddressZero),
      ).to.be.revertedWithCustomError(registry, "NotInitializing");

      await expect(
        registry.exposed__GuildRegistry_init(
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
        ),
      ).to.be.revertedWithCustomError(registry, "NotInitializing");
    });

    it("Should have owner on L1", async () => {
      expect(await guildRegistry.owner()).to.equal(users.owner.address);
    });

    it("Should not be able to transferOwnership to zero address", async () => {
      await expect(guildRegistry.transferOwnership(ethers.constants.AddressZero)).to.revertedWithCustomError(
        guildRegistry,
        "OwnableInvalidOwner",
      );
    });

    it("Should not be able to call config methods if not owner", async () => {
      const signer = await ethers.getSigner(users.applicant.address);
      const applicantRegistry = guildRegistry.connect(signer);

      await expect(applicantRegistry.setSplit(l1SplitMain.address, l1SplitAddress)).to.be.revertedWithCustomError(
        guildRegistry,
        "OwnableUnauthorizedAccount",
      );
      await expect(applicantRegistry.transferSplitControl(users.applicant.address)).to.be.revertedWithCustomError(
        guildRegistry,
        "OwnableUnauthorizedAccount",
      );
      await expect(applicantRegistry.acceptSplitControl()).to.be.revertedWithCustomError(
        guildRegistry,
        "OwnableUnauthorizedAccount",
      );
      await expect(applicantRegistry.cancelSplitControlTransfer()).to.be.revertedWithCustomError(
        guildRegistry,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should control the 0xSplit contract", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const l1SplitMainAddress = await guildRegistry.splitMain();
      const l1SplitAddress = await guildRegistry.split();
      const splitMain = (await ethers.getContractAt("SplitMain", l1SplitMainAddress, signer)) as SplitMain;
      expect(await splitMain.getController(l1SplitAddress)).to.equal(guildRegistry.address);
    });

    it("Should not be able to set a non-existent 0xSplit contract", async () => {
      const dummySplitAddress = users.applicant.address;
      await expect(guildRegistry.setSplit(l1SplitMain.address, dummySplitAddress)).to.be.revertedWithCustomError(
        guildRegistry,
        "Split__InvalidOrImmutable",
      );

      const newSplitAddress = await deploySplit(
        l1SplitMain,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        ethers.constants.AddressZero, // immutable
      );
      await expect(guildRegistry.setSplit(l1SplitMain.address, newSplitAddress)).to.be.revertedWithCustomError(
        guildRegistry,
        "Split__InvalidOrImmutable",
      );
    });

    it("Should not be able to update 0xSplit contract if control is not handed over first", async () => {
      const newSplitAddress = await deploySplit(
        l1SplitMain,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        users.owner.address,
      );

      await expect(guildRegistry.setSplit(l1SplitMain.address, newSplitAddress)).to.be.revertedWithCustomError(
        guildRegistry,
        "Split__ControlNotHandedOver",
      );
    });

    it("Should be able to update 0xSplit contract and get control over it", async () => {
      const newSplitAddress = await deploySplit(
        l1SplitMain,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        users.owner.address,
      );
      const txTransfer = await l1SplitMain.transferControl(newSplitAddress, guildRegistry.address);
      await txTransfer.wait();

      const tx = await guildRegistry.setSplit(l1SplitMain.address, newSplitAddress);

      await expect(tx).to.emit(guildRegistry, "SplitUpdated").withArgs(l1SplitMain.address, newSplitAddress);
      await expect(tx)
        .to.emit(l1SplitMain, "ControlTransfer")
        .withArgs(newSplitAddress, users.owner.address, guildRegistry.address);
    });

    it("Should be able to transfer 0xSplit control", async () => {
      const newController = users.applicant.address;
      const tx = await guildRegistry.transferSplitControl(newController);
      await tx.wait();
      expect(await l1SplitMain.getNewPotentialController(await guildRegistry.split())).to.equal(newController);
    });

    it("Should be able to accept 0xSplit control", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const newL1SplitAddress = await deploySplit(
        l1SplitMain,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        users.owner.address,
      );
      const l1RegistryAddress = await summonGuildRegistryProxy(
        l1CalculatorLibrary.address,
        {
          splitMain: l1SplitMain.address,
          split: newL1SplitAddress,
          owner: users.owner.address,
        },
        "Guild Registry",
      );
      const txTransfer = await l1SplitMain.transferControl(newL1SplitAddress, l1RegistryAddress);
      await expect(txTransfer)
        .to.emit(l1SplitMain, "InitiateControlTransfer")
        .withArgs(newL1SplitAddress, l1RegistryAddress);
      const registry = (await ethers.getContractAt("GuildRegistry", l1RegistryAddress, signer)) as GuildRegistry;
      const tx = await registry.acceptSplitControl();
      await expect(tx)
        .to.emit(l1SplitMain, "ControlTransfer")
        .withArgs(newL1SplitAddress, users.owner.address, l1RegistryAddress);
    });

    it("Should be able to cancel 0xSplit control", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const newL1SplitAddress = await deploySplit(
        l1SplitMain,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        users.owner.address,
      );
      const l1RegistryAddress = await summonGuildRegistryProxy(
        l1CalculatorLibrary.address,
        {
          splitMain: l1SplitMain.address,
          split: newL1SplitAddress,
          owner: users.owner.address,
        },
        "Guild Registry",
      );
      const txTransfer = await l1SplitMain.transferControl(newL1SplitAddress, l1RegistryAddress);
      await expect(txTransfer)
        .to.emit(l1SplitMain, "InitiateControlTransfer")
        .withArgs(newL1SplitAddress, l1RegistryAddress);

      const registry = (await ethers.getContractAt("GuildRegistry", l1RegistryAddress, signer)) as GuildRegistry;
      const txAccept = await registry.acceptSplitControl();
      await expect(txAccept)
        .to.emit(l1SplitMain, "ControlTransfer")
        .withArgs(newL1SplitAddress, users.owner.address, l1RegistryAddress);

      const txTransfer2 = await registry.transferSplitControl(users.applicant.address);
      await expect(txTransfer2)
        .to.emit(l1SplitMain, "InitiateControlTransfer")
        .withArgs(newL1SplitAddress, users.applicant.address);

      const tx = await registry.cancelSplitControlTransfer();
      await expect(tx).to.emit(l1SplitMain, "CancelControlTransfer").withArgs(newL1SplitAddress);
    });
  });

  // ##############################################################################################################
  // ##################################                       #####################################################
  // ################################## GuildRegistry Actions #####################################################
  // ##################################                       #####################################################
  // ##############################################################################################################
  // ##############################################################################################################
  // ##############################################################################################################

  describe("GuildRegistry Actions", function () {
    it("Should not be able to update a main registry if not the owner", async () => {
      const signer = await ethers.getSigner(users.applicant.address);
      const applicantRegistry = guildRegistry.connect(signer);
      await expect(
        applicantRegistry.batchNewMembers([users.applicant.address], [100], [0]),
      ).to.be.revertedWithCustomError(guildRegistry, "OwnableUnauthorizedAccount");
      await expect(
        applicantRegistry.batchUpdateMembersActivity([users.applicant.address], [100]),
      ).to.be.revertedWithCustomError(guildRegistry, "OwnableUnauthorizedAccount");
      await expect(applicantRegistry.batchRemoveMembers([users.applicant.address])).to.be.revertedWithCustomError(
        guildRegistry,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should not be able to add new members in batch if param sizes mismatch", async () => {
      const startDate = await time.latest();

      await expect(guildRegistry.batchNewMembers([], [10], [Number(startDate)])).to.be.revertedWithCustomError(
        guildRegistry,
        "Registry__ParamsSizeMismatch",
      );

      await expect(
        guildRegistry.batchNewMembers([ethers.constants.AddressZero], [10], []),
      ).to.be.revertedWithCustomError(guildRegistry, "Registry__ParamsSizeMismatch");

      await expect(
        guildRegistry.batchNewMembers([ethers.constants.AddressZero], [], [Number(startDate)]),
      ).to.be.revertedWithCustomError(guildRegistry, "Registry__ParamsSizeMismatch");
    });

    it("Should not be able to add new members in batch if activityMultiplier=0", async () => {
      const newMembers = await generateMemberBatch(10);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      activityMultipliers[0] = 0;
      const startDates = newMembers.map((m: Member) => m.startDate);
      await expect(guildRegistry.batchNewMembers(members, activityMultipliers, startDates))
        .to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__InvalidActivityMultiplier")
        .withArgs(members[0], 0);
    });

    it("Should be able to add a new member with correct parameters", async () => {
      const [, , , member1, member2] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const startDate = await time.latest();

      await expect(
        guildRegistry.batchNewMembers([ethers.constants.AddressZero], [activityMultiplier], [startDate]),
      ).to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__InvalidAddress");

      await expect(guildRegistry.batchNewMembers([member1], [activityMultiplier + 1], [startDate]))
        .to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__InvalidActivityMultiplier")
        .withArgs(member1, activityMultiplier + 1);

      await expect(guildRegistry.batchNewMembers([member1], [0], [startDate]))
        .to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__InvalidActivityMultiplier")
        .withArgs(member1, 0);

      await expect(
        guildRegistry.batchNewMembers([member1], [activityMultiplier], [(await time.latest()) + 1e6]),
      ).to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__StartDateInTheFuture");

      // tx success
      const tx = await guildRegistry.batchNewMembers([member1], [activityMultiplier], [startDate]);
      await expect(tx).to.emit(guildRegistry, "NewMember").withArgs(member1, Number(startDate), activityMultiplier);

      await expect(
        guildRegistry.batchNewMembers([member1], [activityMultiplier], [startDate]),
      ).to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__AlreadyRegistered");

      const members = await guildRegistry.getMembers();
      const totalMembers = await guildRegistry.totalMembers();
      const totalActiveMembers = await guildRegistry.totalActiveMembers();
      expect(members.length).to.be.equal(totalMembers);
      expect(totalMembers).to.be.equal(totalActiveMembers);
      expect(members[0]).to.have.ordered.members([member1, 0, Number(startDate), activityMultiplier]);

      const member = await guildRegistry.getMember(member1);
      expect(member).to.have.ordered.members([member1, 0, Number(startDate), activityMultiplier]);

      await expect(guildRegistry.getMember(member2)).to.be.revertedWithCustomError(
        guildRegistry,
        "MemberRegistry__NotRegistered",
      );
    });

    it("Should be able to add new members in batch", async () => {
      const newMembers = await generateMemberBatch(10);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      for (let i = 0; i < newMembers.length; i++) {
        await expect(tx)
          .to.emit(guildRegistry, "NewMember")
          .withArgs(newMembers[i].account, Number(newMembers[i].startDate), newMembers[i].activityMultiplier);
      }
      const totalActiveMembers = await guildRegistry.totalActiveMembers();
      expect(totalActiveMembers).to.be.equal(members.length);
    });

    it("Should not be able to update members in batch if param sizes mismatch", async () => {
      await expect(
        guildRegistry.batchUpdateMembersActivity(members.slice(0, 1), []),
        // ).to.revertedWithPanic("0x32"); // Array accessed at an out-of-bounds or negative index
      ).to.be.revertedWithCustomError(guildRegistry, "Registry__ParamsSizeMismatch");

      await expect(
        guildRegistry.batchUpdateMembersActivity([], [100]),
        // ).to.revertedWithPanic("0x32"); // Array accessed at an out-of-bounds or negative index
      ).to.be.revertedWithCustomError(guildRegistry, "Registry__ParamsSizeMismatch");
    });

    it("Should be able to update an existing member with correct parameters", async () => {
      const [, , , member1, member2] = await getUnnamedAccounts();
      const activityMultiplier = 100;
      const modActivityMultiplier = activityMultiplier / 2;
      const startDate = await time.latest();

      await expect(
        guildRegistry.batchUpdateMembersActivity([member2], [activityMultiplier]),
      ).to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__NotRegistered");

      const newTx = await guildRegistry.batchNewMembers([member1], [activityMultiplier], [startDate]);
      await newTx.wait();
      const totalMembersBefore = await guildRegistry.totalMembers();

      await expect(
        guildRegistry.batchUpdateMembersActivity([member1], [activityMultiplier + 1]),
      ).to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__InvalidActivityMultiplier");

      // does not happen as member with activityMultiplier=0 is directly removed from the registry
      // // should revert if member.secondsActive = 0
      // await expect(
      //   guildRegistry.batchUpdateMembersActivity([member1], [0]),
      // ).to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__InvalidActivityMultiplier");

      let member = await guildRegistry.getMember(member1);

      let tx = await guildRegistry.batchUpdateMembersActivity([member1], [modActivityMultiplier]);
      await expect(tx)
        .to.emit(guildRegistry, "UpdateMember")
        .withArgs(member1, modActivityMultiplier, member.startDate, member.secondsActive);

      member = await guildRegistry.getMember(member1);
      let totalMembersAfter = await guildRegistry.totalMembers();
      let totalActiveMembers = await guildRegistry.totalActiveMembers();
      expect(totalMembersBefore).to.be.equal(totalMembersAfter);
      expect(totalMembersAfter).to.be.equal(totalActiveMembers);

      expect(member).to.have.ordered.members([member1, 0, Number(startDate), modActivityMultiplier]);

      // update registry activity
      tx = await guildRegistry.updateSecondsActive(0);
      await tx.wait();

      // deactivate member at next epoch
      tx = await guildRegistry.batchUpdateMembersActivity([member1], [0]);
      await expect(tx).to.emit(guildRegistry, "RemoveMember").withArgs(member1);
      totalMembersAfter = await guildRegistry.totalMembers();
      totalActiveMembers = await guildRegistry.totalActiveMembers();
      expect(totalMembersAfter).to.be.equal(totalActiveMembers);
      expect(totalMembersAfter).to.be.equal(0);
      expect(totalActiveMembers).to.be.equal(0);
    });

    it("Should be able to update members in batch", async () => {
      const newMembers = await generateMemberBatch(10);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const modActivityMultipliers = newMembers.map((_, i) => (i % 2 === 0 ? 100 : 0));
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batchTx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batchTx.wait();

      const updateTx = await guildRegistry.updateSecondsActive(0);
      await updateTx.wait();

      const tx = await guildRegistry.batchUpdateMembersActivity(members, modActivityMultipliers);
      for (let i = 0; i < newMembers.length; i++) {
        if (modActivityMultipliers[i] > 0)
          await expect(tx)
            .to.emit(guildRegistry, "UpdateMember")
            .withArgs(newMembers[i].account, modActivityMultipliers[i], newMembers[i].startDate, anyValue);
      }
      // TODO: check members with activityMuliplier=0 were removed from the registry
      const totalActiveMembers = await guildRegistry.totalActiveMembers();
      expect(totalActiveMembers).to.be.equal(modActivityMultipliers.filter((v) => v === 0).length);
    });

    it("Should not be able to remove an unregistered member", async () => {
      const [, , , member] = await getUnnamedAccounts();
      await expect(guildRegistry.batchRemoveMembers([member])).to.be.revertedWithCustomError(
        guildRegistry,
        "MemberRegistry__NotRegistered",
      );
    });

    it("Should be able to remove members from the registry", async () => {
      const batchSize = 5;
      const newMembers: Member[] = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batchAddTx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batchAddTx.wait();

      const updateTx = await guildRegistry.updateSecondsActive(0);
      await updateTx.wait();

      // const batchUpdateTx = await guildRegistry.batchUpdateMembersActivity(members.slice(0, 2), [0, 0]);
      // await batchUpdateTx.wait();

      const toBeMembers = [members[1], members[3]];

      const totalMembersBefore = await guildRegistry.totalMembers();
      const totalActiveMembersBefore = await guildRegistry.totalActiveMembers();
      expect(totalMembersBefore).to.be.equal(totalActiveMembersBefore);

      const removeMembers = members.filter((_, i) => i % 2 === 0);
      const tx = await guildRegistry.batchRemoveMembers(removeMembers);
      for (let i = 1; i < removeMembers.length; i++) {
        await expect(tx).to.emit(guildRegistry, "RemoveMember").withArgs(removeMembers[i]);
      }
      const totalMembersAfter = await guildRegistry.totalMembers();
      const totalActiveMembersAfter = await guildRegistry.totalActiveMembers();
      expect(totalMembersAfter).to.be.equal(totalActiveMembersAfter);
      expect(totalMembersAfter).to.be.equal(totalMembersBefore.sub(removeMembers.length));
      expect(totalActiveMembersAfter).to.be.equal(totalActiveMembersBefore.sub(removeMembers.length));

      const memberList = await guildRegistry.getMembers();
      expect(memberList.map((m) => m.account).every((m) => toBeMembers.includes(m))).to.be.true;
      expect(
        (
          await Promise.all(
            toBeMembers.map(async (address) => (await guildRegistry.getMember(address)).account === address),
          )
        ).every((v) => v),
      ).to.be.true;
    });

    it("Should no tbe able to update registry activity using invalid cutoffDate", async () => {
      const batchSize = 5;
      const newMembers: Member[] = await generateMemberBatch(batchSize * 2);
      const batch1 = newMembers.slice(0, batchSize);
      let members = batch1.map((m: Member) => m.account);
      let activityMultipliers = batch1.map((m: Member) => m.activityMultiplier);
      let startDates = batch1.map((m: Member) => m.startDate);
      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      const previousTimestamp = await time.latest();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      ///////// BATCH 2

      const batch2 = newMembers.slice(batchSize, batchSize * 2);
      members = batch2.map((m: Member) => m.account);
      activityMultipliers = batch2.map((m: Member) => m.activityMultiplier);
      startDates = batch1.map((m: Member) => Number(m.startDate) + 3600 * 24 * 15); // 15 days later
      const batch2Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch2Tx.wait();

      const lastBlockTimestamp = await time.latest();

      await expect(guildRegistry.updateSecondsActive(previousTimestamp)).to.be.revertedWithCustomError(
        guildRegistry,
        "MemberRegistry__InvalidCutoffDate",
      );

      await expect(
        guildRegistry.updateSecondsActive(lastBlockTimestamp + 3600 * 24), // one day ahead
      ).to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__InvalidCutoffDate");
    });

    it("Should be able to update registry activity", async () => {
      const batchSize = 5;
      const newMembers: Member[] = await generateMemberBatch(batchSize * 3);
      const batch1 = newMembers.slice(0, batchSize);
      let members = batch1.map((m: Member) => m.account);
      let activityMultipliers = batch1.map((m: Member) => m.activityMultiplier);
      let startDates = batch1.map((m: Member) => m.startDate);
      const batch1Date = Number(startDates[0]);
      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      ///////// BATCH 2

      const batch2 = newMembers.slice(batchSize, batchSize * 2);
      members = batch2.map((m: Member) => m.account);
      activityMultipliers = batch2.map((m: Member) => m.activityMultiplier);
      startDates = batch1.map((m: Member) => Number(m.startDate) + 3600 * 24 * 15); // 15 days later
      const batch2Date = Number(startDates[0]);
      const batch2Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch2Tx.wait();

      let lastBlockTimestamp = (await time.latest()) + 1;

      let tx = await guildRegistry.updateSecondsActive(lastBlockTimestamp);

      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(guildRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch1[i].account,
            Math.floor(((lastBlockTimestamp - batch1Date) * Number(batch1[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(guildRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch2[i].account,
            Math.floor(((lastBlockTimestamp - batch2Date) * Number(batch2[i].activityMultiplier)) / 100),
          );
      }
      let totalMembers = await guildRegistry.totalMembers();
      await expect(tx).to.emit(guildRegistry, "RegistryActivityUpdate").withArgs(lastBlockTimestamp, totalMembers);

      await time.increase(3600 * 24 * 30); // next block in 30 days

      ///////// BATCH 3

      const batch3 = newMembers.slice(batchSize * 2, batchSize * 3);
      members = batch3.map((m: Member) => m.account);
      activityMultipliers = batch3.map(() => 100); // make sure all new members are active
      startDates = batch3.map((m: Member) => Number(m.startDate) + 3600 * 24 * 45); // 45 days later
      const batch3Date = Number(startDates[0]);
      const batch3Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch3Tx.wait();

      const lastActivityUpdate = await guildRegistry.lastActivityUpdate();

      tx = await guildRegistry.updateSecondsActive(0);

      lastBlockTimestamp = await time.latest();

      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(guildRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch1[i].account,
            Math.floor(((lastBlockTimestamp - lastActivityUpdate) * Number(batch1[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(guildRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch2[i].account,
            Math.floor(((lastBlockTimestamp - lastActivityUpdate) * Number(batch2[i].activityMultiplier)) / 100),
          );
        await expect(tx)
          .to.emit(guildRegistry, "UpdateMemberSeconds")
          .withArgs(
            batch3[i].account,
            Math.floor(((lastBlockTimestamp - batch3Date) * Number(activityMultipliers[i])) / 100),
          );
      }
      totalMembers = await guildRegistry.totalMembers();
      await expect(tx).to.emit(guildRegistry, "RegistryActivityUpdate").withArgs(lastBlockTimestamp, totalMembers);
    });

    it("Should not be able to update Split distribution if submitted member list is invalid", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await guildRegistry.updateSecondsActive(0);
      await txUpdate.wait();

      const splitDistributorFee = splitConfig.distributorFee;

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      // first member in sortedList becomes inactive
      const batch2Tx = await guildRegistry.batchUpdateMembersActivity(sortedMembers.slice(0, 1), [0]);
      await batch2Tx.wait();

      await expect(guildRegistry.updateSplits(members, splitDistributorFee)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__MemberListSizeMismatch",
      );
      await expect(guildRegistry.updateSplits(members.slice(1), splitDistributorFee)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__AccountsOutOfOrder",
      );

      sortedMembers.pop(); // remove the last member in sortedList
      // should not happen as inactive members are immediately removed from the registry
      // // try to execute a split distribution with first member in sortedList as inactive
      // await expect(guildRegistry.updateSplits(sortedMembers, splitDistributorFee))
      //   .to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__InactiveMember")
      //   .withArgs(sortedMembers[0]);

      const activeMembers = sortedMembers.slice(1); // remove inactive member from sortedList
      const unregisteredMemberAddr = ethers.utils.getAddress(`0x${"f".repeat(40)}`); // replace last member in sortedList
      await expect(guildRegistry.updateSplits([...activeMembers, unregisteredMemberAddr], splitDistributorFee))
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
      let txUpdate = await guildRegistry.updateSecondsActive(0);
      await txUpdate.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      await expect(guildRegistry.updateSplits(sortedMembers, splitDistributorFee)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__NoActiveMembers",
      );

      // add some members to the registry
      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      txUpdate = await guildRegistry.updateSecondsActive(0);
      await txUpdate.wait();

      // now all members become inactive
      activityMultipliers = newMembers.map(() => 0);
      const batch2Tx = await guildRegistry.batchUpdateMembersActivity(members, activityMultipliers);
      await batch2Tx.wait();

      expect(await guildRegistry.totalActiveMembers()).to.be.equal(0);

      await time.increase(3600 * 24 * 30); // next block in 30 days

      // no updates applied
      txUpdate = await guildRegistry.updateSecondsActive(0);
      await txUpdate.wait();

      await expect(guildRegistry.updateSplits(sortedMembers, splitDistributorFee)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__NoActiveMembers",
      );
    });

    it("Should be able to calculate Split allocations that sum up to PERCENTAGE_SCALE", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      // same activityMultipliers and startDates to enforce allocations to sum up to PERCENTAGE_SCALE
      const activityMultipliers = newMembers.map(() => 100);
      const startDates = newMembers.map(() => newMembers[0].startDate);

      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await guildRegistry.updateSecondsActive(0);
      await txUpdate.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      const { _receivers, _percentAllocations } = await guildRegistry.calculate(sortedMembers);

      // fetch last calculated contributions on registry
      const contributions = await Promise.all(
        newMembers.map(async (member: Member) => await guildRegistry["calculateContributionOf"](member.account)),
      );
      const totalContributions = contributions.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      // calculate allocations on active members
      const calculatedAllocations = contributions.map((contr: BigNumber) =>
        contr.mul(PERCENTAGE_SCALE).div(totalContributions),
      );

      expect(_receivers).to.be.eql(newMembers.map((m: Member) => m.account));
      expect(_percentAllocations).to.be.eql(calculatedAllocations.map((v: BigNumber) => v.toNumber()));
    });

    it("Should be able to calculate Split allocations", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);

      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await guildRegistry.updateSecondsActive(0);
      await txUpdate.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      const { _receivers, _percentAllocations } = await guildRegistry.calculate(sortedMembers);

      // filter active members
      const activeMembers = newMembers.filter((member: Member) => Number(member.activityMultiplier) > 0);
      // fetch last calculated contributions on registry
      const contributions = await Promise.all(
        activeMembers.map(async (member: Member) => await guildRegistry["calculateContributionOf"](member.account)),
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

      expect(_receivers).to.be.eql(activeMembers.map((m: Member) => m.account));
      expect(_percentAllocations).to.be.eql(calculatedAllocations.map((v: BigNumber) => v.toNumber()));
    });

    it("Should not be able to produce an empty Split distribution", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      members.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));

      await expect(guildRegistry.calculate(members)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__EmptyDistribution",
      );

      const splitDistributorFee = splitConfig.distributorFee;

      await expect(guildRegistry.updateSplits(members, splitDistributorFee)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__EmptyDistribution",
      );
    });

    it("Should be able to update Split values from last update", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await guildRegistry.updateSecondsActive(0);
      await txUpdate.wait();

      members.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));
      const splitDistributorFee = splitConfig.distributorFee;

      // pre-calculate to get split hash
      const { _receivers, _percentAllocations } = await guildRegistry.calculate(members);

      const splitHash = hashSplit(_receivers, _percentAllocations, splitDistributorFee);

      const tx = await guildRegistry.updateSplits(members, splitDistributorFee);

      await expect(tx).to.emit(l1SplitMain, "UpdateSplit").withArgs(l1SplitAddress);
      await expect(tx)
        .to.emit(guildRegistry, "SplitsDistributionUpdated")
        .withArgs(l1SplitAddress, splitHash, splitDistributorFee);
    });

    it("Should not be able to update all if submitted member list is invalid", async () => {
      const batchSize = 10;
      const newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const splitDistributorFee = splitConfig.distributorFee;
      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      await time.increase(3600 * 24 * 30); // next block in 30 days
      const updateTx = await guildRegistry.updateSecondsActive(0);
      await updateTx.wait();

      // first member in sortedList becomes inactive
      const batch2Tx = await guildRegistry.batchUpdateMembersActivity(sortedMembers.slice(0, 1), [0]);
      await batch2Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      await expect(guildRegistry.updateAll(0, members, splitDistributorFee)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__MemberListSizeMismatch",
      );
      await expect(guildRegistry.updateAll(0, members.slice(1), splitDistributorFee)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__AccountsOutOfOrder",
      );

      sortedMembers.pop(); // remove the last member in sortedList
      // try to execute a update all with first member in sortedList as inactive
      await expect(guildRegistry.updateAll(0, sortedMembers, splitDistributorFee))
        .to.be.revertedWithCustomError(l1CalculatorLibrary, "MemberRegistry__NotRegistered")
        .withArgs(sortedMembers[0]);

      const activeMembers = sortedMembers.slice(1); // remove inactive member from sortedList
      const unregisteredMemberAddr = ethers.utils.getAddress(`0x${"f".repeat(40)}`); // replace last member in sortedList
      await expect(guildRegistry.updateAll(0, [...activeMembers, unregisteredMemberAddr], splitDistributorFee))
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
      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      members.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));
      const splitDistributorFee = splitConfig.distributorFee;

      const tx = await guildRegistry.updateAll(0, members, splitDistributorFee);
      await tx.wait();

      const lastBlockTimestamp = await time.latest();

      // MUST get calculations after the updateAll call so it uses the latest activeSeconds
      const { _receivers, _percentAllocations } = await guildRegistry.calculate(members);
      const splitHash = hashSplit(_receivers, _percentAllocations, splitDistributorFee);

      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(guildRegistry, "UpdateMemberSeconds")
          .withArgs(
            newMembers[i].account,
            Math.floor(((lastBlockTimestamp - batch1Date) * Number(newMembers[i].activityMultiplier)) / 100),
          );
      }
      const totalMembers = await guildRegistry.totalMembers();
      await expect(tx).to.emit(guildRegistry, "RegistryActivityUpdate").withArgs(lastBlockTimestamp, totalMembers);

      await expect(tx).to.emit(l1SplitMain, "UpdateSplit").withArgs(l1SplitAddress);
      await expect(tx)
        .to.emit(guildRegistry, "SplitsDistributionUpdated")
        .withArgs(l1SplitAddress, splitHash, splitDistributorFee);
    });
  });

  // ##########################################################################################################
  // #################################                    #####################################################
  // #################################    GuildRegistry   #####################################################
  // #################################       Getters      #####################################################
  // ##########################################################################################################
  // ##########################################################################################################
  // ##########################################################################################################

  describe("GuildRegistry getters", function () {
    const batchSize: number = 10;
    let newMembers: Array<Member>;

    beforeEach(async function () {
      newMembers = await generateMemberBatch(batchSize);
      const members = newMembers.map((m: Member) => m.account);
      const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
      const startDates = newMembers.map((m: Member) => m.startDate);
      const tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await tx.wait();
    });

    it("Should be able to get the current number of registered members", async () => {
      const totalMembers = await guildRegistry.totalMembers();
      expect(totalMembers).to.equal(newMembers.length);
    });

    it("Should be able to get the current number of active members", async () => {
      // TODO: check members updates being removed from the registry
      expect(await guildRegistry.totalActiveMembers()).to.equal(newMembers.length);

      const updateTx = await guildRegistry.updateSecondsActive(0);
      await updateTx.wait();

      const tx = await guildRegistry.batchUpdateMembersActivity([members[0]], [0]);
      await tx.wait();

      expect(await guildRegistry.totalActiveMembers()).to.equal(newMembers.length - 1);
    });

    it("Should throw an error when trying to fetch an unregistered user", async () => {
      await expect(guildRegistry.getMember(users.owner.address)).to.be.revertedWithCustomError(
        guildRegistry,
        "MemberRegistry__NotRegistered",
      );
      await expect(guildRegistry.getMembersProperties([users.owner.address])).to.be.revertedWithCustomError(
        guildRegistry,
        "MemberRegistry__NotRegistered",
      );
    });

    it("Should be able to fetch a registered member", async () => {
      const member = await guildRegistry.getMember(newMembers[0].account);
      expect(member.account).to.equal(newMembers[0].account);
      expect(member.activityMultiplier).to.equal(newMembers[0].activityMultiplier);
      expect(member.startDate).to.equal(newMembers[0].startDate);
      expect(member.secondsActive).to.equal(0);

      const memberProperties = await guildRegistry.getMembersProperties([newMembers[0].account]);
      expect(memberProperties[0][0]).to.equal(newMembers[0].activityMultiplier);
      expect(memberProperties[1][0]).to.equal(newMembers[0].startDate);
      expect(memberProperties[2][0]).to.equal(0);
    });

    it("Should be able to fetch all registered members", async () => {
      const members = await guildRegistry.getMembers();
      for (let i = 0; i < newMembers.length; i++) {
        expect(members[i].account).to.equal(newMembers[i].account);
        expect(members[i].activityMultiplier).to.equal(newMembers[i].activityMultiplier);
        expect(members[i].startDate).to.equal(newMembers[i].startDate);
        expect(members[i].secondsActive).to.equal(0);
      }
    });

    it("Should not be able to fetch members paginated if index is out of bounds", async () => {
      await expect(guildRegistry.getMembersPaginated(100, 10000)).to.be.revertedWithCustomError(
        guildRegistry,
        "MemberRegistry__IndexOutOfBounds",
      );
      await expect(guildRegistry.getMembersPaginated(0, 100)).to.be.revertedWithCustomError(
        guildRegistry,
        "MemberRegistry__IndexOutOfBounds",
      );
    });

    it("Should be able to fetch members paginated", async () => {
      const toIndex = 5;
      const members = await guildRegistry.getMembersPaginated(0, toIndex);
      expect(members.length).to.equal(toIndex + 1);
    });

    it("Should be able to calculate members total contributions", async () => {
      // update registry activity
      const syncUpdateTx = await guildRegistry.updateSecondsActive(0);
      await syncUpdateTx.wait();

      const totalContribBefore = await guildRegistry.calculateTotalContributions();

      // get member contribution before getting inactive
      const member = newMembers[newMembers.length - 1].account;
      const memberContrib = await guildRegistry.calculateContributionOf(member);

      // member gets inactive
      const syncTx = await guildRegistry.batchUpdateMembersActivity([member], [0]);
      await syncTx.wait();

      const totalContribAfter = await guildRegistry.calculateTotalContributions();
      expect(totalContribBefore).to.eql(totalContribAfter.add(memberContrib));
    });
  });

  // ##########################################################################################################
  // #################################                    #####################################################
  // #################################    GuildRegistry   #####################################################
  // #################################     UUPS Proxy     #####################################################
  // ##########################################################################################################
  // ##########################################################################################################
  // ##########################################################################################################

  describe("GuildRegistry UUPS Upgradeability", function () {
    let newRegistryImplementation: GuildRegistryV2Mock;

    beforeEach(async () => {
      const { deployer } = await getNamedAccounts();
      const signer = await ethers.getSigner(deployer);
      const implDeployed = await deployments.deploy("GuildRegistryV2Mock", {
        contract: "GuildRegistryV2Mock",
        from: deployer,
        args: [],
        libraries: {
          PGContribCalculator: l1CalculatorLibrary.address,
        },
        log: true,
      });
      newRegistryImplementation = await ethers.getContractAt("GuildRegistryV2Mock", implDeployed.address, signer);
    });

    it("Should not be able to upgrade the implementation of a registry if not owner", async () => {
      const [, , , , outsider] = await getUnnamedAccounts();
      const signer = await ethers.getSigner(outsider);
      const l1NetRegistry = guildRegistry.connect(signer);
      await expect(l1NetRegistry.upgradeToAndCall(ethers.constants.AddressZero, "0x")).to.be.revertedWithCustomError(
        guildRegistry,
        "Registry__UnauthorizedToUpgrade",
      );
    });

    it("Should not be able to upgrade the implementation of a registry if not UUPS compliant", async () => {
      await expect(
        guildRegistry.upgradeToAndCall(
          l1CalculatorLibrary.address, // wrong contract implementation
          "0x",
        ),
      ).to.be.revertedWithCustomError(guildRegistry, "ERC1967InvalidImplementation");
    });

    it("Should be able to upgrade the registry implementation if owner", async () => {
      await expect(guildRegistry.upgradeToAndCall(newRegistryImplementation.address, "0x"))
        .to.emit(guildRegistry, "Upgraded")
        .withArgs(newRegistryImplementation.address);

      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address"],
        [l1SplitMain.address, l1SplitAddress, users.owner.address],
      );

      const calldata = newRegistryImplementation.interface.encodeFunctionData("initialize", [initializationParams]);

      const tx = await guildRegistry.upgradeToAndCall(newRegistryImplementation.address, calldata);
      await tx.wait();

      await expect(tx).to.emit(guildRegistry, "Upgraded").withArgs(newRegistryImplementation.address);
      await expect(tx).to.emit(guildRegistry, "Initialized").withArgs(2);
    });
  });
});
