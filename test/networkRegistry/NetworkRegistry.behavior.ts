import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, getUnnamedAccounts } from "hardhat";

import { PERCENTAGE_SCALE } from "../../constants";
import { SampleSplit, readSampleSplit } from "../../src/utils";
import { ConnextMock, NetworkRegistry, NetworkRegistrySummoner, SplitMain, TestERC20 } from "../../types";
import { deploySplit, hashSplit, summonRegistry } from "../utils";
import { NetworkRegistryProps, User, acceptNetworkSplitControl, registryFixture } from "./NetworkRegistry.fixture";

describe("NetworkRegistry E2E tests", function () {
  let summoner: NetworkRegistrySummoner;
  let registrySingleton: NetworkRegistry;
  // let registryShamanSingleton: NetworkRegistryShaman;
  let connext: ConnextMock;
  let l1SplitMain: SplitMain;
  let l1SplitAddress: string;
  let l2Registry: NetworkRegistryProps;
  let l2SplitAddress: string;
  let users: { [key: string]: User };
  let members: Array<string>;
  const splitConfig = {
    percentAllocations: [500_000, 500_000],
    distributorFee: 0,
  };

  const parentDomainId = 6648936;
  const replicaChainId = 10;
  const replicaDomainId = 1869640809;

  let l1NetworkRegistry: NetworkRegistry;
  let l2NetworkRegistry: NetworkRegistry;

  let l1Token: TestERC20;

  const defaultRelayerFee = ethers.utils.parseEther("0.001");

  // NOTICE: 1 token extra as 0xSplits always leave dust token balance for gas efficiency
  const initialSplitDeposit = ethers.utils.parseEther(Number(20_000_000).toString()).add(BigNumber.from(1));

  let sampleSplit: SampleSplit[];

  const CUTOFF_DATE = Date.parse("01 Jul 2023") / 1000;

  this.beforeAll(async function () {
    sampleSplit = await readSampleSplit("pgsplit.csv");
    // NOTICE: set the block timestamp to a month before cutoff date
    await time.setNextBlockTimestamp(Date.parse("01 Jun 2023") / 1000);
  });

  beforeEach(async function () {
    const setup = await registryFixture({});
    summoner = setup.summoner;
    registrySingleton = setup.pgRegistrySingleton;
    // registryShamanSingleton = setup.pgRegistryShamanSingleton;
    l1Token = setup.token;
    connext = setup.connext;
    l1SplitMain = setup.splitMain;
    l2Registry = setup.l2;
    users = setup.users;

    const signer = await ethers.getSigner(users.owner.address);
    const accounts = await getUnnamedAccounts();
    members = accounts.slice(0, splitConfig.percentAllocations.length);

    // Deploy Split on L1
    l1SplitAddress = await deploySplit(
      l1SplitMain,
      members,
      splitConfig.percentAllocations,
      splitConfig.distributorFee,
      users.owner.address,
    );

    // Deposit funds to Split
    const l1DepositTx = await l1Token.transfer(l1SplitAddress, initialSplitDeposit);
    await l1DepositTx.wait();

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
      "Mainnet Registry",
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

    // Deposit funds to Split
    const l2DepositTx = await l2Registry.token.transfer(l2SplitAddress, initialSplitDeposit);
    await l2DepositTx.wait();

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
    await acceptNetworkSplitControl({
      l1NetworkRegistry,
      chainIds: [replicaChainId],
      relayerFees: [defaultRelayerFee],
    });
  });

  describe("0xSplit + NetworkRegistry", function () {
    beforeEach(async function () {
      // Syncing a batch of members
      const newMmembers = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.address);
      const activityMultipliers = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.activityMultiplier);
      const startDates = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.startDateSeconds);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const batchTx = await l1NetworkRegistry.syncBatchNewMember(
        newMmembers,
        activityMultipliers,
        startDates,
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      await batchTx.wait();
      // const blockNo = await time.latestBlock();
      // console.log('block timestamp', (await ethers.provider.getBlock(blockNo)).timestamp);
    });

    it("Should sync update seconds active and update splits prior distribution", async () => {
      const memberList = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.address);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));
      const splitDistributorFee = splitConfig.distributorFee;

      // Jump the cut-off date
      await time.setNextBlockTimestamp(CUTOFF_DATE);

      // Update seconds active across registries
      const txUpdate = await l1NetworkRegistry.syncUpdateSecondsActive(chainIds, relayerFees, { value: totalValue });
      await txUpdate.wait();

      // member list must be sorted
      memberList.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));

      // Validate member's activity
      const expectedSecondsActive = memberList.map((member: string) => {
        const split = sampleSplit.find((split: SampleSplit) => split.address === member);
        return split ? (split.secondsActive * split.activityMultiplier) / 100 : 0;
      });
      const l1SecondsActive = await Promise.all(
        memberList.map(
          async (memberAddress: string) => (await l1NetworkRegistry.getMember(memberAddress)).secondsActive,
        ),
      );
      const l2SecondsActive = await Promise.all(
        memberList.map(
          async (memberAddress: string) => (await l2NetworkRegistry.getMember(memberAddress)).secondsActive,
        ),
      );
      expect(expectedSecondsActive).to.eql(l1SecondsActive);
      expect(expectedSecondsActive).to.eql(l2SecondsActive);

      // Update 0xSplit across registries
      const txSplits = await l1NetworkRegistry.syncUpdateSplits(
        memberList,
        splitDistributorFee,
        chainIds,
        relayerFees,
        { value: totalValue },
      );
      await txSplits.wait();

      // Fetch split data from registries
      const l1Splits = await l1NetworkRegistry.calculate(memberList);
      const l2Splits = await l2NetworkRegistry.calculate(memberList);

      // Verify latest 0xSplit hash
      const l1SplitHash = hashSplit(l1Splits._receivers, l1Splits._percentAllocations, splitDistributorFee);
      const l2SplitHash = hashSplit(l2Splits._receivers, l2Splits._percentAllocations, splitDistributorFee);

      expect(await l1SplitMain.getHash(l1SplitAddress)).to.be.equal(l1SplitHash);
      expect(await l2Registry.splitMain.getHash(l2SplitAddress)).to.be.equal(l2SplitHash);

      // Validate qualified receivers
      const expectedRecipients = memberList
        .map((member: string) => sampleSplit.find((split: SampleSplit) => split.address === member))
        // NOTICE: get active recipients only
        .filter((split?: SampleSplit) => (split ? (split.secondsActive * split.activityMultiplier) / 100 : 0) > 0)
        .map((split?: SampleSplit) => split?.address);

      expect(expectedRecipients).to.eql(l1Splits._receivers);
      expect(expectedRecipients).to.eql(l2Splits._receivers);

      // Validate member's percent allocation
      const calcContributions = await Promise.all(
        l1Splits._receivers.map(async (member: string) => await l1NetworkRegistry["calculateContributionOf"](member)),
      );
      const totalContributions = await l1NetworkRegistry.calculateTotalContributions();

      const expectedAllocations = calcContributions.map((c: BigNumber) =>
        c.mul(PERCENTAGE_SCALE).div(totalContributions).toNumber(),
      );
      const runningTotal = expectedAllocations.reduce((a: number, b: number) => a + b, 0);
      // NOTICE: dust (remainder) should be added to the first member en the ordered list
      expectedAllocations[0] = expectedAllocations[0] + PERCENTAGE_SCALE.sub(runningTotal).toNumber();

      expect(expectedAllocations).to.eql(l1Splits._percentAllocations);
      expect(expectedAllocations).to.eql(l2Splits._percentAllocations);

      // Trigger 0xSplit distribution (permissionless) acros networks
      const distributeL1Tx = await l1SplitMain.distributeERC20(
        l1SplitAddress,
        l1Token.address,
        l1Splits._receivers,
        l1Splits._percentAllocations,
        splitDistributorFee,
        ethers.constants.AddressZero,
      );

      await distributeL1Tx.wait();

      await expect(distributeL1Tx)
        .to.emit(l1SplitMain, "DistributeERC20")
        .withArgs(
          l1SplitAddress,
          l1Token.address,
          initialSplitDeposit.sub(BigNumber.from(1)), // NOTICE: subtract dust balance
          ethers.constants.AddressZero,
        );

      const distributeL2Tx = await l2Registry.splitMain.distributeERC20(
        l2SplitAddress,
        l2Registry.token.address,
        l2Splits._receivers,
        l2Splits._percentAllocations,
        splitDistributorFee,
        ethers.constants.AddressZero,
      );

      await distributeL2Tx.wait();
      await expect(distributeL2Tx)
        .to.emit(l2Registry.splitMain, "DistributeERC20")
        .withArgs(
          l2SplitAddress,
          l2Registry.token.address,
          initialSplitDeposit.sub(BigNumber.from(1)), // NOTICE: subtract dust balance
          ethers.constants.AddressZero,
        );

      // Validate member's balance
      const expectedBalances = await Promise.all(
        l1Splits._percentAllocations.map((allocation: number) =>
          initialSplitDeposit.mul(allocation).div(PERCENTAGE_SCALE),
        ),
      );
      const l1Balances = await Promise.all(
        memberList.map(
          async (memberAddress: string) => await l1SplitMain.getERC20Balance(memberAddress, l1Token.address),
        ),
      );
      const l2Balances = await Promise.all(
        memberList.map(
          async (memberAddress: string) =>
            await l2Registry.splitMain.getERC20Balance(memberAddress, l2Registry.token.address),
        ),
      );

      expect(expectedBalances).to.eql(l1Balances);
      expect(expectedBalances).to.eql(l2Balances);
    });

    it("Should sync update all prior distribution", async () => {
      const memberList = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.address);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));
      const splitDistributorFee = splitConfig.distributorFee;

      // Jump the cut-off date
      await time.setNextBlockTimestamp(CUTOFF_DATE);

      // member list must be sorted
      memberList.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));

      // Update seconds active across registries
      const txSplits = await l1NetworkRegistry.syncUpdateAll(memberList, splitDistributorFee, chainIds, relayerFees, {
        value: totalValue,
      });
      await txSplits.wait();

      // Validate member's activity
      const expectedSecondsActive = memberList.map((member: string) => {
        const split = sampleSplit.find((split: SampleSplit) => split.address === member);
        return split ? (split.secondsActive * split.activityMultiplier) / 100 : 0;
      });
      const l1SecondsActive = await Promise.all(
        memberList.map(
          async (memberAddress: string) => (await l1NetworkRegistry.getMember(memberAddress)).secondsActive,
        ),
      );
      const l2SecondsActive = await Promise.all(
        memberList.map(
          async (memberAddress: string) => (await l2NetworkRegistry.getMember(memberAddress)).secondsActive,
        ),
      );
      expect(expectedSecondsActive).to.eql(l1SecondsActive);
      expect(expectedSecondsActive).to.eql(l2SecondsActive);

      // Fetch split data from registries
      const l1Splits = await l1NetworkRegistry.calculate(memberList);
      const l2Splits = await l2NetworkRegistry.calculate(memberList);

      // Verify latest 0xSplit hash
      const l1SplitHash = hashSplit(l1Splits._receivers, l1Splits._percentAllocations, splitDistributorFee);
      const l2SplitHash = hashSplit(l2Splits._receivers, l2Splits._percentAllocations, splitDistributorFee);

      expect(await l1SplitMain.getHash(l1SplitAddress)).to.be.equal(l1SplitHash);
      expect(await l2Registry.splitMain.getHash(l2SplitAddress)).to.be.equal(l2SplitHash);

      // Validate qualified receivers
      const expectedRecipients = memberList
        .map((member: string) => sampleSplit.find((split: SampleSplit) => split.address === member))
        // NOTICE: get active recipients only
        .filter((split?: SampleSplit) => (split ? (split.secondsActive * split.activityMultiplier) / 100 : 0) > 0)
        .map((split?: SampleSplit) => split?.address);

      expect(expectedRecipients).to.eql(l1Splits._receivers);
      expect(expectedRecipients).to.eql(l2Splits._receivers);

      // Validate member's percent allocation
      const calcContributions = await Promise.all(
        l1Splits._receivers.map(async (member: string) => await l1NetworkRegistry["calculateContributionOf"](member)),
      );
      const totalContributions = await l1NetworkRegistry.calculateTotalContributions();

      const expectedAllocations = calcContributions.map((c: BigNumber) =>
        c.mul(PERCENTAGE_SCALE).div(totalContributions).toNumber(),
      );
      const runningTotal = expectedAllocations.reduce((a: number, b: number) => a + b, 0);
      // NOTICE: dust (remainder) should be added to the first member en the ordered list
      expectedAllocations[0] = expectedAllocations[0] + PERCENTAGE_SCALE.sub(runningTotal).toNumber();

      expect(expectedAllocations).to.eql(l1Splits._percentAllocations);
      expect(expectedAllocations).to.eql(l2Splits._percentAllocations);

      // Trigger 0xSplit distribution (permissionless) acros networks
      const distributeL1Tx = await l1SplitMain.distributeERC20(
        l1SplitAddress,
        l1Token.address,
        l1Splits._receivers,
        l1Splits._percentAllocations,
        splitDistributorFee,
        ethers.constants.AddressZero,
      );

      await distributeL1Tx.wait();

      await expect(distributeL1Tx)
        .to.emit(l1SplitMain, "DistributeERC20")
        .withArgs(
          l1SplitAddress,
          l1Token.address,
          initialSplitDeposit.sub(BigNumber.from(1)), // NOTICE: subtract dust balance
          ethers.constants.AddressZero,
        );

      const distributeL2Tx = await l2Registry.splitMain.distributeERC20(
        l2SplitAddress,
        l2Registry.token.address,
        l2Splits._receivers,
        l2Splits._percentAllocations,
        splitDistributorFee,
        ethers.constants.AddressZero,
      );

      await distributeL2Tx.wait();
      await expect(distributeL2Tx)
        .to.emit(l2Registry.splitMain, "DistributeERC20")
        .withArgs(
          l2SplitAddress,
          l2Registry.token.address,
          initialSplitDeposit.sub(BigNumber.from(1)), // NOTICE: subtract dust balance
          ethers.constants.AddressZero,
        );

      // Validate member's balance
      const expectedBalances = await Promise.all(
        l1Splits._percentAllocations.map((allocation: number) =>
          initialSplitDeposit.mul(allocation).div(PERCENTAGE_SCALE),
        ),
      );
      const l1Balances = await Promise.all(
        memberList.map(
          async (memberAddress: string) => await l1SplitMain.getERC20Balance(memberAddress, l1Token.address),
        ),
      );
      const l2Balances = await Promise.all(
        memberList.map(
          async (memberAddress: string) =>
            await l2Registry.splitMain.getERC20Balance(memberAddress, l2Registry.token.address),
        ),
      );

      expect(expectedBalances).to.eql(l1Balances);
      expect(expectedBalances).to.eql(l2Balances);
    });
  });
});
