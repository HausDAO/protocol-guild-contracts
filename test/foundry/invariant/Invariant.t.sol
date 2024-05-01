// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.23 <0.9.0;

import { StdInvariant } from "forge-std/StdInvariant.sol";

import { GuildRegistry } from "contracts/GuildRegistry.sol";
import { NetworkRegistry } from "contracts/NetworkRegistry.sol";
import { BaseTest } from "test/foundry/Base.t.sol";

abstract contract InvariantTest is BaseTest, StdInvariant {
    function setUp() public virtual override {
        BaseTest.setUp();
    }

    function addTargetSelectors(address _contractAddress, bytes4[] memory _selectors) internal {
        targetSelector(StdInvariant.FuzzSelector({ addr: _contractAddress, selectors: _selectors }));
    }
}
