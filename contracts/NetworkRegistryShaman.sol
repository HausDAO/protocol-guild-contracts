// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IBaal } from "@daohaus/baal-contracts/contracts/interfaces/IBaal.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { NetworkRegistry } from "./NetworkRegistry.sol";

error NetworkRegistryShaman__NotManagerShaman();
error NetworkRegistryShaman__InvalidBaalAddress();

/**
 * @title A cross-chain network registry and Baal shaman module to distribute funds escrowed in 0xSplit based
 * on member activity.
 * @author DAOHaus
 * @notice Manage a cross-chain member registry that mints/burn Baal DAO shares and distribute funds
 * hold in 0xSplit based on member activity.
 * @dev Setup contract as a MolochV3 manager shaman module to mint/burn shares based on member activity.
 * Features and important things to consider:
 * - Inherits all the features of NetworkRegistry contract.
 * - It can be setup as a manager Shaman module on a MolochV3 DAO (codename Baal) to mint/burn shares when
 *   adding/updating members without the need of sending a separate/additional actions within a multicall proposal.
 * - You can setup the amount of {sharesToMint} to new members being added to the registry.
 * - You can enable/disable burning shares to inactive members (activityMultiplier == 0).
 * - As the DAO usually lives only on the main network, it is recommended to deploy a NetworkRegistryShaman
 *   as the main registry while replicas being NetworkRegistry type.
 */
contract NetworkRegistryShaman is NetworkRegistry {
    /// @notice MolochV3 DAO address
    /// @dev Baal address
    IBaal public baal;
    /// @notice The amount of shares to mint to new members
    uint256 public sharesToMint;
    /// @notice Wether or not to burn shares if a member activityMultiplier is set to zero
    bool public burnShares;

    constructor() {
        // disable initialization on singleton contract
        _disableInitializers();
    }

    /**
     * @notice A modifier to check if the registry has been setup as a manager shaman module
     */
    modifier isManagerShaman() {
        if (!isMainRegistry() || !baal.isManager(address(this))) revert NetworkRegistryShaman__NotManagerShaman();
        _;
    }

    /**
     * @notice emitted when the shaman config is updated
     * @param _sharesToMint new amount of shares to mint to registered members
     * @param _burnShares wether or not to burn shares to inactive members
     */
    event ShamanConfigUpdated(uint256 _sharesToMint, bool _burnShares);

    /**
     * @notice Initializes the registry shaman contract
     * @dev Initialization parameters are abi-encoded (i.e. through the NetworkRegistrySummoner contract)
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
        if (_baal == address(0)) revert NetworkRegistryShaman__InvalidBaalAddress();
        baal = IBaal(_baal);
        __NetworkRegistry_init(
            _connext,
            _updaterDomain,
            _updater,
            _splitMain,
            _split,
            baal.avatar() // NOTICE: Baal avatar is set as the registry owner
        );
        sharesToMint = _sharesToMint;
        burnShares = _burnShares;
    }

    /**
     * @notice Updates the shaman config parameters
     * @dev Callable by the registry owner
     * @param _sharesToMint Amount of shares to mint to new members
     * @param _burnShares Whether or not to burn shares if a member activityMultiplier is set to zero
     */
    function setShamanConfig(uint256 _sharesToMint, bool _burnShares) external onlyOwner {
        burnShares = _burnShares;
        sharesToMint = _sharesToMint;
        emit ShamanConfigUpdated(sharesToMint, burnShares);
    }

    /**
     * @notice Adds a new member to the registry and mints shares in the DAO
     * @dev {isManagerShaman} verifies the registry has a manager role in the DAO
     * @param _member new member address
     * @param _activityMultiplier member activity multiplier
     * @param _startDate timestamp (in seconds) when the member got active
     */
    function _setNewMember(
        address _member,
        uint32 _activityMultiplier,
        uint32 _startDate
    ) internal override isManagerShaman {
        super._setNewMember(_member, _activityMultiplier, _startDate);
        address[] memory _receivers = new address[](1);
        _receivers[0] = _member;
        uint256[] memory _amounts = new uint256[](1);
        _amounts[0] = sharesToMint;
        baal.mintShares(_receivers, _amounts);
    }

    /**
     * @notice Updates the activity multiplier for an existing member and mint/burn DAO shares if applicable
     * @dev {isManagerShaman} verifies the registry has a manager role in the DAO
     * @param _member member address
     * @param _activityMultiplier member new activity multiplier
     */
    function _updateMemberActivity(address _member, uint32 _activityMultiplier) internal override isManagerShaman {
        super._updateMemberActivity(_member, _activityMultiplier);
        address[] memory _to = new address[](1);
        _to[0] = _member;
        uint256[] memory _amounts = new uint256[](1);
        _amounts[0] = sharesToMint;
        if (_activityMultiplier > 0 && IERC20(baal.sharesToken()).balanceOf(_member) == 0) {
            baal.mintShares(_to, _amounts);
        } else if (_activityMultiplier == 0 && burnShares) {
            baal.burnShares(_to, _amounts);
        }
    }
}
