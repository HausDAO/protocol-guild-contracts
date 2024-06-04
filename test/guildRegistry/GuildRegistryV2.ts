import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { deployments, ethers, getNamedAccounts, getUnnamedAccounts } from "hardhat";

import { PERCENTAGE_SCALE } from "../../constants";
import {
  GuildRegistry,
  GuildRegistryV2,
  GuildRegistryV2Harness,
  GuildRegistryV21Mock,
  PGContribCalculator,
  PullSplitFactory,
  SplitMain,
  SplitWalletV2,
  SplitsWarehouse,
} from "../../types";
import { User, registryFixture } from "../networkRegistry/NetworkRegistryV2.fixture";
import { Member } from "../types";
import {
  deploySplit,
  deploySplitV2,
  generateMemberBatch,
  hashSplitV2,
  summonGuildRegistryProxy,
  summonGuildRegistryV2Proxy,
} from "../utils";

describe("GuildRegistryV2", function () {
  let l1CalculatorLibrary: PGContribCalculator;
  let l1SplitV2Factory: PullSplitFactory;
  let l1SplitWarehouse: SplitsWarehouse;
  let l1SplitV2Address: string;
  let l1SplitWalletV2: SplitWalletV2;
  let users: { [key: string]: User };
  let members: Array<string>;
  const splitConfig = {
    percentAllocations: [400_000, 300_000, 300_000],
    distributorFee: 0,
  };

  let guildRegistry: GuildRegistryV2;

  beforeEach(async function () {
    const setup = await registryFixture({});
    l1CalculatorLibrary = setup.calculatorLibrary;
    l1SplitV2Factory = setup.splitV2Factory;
    l1SplitWarehouse = setup.splitWarehouse;
    users = setup.users;

    const signer = await ethers.getSigner(users.owner.address);
    const accounts = await getUnnamedAccounts();
    members = accounts
      .slice(0, splitConfig.percentAllocations.length)
      .sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));

    // Deploy Split on L1
    l1SplitV2Address = await deploySplitV2(
      l1SplitV2Factory,
      members,
      splitConfig.percentAllocations,
      splitConfig.distributorFee,
      PERCENTAGE_SCALE,
      users.owner.address,
    );

    l1SplitWalletV2 = (await ethers.getContractAt("SplitWalletV2", l1SplitV2Address, signer)) as SplitWalletV2;

    // Summon Registry
    const registryAddress = await summonGuildRegistryV2Proxy(
      l1CalculatorLibrary.address,
      {
        split: l1SplitV2Address,
        owner: users.owner.address,
      },
      "GuildRegistryV2",
    );
    guildRegistry = (await ethers.getContractAt("GuildRegistryV2", registryAddress, signer)) as GuildRegistryV2;

    // Transfer Split ownership to GuildRegistry
    const tx_ownership_l1 = await l1SplitWalletV2.transferOwnership(registryAddress);
    await tx_ownership_l1.wait();
  });

  // ##############################################################################################################
  // ##################################                      ######################################################
  // ################################## GuildRegistry Config ######################################################
  // ##################################                      ######################################################
  // ##############################################################################################################
  // ##############################################################################################################
  // ##############################################################################################################

  describe("GuildRegistryV2 Config", function () {
    it("Should be not be able to initialize proxy with wrong parameters", async () => {
      const { deployer } = await getNamedAccounts();
      let initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "address"],
        [
          ethers.constants.AddressZero, // split address
          ethers.constants.AddressZero, // owner
        ],
      );

      await expect(
        deployments.deploy("Guild Registry", {
          contract: "GuildRegistryV2",
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
        ["address", "address"],
        [
          l1SplitV2Address, // split address
          ethers.constants.AddressZero, // owner address
        ],
      );

      await expect(
        deployments.deploy("Guild Registry", {
          contract: "GuildRegistryV2",
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
        ["address", "address"],
        [l1SplitV2Address, users.owner.address],
      );
      const implSlot = BigNumber.from("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
      const slotValue = await ethers.provider.getStorageAt(guildRegistry.address, implSlot);
      const implementationAddress = `0x${slotValue.substring(26, 66)}`;
      const implementation = (await ethers.getContractAt(
        "GuildRegistryV2",
        implementationAddress,
        signer,
      )) as GuildRegistryV2;
      await expect(implementation.initialize(l1InitializationParams)).to.be.revertedWithCustomError(
        implementation,
        "InvalidInitialization",
      );
    });

    it("Should not be able to call init functions if contract is not initializing", async () => {
      const { deployer } = await getNamedAccounts();
      const signer = await ethers.getSigner(deployer);
      const implDeployed = await deployments.deploy("GuildRegistryV2Harness", {
        contract: "GuildRegistryV2Harness",
        from: deployer,
        args: [],
        libraries: {
          PGContribCalculator: l1CalculatorLibrary.address,
        },
        log: true,
      });
      const registry = (await ethers.getContractAt(
        "GuildRegistryV2Harness",
        implDeployed.address,
        signer,
      )) as GuildRegistryV2Harness;

      await expect(registry.exposed__MemberRegistry_init_unchained()).to.be.revertedWithCustomError(
        registry,
        "NotInitializing",
      );

      await expect(registry.exposed__MemberRegistry_init()).to.be.revertedWithCustomError(registry, "NotInitializing");

      await expect(
        registry.exposed__GuildRegistryV2_init_unchained(ethers.constants.AddressZero),
      ).to.be.revertedWithCustomError(registry, "NotInitializing");

      await expect(
        registry.exposed__GuildRegistryV2_init(ethers.constants.AddressZero, ethers.constants.AddressZero),
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

      await expect(applicantRegistry.setSplit(l1SplitV2Address)).to.be.revertedWithCustomError(
        guildRegistry,
        "OwnableUnauthorizedAccount",
      );
      await expect(applicantRegistry.transferSplitOwnership(users.applicant.address)).to.be.revertedWithCustomError(
        guildRegistry,
        "OwnableUnauthorizedAccount",
      );
      await expect(applicantRegistry.pauseSplit(true)).to.be.revertedWithCustomError(
        guildRegistry,
        "OwnableUnauthorizedAccount",
      );
      await expect(
        applicantRegistry.splitWalletExecCalls([{ data: "0x", to: users.applicant.address, value: "0" }]),
      ).to.be.revertedWithCustomError(guildRegistry, "OwnableUnauthorizedAccount");
    });

    it("Should own the 0xSplit contract", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const l1SplitV2Address = await guildRegistry.split();
      const splitV2Wallet = (await ethers.getContractAt("SplitWalletV2", l1SplitV2Address, signer)) as SplitWalletV2;
      expect(await splitV2Wallet.owner()).to.equal(guildRegistry.address);
    });

    it("Should not be able to set a non-existent 0xSplit contract", async () => {
      const dummySplitAddress = users.applicant.address;
      await expect(guildRegistry.setSplit(dummySplitAddress)).to.be.revertedWithoutReason();

      const newSplitAddress = await deploySplitV2(
        l1SplitV2Factory,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        PERCENTAGE_SCALE,
        ethers.constants.AddressZero, // immutable
      );
      await expect(guildRegistry.setSplit(newSplitAddress)).to.be.revertedWithCustomError(
        guildRegistry,
        "Split__InvalidOrImmutable",
      );
    });

    it("Should not be able to update 0xSplit contract if ownership is not handed over first", async () => {
      const newSplitAddress = await deploySplitV2(
        l1SplitV2Factory,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        PERCENTAGE_SCALE,
        users.applicant.address,
      );

      await expect(guildRegistry.setSplit(newSplitAddress)).to.be.revertedWithCustomError(
        guildRegistry,
        "Split__ControlNotHandedOver",
      );
    });

    it("Should be able to update 0xSplit contract and get ownership over it", async () => {
      const signer = await ethers.getSigner(users.owner.address);
      const newSplitAddress = await deploySplitV2(
        l1SplitV2Factory,
        members,
        splitConfig.percentAllocations,
        splitConfig.distributorFee,
        PERCENTAGE_SCALE,
        users.owner.address,
      );
      const splitV2Wallet = (await ethers.getContractAt("SplitWalletV2", newSplitAddress, signer)) as SplitWalletV2;
      const tx_owner = await splitV2Wallet.transferOwnership(guildRegistry.address);
      await tx_owner.wait();
      await expect(tx_owner)
        .to.emit(splitV2Wallet, "OwnershipTransferred")
        .withArgs(users.owner.address, guildRegistry.address);

      const tx = await guildRegistry.setSplit(newSplitAddress);

      await expect(tx).to.emit(guildRegistry, "SplitUpdated").withArgs(newSplitAddress);
    });

    it("Should be able to transfer 0xSplit ownership", async () => {
      const newController = users.applicant.address;
      const tx = await guildRegistry.transferSplitOwnership(newController);
      await tx.wait();
      expect(await l1SplitWalletV2.owner()).to.equal(newController);
    });

    it("Should be able to pause 0xSplit", async () => {
      const tx = await guildRegistry.pauseSplit(true);
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
      const tx = await guildRegistry.splitWalletExecCalls(calls, { value });
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

    it("Should be able to pause withdrawals from the SplitWarehouse", async () => {
      const value = ethers.utils.parseEther("1");
      const calls = [
        {
          to: l1SplitWarehouse.address,
          value: "0",
          data: l1SplitWarehouse.interface.encodeFunctionData("setWithdrawConfig", [{ incentive: "0", paused: true }]),
        },
      ];
      const tx = await guildRegistry.splitWalletExecCalls(calls, { value });
      await expect(tx)
        .to.emit(l1SplitWalletV2, "ExecCalls")
        .withArgs((value: any) => {
          expect(value.length).to.equal(1);
          expect(value[0]).to.deep.equal(calls.map((c) => [c.to, c.value, c.data])[0]);
          return true;
        });
      expect(await l1SplitWarehouse.withdrawConfig(l1SplitWalletV2.address)).to.deep.equal(["0", true]);
    });
  });

  // ##############################################################################################################
  // ##################################                       #####################################################
  // ################################## GuildRegistry Actions #####################################################
  // ##################################                       #####################################################
  // ##############################################################################################################
  // ##############################################################################################################
  // ##############################################################################################################

  describe("GuildRegistryV2 Actions", function () {
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

      await expect(guildRegistry.batchNewMembers([member1], [activityMultiplier], [0])).to.be.revertedWithCustomError(
        guildRegistry,
        "MemberRegistry__InvalidStartDate",
      );

      await expect(
        guildRegistry.batchNewMembers([member1], [activityMultiplier], [(await time.latest()) + 1e6]),
      ).to.be.revertedWithCustomError(guildRegistry, "MemberRegistry__InvalidStartDate");

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

      await expect(
        guildRegistry.updateSplits(
          sortedMembers.map(() => sortedMembers[0]),
          splitDistributorFee,
        ),
      ).to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__AccountsOutOfOrderOrInvalid");

      // first member in sortedList becomes inactive
      const batch2Tx = await guildRegistry.batchUpdateMembersActivity(sortedMembers.slice(0, 1), [0]);
      await batch2Tx.wait();

      await expect(guildRegistry.updateSplits(members, splitDistributorFee)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__MemberListSizeMismatch",
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

      const { _recipients, _allocations } = await guildRegistry.calculate(sortedMembers);

      // fetch last calculated contributions on registry
      const contributions = await Promise.all(
        newMembers.map(async (member: Member) => await guildRegistry["calculateContributionOf"](member.account)),
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

      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      const txUpdate = await guildRegistry.updateSecondsActive(0);
      await txUpdate.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      const { _recipients, _allocations } = await guildRegistry.calculate(sortedMembers);

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

      expect(_recipients).to.be.eql(activeMembers.map((m: Member) => m.account));
      expect(_allocations).to.be.eql(calculatedAllocations);
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
      const { _recipients, _allocations } = await guildRegistry.calculate(members);
      const splitHash = hashSplitV2(_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee);

      const tx = await guildRegistry.updateSplits(members, splitDistributorFee);

      await expect(tx)
        .to.emit(l1SplitWalletV2, "SplitUpdated")
        .withArgs((value: any) => {
          expect(value).to.deep.equal([_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee]);
          return true;
        });
      await expect(tx)
        .to.emit(guildRegistry, "SplitsDistributionUpdated")
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
      const batch1Tx = await guildRegistry.batchNewMembers(members, activityMultipliers, startDates);
      await batch1Tx.wait();

      newMembers.sort((a: Member, b: Member) => (a.account.toLowerCase() > b.account.toLowerCase() ? 1 : -1));
      const sortedMembers = newMembers.map((m: Member) => m.account);

      await time.increase(3600 * 24 * 30); // next block in 30 days
      const updateTx = await guildRegistry.updateSecondsActive(0);
      await updateTx.wait();

      await expect(
        guildRegistry.updateAll(
          0,
          sortedMembers.map(() => sortedMembers[0]),
          splitDistributorFee,
        ),
      ).to.be.revertedWithCustomError(l1CalculatorLibrary, "SplitDistribution__AccountsOutOfOrderOrInvalid");

      // first member in sortedList becomes inactive
      const batch2Tx = await guildRegistry.batchUpdateMembersActivity(sortedMembers.slice(0, 1), [0]);
      await batch2Tx.wait();

      await time.increase(3600 * 24 * 30); // next block in 30 days

      await expect(guildRegistry.updateAll(0, members, splitDistributorFee)).to.be.revertedWithCustomError(
        l1CalculatorLibrary,
        "SplitDistribution__MemberListSizeMismatch",
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
      const { _recipients, _allocations } = await guildRegistry.calculate(members);
      const splitHash = hashSplitV2(_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee);

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

      await expect(tx)
        .to.emit(l1SplitWalletV2, "SplitUpdated")
        .withArgs((value: any) => {
          expect(value).to.deep.equal([_recipients, _allocations, PERCENTAGE_SCALE, splitDistributorFee]);
          return true;
        });
      await expect(tx)
        .to.emit(guildRegistry, "SplitsDistributionUpdated")
        .withArgs(l1SplitV2Address, splitHash, splitDistributorFee);
      expect(await l1SplitWalletV2.splitHash()).to.equal(splitHash);
    });
  });

  // ##########################################################################################################
  // #################################                    #####################################################
  // #################################    GuildRegistry   #####################################################
  // #################################       Getters      #####################################################
  // ##########################################################################################################
  // ##########################################################################################################
  // ##########################################################################################################

  describe("GuildRegistryV2 getters", function () {
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

  describe("GuildRegistryV2 UUPS Upgradeability", function () {
    let newRegistryImplementation: GuildRegistryV21Mock;

    beforeEach(async () => {
      const { deployer } = await getNamedAccounts();
      const signer = await ethers.getSigner(deployer);
      const implDeployed = await deployments.deploy("GuildRegistryV21Mock", {
        contract: "GuildRegistryV21Mock",
        from: deployer,
        args: [],
        libraries: {
          PGContribCalculator: l1CalculatorLibrary.address,
        },
        log: true,
      });
      newRegistryImplementation = await ethers.getContractAt("GuildRegistryV21Mock", implDeployed.address, signer);
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
        ["address", "address"],
        [l1SplitV2Address, users.owner.address],
      );

      const calldata = newRegistryImplementation.interface.encodeFunctionData("initialize", [initializationParams]);

      const tx = await guildRegistry.upgradeToAndCall(newRegistryImplementation.address, calldata);
      await tx.wait();

      await expect(tx).to.emit(guildRegistry, "Upgraded").withArgs(newRegistryImplementation.address);
      await expect(tx).to.emit(guildRegistry, "Initialized").withArgs(2);
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
      const registryV1Address = await summonGuildRegistryProxy(
        l1CalculatorLibrary.address,
        {
          splitMain: l1SplitV1Main.address,
          split: l1SplitAddress,
          owner: users.owner.address,
        },
        "GuildRegistryV1",
      );
      const guildRegistryV1 = (await ethers.getContractAt("GuildRegistry", registryV1Address, signer)) as GuildRegistry;

      // Registry V2
      const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "address"],
        [l1SplitV2Address, users.owner.address],
      );

      const calldata = newRegistryImplementation.interface.encodeFunctionData("initialize", [initializationParams]);

      const tx = await guildRegistryV1.upgradeToAndCall(newRegistryImplementation.address, calldata);
      await tx.wait();

      await expect(tx).to.emit(guildRegistryV1, "Upgraded").withArgs(newRegistryImplementation.address);
      await expect(tx).to.emit(guildRegistryV1, "Initialized").withArgs(2);
      expect(await guildRegistryV1.split()).to.be.equal(l1SplitV2Address);
    });
  });
});
