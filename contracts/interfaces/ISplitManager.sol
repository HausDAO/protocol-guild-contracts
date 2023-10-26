// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title A 0xSplit manager interface
 * @author DAOHaus
 * @notice Allows a contract to become a 0xSplit controller and set split distribution based on member contributions
 * @dev Includes minimal functions to calculate contributions and manage 0xSplit contract.
 * Calculate functions can be implemented in different flavours and use on-chain/off-chain metadata
 */
interface ISplitManager {
    /**
     * @notice Calculate split allocations
     * @dev Verify if the address list is sorted, has no duplicates and is valid.
     * Formula to calculate individual allocations:
     *  - (SQRT(secondsActive * activityMultiplier) * PERCENTAGE_SCALE) / totalContributions
     *  - Total allocations from all members must be equal to 0xSplit PERCENTAGE_SCALE
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @return _receivers list of eligible recipients (non-zero allocation) for the next split distribution
     * @return _percentAllocations list of split allocations for each eligible recipient
     */
    function calculate(address[] memory _sortedList) external view returns (address[] memory, uint32[] memory);

    /**
     * @notice Calculates individual contribution based on member activity / other metadata
     * @dev It could use member activity / other metadata
     * @param _memberAddress member address
     * @return calculated contribution as uin256 value
     */
    function calculateContributionOf(address _memberAddress) external view returns (uint256);

    /**
     * @notice Calculates all active member contributions
     * @dev omit members with activityMultiplier == 0
     * @return total total calculated contributions from active members
     */
    function calculateTotalContributions() external view returns (uint256 total);

    /**
     * @notice Updates the 0xSplit distribution based on member activity during the last epoch.
     * @dev permissionless action, however the registry must hold the controller role of the 0xSplit contract
     * Verify if the address list is sorted, has no duplicates and is valid.
     * Addresses in _sortedList must be in the member registry
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     */
    function updateSplits(address[] memory _sortedList, uint32 _splitDistributorFee) external;

    /**
     * @notice Updates both {updateSecondsActive} to update registry member activity and {updateSplits}
     * for split distribution
     * @dev permissionless action, however the registry must hold the controller role of the 0xSplit contract
     * Addresses in _sortedList must be in the member registry
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     */
    function updateAll(address[] memory _sortedList, uint32 _splitDistributorFee) external;

    /**
     * @notice Updates the addresses for the 0xSplitMain proxy and 0xSplit contract
     * @dev Should verify the 0xSplit contract exists and that it isn't immutable (no owner)
     * Also makes sure controller has been already handed over to the registry or it's waiting to be accepted.
     * If manager is already a potential controller, call acceptSplitControl()
     * @param _splitMain The address of the 0xSplitMain
     * @param _split The address of the 0xSplit contract
     */
    function setSplit(address _splitMain, address _split) external;

    /**
     * @notice Transfer control of the current 0xSplit contract to `_newController`
     * @dev Must only be called by the owner or updater
     * @param _newController new controller address
     */
    function transferSplitControl(address _newController) external;

    /**
     * @notice Accepts control of the current 0xSplit contract
     * @dev should accept control of the current 0xSplit in the state
     */
    function acceptSplitControl() external;

    /**
     * @notice Cancel controller transfer of the current 0xSplit contract
     * @dev should cancel a previous request to update the controller of the current 0xSplit contract
     */
    function cancelSplitControlTransfer() external;
}
