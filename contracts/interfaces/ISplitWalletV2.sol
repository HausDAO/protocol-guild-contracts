// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.23;

import { SplitV2Lib } from "../libraries/SplitV2.sol";

interface ISplitWalletV2 {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    function splitHash() external returns (bytes32);

    function distribute(SplitV2Lib.Split calldata _split, address _token, address _distributor) external;

    function distribute(
        SplitV2Lib.Split calldata _split,
        address _token,
        uint256 _distributeAmount,
        bool _performWarehouseTransfer,
        address _distributor
    ) external;

    /**
     * @notice Gets the total token balance of the split wallet and the warehouse.
     * @param _token The token to get the balance of.
     * @return splitBalance The token balance in the split wallet.
     * @return warehouseBalance The token balance in the warehouse of the split wallet.
     */
    function getSplitBalance(address _token) external view returns (uint256 splitBalance, uint256 warehouseBalance);

    /**
     * @notice Updates the split.
     * @dev Only the owner can call this function.
     * @param _split The new split struct.
     */
    function updateSplit(SplitV2Lib.Split calldata _split) external;

    function execCalls(
        Call[] calldata _calls
    ) external payable returns (uint256 blockNumber, bytes[] memory returnData);

    function setPaused(bool _paused) external;

    function paused() external returns (bool isPaused);

    function transferOwnership(address _owner) external;

    function owner() external returns (address owner);
}
