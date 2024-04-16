// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { NetworkRegistry } from "../NetworkRegistry.sol";

contract NetworkRegistryHarness is NetworkRegistry {
    function exposed__NetworkRegistry_init_unchained(
        address _connext,
        uint32 _updaterDomain,
        address _updater,
        address _splitMain,
        address _split
    ) external {
        super.__NetworkRegistry_init_unchained(_connext, _updaterDomain, _updater, _splitMain, _split);
    }

    function exposed__NetworkRegistry_init(
        address _connext,
        uint32 _updaterDomain,
        address _updater,
        address _splitMain,
        address _split,
        address _owner
    ) external {
        super.__NetworkRegistry_init(_connext, _updaterDomain, _updater, _splitMain, _split, _owner);
    }
}
