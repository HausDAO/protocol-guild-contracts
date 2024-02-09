// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IConnext } from "@connext/interfaces/core/IConnext.sol";

import { ISplitMain } from "../interfaces/ISplitMain.sol";
import { NetworkRegistry } from "../NetworkRegistry.sol";

contract NetworkRegistryV2 is NetworkRegistry {
    function initialize(bytes memory _initializationParams) external virtual override reinitializer(2) {
        (address _connext, uint32 _updaterDomain, address _updater, address _splitMain, address _split, ) = abi.decode(
            _initializationParams,
            (address, uint32, address, address, address, address)
        );
        connext = IConnext(_connext);
        updaterDomain = _updaterDomain;
        updater = _updater;
        splitMain = ISplitMain(_splitMain);
        split = _split;
    }
}
