// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.23 <0.9.0;

import { BaseHandler } from "./BaseHandler.sol";

import { GuildRegistry } from "contracts/GuildRegistry.sol";
import { GuildRegistryV2 } from "contracts/GuildRegistryV2.sol";
import { IMemberRegistry } from "contracts/interfaces/IMemberRegistry.sol";
import { DataTypes } from "contracts/libraries/DataTypes.sol";

contract GuildRegistryBaseHandler is BaseHandler {
    uint256 internal constant MIN_MEMBERS = 10;

    uint256 internal constant MAX_MEMBERS = 100;

    IMemberRegistry public registry;

    address internal owner;

    uint256 private batchNewCounter;

    constructor(IMemberRegistry _registry, address _owner) BaseHandler() {
        registry = _registry;
        owner = _owner;
    }

    function batchNewMembers(
        uint32 _activityMultiplier,
        uint32 _startDate,
        uint256 _totalMembers
    ) public executeAs(owner) {
        _totalMembers = bound(_totalMembers, MIN_MEMBERS, MAX_MEMBERS);
        address[] memory memberAddrs = new address[](_totalMembers);
        uint32[] memory activityMultipliers = new uint32[](_totalMembers);
        uint32[] memory startDates = new uint32[](_totalMembers);
        for (uint256 i; i < _totalMembers; ++i) {
            memberAddrs[i] = address(uint160((0x1000 * ++batchNewCounter) + i));
            activityMultipliers[i] = uint32(bound(_activityMultiplier, 1, 100));
            startDates[i] = uint32(bound(_startDate, 1, block.timestamp));
        }
        registry.batchNewMembers(memberAddrs, activityMultipliers, startDates);
    }

    function batchUpdateMembersActivity(uint32 _activityMultiplier, uint256 _inactiveMembers) public executeAs(owner) {
        _inactiveMembers = bound(_inactiveMembers, 0, registry.totalMembers());
        DataTypes.Member[] memory members = registry.getMembers();
        address[] memory memberAddrs = new address[](_inactiveMembers);
        uint32[] memory activityMultipliers = new uint32[](_inactiveMembers);
        for (uint256 i; i < memberAddrs.length; ++i) {
            memberAddrs[i] = members[i].account;
            activityMultipliers[i] = (i < _inactiveMembers) ? 0 : uint32(bound(_activityMultiplier, 1, 100));
        }
        if (_inactiveMembers > 0) registry.batchUpdateMembersActivity(memberAddrs, activityMultipliers);
    }

    function batchRemoveMembers(uint256 _totalMembers) public executeAs(owner) {
        _totalMembers = bound(_totalMembers, 0, registry.totalMembers());
        DataTypes.Member[] memory members = registry.getMembers();
        address[] memory memberAddrs = new address[](_totalMembers);
        for (uint256 i; i < _totalMembers; ++i) {
            memberAddrs[i] = members[i].account;
        }
        if (_totalMembers > 0) registry.batchRemoveMembers(memberAddrs);
    }

    function updateSecondsActive(uint32 _cutoffTimestamp) public {
        vm.warp(registry.lastActivityUpdate() + 1 days);
        _cutoffTimestamp = uint32(bound(_cutoffTimestamp, registry.lastActivityUpdate() + 1, block.timestamp));
        registry.updateSecondsActive(_cutoffTimestamp);
    }
}

contract GuildRegistryHandler is GuildRegistryBaseHandler {
    constructor(GuildRegistry _registry) GuildRegistryBaseHandler(_registry, _registry.owner()) {}
}

contract GuildRegistryV2Handler is GuildRegistryBaseHandler {
    constructor(GuildRegistryV2 _registry) GuildRegistryBaseHandler(_registry, _registry.owner()) {}
}
