// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IMemberRegistry } from "./IMemberRegistry.sol";
import { ISplitManager } from "./ISplitManager.sol";

/**
 * @title A cross-chain member activity registry in sync across multiple networks
 * @author DAOHaus
 * @notice Interface to manage a cross-chain member activity registry
 * @dev Includes minimal interfaces to implement a registry to track members,
 * their time active and get in synced with replicas living in other networks.
 * It should also be able to distribute funds escrowed on a 0xSplit contract based on member activity
 */
interface INetworkMemberRegistry is IMemberRegistry, ISplitManager {
    /// @dev Data structure to store NetworkRegistry config
    struct Registry {
        /// @notice Connext Domain ID where the NetworkRegistry lives
        uint32 domainId;
        /// @notice NetworkRegistry address
        address registryAddress;
        /// @notice delegate address that can revert or forceLocal on destination (not used)
        address delegate;
    }

    /**
     * @notice Initializes the registry contract
     * @dev Initialization parameters are abi-encoded through the NetworkRegistrySummoner contract.
     * It should also call initializer methods from parent contracts
     * @param _initializationParams abi-encoded parameters
     */
    function initialize(bytes memory _initializationParams) external;

    /**
     * @notice Update connext and updater settings on a replica registry
     * @dev Must only be called by a fallback contract owner.
     * - A main registry cannot set itself as a replica.
     * @param _connext Connext contract address
     * @param _updaterDomain Connext domain ID where the updater contract is deployed
     * @param _updater Main NetworkRegistry address that will update the registry through the Connext bridge
     */
    function setUpdaterConfig(address _connext, uint32 _updaterDomain, address _updater) external;

    /**
     * @notice Adds a replica NetworkRegistry to get in sync with the main registry
     * @dev Must only be called by contract owner. Sending zero values on {_newRegistry}
     * should disable an existing replica
     * @param _chainId Network chainId where the replica registry lives
     * @param _newRegistry Connext domain ID and replica NetworkRegistry address
     */
    function updateNetworkRegistry(uint32 _chainId, Registry memory _newRegistry) external;

    /**
     * @notice Returns True if the registry has been setup as Main or Replica
     * @dev Verifies if updater params are set to zero
     */
    function isMainRegistry() external view returns (bool);

    /**
     * @notice Adds a new member to the registry and sync with replicas
     * @dev It should forward messages to sync all registered replicas
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _member new member address
     * @param _activityMultiplier member activity multiplier
     * @param _startDate timestamp (in seconds) when the member got active
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncSetNewMember(
        address _member,
        uint32 _activityMultiplier,
        uint32 _startDate,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    /**
     * @notice Updates the activity multiplier of an existing member and sync with replicas
     * @dev It should forward messages to sync all registered replicas
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _member new member address
     * @param _activityMultiplier member new activity multiplier
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncUpdateMember(
        address _member,
        uint32 _activityMultiplier,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    /**
     * @notice Adds a new set of members to the registry and sync with replicas
     * @dev Must be used only if registries are in sync. It can only be called by the main registry owner
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _members A list of member addresses to be added to the registry
     * @param _activityMultipliers Activity multipliers for each new member
     * @param _startDates A list of dates when each member got active
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncBatchNewMember(
        address[] calldata _members,
        uint32[] calldata _activityMultipliers,
        uint32[] calldata _startDates,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    /**
     * @notice Sync all registry members. Useful if looking to sync a new replica from scratch
     * however action can be pretty gas intensive in case of the registry having a large amount of members
     * @dev For larger member registries calling this function can be costly or just not fit in a block gas limit
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncNetworkMemberRegistry(uint32[] calldata _chainIds, uint256[] calldata _relayerFees) external payable;

    /**
     * @notice Updates the activity multiplier for a set of existing members and sync with replicas
     * @dev Must be used only if registries are in sync. It can only be called by the main registry owner
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _members A list of existing members
     * @param _activityMultipliers New activity multipliers for each member
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncBatchUpdateMember(
        address[] calldata _members,
        uint32[] calldata _activityMultipliers,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    /**
     * @notice Updates activity for each member in the registry since the last update epoch and sync with replicas
     * @dev It should forward messages to sync all registered replicas
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncUpdateSecondsActive(uint32[] calldata _chainIds, uint256[] calldata _relayerFees) external payable;

    /**
     * @notice Updates the 0xSplit distribution on all networks based on member activity during the last epoch.
     * @dev It should forward messages to sync all registered replicas
     * - The registry must hold the controller role of the 0xSplit contract
     * - Addresses in _sortedList must be in the member registry
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncUpdateSplits(
        address[] calldata _sortedList,
        uint32 _splitDistributorFee,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    /**
     * @notice Updates both {updateSecondsActive} to update registry member activity and {updateSplits}
     * for split distribution across all networks
     * @dev permissionless action, however the registry must hold the controller role of the 0xSplit contract
     * Addresses in _sortedList must be in the member registry
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncUpdateAll(
        address[] calldata _sortedList,
        uint32 _splitDistributorFee,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;

    /**
     * @notice Updates the 0xSplit contracts on existing NetworkRegistry replicas via sync message
     * @dev It should forward messages to sync specified replicas
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _splitsMain a list of 0xSplit proxy addresses for each replica
     * @param _splits a list of 0xSplit addresses for each replica
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function updateNetworkSplit(
        uint32[] memory _chainIds,
        address[] memory _splitsMain,
        address[] memory _splits,
        uint256[] memory _relayerFees
    ) external payable;

    /**
     * @notice Sends sync messages to replicas in order to transfer control
     * of the current 0xSplit contract to `_newController`
     * @dev It should forward messages to sync specified replicas
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _newControllers new controller address per replica
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function transferNetworkSplitControl(
        uint32[] memory _chainIds,
        address[] memory _newControllers,
        uint256[] memory _relayerFees
    ) external payable;

    /**
     * @notice Sends sync messages to replicas in order to accept control of the current 0xSplit contract
     * @dev It should forward messages to sync specified replicas
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function acceptNetworkSplitControl(uint32[] calldata _chainIds, uint256[] calldata _relayerFees) external payable;

    /**
     * @notice Sends sync messages to replicas in order to cancel a transfer control request
     * of the current 0xSplit contract
     * @dev It should forward messages to sync specified replicas
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function cancelNetworkSplitControlTransfer(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;
}
