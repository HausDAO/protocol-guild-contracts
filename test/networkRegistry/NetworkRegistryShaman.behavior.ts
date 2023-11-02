import { Baal, MultiSend, Shares } from "@daohaus/baal-contracts";
import { ProposalType, baalSetup, encodeMultiAction } from "@daohaus/baal-contracts";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers, getUnnamedAccounts, network } from "hardhat";

import { PERCENTAGE_SCALE } from "../../constants";
import { SampleSplit, readSampleSplit } from "../../src/utils";
import {
  ConnextMock,
  GnosisSafe,
  NetworkRegistry,
  NetworkRegistryShaman,
  NetworkRegistrySummoner,
  SplitMain,
  TestERC20,
} from "../../types";
import { deploySplit, hashSplit, summonRegistry, summonRegistryShaman } from "../utils";
// TODO: this should be fixed in the baal-contracts repo
import { defaultDAOSettings, submitAndProcessProposal } from "../utils";
import { NetworkRegistryProps, User, registryFixture } from "./NetworkRegistry.fixture";

describe("NetworkRegistryShaman E2E tests", function () {
  let baal: Baal;
  let daoSafe: GnosisSafe;
  let sharesToken: Shares;
  let multisend: MultiSend;

  const proposal: ProposalType = {
    flag: 0,
    data: "0x",
    details: "test proposal",
    expiration: 0,
    baalGas: 0,
  };

  let summoner: NetworkRegistrySummoner;
  let registrySingleton: NetworkRegistry;
  let registryShamanSingleton: NetworkRegistryShaman;
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

  let l1NetworkRegistry: NetworkRegistryShaman;
  let l2NetworkRegistry: NetworkRegistry;

  let l1Token: TestERC20;

  const defaultRelayerFee = ethers.utils.parseEther("0.001");

  // NOTICE: 1 token extra as 0xSplits always leave dust token balance for gas efficiency
  const initialSplitDeposit = ethers.utils.parseEther(Number(20_000_000).toString()).add(BigNumber.from(1));

  let sampleSplit: SampleSplit[];

  const CUTOFF_DATE = Date.parse("01 Jul 2023") / 1000;

  this.beforeAll(async function () {
    sampleSplit = await readSampleSplit("pgsplit.csv");
    // NOTICE: reset network
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });

  beforeEach(async function () {
    let encodedAction: string;

    const setup = await registryFixture({});
    summoner = setup.summoner;
    registrySingleton = setup.pgRegistrySingleton;
    registryShamanSingleton = setup.pgRegistryShamanSingleton;
    l1Token = setup.token;
    connext = setup.connext;
    l1SplitMain = setup.splitMain;
    l2Registry = setup.l2;
    users = setup.users;

    // MUST run after registryFixture due to how chain snaphost works on hardhat
    const setupBaal = await baalSetup({
      daoSettings: defaultDAOSettings,
    });
    baal = setupBaal.Baal;
    daoSafe = setupBaal.GnosisSafe;
    sharesToken = setupBaal.Shares;
    multisend = setupBaal.MultiSend;

    const signer = await ethers.getSigner(users.owner.address);
    const accounts = await getUnnamedAccounts();
    members = accounts.slice(0, splitConfig.percentAllocations.length);

    // NOTICE: Fund the DAO Safe so it can pay for relayer fees
    await signer.sendTransaction({
      to: daoSafe.address,
      data: "0x",
      value: parseEther("1"),
    });
    expect(await ethers.provider.getBalance(daoSafe.address)).to.be.equal(parseEther("1"));

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
    const l1RegistryAddress = await summonRegistryShaman(
      summoner,
      registryShamanSingleton.address,
      {
        connext: connext.address,
        updaterDomainId: 0, // Main Registry -> no domainId
        updaterAddress: ethers.constants.AddressZero, // Main Registry -> no updater
        splitMain: l1SplitMain.address,
        split: l1SplitAddress,
        baal: baal.address, // NOTICE: DAO address sent so internally set the baal avatar as registry owner
        sharesToMint: parseEther("1"), // NOTICE: DAO shares to mint to new registry members
        burnShares: true, // NOTICE: burn shares if activity multiplier is set to zero
      },
      "Mainnet Registry",
    );
    l1NetworkRegistry = (await ethers.getContractAt(
      "NetworkRegistryShaman",
      l1RegistryAddress,
      signer,
    )) as NetworkRegistryShaman;

    // NOTICE: Registry owner is Baal Avatar
    expect(await l1NetworkRegistry.owner()).to.be.equal(await baal.avatar());

    // NOTICE: DAO set registry as Manager Shaman
    const managerShamanEncoded = baal.interface.encodeFunctionData("setShamans", [[l1RegistryAddress], ["2"]]);
    encodedAction = encodeMultiAction(multisend, [managerShamanEncoded], [baal.address], [BigNumber.from(0)], [0]);
    const tx_set_manager = await submitAndProcessProposal({
      baal,
      encodedAction,
      proposal,
      daoSettings: defaultDAOSettings,
    });
    await tx_set_manager.wait();
    await expect(tx_set_manager).to.emit(baal, "ShamanSet").withArgs(l1RegistryAddress, "2");

    // Transfer Split control to L1 NetworkRegistry
    const tx_controller_l1 = await l1SplitMain.transferControl(l1SplitAddress, l1RegistryAddress);
    await tx_controller_l1.wait();

    // NOTICE: DAO Submit proposal to accept control
    const acceptControlEncoded = l1NetworkRegistry.interface.encodeFunctionData("acceptSplitControl");
    encodedAction = encodeMultiAction(
      multisend,
      [acceptControlEncoded],
      [l1NetworkRegistry.address],
      [BigNumber.from(0)],
      [0],
    );
    const tx_accept_control = await submitAndProcessProposal({
      baal,
      encodedAction,
      proposal,
      daoSettings: defaultDAOSettings,
    });
    await tx_accept_control.wait();
    await expect(tx_accept_control)
      .to.emit(l1SplitMain, "ControlTransfer")
      .withArgs(l1SplitAddress, users.owner.address, l1RegistryAddress);

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

    // Transfer Split control to L2 NetworkRegistry
    const tx_controller_l2 = await l2Registry.splitMain.transferControl(l2SplitAddress, l2RegistryAddress);
    await tx_controller_l2.wait();

    // NOTICE: DAO action proposal to add replica to main registry
    const networkRegistry = {
      domainId: replicaDomainId,
      registryAddress: l2NetworkRegistry.address,
      delegate: ethers.constants.AddressZero,
    };
    const updateNetworkEncoded = l1NetworkRegistry.interface.encodeFunctionData("updateNetworkRegistry", [
      replicaChainId,
      networkRegistry,
    ]);

    // NOTICE: DAO action proposal to accept Split Control at Replica
    const chainIds = [replicaChainId];
    const relayerFees = [defaultRelayerFee];
    const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));
    const acceptNetworkEncoded = l1NetworkRegistry.interface.encodeFunctionData("acceptNetworkSplitControl", [
      chainIds,
      relayerFees,
    ]);

    // NOTICE: batch both proposal actions
    encodedAction = encodeMultiAction(
      multisend,
      [updateNetworkEncoded, acceptNetworkEncoded],
      [l1NetworkRegistry.address, l1NetworkRegistry.address],
      [BigNumber.from(0), totalValue],
      [0, 0],
    );
    const tx = await submitAndProcessProposal({
      baal,
      encodedAction,
      proposal,
      daoSettings: defaultDAOSettings,
    });
    await tx.wait();
    const action = l2NetworkRegistry.interface.getSighash("acceptSplitControl");
    await expect(tx)
      .to.emit(l1NetworkRegistry, "NetworkRegistryUpdated")
      .withArgs(replicaChainId, networkRegistry.registryAddress, networkRegistry.domainId, networkRegistry.delegate);
    await expect(tx)
      .to.emit(l2NetworkRegistry, "SyncActionPerformed")
      .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);
  });

  describe("0xSplit + NetworkRegistryShaman", function () {
    const batchSize = 113; // NOTICE: max amount of members to be process befor hitting the max block gas limit

    beforeEach(async function () {
      // Syncing a batch of members
      const newMembers = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.address);
      const activityMultipliers = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.activityMultiplier);
      const startDates = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.startDateSeconds);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      // NOTICE: set the block timestamp to a month before cutoff date
      await time.setNextBlockTimestamp(
        Date.parse("01 Jun 2023") / 1000 -
          defaultDAOSettings.VOTING_PERIOD_IN_SECONDS * 2 - // voting + grace period before execution
          3, // 3 actions / second - submit proposal -> vote -> execute
      );

      // NOTICE: Register a new batch of members via the DAO. Just a subset at it will hit the block gas limit
      let newBatchEncoded = l1NetworkRegistry.interface.encodeFunctionData("syncBatchNewMember", [
        newMembers.slice(0, batchSize),
        activityMultipliers.slice(0, batchSize),
        startDates.slice(0, batchSize),
        chainIds,
        relayerFees,
      ]);

      let encodedAction = encodeMultiAction(
        multisend,
        [newBatchEncoded],
        [l1NetworkRegistry.address],
        [totalValue],
        [0],
      );
      const tx_batch1 = await submitAndProcessProposal({
        baal,
        encodedAction,
        proposal,
        daoSettings: defaultDAOSettings,
      });
      await tx_batch1.wait();
      // for (let i = 0; i < batchSize; i++) {
      //   await expect(tx_batch1).to.emit(sharesToken, 'Transfer').withArgs(ethers.constants.AddressZero, newMembers[i], parseEther("1"));
      // }
      const action = l2NetworkRegistry.interface.getSighash("batchNewMember(address[],uint32[],uint32[])");
      await expect(tx_batch1)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      // NOTICE: Register a 2nd batch of members via the DAO.
      newBatchEncoded = l1NetworkRegistry.interface.encodeFunctionData("syncBatchNewMember", [
        newMembers.slice(batchSize),
        activityMultipliers.slice(batchSize),
        startDates.slice(batchSize),
        chainIds,
        relayerFees,
      ]);

      encodedAction = encodeMultiAction(multisend, [newBatchEncoded], [l1NetworkRegistry.address], [totalValue], [0]);
      const tx_batch2 = await submitAndProcessProposal({
        baal,
        encodedAction,
        proposal,
        daoSettings: defaultDAOSettings,
      });
      await tx_batch2.wait();
      // for (let i = batchSize; i < newMembers.length; i++) {
      //   await expect(tx_batch2).to.emit(sharesToken, 'Transfer').withArgs(ethers.constants.AddressZero, newMembers[i], parseEther("1"));
      // }
      await expect(tx_batch2)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      // const blockNo = await time.latestBlock();
      // console.log('block timestamp', (await ethers.provider.getBlock(blockNo)).timestamp);
    });

    it("Should have everything setup", async () => {
      expect(await l1NetworkRegistry.owner()).to.be.equal(daoSafe.address);
      expect(await l2NetworkRegistry.owner()).to.be.equal(ethers.constants.AddressZero);
      expect(await l1SplitMain.getController(l1SplitAddress)).to.be.equal(l1NetworkRegistry.address);
      expect(await l2Registry.splitMain.getController(l2SplitAddress)).to.be.equal(l2NetworkRegistry.address);
      expect(await l1NetworkRegistry.replicaRegistry(replicaChainId)).to.have.ordered.members([
        replicaDomainId,
        l2NetworkRegistry.address,
        ethers.constants.AddressZero,
      ]);
      expect(await ethers.provider.getBalance(l1NetworkRegistry.address)).to.be.equal(BigNumber.from(0));

      const newMembers = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.address);
      for (let i = 0; i < newMembers.length; i++) {
        expect(await sharesToken.balanceOf(newMembers[i])).to.be.equal(parseEther("1"));
      }
    });

    it("Should be able to update Shaman settings through the dao", async () => {
      const sharesToMint = 100;
      const burnShares = false;
      const batchEncoded = l1NetworkRegistry.interface.encodeFunctionData("setShamanConfig", [
        sharesToMint,
        burnShares,
      ]);

      const encodedAction = encodeMultiAction(
        multisend,
        [batchEncoded],
        [l1NetworkRegistry.address],
        [BigNumber.from(0)],
        [0],
      );
      const tx_batch = await submitAndProcessProposal({
        baal,
        encodedAction,
        proposal,
        daoSettings: defaultDAOSettings,
      });
      await tx_batch.wait();
      await expect(tx_batch).to.emit(l1NetworkRegistry, "ShamanConfigUpdated").withArgs(sharesToMint, burnShares);
    });

    it("Should sync update seconds active and update splits prior distribution", async () => {
      let encodedAction: string;
      let action: string;
      const memberList = sampleSplit.map((memberSplit: SampleSplit) => memberSplit.address);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));
      const splitDistributorFee = splitConfig.distributorFee;

      // Jump the cut-off date
      await time.setNextBlockTimestamp(
        CUTOFF_DATE -
          defaultDAOSettings.VOTING_PERIOD_IN_SECONDS * 2 - // voting + grace period before execution
          3, // 3 actions / second - submit proposal -> vote -> execute
      );

      // NOtICE: DAO updates seconds active across registries
      const updateSecsEncoded = l1NetworkRegistry.interface.encodeFunctionData("syncUpdateSecondsActive", [
        chainIds,
        relayerFees,
      ]);
      encodedAction = encodeMultiAction(multisend, [updateSecsEncoded], [l1NetworkRegistry.address], [totalValue], [0]);
      const tx_update_secs = await submitAndProcessProposal({
        baal,
        encodedAction,
        proposal,
        daoSettings: defaultDAOSettings,
      });
      action = l2NetworkRegistry.interface.getSighash("updateSecondsActive");
      await expect(tx_update_secs)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

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

      // NOTICE: DAO updates 0xSplit across registries
      const updateSplitsEncoded = l1NetworkRegistry.interface.encodeFunctionData("syncUpdateSplits", [
        memberList,
        splitDistributorFee,
        chainIds,
        relayerFees,
      ]);
      encodedAction = encodeMultiAction(
        multisend,
        [updateSplitsEncoded],
        [l1NetworkRegistry.address],
        [totalValue],
        [0],
      );
      const tx_update_splits = await submitAndProcessProposal({
        baal,
        encodedAction,
        proposal,
        daoSettings: defaultDAOSettings,
      });
      action = l2NetworkRegistry.interface.getSighash("updateSplits(address[],uint32)");
      await expect(tx_update_splits)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

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
      await time.setNextBlockTimestamp(
        CUTOFF_DATE -
          defaultDAOSettings.VOTING_PERIOD_IN_SECONDS * 2 - // voting + grace period before execution
          3, // 3 actions / second - submit proposal -> vote -> execute
      );

      // member list must be sorted
      memberList.sort((a: string, b: string) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));

      // Update seconds active across registries
      // const txSplits = await l1NetworkRegistry.syncUpdateAll(memberList, splitDistributorFee, chainIds, relayerFees, { value: totalValue });
      // await txSplits.wait();
      const updateAllEncoded = l1NetworkRegistry.interface.encodeFunctionData("syncUpdateAll", [
        memberList,
        splitDistributorFee,
        chainIds,
        relayerFees,
      ]);
      const encodedAction = encodeMultiAction(
        multisend,
        [updateAllEncoded],
        [l1NetworkRegistry.address],
        [totalValue],
        [0],
      );
      const tx_update_all = await submitAndProcessProposal({
        baal,
        encodedAction,
        proposal,
        daoSettings: defaultDAOSettings,
      });
      const action = l2NetworkRegistry.interface.getSighash("updateAll");
      await expect(tx_update_all)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

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

    it("Should burn shares if a member's activeMultiplier is set to zero", async () => {
      // Syncing a batch of members
      const members = sampleSplit.slice(0, 2).map((memberSplit: SampleSplit) => memberSplit.address);
      const activityMultipliers = members.map((_, idx: number) => (idx % 2) * 50);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const batchEncoded = l1NetworkRegistry.interface.encodeFunctionData("syncBatchUpdateMember", [
        members,
        activityMultipliers,
        chainIds,
        relayerFees,
      ]);

      const encodedAction = encodeMultiAction(
        multisend,
        [batchEncoded],
        [l1NetworkRegistry.address],
        [totalValue],
        [0],
      );
      const tx_batch = await submitAndProcessProposal({
        baal,
        encodedAction,
        proposal,
        daoSettings: defaultDAOSettings,
      });
      await tx_batch.wait();
      const action = l2NetworkRegistry.interface.getSighash("batchUpdateMember(address[],uint32[])");
      await expect(tx_batch)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      for (let i = 0; i < members.length; i++) {
        if (i % 2 === 0) {
          await expect(tx_batch)
            .to.emit(sharesToken, "Transfer")
            .withArgs(members[i], ethers.constants.AddressZero, parseEther("1"));
        }
        expect(await sharesToken.balanceOf(members[i])).to.be.equal(i % 2 === 0 ? BigNumber.from(0) : parseEther("1"));
      }
    });

    it("Should burn and re-issue shares if a member get active again", async () => {
      // Syncing a batch of members
      const members = sampleSplit.slice(0, 2).map((memberSplit: SampleSplit) => memberSplit.address);
      const activityMultipliers = members.map((_, idx: number) => (idx % 2) * 50);
      const activityMultipliersUpdated = members.map(() => 100);
      const chainIds = [replicaChainId];
      const relayerFees = [defaultRelayerFee];
      const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

      const batchEncoded = l1NetworkRegistry.interface.encodeFunctionData("syncBatchUpdateMember", [
        members,
        activityMultipliers,
        chainIds,
        relayerFees,
      ]);

      const encodedAction = encodeMultiAction(
        multisend,
        [batchEncoded],
        [l1NetworkRegistry.address],
        [totalValue],
        [0],
      );
      const tx_batch = await submitAndProcessProposal({
        baal,
        encodedAction,
        proposal,
        daoSettings: defaultDAOSettings,
      });
      await tx_batch.wait();

      const batch2Encoded = l1NetworkRegistry.interface.encodeFunctionData("syncBatchUpdateMember", [
        members,
        activityMultipliersUpdated,
        chainIds,
        relayerFees,
      ]);

      const encodedAction2 = encodeMultiAction(
        multisend,
        [batch2Encoded],
        [l1NetworkRegistry.address],
        [totalValue],
        [0],
      );
      const tx_batch2 = await submitAndProcessProposal({
        baal,
        encodedAction: encodedAction2,
        proposal,
        daoSettings: defaultDAOSettings,
      });
      await tx_batch2.wait();

      const action = l2NetworkRegistry.interface.getSighash("batchUpdateMember(address[],uint32[])");
      await expect(tx_batch2)
        .to.emit(l2NetworkRegistry, "SyncActionPerformed")
        .withArgs(anyValue, parentDomainId, action, true, l1NetworkRegistry.address);

      for (let i = 0; i < members.length; i++) {
        expect(await sharesToken.balanceOf(members[i])).to.be.equal(parseEther("1"));
      }
    });
  });
});
