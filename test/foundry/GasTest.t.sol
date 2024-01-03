// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";

import { SplitMain } from "contracts/fixtures/SplitMain.sol";
import { ConnextMock } from "contracts/mocks/ConnextMock.sol";
import { DataTypes } from "contracts/libraries/DataTypes.sol";
import { NetworkRegistry } from "contracts/NetworkRegistry.sol";
import { NetworkRegistryShaman } from "contracts/NetworkRegistryShaman.sol";
import { NetworkRegistrySummoner } from "contracts/NetworkRegistrySummoner.sol";

contract GasTest is Test {
    SplitMain private splitMain;
    NetworkRegistry private registry;
    // NetworkRegistry private replica;
    // NetworkRegistryShaman private registryShaman;
    NetworkRegistry private singleton;
    NetworkRegistryShaman private singletonShaman;
    NetworkRegistrySummoner private summoner;
    address private registryOwner;
    address[] private sortedAddresses;

    uint32[] private chainIds;
    uint256[] private relayerFees;

    uint32 private constant HOME_DOMAIN_ID = 1;
    // Change this for testing
    uint256 private constant TOTAL_USERS = 800;

    function _createUser(string memory name) internal returns (address payable) {
        address payable user = payable(makeAddr(name));
        vm.deal({ account: user, newBalance: 100 ether });
        return user;
    }

    function setUp() external {
        vm.createSelectFork(vm.rpcUrl("goerli"), 10159603); // TODO: block No.

        registryOwner = _createUser("ProtocolGuild");

        // Deploy 0xSplit infra
        splitMain = new SplitMain();
        address[] memory accounts = new address[](2);
        accounts[0] = registryOwner;
        accounts[1] = address(this);
        uint32[] memory percentAllocations = new uint32[](2);
        percentAllocations[0] = 500_000;
        percentAllocations[1] = 500_000;
        address split = splitMain.createSplit(accounts, percentAllocations, 0, registryOwner);

        // deploy Registry infra
        summoner = new NetworkRegistrySummoner();
        singleton = new NetworkRegistry();
        singletonShaman = new NetworkRegistryShaman();

        // Deploy Connext infra
        address connext = address(new ConnextMock(HOME_DOMAIN_ID));

        // Deploy main registry
        bytes memory mainInitParams = abi.encode(connext, 0, address(0), address(splitMain), split, registryOwner);
        registry = NetworkRegistry(summoner.summonRegistry(address(singleton), "MainRegistry", mainInitParams));
        // TODO: deploy replica

        // TODO: Cross-chain config

        DataTypes.Member[] memory members = registry.getMembers();

        console.log("Before setup: Goerli registry has %d members", members.length);

        vm.startPrank(registry.owner());

        // Transfer 0xSplit control
        splitMain.transferControl(split, address(registry));
        // Accept 0xSplit control
        registry.acceptSplitControl();

        address[] memory _members = new address[](TOTAL_USERS);
        uint32[] memory _activityMultipliers = new uint32[](TOTAL_USERS);
        uint32[] memory _startDates = new uint32[](TOTAL_USERS);

        for (uint256 i = 0; i < TOTAL_USERS; ) {
            _members[i] = address(uint160(0x1000 + i));
            _activityMultipliers[i] = 100;
            // force latest member to have the lowest allocation
            _startDates[i] = 1_672_531_200 + uint32(5000 * i);
            unchecked {
                ++i;
            }
        }

        registry.syncBatchNewMembers(_members, _activityMultipliers, _startDates, chainIds, relayerFees);

        // Verify new amount of members
        console.log("After setup: Goerli registry has %d members", registry.totalMembers());

        // // Sort the member's addresses for testing purposes later.
        // (address[] memory addrs, , ) = registry.getMembersProperties();

        // Standard bubblesort
        // bool swapped;
        // do {
        //     swapped = false;

        //     for (uint256 i = 1; i < _members.length; ) {
        //         if (_members[i - 1] > _members[i]) {
        //             swapped = true;
        //             address temp = _members[i - 1];
        //             _members[i - 1] = _members[i];
        //             _members[i] = temp;
        //         }
        //         unchecked {
        //             ++i;
        //         }
        //     }
        // } while (swapped);

        for (uint256 i = 0; i < _members.length; ) {
            sortedAddresses.push(_members[i]);
            unchecked {
                ++i;
            }
        }

        vm.stopPrank();
    }

    modifier ownerContext() {
        vm.startPrank(registry.owner());
        _;
        vm.stopPrank();
    }

    // function testCalculateTotalContributions() external {
    //     uint256 totalContribution = registry.calculateTotalContributions();
    // }

    // function testUpdateSecondsActive() external {
    //     registry.updateSecondsActive();
    // }

    // function testGetMembersProperties() external {
    //     (address[] memory _members, uint32[] memory _activityMultipliers, uint32[] memory _startDates) = registry
    //         .getMembersProperties();
    // }

    // function testSetNewMember() external {
    //     vm.startPrank(registryOwner);

    //     registry.setNewMember(address(0x1337), 100, 12345678);

    //     vm.stopPrank();
    // }

    function testUpdateSecondsActive() external ownerContext {
        registry.syncUpdateSecondsActive(chainIds, relayerFees);
    }

    function testUpdateAll() external ownerContext {
        registry.syncUpdateAll(sortedAddresses, 0, chainIds, relayerFees);
    }
}
