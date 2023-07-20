// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title 0xSplit manager interface
 * @author DAOHaus
 * @notice Interface that allow a contract to become a controller and update a 0xSplit distribution
 */
interface ISplitManager {
    function calculate(address[] memory _sortedList) external view returns (address[] memory, uint32[] memory);
    function updateSplits(address[] memory _sortedList, uint32 _splitDistributorFee) external;
    function updateAll(address[] memory _sortedList, uint32 _splitDistributorFee) external;

    // TODO: might remove this
    // function updateAllAndDistributeETH(address[] memory _sortedList, address _distributorAddress, uint32 _splitDistributorFee) external;
    // function updateAllAndDistributeERC20(address[] memory _sortedList, IERC20 _token, address _distributorAddress, uint32 _splitDistributorFee) external;

    /**
     * @notice Updates the addresses for the 0xSplitMain proxy and 0xSplit contract
     * @dev Should make sure the 0xSplit contract exists and isn't immutable (no owner)
     * Also make sure controller has been already handed over to the manager or waiting to be accepted.
     * If manager is already a potential controller, call acceptSplitControl()
     * @param _splitMain The address of the 0xSplitMain
     * @param _split The address of the 0xSplit contract
     */
    function setSplit(address _splitMain, address _split) external;

    function transferSplitControl(address _newController) external;

    /**
     * @notice Accepts control of the current 0xSplit contract
     * @dev should accept control of the current 0xsplit in the state
     */
    function acceptSplitControl() external;
    function cancelSplitControlTransfer() external;
}
