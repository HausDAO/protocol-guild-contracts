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

    function setUpdaterConfig(address _connext, uint32 _updaterDomain, address _updater) external;
    function updateNetworkRegistry(uint32 _chainId, NetworkRegistry memory _registry) external;

    function syncSetNewMember(
        address _member,
        uint32 _activityMultiplier,
        uint32 _startDate,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    function syncUpdateMember(
        address _member,
        uint32 _activityMultiplier,
        uint32[] calldata chainIds,
        uint256[] calldata relayerFees
    ) external payable;

    function syncBatchNewMember(
        address[] calldata _members,
        uint32[] calldata _activityMultipliers,
        uint32[] calldata _startDates,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    function syncNetworkMemberRegistry(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    function syncBatchUpdateMember(
        address[] calldata _members,
        uint32[] calldata _activityMultipliers,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    function syncUpdateSecondsActive(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    function syncUpdateSplits(
        address[] calldata _sortedList,
        uint32 _splitDistributorFee,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    function syncUpdateAll(
        address[] calldata _sortedList,
        uint32 _splitDistributorFee,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    function updateNetworkSplit(
        uint32[] memory _chainIds,
        address[] memory _splitsMain,
        address[] memory _splits,
        uint256[] memory _relayerFees
    ) external payable;

    // function updateNetworkSplit(
    //     uint32[] memory _chainIds,
    //     address[] memory _splits,
    //     uint32[] memory _splitDistributorFees,
    //     uint256[] memory _relayerFees
    // ) external payable;

    function transferNetworkSplitControl(
        uint32[] memory _chainIds,
        address[] memory _newControllers,
        uint256[] memory _relayerFees
    ) external payable;

    function acceptNetworkSplitControl(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    function cancelNetworkSplitControlTransfer(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;
}
