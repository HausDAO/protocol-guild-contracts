// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IConnext } from "@connext/interfaces/core/IConnext.sol";

import { ISplitMain } from "../interfaces/ISplitMain.sol";
import { GuildRegistry } from "../GuildRegistry.sol";

contract GuildRegistryV2Mock is GuildRegistry {
    function initialize(bytes memory _initializationParams) external virtual override reinitializer(2) {
        (address _splitMain, address _split, ) = abi.decode(_initializationParams, (address, address, address));
        splitMain = ISplitMain(_splitMain);
        split = _split;
    }
}
