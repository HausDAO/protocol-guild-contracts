// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.23;

import { console2 } from "forge-std/console2.sol";
import { IMemberRegistry } from "contracts/interfaces/IMemberRegistry.sol";
import { ISplitManager } from "contracts/interfaces/ISplitManager.sol";
import { ISplitV2Manager } from "contracts/interfaces/ISplitV2Manager.sol";
import { GuildRegistry } from "contracts/GuildRegistry.sol";
import { GuildRegistryV2 } from "contracts/GuildRegistryV2.sol";
import { MemberRegistry } from "contracts/registry/MemberRegistry.sol";
import { MemberRegistry__InvalidCutoffDate } from "contracts/utils/Errors.sol";
import { BaseTest } from "test/foundry/Base.t.sol";

abstract contract Calculate_Unit_Fuzz_Base_Test is BaseTest {
    IMemberRegistry public memberRegistry;

    address internal alice = address(uint160(0x1001));
    address internal bob = address(uint160(0x1002));
    address internal charlie = address(uint160(0x1003));

    uint256 internal constant PERCENTAGE_SCALE = 100e4; // used by 0xSplit (100%)

    uint32 private constant QUARTER_SECONDS = 10_368_000;

    function setUp() public virtual override {
        BaseTest.setUp();

        assertEq(memberRegistry.totalMembers(), 0);
        assertEq(memberRegistry.lastActivityUpdate(), uint32(block.timestamp));

        vm.warp(1704103200); // Jan 1st, 2024
    }

    function _splitCalculation(address[] memory _memberList) internal virtual;

    function _splitCalculation2(address[] memory _memberList) internal virtual;

    /**
        We intend to test:
        - for 3 members Alice, Bob & Charlie with different starting dates (bob oldest member, charlie newest member)
        - given a positive activityMultiplier (the same for all the members)
        - at any given future cutoff date
        - we calculate members shares and expect bob shares > alice shares > charlie shares
    */
    function testFuzz_percentAllocations_ByStartDate(
        uint32 _activityMultiplier,
        uint32 _charlieStartTimestamp,
        uint32 _aliceStartTimestamp,
        uint32 _bobStartTimestamp,
        uint32 cutoffTimestamp
    ) public {
        /*
            We test that:
            - given an activityMultiplier (the same for all the members)
            - for 3 members Alice, Bob & Charlie with different starting dates (alice the oldest member,
                charlie newest member)
            - at any given future cutoff date
            - we calculate members shares and expect alice allocation > bob allocation > charlie allocation
        */

        // Activity multiplier must be between 1 and 100
        _activityMultiplier = uint32(bound(_activityMultiplier, 1, 100));

        // Cutoff timestamp must be in the future
        vm.assume(cutoffTimestamp >= (block.timestamp + QUARTER_SECONDS)); // one quarter ahead

        uint32 startDate = uint32(block.timestamp - QUARTER_SECONDS);

        // Alice started between previous quarter and current date
        _aliceStartTimestamp = uint32(bound(_aliceStartTimestamp, startDate, block.timestamp));

        // Bob started later than Alice
        _bobStartTimestamp = uint32(bound(_bobStartTimestamp, _aliceStartTimestamp + 1, block.timestamp));

        // Charlie started later than Bob
        _charlieStartTimestamp = uint32(bound(_charlieStartTimestamp, _bobStartTimestamp + 1, block.timestamp));

        // Check timestamps of starting dates are correctly bounded
        require(
            _bobStartTimestamp > _aliceStartTimestamp && _charlieStartTimestamp > _aliceStartTimestamp,
            "Unexpected timestamps"
        );

        address[] memory memberAddrs = new address[](3);
        memberAddrs[0] = bob;
        memberAddrs[1] = alice;
        memberAddrs[2] = charlie;
        uint32[] memory multipliers = new uint32[](3);
        multipliers[0] = _activityMultiplier;
        multipliers[1] = _activityMultiplier;
        multipliers[2] = _activityMultiplier;
        uint32[] memory startDates = new uint32[](3);
        startDates[0] = _bobStartTimestamp;
        startDates[1] = _aliceStartTimestamp;
        startDates[2] = _charlieStartTimestamp;

        // We add new members
        memberRegistry.batchNewMembers(memberAddrs, multipliers, startDates);

        // We warp into the future to any given cutoff date
        vm.warp(cutoffTimestamp);

        // We update the registry up to the current block.timestamp
        memberRegistry.updateSecondsActive(0);
        assertEq(memberRegistry.lastActivityUpdate(), cutoffTimestamp);

        address[] memory _sortedList = new address[](3);

        // We create an ascending sorted list with members
        _sortedList[0] = alice;
        _sortedList[1] = bob;
        _sortedList[2] = charlie;

        _splitCalculation(_sortedList);
    }

    function testFuzz_percentAllocations_ByActivityMultiplier(
        uint32 _aliceActivity,
        uint32 _bobActivity,
        uint32 _charlieActivity,
        uint32 _timestamp
    ) public {
        /*
            We test that:
                - given a specific _timestamp (the same for all the members
                - for activityMultipliers (bounded between > 0 and < 100 )
                    && (bobActivity >= aliceActivity > charlieActivity)
                - We calculate members shares and expect bobShares >= aliceShares >= charlieShares

            We bound values
            - _timestamp at least one quarter behind and no greater than the current block.timestamp
            - For the different activities, we bound them to bobActivity >= aliceActivity >= charlieActivity
        */

        _bobActivity = uint32(bound(_bobActivity, 5, 100));
        _aliceActivity = uint32(bound(_aliceActivity, 3, _bobActivity - 1));
        _charlieActivity = uint32(bound(_charlieActivity, 1, _aliceActivity - 1));

        uint32 startDate = uint32(block.timestamp - QUARTER_SECONDS); // one quarter behind
        _timestamp = uint32(bound(_timestamp, startDate, block.timestamp));

        address[] memory memberAddrs = new address[](3);
        memberAddrs[0] = bob;
        memberAddrs[1] = alice;
        memberAddrs[2] = charlie;
        uint32[] memory multipliers = new uint32[](3);
        multipliers[0] = _bobActivity;
        multipliers[1] = _aliceActivity;
        multipliers[2] = _charlieActivity;
        uint32[] memory startDates = new uint32[](3);
        startDates[0] = _timestamp;
        startDates[1] = _timestamp;
        startDates[2] = _timestamp;

        // We add new members
        memberRegistry.batchNewMembers(memberAddrs, multipliers, startDates);

        uint32 warpTime = uint32(block.timestamp + QUARTER_SECONDS); // one quarter ahead

        // We warp into the future stablished by _timestamp
        vm.warp(warpTime);

        // We update the registry up to the timestamp
        memberRegistry.updateSecondsActive(warpTime);
        assertEq(memberRegistry.lastActivityUpdate(), warpTime);

        address[] memory _sortedList = new address[](3);

        // We create an ascending sorted list with members
        _sortedList[0] = alice;
        _sortedList[1] = bob;
        _sortedList[2] = charlie;

        _splitCalculation2(_sortedList);
    }

    // function testFuzz_inactiveUsers(uint32 _timestamp_1, uint32 cutoffTimestamp) public {
    //     /*
    //             What we test is that:
    //                 - given a specific _timestamp (the same for all the members
    //                 - and different activityMultipliers (3 with 100 and 2 with 0)

    //             we only get results for the members with activityMultipliers > 0
    //         */

    //     // Cutoff timestamp must be in the future
    //     vm.assume(cutoffTimestamp > block.timestamp);

    //     _timestamp_1 = uint32(bound(_timestamp_1, 9000, block.timestamp));

    //     // We set the new members
    //     memberRegistry.setNewMember(bob, 100, _timestamp_1);

    //     // TODO: not possible
    //     // memberRegistry.setNewMember(alice, 0, _timestamp_1);

    //     memberRegistry.setNewMember(charlie, 100, _timestamp_1);

    //     memberRegistry.setNewMember(delta, 100, _timestamp_1);

    //     // TODO: not possible
    //     memberRegistry.setNewMember(epsilon, 0, _timestamp_1);

    //     // We warp into the future to any given cutoff date
    //     vm.warp(cutoffTimestamp);

    //     // We update the registry up to the timestamp
    //     memberRegistry.updateSecondsActive(cutoffTimestamp);
    //     assertEq(memberRegistry.lastActivityUpdate(), cutoffTimestamp);

    //     address[] memory _sortedList = new address[](5);

    //     // We create an ascending sorted list with members
    //     _sortedList[0] = bob;
    //     _sortedList[1] = alice;
    //     _sortedList[2] = delta;
    //     _sortedList[3] = epsilon;
    //     _sortedList[4] = charlie;

    //     // We retrieve the calculation of weights
    //     (address[] memory receivers, uint32[] memory percentAllocations) = memberRegistry.calculate(_sortedList);

    //     assertEq(receivers.length, 3, "We only expect 3 valid receivers");
    //     assertEq(percentAllocations.length, 3, "We only epect 3 valid ");
    // }
}

