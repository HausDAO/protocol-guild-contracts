// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IConnext } from "@connext/interfaces/core/IConnext.sol";

import { ISplitMain } from "../interfaces/ISplitMain.sol";
import { ISplitWalletV2 } from "../interfaces/ISplitWalletV2.sol";
import { NetworkRegistry } from "../NetworkRegistry.sol";
import { NetworkRegistryV2 } from "../NetworkRegistryV2.sol";

contract NetworkRegistryV2Mock is NetworkRegistry {
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

contract NetworkRegistryV21Mock is NetworkRegistryV2 {
    function initialize(bytes memory _initializationParams) external virtual override reinitializer(2) {
        (address _connext, uint32 _updaterDomain, address _updater, address _split, ) = abi.decode(
            _initializationParams,
            (address, uint32, address, address, address)
        );
        connext = IConnext(_connext);
        updaterDomain = _updaterDomain;
        updater = _updater;
        split = ISplitWalletV2(_split);
    }
}
