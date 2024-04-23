// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { ISplitMain } from "./interfaces/ISplitMain.sol";
import { ISplitManager } from "./interfaces/ISplitManager.sol";
import { DataTypes } from "./libraries/DataTypes.sol";
import { PGContribCalculator } from "./libraries/PGContribCalculator.sol";
import { IMemberRegistry, MemberRegistry } from "./registry/MemberRegistry.sol";
import {
    Registry__ParamsSizeMismatch,
    Registry__UnauthorizedToUpgrade,
    Split__ControlNotHandedOver,
    Split_InvalidAddress,
    Split__InvalidOrImmutable
} from "./utils/Errors.sol";

/**
 * @title A guild registry to distribute funds escrowed in 0xSplit based on member activity
 * @author DAOHaus
 * @notice Manage a time-weighted member registry to distribute funds hold in 0xSplit based on member activity
 * @dev Features and important things to consider:
 * - There are methods for adding/updating members, update registry activity & split funds
 *   based on a time-weighted formula.
 * - Funds are escrowed in a 0xSplit contract so in order to split funds the GuildRegistry contract must be set
 *   as the controller.
 * - A main GuildRegistry should be owned by the community (i.e. Safe or a DAO),
 */
contract GuildRegistry is ISplitManager, UUPSUpgradeable, OwnableUpgradeable, MemberRegistry {
    using PGContribCalculator for DataTypes.Members;

    /// @notice 0xSplit proxy contract
    /// @dev 0xSplitMain contract
    ISplitMain public splitMain;
    /// @notice 0xSplit contract where funds are hold
    /// @dev 0xSplitWallet contract
    address public split;

    /**
     * EVENTS
     */

    /**
     * @notice emitted when the 0xSplit contract is updated
     * @param _splitMain new 0xSplitMain contract address
     * @param _split new 0xSplitWallet contract address
     */
    event SplitUpdated(address _splitMain, address _split);
    /**
     * @notice emitted when a new split distribution is registered on the 0xSplit contract
     * @param _split 0xSplit contract address
     * @param _splitHash hash of the split distribution parameters
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     */
    event SplitsDistributionUpdated(address _split, bytes32 _splitHash, uint32 _splitDistributorFee);

    constructor() {
        // disable initialization on singleton contract
        _disableInitializers();
    }

    /**
     * @dev Setup the 0xSplit contracts settings.
     * @param _splitMain 0xSplit proxy contract
     * @param _split 0xSplit contract address
     */
    // solhint-disable-next-line func-name-mixedcase
    function __GuildRegistry_init_unchained(address _splitMain, address _split) internal onlyInitializing {
        splitMain = ISplitMain(_splitMain);
        split = _split;
    }

    /**
     * @dev Executes initializers from parent contracts
     * @param _splitMain 0xSplit proxy contract
     * @param _split 0xSplit contract address
     * @param _owner Account address that will own the registry contract
     */
    // solhint-disable-next-line func-name-mixedcase
    function __GuildRegistry_init(address _splitMain, address _split, address _owner) internal onlyInitializing {
        if (_splitMain == address(0) || _split == address(0)) revert Split_InvalidAddress();
        __UUPSUpgradeable_init();
        __Ownable_init(_owner);
        __MemberRegistry_init();
        __GuildRegistry_init_unchained(_splitMain, _split);
    }

    /**
     * @notice Initializes the registry contract
     * @dev Initialization parameters are abi-encoded
     * @param _initializationParams abi-encoded parameters
     */
    function initialize(bytes memory _initializationParams) external virtual initializer {
        (address _splitMain, address _split, address _owner) = abi.decode(
            _initializationParams,
            (address, address, address)
        );
        __GuildRegistry_init(_splitMain, _split, _owner);
    }

    /**
     * @notice Adds a new set of members to the registry
     * @dev _activityMultipliers values must be > 0
     * @inheritdoc IMemberRegistry
     */
    function batchNewMembers(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] memory _startDates
    ) external onlyOwner {
        _batchNewMembers(_members, _activityMultipliers, _startDates);
    }

    /**
     * @notice Updates the activity multiplier for a set of existing members
     * @dev If a member's activityMultiplier is zero, the record is automatically removed from the registry.
     * @inheritdoc IMemberRegistry
     */
    function batchUpdateMembersActivity(
        address[] memory _members,
        uint32[] memory _activityMultipliers
    ) external onlyOwner {
        uint256 batchSize = _members.length;
        if (_activityMultipliers.length != batchSize) revert Registry__ParamsSizeMismatch();
        for (uint256 i = 0; i < batchSize; ++i) {
            if (_activityMultipliers[i] > 0) _updateMemberActivity(_members[i], _activityMultipliers[i]);
            else _removeMember(_members[i]);
        }
    }

    /**
     * @notice Remove a set of members from the registry
     * @inheritdoc IMemberRegistry
     */
    function batchRemoveMembers(address[] memory _members) external onlyOwner {
        _batchRemoveMembers(_members);
    }

    /**
     * @dev Updates registry activity since the last update epoch. Overrides MemberRegistry implementation
     * to check whether if _cutoffDate is zero its value will be overridden with the current block.timestamp
     */
    function _updateSecondsActive(uint32 _cutoffDate) internal override(MemberRegistry) {
        if (_cutoffDate == 0) _cutoffDate = uint32(block.timestamp);
        super._updateSecondsActive(_cutoffDate);
    }

    /**
     * @notice Updates seconds active since the last update epoch for every member in the registry.
     * If _cutoffDate is zero its value will be overridden with the current block.timestamp
     * @inheritdoc IMemberRegistry
     */
    function updateSecondsActive(uint32 _cutoffDate) external {
        _updateSecondsActive(_cutoffDate);
    }

    /**
     * @notice Updates the 0xSplit distribution based on member activity during the last epoch
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set as reward for the address that executes the distribution
     */
    function _updateSplitDistribution(address[] memory _sortedList, uint32 _splitDistributorFee) internal {
        (address[] memory _receivers, uint32[] memory _percentAllocations) = calculate(_sortedList);
        splitMain.updateSplit(split, _receivers, _percentAllocations, _splitDistributorFee);
        bytes32 splitHash = keccak256(abi.encodePacked(_receivers, _percentAllocations, _splitDistributorFee));
        emit SplitsDistributionUpdated(split, splitHash, _splitDistributorFee);
    }

    /**
     * @notice Updates the 0xSplit distribution based on member activity during the last epoch
     * Consider calling {updateSecondsActive} prior triggering a 0xSplit distribution update
     * @inheritdoc ISplitManager
     */
    function updateSplits(address[] memory _sortedList, uint32 _splitDistributorFee) external {
        _updateSplitDistribution(_sortedList, _splitDistributorFee);
    }

    /**
     * @notice Executes both {updateSecondsActive} to update registry member's activity and {updateSplits}
     * for split distribution. If _cutoffDate is zero its value will be overridden with the current block.timestamp
     * @inheritdoc ISplitManager
     */
    function updateAll(uint32 _cutoffDate, address[] memory _sortedList, uint32 _splitDistributorFee) external {
        _updateSecondsActive(_cutoffDate);
        _updateSplitDistribution(_sortedList, _splitDistributorFee);
    }

    /**
     * @notice Calculate 0xSplit distribution allocations
     * @dev It uses the PGContribCalculator library to calculate member allocations
     * @inheritdoc ISplitManager
     */
    function calculate(
        address[] memory _sortedList
    ) public view virtual returns (address[] memory _receivers, uint32[] memory _percentAllocations) {
        (_receivers, _percentAllocations) = members.calculate(_sortedList);
    }

    /**
     * @notice Calculates a member individual contribution
     * @dev It uses the PGContribCalculator library
     * @inheritdoc ISplitManager
     */
    function calculateContributionOf(address _memberAddress) external view returns (uint256) {
        DataTypes.Member memory member = getMember(_memberAddress);
        return members.calculateContributionOf(member);
    }

    /**
     * @notice Calculates the sum of all member contributions
     * @dev omit members with activityMultiplier == 0
     * @inheritdoc ISplitManager
     */
    function calculateTotalContributions() external view returns (uint256 total) {
        uint256 totalRegistryMembers = totalMembers();
        for (uint256 i = 0; i < totalRegistryMembers; ++i) {
            DataTypes.Member memory member = _getMemberByIndex(i);
            total += members.calculateContributionOf(member);
        }
    }

    /**
     * @notice Updates the the 0xSplitMain proxy and 0xSplit contract addresses
     * @dev Callable on both main and replica registries
     * @inheritdoc ISplitManager
     */
    function setSplit(address _splitMain, address _split) external onlyOwner {
        splitMain = ISplitMain(_splitMain);
        address currentController = splitMain.getController(_split);
        if (currentController == address(0)) revert Split__InvalidOrImmutable();
        address newController = splitMain.getNewPotentialController(_split);
        if (currentController != address(this) && newController != address(this)) revert Split__ControlNotHandedOver();
        split = _split;
        emit SplitUpdated(_splitMain, split);
        acceptSplitControl();
    }

    /**
     * @notice Transfer control of the current 0xSplit contract to `_newController`
     * @dev Callable on both main and replica registries
     * @inheritdoc ISplitManager
     */
    function transferSplitControl(address _newController) external onlyOwner {
        splitMain.transferControl(split, _newController);
    }

    /**
     * @notice Accepts control of the current 0xSplit contract
     * @dev Callable on both main and replica registries
     * @inheritdoc ISplitManager
     */
    function acceptSplitControl() public onlyOwner {
        splitMain.acceptControl(split);
    }

    /**
     * @notice Cancel controller transfer of the current 0xSplit contract
     * @dev Callable on both main and replica registries
     * @inheritdoc ISplitManager
     */
    function cancelSplitControlTransfer() external onlyOwner {
        splitMain.cancelControlTransfer(split);
    }

    /**
     * @dev Function that should revert when `msg.sender` is not authorized to upgrade the contract.
     */
    function _authorizeUpgrade(address /*newImplementation*/) internal view override {
        if (_msgSender() != owner()) revert Registry__UnauthorizedToUpgrade();
    }

    // solhint-disable-next-line state-visibility, var-name-mixedcase
    uint256[49] __gap_gr;
}
