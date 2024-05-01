// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.23 <0.9.0;

import { BaseHandler } from "./BaseHandler.sol";

import { DataTypes } from "contracts/libraries/DataTypes.sol";
import { NetworkRegistry } from "contracts/NetworkRegistry.sol";

contract NetworkRegistryHandler is BaseHandler {
    uint256 internal constant MIN_MEMBERS = 10;

    uint256 internal constant MAX_MEMBERS = 100;

    NetworkRegistry public registry;

    address internal owner;

    uint256 private batchNewCounter;

    uint256 public totalInactiveMembers;

    uint32[] internal chainIds;
    uint256[] internal relayerFees;

    constructor(NetworkRegistry _registry) BaseHandler() {
        registry = _registry;
        owner = registry.owner();
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
        registry.syncBatchNewMembers(memberAddrs, activityMultipliers, startDates, chainIds, relayerFees);
    }

    function batchUpdateMembersActivity(uint32 _activityMultiplier, uint256 _inactiveMembers) public executeAs(owner) {
        _inactiveMembers = bound(_inactiveMembers, 0, registry.totalMembers());
        DataTypes.Member[] memory members = registry.getMembers();
        address[] memory memberAddrs;
        uint32[] memory activityMultipliers;
        uint256 inactiveCounter;
        for (uint256 i; i < memberAddrs.length; ++i) {
            uint32 multiplier = (i < _inactiveMembers) ? 0 : uint32(bound(_activityMultiplier, 1, 100));
            if (members[i].activityMultiplier > 0 && multiplier == 0) {
                memberAddrs[inactiveCounter] = members[i].account;
                activityMultipliers[inactiveCounter] = multiplier;
                ++inactiveCounter;
            }
        }
        if (inactiveCounter > 0) {
            totalInactiveMembers += inactiveCounter;
            registry.syncBatchUpdateMembersActivity(memberAddrs, activityMultipliers, chainIds, relayerFees);
        }
    }

    function batchRemoveMembers(uint256 _totalMembers) public executeAs(owner) {
        _totalMembers = bound(_totalMembers, 0, registry.totalMembers());
        DataTypes.Member[] memory members = registry.getMembers();
        address[] memory memberAddrs = new address[](_totalMembers);
        for (uint256 i; i < _totalMembers; ++i) {
            memberAddrs[i] = members[i].account;
        }
        if (_totalMembers > 0) {
            registry.syncBatchRemoveMembers(memberAddrs, chainIds, relayerFees);
        }
    }

    function updateSecondsActive() public {
        vm.warp(registry.lastActivityUpdate() + 1 days);
        registry.syncUpdateSecondsActive(chainIds, relayerFees);
    }
}
