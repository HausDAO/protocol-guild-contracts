// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { GuildRegistry } from "../GuildRegistry.sol";
import { GuildRegistryV2 } from "../GuildRegistryV2.sol";

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

contract GuildRegistryV2Harness is GuildRegistryV2 {
    function exposed__GuildRegistryV2_init_unchained(address _split) external {
        super.__GuildRegistryV2_init_unchained(_split);
    }

    function exposed__GuildRegistryV2_init(address _split, address _owner) external {
        super.__GuildRegistryV2_init(_split, _owner);
    }

    function exposed__MemberRegistry_init_unchained() external {
        super.___MemberRegistry_init_unchained();
    }

    function exposed__MemberRegistry_init() external {
        super.__MemberRegistry_init();
    }
}
