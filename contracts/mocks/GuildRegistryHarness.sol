// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { GuildRegistry } from "../GuildRegistry.sol";

contract GuildRegistryHarness is GuildRegistry {
    function exposed__GuildRegistry_init_unchained(address _splitMain, address _split) external {
        super.__GuildRegistry_init_unchained(_splitMain, _split);
    }

    function exposed__GuildRegistry_init(address _splitMain, address _split, address _owner) external {
        super.__GuildRegistry_init(_splitMain, _split, _owner);
    }

    function exposed__MemberRegistry_init_unchained() external {
        super.___MemberRegistry_init_unchained();
    }

    function exposed__MemberRegistry_init() external {
        super.__MemberRegistry_init();
    }
}
