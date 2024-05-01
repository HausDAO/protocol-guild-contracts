// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.23;

import { console2 } from "forge-std/console2.sol";
import { GuildRegistry } from "contracts/GuildRegistry.sol";
import { MemberRegistry } from "contracts/registry/MemberRegistry.sol";
import { MemberRegistry__InvalidCutoffDate } from "contracts/utils/Errors.sol";
import { BaseTest } from "test/foundry/Base.t.sol";

contract UpdateSecondsActive_Unit_Fuzz_Test is BaseTest {
    GuildRegistry public memberRegistry;

    address internal alice = address(uint160(0x1001));
    address internal bob = address(uint160(0x1002));
    address internal charlie = address(uint160(0x1003));

    uint256 private constant PERCENTAGE_SCALE = 100e4; // used by 0xSplit (100%)

    uint32 private constant QUARTER_SECONDS = 10_368_000;

    function setUp() public override {
        BaseTest.setUp();

        address proxyAddress = deployGuildRegistry(address(this));
        memberRegistry = GuildRegistry(proxyAddress);

        assertEq(memberRegistry.totalMembers(), 0);
        assertEq(memberRegistry.lastActivityUpdate(), uint32(block.timestamp));

        vm.warp(1704103200); // Jan 1st, 2024
    }

    function testFuzz__RevertWhen_CutoffTimestampIsInvalid(
        uint32 _cutoffTimestamp,
        uint32 _activityMultiplier,
        uint32 _startDate,
        uint256 _totalMembers
    ) public {
        uint32 lastActivityUpdate = memberRegistry.lastActivityUpdate();
        vm.assume(_cutoffTimestamp < lastActivityUpdate || _cutoffTimestamp > block.timestamp);

        _activityMultiplier = uint32(bound(_activityMultiplier, 1, 100));
        _startDate = uint32(bound(_startDate, lastActivityUpdate, block.timestamp));
        _totalMembers = bound(_totalMembers, 10, 100);

        address[] memory memberAddrs = new address[](_totalMembers);
        uint32[] memory multipliers = new uint32[](_totalMembers);
        uint32[] memory startDates = new uint32[](_totalMembers);
        for (uint256 i; i < _totalMembers; ++i) {
            memberAddrs[i] = address(uint160(0x1000 + i));
            multipliers[i] = _activityMultiplier;
            startDates[i] = _startDate;
        }

        // We add new members
        memberRegistry.batchNewMembers(memberAddrs, multipliers, startDates);

        vm.expectRevert(abi.encodeWithSelector(MemberRegistry__InvalidCutoffDate.selector));
        memberRegistry.updateSecondsActive(_cutoffTimestamp);
    }

    function testFuzz__CutoffTimestamp(
        uint32 _cutoffTimestamp,
        uint32 _activityMultiplier,
        uint32 _startDate,
        uint256 _totalMembers
    ) public {
        vm.assume(_cutoffTimestamp >= block.timestamp);

        _activityMultiplier = uint32(bound(_activityMultiplier, 1, 100));
        _startDate = uint32(bound(_startDate, 1, block.timestamp));
        _totalMembers = bound(_totalMembers, 10, 100);

        address[] memory memberAddrs = new address[](_totalMembers);
        uint32[] memory multipliers = new uint32[](_totalMembers);
        uint32[] memory startDates = new uint32[](_totalMembers);
        for (uint256 i; i < _totalMembers; ++i) {
            memberAddrs[i] = address(uint160(0x1000 + i));
            multipliers[i] = _activityMultiplier;
            startDates[i] = _startDate;
        }

        // We add new members
        memberRegistry.batchNewMembers(memberAddrs, multipliers, startDates);

        // We warp into the future to any given cutoff date
        vm.warp(_cutoffTimestamp);

        vm.expectEmit({ emitter: address(memberRegistry) });
        emit MemberRegistry.RegistryActivityUpdate(_cutoffTimestamp, _totalMembers);
        memberRegistry.updateSecondsActive(_cutoffTimestamp);
    }
}
