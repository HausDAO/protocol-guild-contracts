import { ethers, getNamedAccounts, getUnnamedAccounts } from "hardhat";
import { ConnextMock, NetworkRegistrySummoner, NetworkRegistry, NetworkRegistryShaman, SplitMain } from "../../types";
import { NetworkRegistryProps, User, registryFixture } from "./NetworkRegistry.fixture";
import { expect } from "chai";
import { BigNumber } from "ethers";

const deploySplit = async (
    splitMain: SplitMain,
    members: Array<string>,
    percentAllocations: Array<number>,
    distributorFee: number,
    controller: string
) => {
    const tx = await splitMain.createSplit(members, percentAllocations, distributorFee, controller);
    const receipt = await tx.wait();
    const splitAddress = 
        receipt.events?.[0].topics[1] && ethers.utils.defaultAbiCoder.decode(['address'], receipt.events?.[0].topics[1])[0];
    if (!splitAddress) throw new Error('Failed to deploy Split');
    return splitAddress;
}

type NetworkRegistryArgs = {
    connext: string;
    updaterDomainId: number;
    updaterAddress: string;
    splitMain: string;
    split: string;
    distributorFee: number;
    owner: string;
}

const summonRegistry = async (
    summoner: NetworkRegistrySummoner,
    registrySingleton: string,
    registryArgs: NetworkRegistryArgs,
    registryName: string = 'SampleRegistry'
  ) => {
    const { connext, updaterDomainId, updaterAddress, splitMain, split, distributorFee, owner } = registryArgs;
    const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint32', 'address', 'address', 'address', 'uint32', 'address'],
        [connext, updaterDomainId, updaterAddress, splitMain, split, distributorFee, owner]
    );
    // const eventIndex = 2 + Number(registryArgs.renounceOwnership);
    const eventIndex = 3; // NetworkRegistrySummoned

    const tx = await summoner.summonRegistry(registrySingleton, registryName, initializationParams);
    const receipt = await tx.wait();
    // if (!registryArgs.renounceOwnership) {
    //     console.log('events', receipt);
    // }
    const registryAddress =
        receipt.events?.[eventIndex].topics[1] &&
        ethers.utils.defaultAbiCoder.decode(['address'], receipt.events?.[eventIndex].topics[1])[0];
    if (!registryAddress) throw new Error('Failed to summon a Network Registry');
    return registryAddress;
  };

