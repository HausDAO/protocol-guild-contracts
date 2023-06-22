// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IBaal } from "@daohaus/baal-contracts/contracts/interfaces/IBaal.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { NetworkRegistry } from "./NetworkRegistry.sol";

contract NetworkRegistrySummoner {
    
    event NetworkRegistrySummoned(address indexed _registry, string _details, bytes _initializationParams);

    constructor() { }

    function summonRegistry(
        address _singleton,
        string memory _details,
        bytes memory _initializationParams
    ) external returns (address) {
        address registryAddress = Clones.clone(_singleton);
        NetworkRegistry registry = NetworkRegistry(registryAddress);
        registry.initialize(_initializationParams);
        emit NetworkRegistrySummoned(registryAddress, _details, _initializationParams);
        return address(registryAddress);
    }

    function summonRegistryDeterministic(
        address _singleton,
        string memory _details,
        bytes memory _initializationParams,
        bytes32 _saltNonce
    ) external returns (address) {
        address registryAddress = Clones.cloneDeterministic(_singleton, _saltNonce);
        NetworkRegistry registry = NetworkRegistry(registryAddress);
        registry.initialize(_initializationParams);
        emit NetworkRegistrySummoned(registryAddress, _details, _initializationParams);
        return registryAddress;
    }
}
