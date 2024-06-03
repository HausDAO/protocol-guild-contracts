// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { INetworkRegistryManager } from "./INetworkRegistryManager.sol";
import { ISplitWalletV2 } from "./ISplitWalletV2.sol";
import { DataTypes } from "../libraries/DataTypes.sol";

/**
 * @title A cross-chain member activity registry in sync across multiple networks
 * @author DAOHaus
 * @notice Interface to manage a cross-chain member activity registry
 * @dev Includes minimal interfaces to implement a registry to keep track of members and their
 * activity time both in the home chain as well as in any replicas living in other networks.
 * It uses Connext XApp architecture to manage registries across different networks.
 * It offers minimal interfaces to manage a 0xSplit V2 contract.
 */
interface INetworkMemberRegistryV2 is INetworkRegistryManager {
    /**
     * @notice Updates the 0xSplit contracts on existing NetworkRegistry replicas via sync message
     * @dev {msg.value} must match the total fees required to pay the Connext relayer to execute
     * forwarded messages at destination.
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _splits a list of SplitWalletV2 addresses for each replica
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function updateNetworkSplit(
        uint32[] memory _chainIds,
        address[] memory _splits,
        uint256[] memory _relayerFees
    ) external payable;

    /**
     * @notice Submit sync messages to replicas in order to transfer ownership of the current
     * SplitWalletV2 contract
     * @dev {msg.value} must match the total fees required to pay the Connext relayer to execute
     * forwarded messages at destination.
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _newOwners new owner address per replica
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function transferNetworkSplitOwnership(
        uint32[] memory _chainIds,
        address[] memory _newOwners,
        uint256[] memory _relayerFees
    ) external payable;

    /**
     * @notice Submit sync messages to replicas in order to (un)pause the current SplitWalletV2 contract
     * @dev {msg.value} must match the total fees required to pay the Connext relayer to execute
     * forwarded messages at destination.
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _paused pase flag per replica
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function pauseNetworkSplit(
        uint32[] memory _chainIds,
        bool[] memory _paused,
        uint256[] memory _relayerFees
    ) external payable;

    /**
     * @notice Submit sync messages to replicas in order to execute a batch of calls through 0xSplitV2 SplitWallet
     * @dev The calls are executed in order, reverting if any of them fails. Can
     * only be called by the owner.
     * - {msg.value} must match the total fees required to pay the Connext relayer to execute
     * forwarded messages at destination.
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _calls batch of calldata to execute on each replica
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function networkSplitWalletExecCalls(
        uint32[] memory _chainIds,
        ISplitWalletV2.Call[] calldata _calls,
        uint256[] memory _relayerFees
    ) external payable;
}