describe("NetworkRegistry", function () {

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
    let newMemberQueue: Array<string>;
    const splitConfig = {
        percentAllocations: [400_000, 300_000, 300_000],
        distributorFee: 0,
    };

    let l1InitializationParams: string;
    let l2InitializationParams: string;

    const parentDomainId = 6648936;
    const replicaChainId = 10;
    const replicaDomainId = 1869640809;

    let l1NetworkRegistry: NetworkRegistry;
    let l2NetworkRegistry: NetworkRegistry;

    const defaultRelayerFee = ethers.utils.parseEther("0.001");


    beforeEach(async function () {
        const setup = await registryFixture({});
        summoner = setup.summoner;
        registrySingleton = setup.pgRegistrySingleton;
        registryShamanSingleton = setup.pgRegistryShamanSingleton;
        connext = setup.connext;
        l1SplitMain = setup.splitMain;
        l2Registry = setup.l2;
        users = setup.users;

        const { deployer } = await getNamedAccounts();
        const signer = await ethers.getSigner(deployer);
        const accounts = await getUnnamedAccounts();
        members = accounts.slice(0, splitConfig.percentAllocations.length);
        newMemberQueue = accounts.slice(splitConfig.percentAllocations.length, 20 + splitConfig.percentAllocations.length);

        l1SplitAddress = await deploySplit(l1SplitMain, members, splitConfig.percentAllocations, splitConfig.distributorFee, deployer);

        l1InitializationParams = ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint32', 'address', 'address', 'address', 'uint32', 'bool'],
            [
                connext.address,
                0, // Main Registry -> no domainId
                ethers.constants.AddressZero, // Main Registry -> no updater
                l1SplitMain.address,
                l1SplitAddress,
                splitConfig.distributorFee, // TODO: do we really need to send it here or during split deployment?
                deployer,
            ]
        );
        const l1RegistryAddress = await summonRegistry(
            summoner,
            registrySingleton.address,
            {
                connext: connext.address,
                updaterDomainId: 0, // Main Registry -> no domainId
                updaterAddress: ethers.constants.AddressZero, // Main Registry -> no updater
                splitMain: l1SplitMain.address,
                split: l1SplitAddress,
                distributorFee: splitConfig.distributorFee, // TODO: do we really need to send it here or during split deployment?
                owner: deployer,
            },
            'Mainnet Registry'
        );
        l1NetworkRegistry = (await ethers.getContractAt('NetworkRegistry', l1RegistryAddress, signer)) as NetworkRegistry;

        
        l2SplitAddress = await deploySplit(l2Registry.splitMain, members, splitConfig.percentAllocations, splitConfig.distributorFee, deployer);
        const l2RegistryAddress = await summonRegistry(
            summoner,
            registrySingleton.address,
            {
                connext: connext.address,
                updaterDomainId: parentDomainId,
                updaterAddress: l1NetworkRegistry.address,
                splitMain: l2Registry.splitMain.address,
                split: l2SplitAddress,
                distributorFee: splitConfig.distributorFee, // TODO: do we really need to send it here or during split deployment?
                owner: ethers.constants.AddressZero, // renounceOwnership 
            },
            'L2 Registry'
        );
        l2NetworkRegistry = (await ethers.getContractAt('NetworkRegistry', l2RegistryAddress, signer)) as NetworkRegistry;

        const networkRegistry = {
            domainId: replicaDomainId,
            registryAddress: l2NetworkRegistry.address,
            delegate: ethers.constants.AddressZero,
        };
        const tx = await l1NetworkRegistry.updateNetworkRegistry(replicaChainId, networkRegistry);
        await tx.wait();
    });

    describe("NetworkRegistrySummoner", function () {

        it("Should not be able to initialize a singleton", async () => {
            expect(registrySingleton.initialize(l1InitializationParams)).to.be.revertedWith('AlreadyInitialized');
            expect(registryShamanSingleton.initialize(l1InitializationParams)).to.be.revertedWith('AlreadyInitialized');
        });

        it("Should summon a PGNetworkRegistry", async () => {
            const { deployer } = await getNamedAccounts();
            const initializationParams = ethers.utils.defaultAbiCoder.encode(
                ['address', 'uint32', 'address', 'address', 'address', 'uint32', 'address'],
                [
                    connext.address, parentDomainId, ethers.constants.AddressZero, l1SplitMain.address,
                    l1SplitAddress, splitConfig.distributorFee,
                    deployer,
                ]
            );

            const details = 'sample registry';
            const tx = await summoner.summonRegistry(registrySingleton.address, details, initializationParams);
            const receipt = await tx.wait();
            const registryAddress = 
                receipt.events?.[3].topics[1] && ethers.utils.hexStripZeros(receipt.events?.[3].topics[1]);
            expect(tx).to.emit(summoner, 'NetworkRegistrySummoned').withArgs(registryAddress, details, initializationParams);
        });

        it("Should summon a PGNetworkRegistry with predetermined address", async () => {
            // TODO: pre-calcute create2 address
        });

        // it("", async () => {
        //     summonRegistry = async (
        //         summoner: NetworkRegistrySummoner,
        //         registrySingleton: string,
        //         registryArgs: NetworkRegistryArgs,
        //         registryName: string = 'SampleRegistry'
        // });
    });

    describe("NetworkRegistry Sync", function () {

        it("Should have registries properly setup", async function () {
            expect(await l1NetworkRegistry.updaterDomain()).to.equal(0);
            expect(await l1NetworkRegistry.updater()).to.equal(ethers.constants.AddressZero);
            expect(await l1NetworkRegistry.isMainRegistry()).to.equal(true);
            expect(await l2NetworkRegistry.updaterDomain()).to.equal(parentDomainId);
            expect(await l2NetworkRegistry.updater()).to.equal(l1NetworkRegistry.address);
            expect(await l2NetworkRegistry.owner()).to.equal(ethers.constants.AddressZero);
            expect(await l2NetworkRegistry.isMainRegistry()).to.equal(false);
            const l2Registry = await l1NetworkRegistry.networkRegistry(replicaChainId);
            expect(l2Registry).to.have.deep.members([ replicaDomainId, l2NetworkRegistry.address, ethers.constants.AddressZero ]);
        });
        
        it("Should sync a new member", async () => {
            const [, , , member] = await getUnnamedAccounts();
            const activityMultiplier = 100;
            const startDate = (new Date().getTime() / 1000).toFixed(0);
            const chainIds = [replicaChainId];
            const relayerFees = [defaultRelayerFee];

            const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

            expect(await l1NetworkRegistry.memberIdxs(member)).to.equal(0);
            expect(await l2NetworkRegistry.memberIdxs(member)).to.equal(0);

            const l1CurrentMemberId = await l1NetworkRegistry.totalMembers();
            const l2CurrentMemberId = await l2NetworkRegistry.totalMembers();

            const syncTx = await l1NetworkRegistry.syncSetNewMember(
                member,
                activityMultiplier,
                startDate,
                chainIds,
                relayerFees,
                { value: totalValue }
            );
            await syncTx.wait();

            const l1Member = await l1NetworkRegistry.members(l1CurrentMemberId);
            const l2Member = await l2NetworkRegistry.members(l2CurrentMemberId);
            expect(l1Member).to.eql(l2Member);
            expect(await l1NetworkRegistry.getMember(member)).to.eql(l1Member);
            expect(await l1NetworkRegistry.totalMembers()).to.equal(1);
            expect(await l2NetworkRegistry.getMember(member)).to.eql(l2Member);
            expect(await l2NetworkRegistry.totalMembers()).to.equal(1);
        });

        // it("", async () => {

        // });

        // it("", async () => {

        // });

    });
});