// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IMemberRegistry } from "./IMemberRegistry.sol";
import { ISplitManager } from "./ISplitManager.sol";

interface INetworkMemberRegistry is IMemberRegistry, ISplitManager {

    struct NetworkRegistry {
        uint32 domainId;
        address registryAddress; // registryAddress: PGNetworkRegistry on destination
        address delegate; // delegate: address that can revert or forceLocal on destination
    }

    function initialize(bytes memory _initializationParams) external;

    function isMainRegistry() external view returns (bool);

    function setUpdater(uint32 _updaterDomain, address _updater) external;
    function updateNetworkRegistry(uint32 _chainId, NetworkRegistry memory _registry) external;

    function syncSetNewMember(
        address _member,
        uint8 _activityMultiplier,
        uint32 _startDate,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable;

    function syncUpdateMember(
        address _member,
        uint8 _activityMultiplier,
        uint32[] memory chainIds,
        uint256[] memory relayerFees
    ) external payable;

    function syncBatchNewMember(
        address[] memory _members,
        uint8[] memory _activityMultipliers,
        uint32[] memory _startDates,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable;

    function syncBatchUpdateMember(
        address[] memory _members,
        uint8[] memory _activityMultipliers,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable;

    function syncUpdateSecondsActive(
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable;

    function syncUpdateSplits(
        address[] memory _sortedList,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable;

    function syncUpdateAll(
        address[] memory _sortedList,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable;

    function updateNetworkSplitMain(
        uint32[] memory _chainIds,
        address[] memory _splitsMain,
        uint256[] memory _relayerFees
    ) external payable;

    function updateNetworkSplit(
        uint32[] memory _chainIds,
        address[] memory _splits,
        uint32[] memory _splitDistributorFees,
        uint256[] memory _relayerFees
    ) external payable;

    function transferNetworkSplitControl(
        uint32[] memory _chainIds,
        address[] memory _newControllers,
        uint256[] memory _relayerFees
    ) external payable;
}