contract Calculate_Unit_Fuzz_Test is Calculate_Unit_Fuzz_Base_Test {
    function setUp() public override {
        address proxyAddress = deployGuildRegistry(address(this));
        memberRegistry = GuildRegistry(proxyAddress);

        super.setUp();
    }

    function _splitCalculation(address[] memory _sortedList) internal override {
        // We retrieve the calculation of weights
        (address[] memory receivers, uint32[] memory percentAllocations) = ISplitManager(address(memberRegistry))
            .calculate(_sortedList);

        // We check order of receivers
        assertEq(receivers[0], alice, "Alice not first receiver");
        assertEq(receivers[1], bob, "Bob not second receiver");
        assertEq(receivers[2], charlie, "Charlie not third receiver");

        // Allocations add up to 100e4
        assertEq(
            percentAllocations[0] + percentAllocations[1] + percentAllocations[2],
            PERCENTAGE_SCALE,
            "Unexpected total allocation"
        );

        // Bob (oldest member) shouldn't receive less than Alice
        assertGte(percentAllocations[0], percentAllocations[1], "Alice received less than Bob");

        // IMPORTANT: If Charlie is getting 1 percent allocation more it's OK
        // due to the rounding favouring minorities in the `calculate` function
        if (percentAllocations[1] < percentAllocations[2]) {
            assertGte(1, percentAllocations[2] - percentAllocations[1], "Rounding error bigger than 1");
        } else {
            // Otherwise,
            assertGte(percentAllocations[1], percentAllocations[2], "Bob received less than Charlie");
        }
    }

    function _splitCalculation2(address[] memory _sortedList) internal override {
        // We retrieve the calculation of weights
        (address[] memory receivers, uint32[] memory percentAllocations) = ISplitManager(address(memberRegistry))
            .calculate(_sortedList);

        // We check order of receivers
        assertEq(receivers[0], alice, "Alice not first receiver");
        assertEq(receivers[1], bob, "Bob not second receiver");
        assertEq(receivers[2], charlie, "Charlie not third receiver");

        // We check allocations
        assertGte(percentAllocations[1], percentAllocations[0], "Bob received less than Alice");

        // IMPORTANT: If Charlie is getting 1 percent allocation more it's OK
        // due to the rounding favouring minorities in the `calculate` function
        if (percentAllocations[0] < percentAllocations[2]) {
            assertGte(1, percentAllocations[2] - percentAllocations[0], "Rounding error bigger than 1");
        } else {
            // Otherwise,
            assertGte(percentAllocations[0], percentAllocations[2], "Alice received less than Charlie");
        }
    }
}

