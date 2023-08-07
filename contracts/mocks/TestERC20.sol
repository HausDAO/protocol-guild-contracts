// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import { ERC20PresetFixedSupply } from "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetFixedSupply.sol";

/// @notice Basic ERC20 implementation.
contract TestERC20 is ERC20PresetFixedSupply {
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply
    ) ERC20PresetFixedSupply(_name, _symbol, _totalSupply, msg.sender) {}
}
