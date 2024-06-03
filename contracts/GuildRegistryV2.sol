// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { ISplitV2Manager, ISplitManagerBase } from "./interfaces/ISplitV2Manager.sol";
import { ISplitWalletV2 } from "./interfaces/ISplitWalletV2.sol";
import { DataTypes } from "./libraries/DataTypes.sol";
import { PGContribCalculator } from "./libraries/PGContribCalculator.sol";
import { SplitV2Lib } from "./libraries/SplitV2.sol";
import { IMemberRegistry, MemberRegistry } from "./registry/MemberRegistry.sol";
import {
    Registry__ParamsSizeMismatch,
    Registry__UnauthorizedToUpgrade,
    Split__ControlNotHandedOver,
    Split_InvalidAddress,
    Split__InvalidOrImmutable
} from "./utils/Errors.sol";

/**
 * @title A guild registry to distribute funds escrowed in 0xSplit V2 based on member activity
 * @author DAOHaus
 * @notice Manage a time-weighted member registry to distribute funds hold in 0xSplit V2 based on member activity
 * @dev Features and important things to consider:
 * - There are methods for adding/updating members, update registry activity & split funds
 *   based on a time-weighted formula.
 * - Funds are escrowed in a 0xSplit contract so in order to split funds the GuildRegistry contract must be set
 *   as the controller.
 * - A main GuildRegistry should be owned by the community (i.e. Safe or a DAO),
 */
