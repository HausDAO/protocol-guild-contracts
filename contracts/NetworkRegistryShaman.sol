// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IBaal } from "@daohaus/baal-contracts/contracts/interfaces/IBaal.sol";

import { NetworkRegistry } from "./NetworkRegistry.sol";

// import "hardhat/console.sol";

/**
 * @title A cross-chain network registry and Baal shaman module to distribute funds escrowed in 0xSplit based on member activity
 * @author DAOHaus
 * @notice Manage a cross-chain member registry that mints Baal DAO shares and distribute funds hold in 0xSplit based on member activity
 * @dev Setup as a MolochV3 manager shaman module to mint/burn shares based on member activity.
 * Features and important things to consider:
 * - Inherits all the features of NetworkRegistry contract
 * - It can be setup as a manager Shaman module on a MolochV3 DAO (codename Baal) to mint/burn shares when adding/updating members
 *   without the need of sending a separate proposal or additional proposal actions within a multicall proposal
 * - You can setup the amount of {sharesToMint} to new members being added to the registry
 * - You can enable/disable burning shares to inactive members (activityMultiplier == 0)
 * - As the DAO lives only on the main network, you just need to deploy one NetworkRegistryShaman as the main registry
 *   while replicas can be NetworkRegistry flavour
 */
contract NetworkRegistryShaman is NetworkRegistry {

    /// @notice MolochV3 DAO address
    /// @dev Baal address
    IBaal public baal;
    /// @notice The amount of shares to mint to new members
    uint256 public sharesToMint;
    /// @notice Wether or not to burn shares if a memeber activityMultiplier is set to zero
    bool public burnShares;

    /**
     * @notice A modifier to check if the registry has been setup as a manager shaman module
     */
    modifier isManagerShaman() {
        if (isMainRegistry()) {
            require(address(baal) != address(0) && baal.isManager(address(this)), "NetworkRegistryShaman: !init || ! manager");
        }
        _;
    }

    /**
     * @notice Initializs the registry shaman contract
     * @dev Initialization parameters are abi-encoded through the NetworkRegistrySummoner contract
     * @param _initializationParams abi-encoded parameters
     */
    function initialize(bytes memory _initializationParams) external override initializer {
        (
            address _connext,
            uint32 _updaterDomain,
            address _updater,
            address _splitMain,
            address _split,
            address _baal,
            uint256 _sharesToMint,
            bool _burnShares
        ) = abi.decode(_initializationParams, (address, uint32, address, address, address, address, uint256, bool));
        baal = IBaal(_baal);
        __NetworkRegistry_init(
            _connext,
            _updaterDomain,
            _updater,
            _splitMain,
            _split,
            baal.avatar() // NOTICE: Baal avatar as registry Owner
        );
        sharesToMint = _sharesToMint;
        burnShares = _burnShares;
    }

    /**
     * @notice Updates shaman config parameters
     * @dev Must only be called by owner or updater (latter should never apply)
     * @param _sharesToMint The amount of shares to mint to new members
     * @param _burnShares Wether or not to burn shares if a memeber activityMultiplier is set to zero
     */
    function setShamanConfig(uint256 _sharesToMint, bool _burnShares) external onlyOwnerOrUpdater {
        burnShares = _burnShares;
        sharesToMint = _sharesToMint;
    }

    /**
     * @notice Adds a new member to the registry and mints some shares in the DAO
     * @dev {isManagerShaman} verifies the registry has a manager role in the DAO
     * @param _member new member address
     * @param _activityMultiplier member activity multiplier
     * @param _startDate timestamp (in seconds) when the member got active
     */
    function setNewMember(
        address _member,
        uint32 _activityMultiplier,
        uint32 _startDate
    ) public override isManagerShaman {
        super.setNewMember(_member, _activityMultiplier, _startDate);
        if (isMainRegistry()) {
            address[] memory _receivers = new address[](1);
            _receivers[0] = _member;
            uint256[] memory _amounts = new uint256[](1);
            _amounts[0] = sharesToMint;
            baal.mintShares(_receivers, _amounts);
        }
    }

    /**
     * @notice Updates the activity multiplier of an existing member and burns DAO member shares if applicable
     * @dev {isManagerShaman} verifies the registry has a manager role in the DAO
     * @param _member member address
     * @param _activityMultiplier member new activity multiplier
     */
    function updateMember(
        address _member,
        uint32 _activityMultiplier
    ) public override isManagerShaman {
        super.updateMember(_member, _activityMultiplier);
        if (_activityMultiplier == 0 && isMainRegistry() && burnShares) {
            address[] memory _from = new address[](1);
            _from[0] = _member;
            uint256[] memory _amounts = new uint256[](1);
            _amounts[0] = sharesToMint;
            baal.burnShares(_from, _amounts);
        }
    }
}
