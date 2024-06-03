// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ISplitManagerBase } from "./ISplitManagerBase.sol";

/**
 * @title A 0xSplit V1 manager interface
 * @author DAOHaus
 * @notice Allows a contract to become a 0xSplit V1 controller and trigger a split distribution based
 * on member contributions
 * @dev Includes minimal functions to calculate contributions and update 0xSplit distributions.
 */
interface ISplitManager is ISplitManagerBase {
    /**
     * @notice Calculate 0xSplit distribution allocations
     * @dev Verify if the address list is sorted, has no duplicates and is valid.
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @return _receivers list of eligible recipients (non-zero allocation) for the next split distribution
     * @return _percentAllocations list of split allocations for each eligible recipient
     */
    function calculate(address[] memory _sortedList) external view returns (address[] memory, uint32[] memory);

    /**
     * @notice Updates the the 0xSplitMain proxy and 0xSplit contract addresses
     * @dev Should verify the 0xSplit contract exists and that it isn't immutable (no owner).
     * Also make sure controller has been already handed over to the registry or it's waiting to be accepted.
     * @param _splitMain The address of the 0xSplitMain
     * @param _split The address of the 0xSplit contract
     */
    function setSplit(address _splitMain, address _split) external;

    /**
     * @notice Transfer control of the current 0xSplit contract to `_newController`
     * @param _newController new controller address
     */
    function transferSplitControl(address _newController) external;

    /**
     * @notice Accepts control of the current 0xSplit contract
     */
    function acceptSplitControl() external;

    /**
     * @notice Cancel controller transfer of the current 0xSplit contract
     * @dev Should cancel a previous request to update the controller of the current 0xSplit contract
     */
    function cancelSplitControlTransfer() external;
}
