import { ethers, getNamedAccounts, getUnnamedAccounts } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ConnextMock, NetworkRegistrySummoner, NetworkRegistry, NetworkRegistryShaman, SplitMain } from "../../types";
import { NetworkRegistryProps, User, registryFixture } from "./NetworkRegistry.fixture";
import { expect } from "chai";
import { BigNumber, BigNumberish, Event } from "ethers";

const deploySplit = async (
    splitMain: SplitMain,
    members: Array<string>,
    percentAllocations: Array<number>,
    distributorFee: number,
    controller: string
): Promise<string> => {
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
    // distributorFee: number;
    owner: string;
}

type Member = {
    account: string;
    secondsActive?: BigNumberish;
    startDate: BigNumberish;
    activityMultiplier: BigNumberish;
}

const summonRegistry = async (
    summoner: NetworkRegistrySummoner,
    registrySingleton: string,
    registryArgs: NetworkRegistryArgs,
    registryName: string = 'SampleRegistry'
  ) => {
    const { connext, updaterDomainId, updaterAddress, splitMain, split, owner } = registryArgs;
    const initializationParams = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint32', 'address', 'address', 'address', 'address'],
        [connext, updaterDomainId, updaterAddress, splitMain, split, owner]
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

const generateMemberBatch = async (
    totalMembers: number
): Promise<Array<Member>> => {
    const accounts = await getUnnamedAccounts();
    const members = accounts.slice(0, totalMembers);
    const startDate = (new Date().getTime() / 1000).toFixed(0);
    return members.map((m: string, idx: number) => {
        return {
            account: m,
            activityMultiplier: idx < 3 ? 100 : (idx % 5 === 0 ? 0 : (Math.floor(Math.random() * 100) > 50 ? 100 : 50)),
            startDate,
        }
    });
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

        // const { deployer } = await getNamedAccounts();
        const signer = await ethers.getSigner(users.owner.address);
        const accounts = await getUnnamedAccounts();
        members = accounts.slice(0, splitConfig.percentAllocations.length);
        newMemberQueue = accounts.slice(splitConfig.percentAllocations.length, 20 + splitConfig.percentAllocations.length);

        l1SplitAddress = await deploySplit(l1SplitMain, members, splitConfig.percentAllocations, splitConfig.distributorFee, users.owner.address);

        l1InitializationParams = ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint32', 'address', 'address', 'address', 'bool'],
            [
                connext.address,
                0, // Main Registry -> no domainId
                ethers.constants.AddressZero, // Main Registry -> no updater
                l1SplitMain.address,
                l1SplitAddress,
                // deployer,
                users.owner.address,
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
                // owner: deployer,
                owner: users.owner.address,
            },
            'Mainnet Registry'
        );
        l1NetworkRegistry = (await ethers.getContractAt('NetworkRegistry', l1RegistryAddress, signer)) as NetworkRegistry;

        // Transfer control to L1 NetworkRegistry
        const tx_controller_l1 = await l1SplitMain.transferControl(l1SplitAddress, l1RegistryAddress);
        await tx_controller_l1.wait();
        await l1NetworkRegistry.acceptSplitControl();
        
        l2SplitAddress = await deploySplit(
            l2Registry.splitMain,
            members,
            splitConfig.percentAllocations,
            splitConfig.distributorFee,
            users.owner.address
        );
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
            'L2 Registry'
        );
        l2NetworkRegistry = (await ethers.getContractAt('NetworkRegistry', l2RegistryAddress, signer)) as NetworkRegistry;

        // Transfer control to L2 NetworkRegistry
        const tx_controller_l2 = await l2Registry.splitMain.transferControl(l2SplitAddress, l2RegistryAddress);
        await tx_controller_l2.wait();

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
            // const { deployer } = await getNamedAccounts();
            const initializationParams = ethers.utils.defaultAbiCoder.encode(
                ['address', 'uint32', 'address', 'address', 'address', 'uint32', 'address'],
                [
                    connext.address, parentDomainId, ethers.constants.AddressZero, l1SplitMain.address,
                    l1SplitAddress, splitConfig.distributorFee,
                    // deployer,
                    users.owner.address,
                ]
            );

            const details = 'sample registry';
            const tx = await summoner.summonRegistry(registrySingleton.address, details, initializationParams);
            const receipt = await tx.wait();
            const registryAddress = receipt.events?.[3].topics[1] && 
                ethers.utils.getAddress(`0x${receipt.events?.[3].topics[1].substring(24 + 2)}`);
            await expect(tx).to.emit(summoner, 'NetworkRegistrySummoned').withArgs(registryAddress, details, initializationParams);
        });

        it("Should summon a PGNetworkRegistry with predetermined address", async () => {
            const saltNonce = `0x${Buffer.from(ethers.utils.randomBytes(32)).toString('hex')}`;
            const creationCode = [
                '0x3d602d80600a3d3981f3363d3d373d3d3d363d73',
                registrySingleton.address.replace(/0x/, '').toLowerCase(),
                '5af43d82803e903d91602b57fd5bf3',
            ].join('');

            const predictedAddress = ethers.utils.getAddress(
                `0x${ethers.utils
                    .keccak256(
                        `0x${
                            [
                                'ff',
                                summoner.address,
                                saltNonce,
                                ethers.utils.solidityKeccak256(
                                    ['bytes'],
                                    [creationCode]
                                )
                            ].map(x => x.replace(/0x/, '')).join('')}`
                    )
                    .slice(-40)}`,
            );

            // const { deployer } = await getNamedAccounts();
            const initializationParams = ethers.utils.defaultAbiCoder.encode(
                ['address', 'uint32', 'address', 'address', 'address', 'uint32', 'address'],
                [
                    connext.address, parentDomainId, ethers.constants.AddressZero, l1SplitMain.address,
                    l1SplitAddress, splitConfig.distributorFee,
                    // deployer,
                    users.owner.address,
                ]
            );

            const details = 'sample registry';
            const tx = await summoner.summonRegistryDeterministic(
                registrySingleton.address,
                details,
                initializationParams,
                saltNonce
            );
            await expect(tx).to.emit(summoner, 'NetworkRegistrySummoned').withArgs(predictedAddress, details, initializationParams);
            const receipt = await tx.wait();
            // console.log('Events', receipt.events?.[3]);
            const registryAddress = receipt.events?.[3].topics[1] 
                && ethers.utils.getAddress(`0x${receipt.events?.[3].topics[1].substring(24 + 2)}`);
            
            expect(predictedAddress).to.equal(registryAddress);
            
        });
    });

    describe("NetworkRegistry Config", function () {

        it("Should have owner on L1", async () => {
            expect(await l1NetworkRegistry.owner()).to.equal(users.owner.address);
        });

        it("Should not have owner on L2", async () => {
            expect(await l2NetworkRegistry.owner()).to.equal(ethers.constants.AddressZero);
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
            const replicaRegistry = await l1NetworkRegistry.networkRegistry(replicaChainId);
            expect(replicaRegistry).to.have.ordered.members([
                replicaDomainId,
                l2NetworkRegistry.address,
                ethers.constants.AddressZero
            ]);
        });

        it("Should not be able to call config methods if not owner or updater", async () => {
            const signer = await ethers.getSigner(users.applicant.address);
            const applicantRegistry = l1NetworkRegistry.connect(signer);

            await expect(
                applicantRegistry.setUpdaterConfig(connext.address, parentDomainId, connext.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                applicantRegistry.updateNetworkRegistry(
                    replicaChainId,
                    {
                        domainId: replicaDomainId,
                        registryAddress: l2NetworkRegistry.address,
                        delegate: ethers.constants.AddressZero,
                    }
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                applicantRegistry.setSplit(l1SplitMain.address, l1SplitAddress)
            ).to.be.revertedWith("NetworkRegistry: !owner || !updater");
            await expect(
                applicantRegistry.transferSplitControl(users.applicant.address)
            ).to.be.revertedWith("NetworkRegistry: !owner || !updater");
            await expect(
                applicantRegistry.acceptSplitControl()
            ).to.be.revertedWith("NetworkRegistry: !owner || !updater");
            await expect(
                applicantRegistry.cancelSplitControlTransfer()
            ).to.be.revertedWith("NetworkRegistry: !owner || !updater");

            await expect(
                applicantRegistry.updateNetworkSplit([replicaChainId], [l2Registry.splitMain.address], [l2SplitAddress], [0])
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                applicantRegistry.transferNetworkSplitControl([replicaChainId], [users.applicant.address], [0])
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                applicantRegistry.acceptNetworkSplitControl([replicaChainId], [0])
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                applicantRegistry.cancelNetworkSplitControlTransfer([replicaChainId], [0])
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should be able to update connext updater and turn into a replica registry", async () => {
            const prevUpdaterDomain = await l1NetworkRegistry.updaterDomain();
            const prevUpdater = await l1NetworkRegistry.updater();
            const tx = await l1NetworkRegistry.setUpdaterConfig(connext.address, parentDomainId, l1NetworkRegistry.address);
            await tx.wait();
            const currUpdaterDomain = await l1NetworkRegistry.updaterDomain();
            const currUpdater = await l1NetworkRegistry.updater();
            await expect(tx)
                .to.emit(l1NetworkRegistry, 'NewUpdaterConfig')
                .withArgs(connext.address, parentDomainId, l1NetworkRegistry.address);
            expect(currUpdaterDomain).to.not.equal(prevUpdaterDomain);
            expect(currUpdater).to.not.equal(prevUpdater);
            expect(currUpdaterDomain).to.equal(parentDomainId);
            expect(currUpdater).to.equal(l1NetworkRegistry.address);
            expect(await l1NetworkRegistry.isMainRegistry()).to.equal(false);
        });

        it("Should control a 0xSplit contract on L1", async () => {
            const signer = await ethers.getSigner(users.owner.address);
            const l1SplitMainAddress = await l1NetworkRegistry.splitMain();
            const l1SplitAddress = await l1NetworkRegistry.split();
            const splitMain = (await ethers.getContractAt('SplitMain', l1SplitMainAddress, signer)) as SplitMain;
            expect(await splitMain.getController(l1SplitAddress)).to.equal(l1NetworkRegistry.address);
        });

        it("Should be ready to accept control of 0xSplit contract on L2", async () => {
            const signer = await ethers.getSigner(users.owner.address);
            const l2SplitMainAddress = await l2NetworkRegistry.splitMain();
            const l2SplitAddress = await l2NetworkRegistry.split();
            const splitMain = (await ethers.getContractAt('SplitMain', l2SplitMainAddress, signer)) as SplitMain;
            // Controller is still on hold waiting for a message from L1 main regsitry to accept control
            expect(await splitMain.getNewPotentialController(l2SplitAddress)).to.equal(l2NetworkRegistry.address);
        });

        it("Should not be able to set a non-existent 0xSplit contract", async () => {
            const dummySplitAddress = users.applicant.address;
            await expect(
                l1NetworkRegistry.setSplit(l1SplitMain.address, dummySplitAddress)
            ).to.be.revertedWith("NetworkRegistry: !exists || immutable");

            const newSplitAddress = await deploySplit(
                l1SplitMain,
                members,
                splitConfig.percentAllocations,
                splitConfig.distributorFee,
                ethers.constants.AddressZero // immutable
            );
            await expect(
                l1NetworkRegistry.setSplit(l1SplitMain.address, newSplitAddress)
            ).to.be.revertedWith("NetworkRegistry: !exists || immutable");
        });
        
        it("Should not be able to update 0xSplit contract if control is not handed over first", async () => {
            const newSplitAddress = await deploySplit(
                l1SplitMain,
                members,
                splitConfig.percentAllocations,
                splitConfig.distributorFee,
                users.owner.address
            );
            
            await expect(
                l1NetworkRegistry.setSplit(l1SplitMain.address, newSplitAddress)
            ).to.be.revertedWithCustomError(l1NetworkRegistry, 'Split_ControlNotHandedOver');
        });

        it("Should be able to update 0xSplit contract and get control over it", async () => {
            const newSplitAddress = await deploySplit(
                l1SplitMain,
                members,
                splitConfig.percentAllocations,
                splitConfig.distributorFee,
                users.owner.address
            );
            const txTransfer = await l1SplitMain.transferControl(newSplitAddress, l1NetworkRegistry.address);
            await txTransfer.wait();

            const tx = await l1NetworkRegistry.setSplit(l1SplitMain.address, newSplitAddress);
            
            await expect(tx).to.emit(l1NetworkRegistry, 'SplitUpdated').withArgs(l1SplitMain.address, newSplitAddress);
            await expect(tx).to.emit(l1SplitMain, 'ControlTransfer').withArgs(newSplitAddress, users.owner.address, l1NetworkRegistry.address);
        });

        it("Should be able to transfer 0xSplit control", async () => {
            const newController = users.applicant.address;
            const tx = await l1NetworkRegistry.transferSplitControl(newController);
            await tx.wait();
            expect(await l1SplitMain.getNewPotentialController(await l1NetworkRegistry.split())).to.equal(newController);
        });

        it("Should be able to accept 0xSplit control", async () => {
            const signer = await ethers.getSigner(users.owner.address);
            const newL1SplitAddress = await deploySplit(
                l1SplitMain,
                members,
                splitConfig.percentAllocations,
                splitConfig.distributorFee,
                users.owner.address
            );
            const l1RegistryAddress = await summonRegistry(
                summoner,
                registrySingleton.address,
                {
                    connext: connext.address,
                    updaterDomainId: 0, // Main Registry -> no domainId
                    updaterAddress: ethers.constants.AddressZero, // Main Registry -> no updater
                    splitMain: l1SplitMain.address,
                    split: newL1SplitAddress,
                    owner: users.owner.address,
                },
                'Mainnet Registry'
            );
            const txTransfer = await l1SplitMain.transferControl(newL1SplitAddress, l1RegistryAddress);
            await expect(txTransfer).to.emit(l1SplitMain, 'InitiateControlTransfer').withArgs(newL1SplitAddress, l1RegistryAddress);
            const registry = (await ethers.getContractAt('NetworkRegistry', l1RegistryAddress, signer)) as NetworkRegistry;
            const tx = await registry.acceptSplitControl();
            await expect(tx).to.emit(l1SplitMain, 'ControlTransfer').withArgs(newL1SplitAddress, users.owner.address, l1RegistryAddress);
        });

        it("Should be able to cancel 0xSplit control", async () => {
            const signer = await ethers.getSigner(users.owner.address);
            const newL1SplitAddress = await deploySplit(
                l1SplitMain,
                members,
                splitConfig.percentAllocations,
                splitConfig.distributorFee,
                users.owner.address
            );
            const l1RegistryAddress = await summonRegistry(
                summoner,
                registrySingleton.address,
                {
                    connext: connext.address,
                    updaterDomainId: 0, // Main Registry -> no domainId
                    updaterAddress: ethers.constants.AddressZero, // Main Registry -> no updater
                    splitMain: l1SplitMain.address,
                    split: newL1SplitAddress,
                    owner: users.owner.address,
                },
                'Mainnet Registry'
            );
            const txTransfer = await l1SplitMain.transferControl(newL1SplitAddress, l1RegistryAddress);
            await expect(txTransfer)
                .to.emit(l1SplitMain, 'InitiateControlTransfer')
                .withArgs(newL1SplitAddress, l1RegistryAddress);

            const registry = (await ethers.getContractAt('NetworkRegistry', l1RegistryAddress, signer)) as NetworkRegistry;
            const txAccept = await registry.acceptSplitControl();
            await expect(txAccept)
                .to.emit(l1SplitMain, 'ControlTransfer')
                .withArgs(newL1SplitAddress, users.owner.address, l1RegistryAddress);

            const txTransfer2 = await registry.transferSplitControl(users.applicant.address);
            await expect(txTransfer2)
                .to.emit(l1SplitMain, 'InitiateControlTransfer')
                .withArgs(newL1SplitAddress, users.applicant.address);
            
            const tx = await registry.cancelSplitControlTransfer();
            await expect(tx).to.emit(l1SplitMain, 'CancelControlTransfer').withArgs(newL1SplitAddress);
        });
    });

    describe("NetworkRegistry Actions", function () {
        it("Should not be able to update the registry if not an owner", async () => {
            const signer = await ethers.getSigner(users.applicant.address);
            const applicantRegistry = l1NetworkRegistry.connect(signer);
            await expect(
                applicantRegistry.setNewMember(users.applicant.address, 100, 0)
            ).to.be.revertedWith("NetworkRegistry: !owner || !updater");
            await expect(
                applicantRegistry.updateMember(users.applicant.address, 100)
            ).to.be.revertedWith("NetworkRegistry: !owner || !updater");
            await expect(
                applicantRegistry.batchNewMember([users.applicant.address], [100], [0])
            ).to.be.revertedWith("NetworkRegistry: !owner || !updater");
            await expect(
                applicantRegistry.batchUpdateMember([users.applicant.address], [100])
            ).to.be.revertedWith("NetworkRegistry: !owner || !updater");
        });

        it("Should be able to add a new member with correct parameters", async () => {
            const [, , , member1, member2] = await getUnnamedAccounts();
            const activityMultiplier = 100;
            const startDate = (new Date().getTime() / 1000).toFixed(0);
            
            await expect(
                l1NetworkRegistry.setNewMember(ethers.constants.AddressZero, activityMultiplier, startDate)
            ).to.be.revertedWithCustomError(l1NetworkRegistry, "InvalidMember__Address");

            await expect(
                l1NetworkRegistry.setNewMember(member1, activityMultiplier + 1, startDate)
            ).to.be.revertedWithCustomError(l1NetworkRegistry, "InvalidMember__ActivityMultiplier");
            
            await expect(
                l1NetworkRegistry.setNewMember(member1, activityMultiplier, await time.latest() + 1e6)
            ).to.be.revertedWithCustomError(l1NetworkRegistry, "InvalidMember__StartDateInTheFuture");

            const tx = await l1NetworkRegistry.setNewMember(member1, activityMultiplier, startDate);
            await expect(tx)
                .to.emit(l1NetworkRegistry, 'NewMember')
                .withArgs(member1, Number(startDate), activityMultiplier);

            await expect(
                l1NetworkRegistry.setNewMember(member1, activityMultiplier, startDate)
            ).to.be.revertedWithCustomError(l1NetworkRegistry, "Member__AlreadyRegistered");

            const members = await l1NetworkRegistry.getMembers();
            const totalMembers = await l1NetworkRegistry.totalMembers();
            expect(members.length).to.be.equal(totalMembers);
            expect(members[0]).to.have.ordered.members([member1, 0, Number(startDate), activityMultiplier]);

            const member = await l1NetworkRegistry.getMember(member1);
            expect(member).to.have.ordered.members([member1, 0, Number(startDate), activityMultiplier]);

            await expect(
                l1NetworkRegistry.getMember(member2)
            ).to.be.revertedWithCustomError(l1NetworkRegistry, "Member__NotRegistered");

        });

        it("Should be able to update an existing member with correct paramters", async () => {
            const [, , , member1, member2] = await getUnnamedAccounts();
            const activityMultiplier = 100;
            const modActivityMultiplier = activityMultiplier / 2;
            const startDate = (new Date().getTime() / 1000).toFixed(0);

            await expect(
                l1NetworkRegistry.updateMember(member2, activityMultiplier)
            ).to.be.revertedWithCustomError(l1NetworkRegistry, "Member__NotRegistered");

            const newTx = await l1NetworkRegistry.setNewMember(member1, activityMultiplier, startDate);
            await newTx.wait();
            const totalMembersBefore = await l1NetworkRegistry.totalMembers();

            await expect(
                l1NetworkRegistry.updateMember(member1, activityMultiplier + 1)
            ).to.be.revertedWithCustomError(l1NetworkRegistry, "InvalidMember__ActivityMultiplier");

            const tx = await l1NetworkRegistry.updateMember(member1, modActivityMultiplier);
            await expect(tx).to.emit(l1NetworkRegistry, 'UpdateMember').withArgs(member1, modActivityMultiplier);

            const totalMembersAfter = await l1NetworkRegistry.totalMembers();
            expect(totalMembersBefore).to.be.equal(totalMembersAfter);

            const member = await l1NetworkRegistry.getMember(member1);
            expect(member).to.have.ordered.members([member1, 0, Number(startDate), modActivityMultiplier]);

        });

        it("Should be able to add new members in batch", async () => {
            const newMembers = await generateMemberBatch(10);
            const members = newMembers.map((m: Member) => m.account);
            const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
            const startDates = newMembers.map((m: Member) => m.startDate);
            const tx = await l1NetworkRegistry.batchNewMember(members, activityMultipliers, startDates);
            for (let i = 0; i < newMembers.length; i++) {
                await expect(tx)
                    .to.emit(l1NetworkRegistry, 'NewMember')
                    .withArgs(newMembers[i].account, Number(newMembers[i].startDate), newMembers[i].activityMultiplier);
            }

            await expect(
                l1NetworkRegistry.batchNewMember([ethers.constants.AddressZero], [10], [])
            ).to.revertedWithPanic('0x32'); // Array accessed at an out-of-bounds or negative index
        });

        it("Should be able to update members in batch", async () => {
            const newMembers = await generateMemberBatch(10);
            const members = newMembers.map((m: Member) => m.account);
            const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
            const modActivityMultipliers = newMembers.map((m: Member) => 100);
            const startDates = newMembers.map((m: Member) => m.startDate);
            const batchTx = await l1NetworkRegistry.batchNewMember(members, activityMultipliers, startDates);
            await batchTx.wait();

            const tx = await l1NetworkRegistry.batchUpdateMember(members, modActivityMultipliers);
            for (let i = 0; i < newMembers.length; i++) {
                await expect(tx)
                    .to.emit(l1NetworkRegistry, 'UpdateMember')
                    .withArgs(newMembers[i].account, modActivityMultipliers[i]);
            }

            await expect(
                l1NetworkRegistry.batchUpdateMember(members.slice(0, 1), [])
            ).to.revertedWithPanic('0x32'); // Array accessed at an out-of-bounds or negative index
        });

        it("Should be able to update members activity", async () => {
            const batchSize = 5;
            let newMembers = await generateMemberBatch(batchSize * 2);
            const batch1 = newMembers.slice(0, batchSize);
            let members = batch1.map((m: Member) => m.account);
            let activityMultipliers = batch1.map((m: Member) => m.activityMultiplier);
            let startDates = batch1.map((m: Member) => m.startDate);
            const batch1Date = Number(startDates[0]);
            const batch1Tx = await l1NetworkRegistry.batchNewMember(members, activityMultipliers, startDates);
            await batch1Tx.wait();

            await time.increase(3600 * 24 * 30); // next block in 30 days

            const batch2 = newMembers.slice(batchSize);
            members = batch2.map((m: Member) => m.account);
            activityMultipliers = batch2.map((m: Member) => m.activityMultiplier);
            startDates = batch1.map((m: Member) => Number(m.startDate) + 3600 * 24 * 15); // 15 days later
            const batch2Date = Number(startDates[0]);
            const batch2Tx = await l1NetworkRegistry.batchNewMember(members, activityMultipliers, startDates);
            await batch2Tx.wait();

            const tx = await l1NetworkRegistry.updateSecondsActive();
            // const receipt = await tx.wait();
            // console.log('receipt', receipt.events);

            const lastBlockTimestamp = await time.latest();

            for (let i = 0; i < batchSize; i++) {
                await expect(tx)
                    .to.emit(l1NetworkRegistry, 'UpdateMemberSeconds')
                    .withArgs(batch1[i].account, Math.floor((lastBlockTimestamp - batch1Date) * Number(batch1[i].activityMultiplier) / 100));
                await expect(tx)
                    .to.emit(l1NetworkRegistry, 'UpdateMemberSeconds')
                    .withArgs(batch2[i].account, Math.floor((lastBlockTimestamp - batch2Date) * Number(batch2[i].activityMultiplier) / 100));
            }
            const totalMembers = await l1NetworkRegistry.totalMembers();
            await expect(tx).to.emit(l1NetworkRegistry, 'RegistryActivityUpdate').withArgs(lastBlockTimestamp, totalMembers);
        });

        it("", async () => {
            // TODO: calculate
        });

        it("", async () => {
            // ====================================================================================
            // ====================================================================================
            // ====================================================================================
        });
    });

    describe("NetworkRegistry Sync Actions", function () {

        it("Should have network registries properly setup", async () => {
            // Main registry
            expect(await l1NetworkRegistry.updaterDomain()).to.equal(0);
            expect(await l1NetworkRegistry.updater()).to.equal(ethers.constants.AddressZero);
            expect(await l1NetworkRegistry.isMainRegistry()).to.equal(true);
            const l2Registry = await l1NetworkRegistry.networkRegistry(replicaChainId);
            expect(l2Registry).to.have.deep.members([ replicaDomainId, l2NetworkRegistry.address, ethers.constants.AddressZero ]);
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
                    '0x'
                )
            ).to.be.revertedWith("NetworkRegistry: !updaterDomain || !updater || !Connext");
            const connextCaller = await ethers.getSigner(users.applicant.address);
            const l2RegistryAddress = await summonRegistry(
                summoner,
                registrySingleton.address,
                {
                    connext: users.applicant.address, // fake connext caller
                    updaterDomainId: parentDomainId,
                    updaterAddress: l1NetworkRegistry.address,
                    splitMain: l2Registry.splitMain.address,
                    split: l2SplitAddress,
                    owner: ethers.constants.AddressZero, // renounceOwnership 
                },
                'L2 Registry'
            );
            const l2NewRegistry = (await ethers.getContractAt('NetworkRegistry', l2RegistryAddress, connextCaller)) as NetworkRegistry;
            await expect(
                l2NewRegistry.xReceive(
                    ethers.utils.randomBytes(32),
                    0,
                    ethers.constants.AddressZero,
                    users.applicant.address, // originSender != updaterAddress
                    parentDomainId,
                    '0x'
                )
            ).to.be.revertedWith("NetworkRegistry: !updaterDomain || !updater || !Connext");
        });

        it("Should not be able to sync the registry if not called by the updater", async () => {
            const signer = await ethers.getSigner(users.applicant.address);
            const applicantRegistry = l1NetworkRegistry.connect(signer);

            await expect(
                applicantRegistry.syncSetNewMember(users.applicant.address, 100, 0, [replicaChainId], [0])
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                applicantRegistry.syncUpdateMember(users.applicant.address, 100, [replicaChainId], [0])
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                applicantRegistry.syncBatchNewMember([users.applicant.address], [100], [0], [replicaChainId], [0])
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                applicantRegistry.syncNetworkMemberRegistry([replicaChainId], [0])
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                applicantRegistry.syncBatchUpdateMember([users.applicant.address], [100], [replicaChainId], [0])
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should not be able to call sync actions if param sizes mismatch", async () => {
            const [, , , member] = await getUnnamedAccounts();
            const activityMultiplier = 100;
            const startDate = (new Date().getTime() / 1000).toFixed(0);
            await expect(
                l1NetworkRegistry.syncSetNewMember(
                    member,
                    activityMultiplier,
                    startDate,
                    [parentDomainId, replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                    { value: defaultRelayerFee }
                )
            ).to.be.revertedWith("NetworkRegistry: params size mismatch");
            await expect(
                l1NetworkRegistry.syncBatchNewMember(
                    [member],
                    [activityMultiplier],
                    [startDate],
                    [parentDomainId, replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                    { value: defaultRelayerFee }
                )
            ).to.be.revertedWith("NetworkRegistry: params size mismatch");
            await expect(
                l1NetworkRegistry.syncNetworkMemberRegistry(
                    [parentDomainId, replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                    { value: defaultRelayerFee }
                )
            ).to.be.revertedWith("NetworkRegistry: params size mismatch");
            await expect(
                l1NetworkRegistry.syncUpdateMember(
                    member,
                    activityMultiplier,
                    [parentDomainId, replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                    { value: defaultRelayerFee }
                )
            ).to.be.revertedWith("NetworkRegistry: params size mismatch");
            await expect(
                l1NetworkRegistry.syncBatchUpdateMember(
                    [member],
                    [activityMultiplier],
                    [parentDomainId, replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                    { value: defaultRelayerFee }
                )
            ).to.be.revertedWith("NetworkRegistry: params size mismatch");
            await expect(
                l1NetworkRegistry.syncUpdateSecondsActive(
                    [parentDomainId, replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                    { value: defaultRelayerFee }
                )
            ).to.be.revertedWith("NetworkRegistry: params size mismatch");
            await expect(
                l1NetworkRegistry.syncUpdateSplits(
                    [users.applicant.address],
                    [0],
                    [parentDomainId, replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                    { value: defaultRelayerFee }
                )
            ).to.be.revertedWith("NetworkRegistry: params size mismatch");
            await expect(
                l1NetworkRegistry.syncUpdateAll(
                    [users.applicant.address],
                    [0],
                    [parentDomainId, replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                    { value: defaultRelayerFee }
                )
            ).to.be.revertedWith("NetworkRegistry: params size mismatch");
        });

        it("Should not be able to execute sync actions if not enough ETH is sent to cover relayer fees", async () => {
            const [, , , member] = await getUnnamedAccounts();
            const activityMultiplier = 100;
            const startDate = (new Date().getTime() / 1000).toFixed(0);
            await expect(
                l1NetworkRegistry.syncSetNewMember(
                    member,
                    activityMultiplier,
                    startDate,
                    [replicaChainId], // chainIds
                    [defaultRelayerFee] // relayerFees
                )
            ).to.be.revertedWith("NetworkRegistry: msg.value < relayerFees");
            await expect(
                l1NetworkRegistry.syncBatchNewMember(
                    [member],
                    [activityMultiplier],
                    [startDate],
                    [replicaChainId], // chainIds
                    [defaultRelayerFee] // relayerFees
                )
            ).to.be.revertedWith("NetworkRegistry: msg.value < relayerFees");
            await expect(
                l1NetworkRegistry.syncNetworkMemberRegistry(
                    [replicaChainId], // chainIds
                    [defaultRelayerFee] // relayerFees
                )
            ).to.be.revertedWith("NetworkRegistry: msg.value < relayerFees");
            await expect(
                l1NetworkRegistry.syncUpdateMember(
                    member,
                    activityMultiplier,
                    [replicaChainId], // chainIds
                    [defaultRelayerFee] // relayerFees
                )
            ).to.be.revertedWith("NetworkRegistry: msg.value < relayerFees");
            await expect(
                l1NetworkRegistry.syncBatchUpdateMember(
                    [member],
                    [activityMultiplier],
                    [replicaChainId], // chainIds
                    [defaultRelayerFee] // relayerFees
                )
            ).to.be.revertedWith("NetworkRegistry: msg.value < relayerFees");
            await expect(
                l1NetworkRegistry.syncUpdateSecondsActive(
                    [replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                )
            ).to.be.revertedWith("NetworkRegistry: msg.value < relayerFees");
            await expect(
                l1NetworkRegistry.syncUpdateSplits(
                    [users.applicant.address],
                    [0],
                    [replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                )
            ).to.be.revertedWith("NetworkRegistry: msg.value < relayerFees");
            await expect(
                l1NetworkRegistry.syncUpdateAll(
                    [users.applicant.address],
                    [0],
                    [replicaChainId], // chainIds
                    [defaultRelayerFee], // relayerFees
                )
            ).to.be.revertedWith("NetworkRegistry: msg.value < relayerFees");
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
            const receipt = await syncTx.wait();

            // console.log('l1NetworkRegistry', l1NetworkRegistry.address);
            // console.log('l2NetworkRegistry', l2NetworkRegistry.address);
            // console.log('events', receipt.events);
            // 0 SetMember 0xb64C
            // 1 SetMember 0x0eb1
            // 2 SynActionPerformed
            // 3
            // 4 SynMessageSubmitted
            // 

            await expect(syncTx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
            const transferId = receipt.events?.[4].topics?.[1];
            const action = receipt.events?.[4].topics?.[3].substring(0, 10);
            await expect(syncTx)
                .to.emit(l2NetworkRegistry, "SyncActionPerformed")
                .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

            await expect(syncTx).to.emit(l1NetworkRegistry, "NewMember").withArgs(member, Number(startDate), activityMultiplier);
            await expect(syncTx).to.emit(l2NetworkRegistry, "NewMember").withArgs(member, Number(startDate), activityMultiplier);

            const l1Member = await l1NetworkRegistry.members(l1CurrentMemberId);
            const l2Member = await l2NetworkRegistry.members(l2CurrentMemberId);
            expect(l1Member).to.eql(l2Member);
            expect(await l1NetworkRegistry.getMember(member)).to.eql(l1Member);
            expect(await l1NetworkRegistry.totalMembers()).to.equal(1);
            expect(await l2NetworkRegistry.getMember(member)).to.eql(l2Member);
            expect(await l2NetworkRegistry.totalMembers()).to.equal(1);
        });

        it("Should sync an updated member", async () => {
            const [, , , member] = await getUnnamedAccounts();
            const activityMultiplier = 100;
            const startDate = (new Date().getTime() / 1000).toFixed(0);
            const chainIds = [replicaChainId];
            const relayerFees = [defaultRelayerFee];

            const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

            // expect(await l1NetworkRegistry.memberIdxs(member)).to.equal(0);
            // expect(await l2NetworkRegistry.memberIdxs(member)).to.equal(0);

            // const l1CurrentMemberId = await l1NetworkRegistry.totalMembers();
            // const l2CurrentMemberId = await l2NetworkRegistry.totalMembers();

            const syncNewTx = await l1NetworkRegistry.syncSetNewMember(
                member,
                activityMultiplier,
                startDate,
                chainIds,
                relayerFees,
                { value: totalValue }
            );
            await syncNewTx.wait();

            const updatedMultiplier = activityMultiplier / 2; // half-time

            const syncTx = await l1NetworkRegistry.syncUpdateMember(
                member,
                updatedMultiplier,
                chainIds,
                relayerFees,
                { value: totalValue }
            );
            const receipt = await syncTx.wait();
            
            await expect(syncTx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
            const transferId = receipt.events?.[4].topics?.[1];
            const action = receipt.events?.[4].topics?.[3].substring(0, 10);
            await expect(syncTx)
                .to.emit(l2NetworkRegistry, "SyncActionPerformed")
                .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

            await expect(syncTx).to.emit(l1NetworkRegistry, "UpdateMember").withArgs(member, updatedMultiplier);
            await expect(syncTx).to.emit(l2NetworkRegistry, "UpdateMember").withArgs(member, updatedMultiplier);

            // const l1Member = await l1NetworkRegistry.members(l1CurrentMemberId);
            // const l2Member = await l2NetworkRegistry.members(l2CurrentMemberId);
            // expect(l1Member).to.eql(l2Member);
            expect(await l1NetworkRegistry.getMember(member)).to.eql(await l2NetworkRegistry.getMember(member));
        });

        it("Should be able to sync a new batch of members", async () => {
            const newMembers = await generateMemberBatch(10);
            const members = newMembers.map((m: Member) => m.account);
            const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
            const startDates = newMembers.map((m: Member) => m.startDate);
            const chainIds = [replicaChainId];
            const relayerFees = [defaultRelayerFee];
            const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

            const tx = await l1NetworkRegistry.syncBatchNewMember(
                members,
                activityMultipliers,
                startDates,
                chainIds,
                relayerFees,
                { value: totalValue }
            );
            const receipt = await tx.wait();
            
            await expect(tx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
            const event = receipt.events?.find((e: Event) => e.event === "SyncMessageSubmitted");
            const transferId = event?.topics?.[1];
            const action = event?.topics?.[3].substring(0, 10);
            await expect(tx)
                .to.emit(l2NetworkRegistry, "SyncActionPerformed")
                .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

            for (let i = 0; i < newMembers.length; i++) {
                await expect(tx)
                    .to.emit(l1NetworkRegistry, 'NewMember')
                    .withArgs(newMembers[i].account, Number(newMembers[i].startDate), newMembers[i].activityMultiplier);
                await expect(tx)
                    .to.emit(l2NetworkRegistry, 'NewMember')
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

            const batchTx = await l1NetworkRegistry.batchNewMember(
                members,
                activityMultipliers,
                startDates
            );
            await batchTx.wait();

            const tx = await l1NetworkRegistry.syncNetworkMemberRegistry(
                chainIds,
                relayerFees,
                { value: totalValue }
            );
            const receipt = await tx.wait();
            
            await expect(tx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
            const event = receipt.events?.find((e: Event) => e.event === "SyncMessageSubmitted");
            const transferId = event?.topics?.[1];
            const action = event?.topics?.[3].substring(0, 10);
            await expect(tx)
                .to.emit(l2NetworkRegistry, "SyncActionPerformed")
                .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

            for (let i = 0; i < newMembers.length; i++) {
                await expect(tx)
                    .to.emit(l2NetworkRegistry, 'NewMember')
                    .withArgs(newMembers[i].account, Number(newMembers[i].startDate), newMembers[i].activityMultiplier);
            }
        });

        it("Should be able to sync update a batch of members", async () => {
            const newMembers = await generateMemberBatch(10);
            const members = newMembers.map((m: Member) => m.account);
            const activityMultipliers = newMembers.map((m: Member) => m.activityMultiplier);
            const modActivityMultipliers = newMembers.map((m: Member) => 100);
            const startDates = newMembers.map((m: Member) => m.startDate);
            const chainIds = [replicaChainId];
            const relayerFees = [defaultRelayerFee];
            const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

            const newBatchTx = await l1NetworkRegistry.syncBatchNewMember(
                members,
                activityMultipliers,
                startDates,
                chainIds,
                relayerFees,
                { value: totalValue }
            );
            await newBatchTx.wait();

            const tx = await l1NetworkRegistry.syncBatchUpdateMember(
                members,
                modActivityMultipliers,
                chainIds,
                relayerFees,
                { value: totalValue }
            );
            const receipt = await tx.wait();
            
            await expect(tx).to.emit(l1NetworkRegistry, "SyncMessageSubmitted");
            const event = receipt.events?.find((e: Event) => e.event === "SyncMessageSubmitted");
            const transferId = event?.topics?.[1];
            const action = event?.topics?.[3].substring(0, 10);
            await expect(tx)
                .to.emit(l2NetworkRegistry, "SyncActionPerformed")
                .withArgs(transferId, parentDomainId, action, true, l1NetworkRegistry.address);

            for (let i = 0; i < newMembers.length; i++) {
                await expect(tx)
                    .to.emit(l1NetworkRegistry, 'UpdateMember')
                    .withArgs(newMembers[i].account, modActivityMultipliers[i]);
                await expect(tx)
                    .to.emit(l2NetworkRegistry, 'UpdateMember')
                    .withArgs(newMembers[i].account, modActivityMultipliers[i]);
            }
        });

        it("Should be able to sync update members activity", async () => {
            const batchSize = 5;
            let newMembers = await generateMemberBatch(batchSize * 2);
            const batch1 = newMembers.slice(0, batchSize);
            let members = batch1.map((m: Member) => m.account);
            let activityMultipliers = batch1.map((m: Member) => m.activityMultiplier);
            let startDates = batch1.map((m: Member) => m.startDate);
            const chainIds = [replicaChainId];
            const relayerFees = [defaultRelayerFee];
            const batch1Date = Number(startDates[0]);
            const totalValue = relayerFees.reduce((a: BigNumber, b: BigNumber) => a.add(b), BigNumber.from(0));

            const newBatch1Tx = await l1NetworkRegistry.syncBatchNewMember(
                members,
                activityMultipliers,
                startDates,
                chainIds,
                relayerFees,
                { value: totalValue }
            );
            await newBatch1Tx.wait();

            await time.increase(3600 * 24 * 30); // next block in 30 days

            const batch2 = newMembers.slice(batchSize);
            members = batch2.map((m: Member) => m.account);
            activityMultipliers = batch2.map((m: Member) => m.activityMultiplier);
            startDates = batch1.map((m: Member) => Number(m.startDate) + 3600 * 24 * 15); // 15 days later
            const batch2Date = Number(startDates[0]);
            const newBatch2Tx = await l1NetworkRegistry.syncBatchNewMember(
                members,
                activityMultipliers,
                startDates,
                chainIds,
                relayerFees,
                { value: totalValue }
            );
            await newBatch2Tx.wait();

            const tx = await l1NetworkRegistry.syncUpdateSecondsActive(
                chainIds,
                relayerFees,
                { value: totalValue }
            );
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
                    .to.emit(l1NetworkRegistry, 'UpdateMemberSeconds')
                    .withArgs(batch1[i].account, Math.floor((lastBlockTimestamp - batch1Date) * Number(batch1[i].activityMultiplier) / 100));
                await expect(tx)
                    .to.emit(l2NetworkRegistry, 'UpdateMemberSeconds')
                    .withArgs(batch1[i].account, Math.floor((lastBlockTimestamp - batch1Date) * Number(batch1[i].activityMultiplier) / 100));
                await expect(tx)
                    .to.emit(l1NetworkRegistry, 'UpdateMemberSeconds')
                    .withArgs(batch2[i].account, Math.floor((lastBlockTimestamp - batch2Date) * Number(batch2[i].activityMultiplier) / 100));
                await expect(tx)
                    .to.emit(l2NetworkRegistry, 'UpdateMemberSeconds')
                    .withArgs(batch2[i].account, Math.floor((lastBlockTimestamp - batch2Date) * Number(batch2[i].activityMultiplier) / 100));
            }
            const totalMembersL1 = await l1NetworkRegistry.totalMembers();
            const totalMembersL2 = await l2NetworkRegistry.totalMembers();
            await expect(tx).to.emit(l1NetworkRegistry, 'RegistryActivityUpdate').withArgs(lastBlockTimestamp, totalMembersL1);
            await expect(tx).to.emit(l2NetworkRegistry, 'RegistryActivityUpdate').withArgs(lastBlockTimestamp, totalMembersL2);
        });

    });
});