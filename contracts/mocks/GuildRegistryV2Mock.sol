// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IConnext } from "@connext/interfaces/core/IConnext.sol";

import { ISplitMain } from "../interfaces/ISplitMain.sol";
import { ISplitWalletV2 } from "../interfaces/ISplitWalletV2.sol";
import { GuildRegistry } from "../GuildRegistry.sol";
import { GuildRegistryV2 } from "../GuildRegistryV2.sol";

contract GuildRegistryV2Mock is GuildRegistry {
    function initialize(bytes memory _initializationParams) external virtual override reinitializer(2) {
        (address _splitMain, address _split, ) = abi.decode(_initializationParams, (address, address, address));
        splitMain = ISplitMain(_splitMain);
        split = _split;
    }
}

contract GuildRegistryV21Mock is GuildRegistryV2 {
    function initialize(bytes memory _initializationParams) external virtual override reinitializer(2) {
        (address _split, ) = abi.decode(_initializationParams, (address, address));
        split = ISplitWalletV2(_split);
    }
}
