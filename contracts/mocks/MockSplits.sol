// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.7;

contract MockSplits {
    function createSplit(
        address[] memory accounts,
        uint32[] memory percentAllocations,
        uint32 distributorsFee,
        address controller
    ) external {

    }

    function updateSplit(
        address split,
        address[] memory accounts,
        uint32[] memory percentAllocations,
        uint32 distributorsFee
    ) external {

    }

    function transferControl(address split, address newController) external {

    }

    function acceptControl(address split) external {

    }

    function cancelControlTransfer(address split) external {
        
    }
}