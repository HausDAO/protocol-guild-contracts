// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISplitManager {
    function calculate(address[] memory _sortedList) external view returns (address[] memory, uint32[] memory);
    function updateSplits(address[] memory _sortedList) external returns (address[] memory, uint32[] memory);
    function updateAll(address[] memory _sortedList) external returns (address[] memory, uint32[] memory);

    function updateAllAndDistributeETH(address[] memory _sortedList, address _distributorAddress) external;
    function updateAllAndDistributeERC20(address[] memory _sortedList, IERC20 _token, address _distributorAddress) external;
    
    function setSplitMain(address _splitMain) external;
    function setSplit(address _split, uint32 _splitDistributorFee) external;
    function transferSplitControl(address _newController) external;
    function acceptSplitControl() external;
    function cancelSplitControlTransfer() external;
}