contract CalculateV2_Unit_Fuzz_Test is Calculate_Unit_Fuzz_Base_Test {
    function setUp() public override {
        address proxyAddress = deployGuildRegistryV2(address(this));
        memberRegistry = GuildRegistryV2(proxyAddress);

        super.setUp();
    }

    function _splitCalculation(address[] memory _sortedList) internal override {
        // We retrieve the calculation of weights
        (address[] memory receivers, uint256[] memory percentAllocations) = ISplitV2Manager(address(memberRegistry))
            .calculate(_sortedList);

        // We check order of receivers
        assertEq(receivers[0], alice, "Alice not first receiver");
        assertEq(receivers[1], bob, "Bob not second receiver");
        assertEq(receivers[2], charlie, "Charlie not third receiver");

        // Allocations add up to 100e4
        assertEq(
            percentAllocations[0] + percentAllocations[1] + percentAllocations[2],
            PERCENTAGE_SCALE,
            "Unexpected total allocation"
        );

        // Bob (oldest member) shouldn't receive less than Alice
        assertGte(percentAllocations[0], percentAllocations[1], "Alice received less than Bob");

        // IMPORTANT: If Charlie is getting 1 percent allocation more it's OK
        // due to the rounding favouring minorities in the `calculate` function
        if (percentAllocations[1] < percentAllocations[2]) {
            assertGte(1, percentAllocations[2] - percentAllocations[1], "Rounding error bigger than 1");
        } else {
            // Otherwise,
            assertGte(percentAllocations[1], percentAllocations[2], "Bob received less than Charlie");
        }
    }

    function _splitCalculation2(address[] memory _sortedList) internal override {
        // We retrieve the calculation of weights
        (address[] memory receivers, uint256[] memory percentAllocations) = ISplitV2Manager(address(memberRegistry))
            .calculate(_sortedList);

        // We check order of receivers
        assertEq(receivers[0], alice, "Alice not first receiver");
        assertEq(receivers[1], bob, "Bob not second receiver");
        assertEq(receivers[2], charlie, "Charlie not third receiver");

        // We check allocations
        assertGte(percentAllocations[1], percentAllocations[0], "Bob received less than Alice");

        // IMPORTANT: If Charlie is getting 1 percent allocation more it's OK
        // due to the rounding favouring minorities in the `calculate` function
        if (percentAllocations[0] < percentAllocations[2]) {
            assertGte(1, percentAllocations[2] - percentAllocations[0], "Rounding error bigger than 1");
        } else {
            // Otherwise,
            assertGte(percentAllocations[0], percentAllocations[2], "Alice received less than Charlie");
        }
    }
}
