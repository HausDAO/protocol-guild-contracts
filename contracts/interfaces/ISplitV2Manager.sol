// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISplitManagerBase } from "./ISplitManagerBase.sol";
import { ISplitWalletV2 } from "./ISplitWalletV2.sol";

/**
 * @title A 0xSplit V2 manager interface
 * @author DAOHaus
 * @notice Allows a contract to become a 0xSplit V2 controller and trigger a split distribution based
 * on member contributions
 * @dev Includes minimal functions to calculate contributions and update 0xSplit V2 distributions.
 */
interface ISplitV2Manager is ISplitManagerBase {
    /**
     * @notice Calculate 0xSplit distribution allocations
     * @dev Verify if the address list is sorted, has no duplicates and is valid.
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @return _recipients list of eligible recipients (non-zero allocation) for the next split distribution
     * @return _allocations list of split allocations for each eligible recipient
     */
    function calculate(address[] memory _sortedList) external view returns (address[] memory, uint256[] memory);

    /**
     * @notice Updates the the SplitWalletV2 contract address.
     * @dev Should verify the 0xSplit contract exists and that it isn't immutable (no owner).
     * Also make sure ownership has already been handed over to the registry.
     * @param _splitWalletV2 new SplitWalletV2 contract address
     */
    function setSplit(address _splitWalletV2) external;

    /**
     * @notice Transfer ownership of the current SplitWalletV2 contract to `_newOwner`
     * @param _newOwner new owner address
     */
    function transferSplitOwnership(address _newOwner) external;

    /**
     * @notice Pause the current SplitWalletV2 contract
     * @param _paused lag to update SplitWalletV2 pausable state
     */
    function pauseSplit(bool _paused) external;

    /**
     * @notice Execute a batch of calls through SplitWallet
     * @dev The calls are executed in order, reverting if any of them fails. Should
     * only be called by the owner.
     * @param _calls The calls to execute
     * @return _blockNumber tx block number
     * @return _returnData data returned by each call
     */
    function splitWalletExecCalls(
        ISplitWalletV2.Call[] calldata _calls
    ) external payable returns (uint256 _blockNumber, bytes[] memory _returnData);
}
