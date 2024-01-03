// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import { ERC20, ERC20Capped } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";

/// @notice Basic ERC20 implementation.
contract TestERC20 is ERC20Capped {
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply
    ) ERC20(_name, _symbol) ERC20Capped(_totalSupply) {
        _mint(msg.sender, _totalSupply);
    }
}
