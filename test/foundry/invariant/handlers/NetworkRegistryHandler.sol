// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.23 <0.9.0;

import { BaseHandler } from "./BaseHandler.sol";

import { NetworkRegistry } from "contracts/NetworkRegistry.sol";
import { NetworkRegistryV2 } from "contracts/NetworkRegistryV2.sol";
import { INetworkRegistryManager } from "contracts/interfaces/INetworkRegistryManager.sol";
import { DataTypes } from "contracts/libraries/DataTypes.sol";

contract NetworkRegistryBaseHandler is BaseHandler {
    uint256 internal constant MIN_MEMBERS = 10;

    uint256 internal constant MAX_MEMBERS = 100;

    INetworkRegistryManager public immutable registry;

    address internal immutable owner;

    uint256 private batchNewCounter;

    uint256 public totalInactiveMembers;

    uint32[] internal chainIds;
    uint256[] internal relayerFees;

    constructor(INetworkRegistryManager _registry, address _owner) BaseHandler() {
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
        registry.syncBatchNewMembers(memberAddrs, activityMultipliers, startDates, chainIds, relayerFees);
    }

    function batchUpdateMembersActivity(uint32 _activityMultiplier, uint256 _inactiveMembers) public executeAs(owner) {
        _inactiveMembers = bound(_inactiveMembers, 0, registry.totalMembers());
        DataTypes.Member[] memory members = registry.getMembers();
        address[] memory memberAddrs;
        uint32[] memory activityMultipliers;
        uint256 inactiveCounter;
        uint256 totalMembers = memberAddrs.length;
        for (uint256 i; i < totalMembers; ++i) {
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

contract NetworkRegistryHandler is NetworkRegistryBaseHandler {
    constructor(NetworkRegistry _registry) NetworkRegistryBaseHandler(_registry, _registry.owner()) {}
}

contract NetworkRegistryV2Handler is NetworkRegistryBaseHandler {
    constructor(NetworkRegistryV2 _registry) NetworkRegistryBaseHandler(_registry, _registry.owner()) {}
}
