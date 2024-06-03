// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { NetworkRegistry } from "../NetworkRegistry.sol";
import { NetworkRegistryV2 } from "../NetworkRegistryV2.sol";

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

    function exposed__MemberRegistry_init_unchained() external {
        super.___MemberRegistry_init_unchained();
    }

    function exposed__MemberRegistry_init() external {
        super.__MemberRegistry_init();
    }
}

contract NetworkRegistryV2Harness is NetworkRegistryV2 {
    function exposed__NetworkRegistryV2_init_unchained(
        address _connext,
        uint32 _updaterDomain,
        address _updater,
        address _split
    ) external {
        super.__NetworkRegistryV2_init_unchained(_connext, _updaterDomain, _updater, _split);
    }

    function exposed__NetworkRegistryV2_init(
        address _connext,
        uint32 _updaterDomain,
        address _updater,
        address _split,
        address _owner
    ) external {
        super.__NetworkRegistryV2_init(_connext, _updaterDomain, _updater, _split, _owner);
    }

    function exposed__MemberRegistry_init_unchained() external {
        super.___MemberRegistry_init_unchained();
    }

    function exposed__MemberRegistry_init() external {
        super.__MemberRegistry_init();
    }
}
