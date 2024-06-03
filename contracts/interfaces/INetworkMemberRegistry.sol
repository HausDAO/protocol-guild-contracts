// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { INetworkRegistryManager } from "./INetworkRegistryManager.sol";
import { DataTypes } from "../libraries/DataTypes.sol";

/**
 * @title A cross-chain member activity registry in sync across multiple networks
 * @author DAOHaus
 * @notice Interface to manage a cross-chain member activity registry
 * @dev Includes minimal interfaces to implement a registry to keep track of members and their
 * activity time both in the home chain as well as in any replicas living in other networks.
 * It uses Connext XApp architecture to manage registries across different networks.
 * It offers minimal interfaces to manage a 0xSplit V1 contract.
 */
interface INetworkMemberRegistry is INetworkRegistryManager {
    /**
     * @notice Updates the 0xSplit contracts on existing NetworkRegistry replicas via sync message
     * @dev It should forward messages to stay in sync with provided replicas.
     * - {msg.value} must match the total fees required to pay the Connext relayer to execute
     * forwarded messages in the destination.
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
     * @notice Submit sync messages to replicas in order to transfer control
     * of the current 0xSplit contract to `_newController`
     * @dev It should forward messages to stay in sync with provided replicas.
     * - {msg.value} must match the total fees required to pay the Connext relayer to execute
     * forwarded messages in the destination.
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
     * @notice Submit sync messages to replicas in order to accept control of the current 0xSplit contract
     * @dev It should forward messages to stay in sync with provided replicas.
     * - {msg.value} must match the total fees required to pay the Connext relayer to execute
     * forwarded messages in the destination.
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function acceptNetworkSplitControl(uint32[] calldata _chainIds, uint256[] calldata _relayerFees) external payable;

    /**
     * @notice Submit sync messages to replicas in order to cancel a transfer control request
     * of the current 0xSplit contract
     * @dev It should forward messages to stay in sync with provided replicas.
     * - {msg.value} must match the total fees required to pay the Connext relayer to execute
     * forwarded messages in the destination.
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function cancelNetworkSplitControlTransfer(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable;
}