contract GuildRegistryV2 is ISplitV2Manager, UUPSUpgradeable, OwnableUpgradeable, MemberRegistry {
    using PGContribCalculator for DataTypes.Members;

    /// @dev empty slot to comply with V1 storage layout
    address private _emptySlot0;
    /// @notice 0xSplit contract where funds are hold
    /// @dev 0xSplitWallet contract
    ISplitWalletV2 public split;

    /**
     * EVENTS
     */

    /**
     * @notice emitted when the 0xSplit contract is updated
     * @param _split new SplitWalletV2 contract address
     */
    event SplitUpdated(address _split);
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
     * @param _split 0xSplit contract address
     */
    // solhint-disable-next-line func-name-mixedcase
    function __GuildRegistryV2_init_unchained(address _split) internal onlyInitializing {
        split = ISplitWalletV2(_split);
    }

    /**
     * @dev Executes initializers from parent contracts
     * @param _split 0xSplit contract address
     * @param _owner Account address that will own the registry contract
     */
    // solhint-disable-next-line func-name-mixedcase
    function __GuildRegistryV2_init(address _split, address _owner) internal onlyInitializing {
        if (_split == address(0)) revert Split_InvalidAddress();
        __UUPSUpgradeable_init();
        __Ownable_init(_owner);
        __MemberRegistry_init();
        __GuildRegistryV2_init_unchained(_split);
    }

    /**
     * @notice Initializes the registry contract
     * @dev Initialization parameters are abi-encoded
     * @param _initializationParams abi-encoded parameters
     */
    function initialize(bytes memory _initializationParams) external virtual initializer {
        (address _split, address _owner) = abi.decode(_initializationParams, (address, address));
        __GuildRegistryV2_init(_split, _owner);
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
        for (uint256 i; i < batchSize; ++i) {
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
     * @param _distributionIncentive split fee set as reward for the address that executes the distribution
     */
    function _updateSplitDistribution(address[] memory _sortedList, uint16 _distributionIncentive) internal {
        (address[] memory _recipients, uint256[] memory _allocations) = _calculate(
            _sortedList,
            PGContribCalculator.DEFAULT_TOTAL_ALLOCATION
        );
        split.updateSplit(
            SplitV2Lib.Split({
                recipients: _recipients,
                allocations: _allocations,
                totalAllocation: PGContribCalculator.DEFAULT_TOTAL_ALLOCATION,
                distributionIncentive: _distributionIncentive
            })
        );
        emit SplitsDistributionUpdated(address(split), split.splitHash(), _distributionIncentive);
    }

    /**
     * @notice Updates the 0xSplit distribution based on member activity during the last epoch.
     * Consider calling {updateSecondsActive} prior triggering a 0xSplit distribution update.
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _distributionIncentive reward incentive for the address that executes the distribution (max 6.5%)
     */
    function updateSplits(address[] memory _sortedList, uint16 _distributionIncentive) external {
        _updateSplitDistribution(_sortedList, _distributionIncentive);
    }

    /**
     * @notice Executes both {updateSecondsActive} to update registry member's activity and {updateSplits}
     * for split distribution. If _cutoffDate is zero its value will be overridden with the current block.timestamp
     * @param _cutoffDate in seconds to calculate registry member's activity
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _distributionIncentive reward incentive for the address that executes the distribution (max 6.5%)
     */
    function updateAll(uint32 _cutoffDate, address[] memory _sortedList, uint16 _distributionIncentive) external {
        _updateSecondsActive(_cutoffDate);
        _updateSplitDistribution(_sortedList, _distributionIncentive);
    }

    /**
     * @notice Calculate 0xSplit distribution allocations
     * @dev Verify if the address list is sorted, has no duplicates and is valid.
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _totalAllocation the total allocation of the split distribution
     * @return _recipients list of eligible recipients (non-zero allocation) for the next split distribution
     * @return _allocations list of split allocations for each eligible recipient
     */
    function _calculate(
        address[] memory _sortedList,
        uint256 _totalAllocation
    ) internal view returns (address[] memory _recipients, uint256[] memory _allocations) {
        (_recipients, _allocations) = members.calculateV2(_sortedList, _totalAllocation);
    }

    /**
     * @notice Calculate 0xSplit distribution allocations
     * @dev It uses the PGContribCalculator library to calculate member allocations
     * @inheritdoc ISplitV2Manager
     */
    function calculate(
        address[] memory _sortedList
    ) external view virtual returns (address[] memory _recipients, uint256[] memory _allocations) {
        (_recipients, _allocations) = _calculate(_sortedList, PGContribCalculator.DEFAULT_TOTAL_ALLOCATION);
    }

    /**
     * @notice Calculates a member individual contribution
     * @dev It uses the PGContribCalculator library
     * @inheritdoc ISplitManagerBase
     */
    function calculateContributionOf(address _memberAddress) external view returns (uint256) {
        DataTypes.Member memory member = getMember(_memberAddress);
        return members.calculateContributionOf(member);
    }

    /**
     * @notice Calculates the sum of all member contributions
     * @dev omit members with activityMultiplier == 0
     * @inheritdoc ISplitManagerBase
     */
    function calculateTotalContributions() external view returns (uint256 total) {
        uint256 totalRegistryMembers = totalMembers();
        for (uint256 i; i < totalRegistryMembers; ++i) {
            DataTypes.Member memory member = _getMemberByIndex(i);
            total += members.calculateContributionOf(member);
        }
    }

    /**
     * @notice Updates the the 0xSplitMain proxy and 0xSplit contract addresses
     * @inheritdoc ISplitV2Manager
     */
    function setSplit(address _splitWalletV2) external onlyOwner {
        split = ISplitWalletV2(_splitWalletV2);
        address currentOwner = split.owner();
        if (currentOwner == address(0)) revert Split__InvalidOrImmutable();
        if (currentOwner != address(this)) revert Split__ControlNotHandedOver();
        emit SplitUpdated(_splitWalletV2);
    }

    /**
     * @notice Transfer ownership of the current 0xSplit contract to `_newOwner`
     * @inheritdoc ISplitV2Manager
     */
    function transferSplitOwnership(address _newOwner) external onlyOwner {
        split.transferOwnership(_newOwner);
    }

    /**
     * @notice Pause the current SplitWalletV2 contract
     * @inheritdoc ISplitV2Manager
     */
    function pauseSplit(bool _paused) external onlyOwner {
        split.setPaused(_paused);
    }

    /**
     * @notice Execute a batch of calls through SplitWallet
     * @inheritdoc ISplitV2Manager
     */
    function splitWalletExecCalls(
        ISplitWalletV2.Call[] calldata _calls
    ) external payable onlyOwner returns (uint256 _blockNumber, bytes[] memory _returnData) {
        (_blockNumber, _returnData) = split.execCalls{ value: msg.value }(_calls);
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
