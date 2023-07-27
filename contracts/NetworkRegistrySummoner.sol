// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IBaal } from "@daohaus/baal-contracts/contracts/interfaces/IBaal.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { NetworkRegistry } from "./NetworkRegistry.sol";

/**
 * @title A NetworkRegistry minimal proxy factory using the EIP 1167 standard
 * @author DAOHaus
 * @notice Summons a new NetworkRegistry using a specified registry singleton
 * @dev Singleton contract must inherit NetworkRegistry
 */
contract NetworkRegistrySummoner {
    
    /**
     * @notice emitted after a new NetworkRegistry has been summoned
     * @param _registry new NetworkRegistry address
     * @param _details registry name/details as string
     * @param _initializationParams abi-encoded parameters used to setup the registry
     */
    event NetworkRegistrySummoned(address indexed _registry, string _details, bytes _initializationParams);

    constructor() { }

    /**
     * @notice Summons a new NetworkRegistry
     * @dev Singleton contract must inherit NetworkRegistry
     * @param _singleton NetworkRegistry singleton contract address
     * @param _details registry name/details as string
     * @param _initializationParams abi-encoded parameters used to setup the registry
     * @return the new NetworkRegistry address
     */
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

    /**
     * @notice Summons a new NetworkRegistry deterministically using the create2 opcode
     * @dev Singleton contract must inherit NetworkRegistry
     * Using the same {_singleton} {salt} multiple time will revert
     * @param _singleton NetoworkRegistry singleton contract address
     * @param _details registry name/details as string
     * @param _initializationParams abi-encoded parameters used to setup the registry
     * @param _saltNonce unique salt nonce for the contract deployment
     * @return the new NetworkRegistry address
     */
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
