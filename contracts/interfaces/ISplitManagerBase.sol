// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title A 0xSplit manager interface
 * @author DAOHaus
 * @notice Base interface to allow a contract to become a 0xSplit controller and trigger a split distribution based
 * on member contributions
 * @dev Includes minimal functions to calculate contributions and update 0xSplit distributions.
 * Calculate functions can be implemented in different ways and use both on-chain and/or off-chain data
 */
interface ISplitManagerBase {
    /**
     * @notice Calculates a member individual contribution
     * @dev It could use member activity / other metadata
     * @param _memberAddress member address
     * @return calculated contribution as uin256 value
     */
    function calculateContributionOf(address _memberAddress) external view returns (uint256);

    /**
     * @notice Calculates the sum of all member contributions
     * @return total calculated contributions from active members
     */
    function calculateTotalContributions() external view returns (uint256 total);

    /**
     * @notice Updates the 0xSplit distribution based on member activity during the last epoch.
     * @dev Verify if the address list is sorted, has no duplicates and is valid
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set as reward for the address that executes the distribution (max 6.5%)
     */
    function updateSplits(address[] memory _sortedList, uint16 _splitDistributorFee) external;

    /**
     * @notice Executes both {updateSecondsActive} to update registry member's activity and {updateSplits}
     * for split distribution
     * @dev Verify if the address list is sorted, has no duplicates and is valid
     * @param _cutoffDate in seconds to calculate registry member's activity
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set as reward for the address that executes the distribution (max 6.5%)
     */
    function updateAll(uint32 _cutoffDate, address[] memory _sortedList, uint16 _splitDistributorFee) external;
}
