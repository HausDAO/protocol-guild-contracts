// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { IMemberRegistry } from "../interfaces/IMemberRegistry.sol";
import { DataTypes } from "../libraries/DataTypes.sol";
import {
    MemberRegistry__AlreadyRegistered,
    MemberRegistry__IndexOutOfBounds,
    MemberRegistry__InvalidActivityMultiplier,
    MemberRegistry__InvalidAddress,
    MemberRegistry__InvalidCutoffDate,
    MemberRegistry__NotRegistered,
    MemberRegistry__StartDateInTheFuture,
    Registry__ParamsSizeMismatch
} from "../utils/Errors.sol";

/**
 * @title An On-chain member registry
 * @author DAOHaus
 * @notice Manage an on-chain member activity registry
 * @dev Includes minimal functions to implement an on-chain registry that tracks members & activity time
 */
abstract contract MemberRegistry is Initializable, IMemberRegistry {
    /// @dev Activity multiplier upper bound
    uint32 internal constant MULTIPLIER_UPPER_BOUND = 100;
    /// @notice Member registry
    /// @dev members should be fetched with proper getters that interact with Members db and index
    DataTypes.Members internal members;
    /// @notice last timestamp where the registry got updated
    /// @dev should be assigned to uint32(block.timestamp)
    uint32 public lastActivityUpdate;

    /**
     * EVENTS
     */

    /**
     * @notice emitted after a new member is added to the registry
     * @param _memberAddress member address
     * @param _startDate timestamp the member started activities in seconds
     * @param _activityMultiplier member activity multiplier
     */
    event NewMember(address indexed _memberAddress, uint32 _startDate, uint32 _activityMultiplier);
    /**
     * @notice emitted after the an existing member is updated
     * @param _memberAddress member address
     * @param _activityMultiplier new member activity multiplier
     * @param _startDate timestamp the member started activities in seconds
     * @param _secondsActive member seconds active since last update
     */
    event UpdateMember(
        address indexed _memberAddress,
        uint32 _activityMultiplier,
        uint32 _startDate,
        uint32 _secondsActive
    );
    /**
     * @notice emitted after member is removed from the registry
     * @param _memberAddress member address
     */
    event RemoveMember(address indexed _memberAddress);
    /**
     * @notice emitted after each time a member registry activity is updated
     * @param _memberAddress member address
     * @param _secondsActive member activity in seconds since last registry update
     */
    event UpdateMemberSeconds(address indexed _memberAddress, uint32 _secondsActive);
    /**
     * @notice emitted after an registry activity update epoch is executed
     * @param _timestamp timestamp registry activity update epoch was executed
     * @param _totalMemberUpdates total updated members during the epoch
     */
    event RegistryActivityUpdate(uint32 _timestamp, uint256 _totalMemberUpdates);

    // solhint-disable-next-line func-name-mixedcase
    function ___MemberRegistry_init_unchained() internal onlyInitializing {
        lastActivityUpdate = uint32(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function __MemberRegistry_init() internal onlyInitializing {
        ___MemberRegistry_init_unchained();
    }

    /**
     * @notice Adds a new member to the registry
     * @dev Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time).
     * Notice function is set as virtual so base functionality can be overridden by the implementer.
     * @param _memberAddress new member address
     * @param _activityMultiplier member activity multiplier
     * @param _startDate timestamp (in seconds) when the member got active
     */
    function _setNewMember(address _memberAddress, uint32 _activityMultiplier, uint32 _startDate) internal virtual {
        if (_memberAddress == address(0)) revert MemberRegistry__InvalidAddress(_memberAddress);
        if (_getMemberId(_memberAddress) != 0) revert MemberRegistry__AlreadyRegistered(_memberAddress);
        if (_activityMultiplier > MULTIPLIER_UPPER_BOUND)
            revert MemberRegistry__InvalidActivityMultiplier(_memberAddress, _activityMultiplier);
        if (_startDate > block.timestamp) revert MemberRegistry__StartDateInTheFuture(_memberAddress, _startDate);

        // secondsActive set to 0, should be updated in next epoch
        members.db.push(DataTypes.Member(_memberAddress, 0, _startDate, _activityMultiplier));
        unchecked {
            members.index[_memberAddress] = ++members.count;
        }
        emit NewMember(_memberAddress, _startDate, _activityMultiplier);
    }

    /**
     * @notice Adds a new set of members to the registry
     * @param _members A list of member addresses to be added to the registry
     * @param _activityMultipliers Activity multipliers for each new member
     * @param _startDates A list of dates when each member got active
     */
    function _batchNewMembers(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] memory _startDates
    ) internal {
        uint256 batchSize = _members.length;
        if (_activityMultipliers.length != batchSize || _startDates.length != batchSize)
            revert Registry__ParamsSizeMismatch();
        for (uint256 i = 0; i < batchSize; ++i) {
            if (_activityMultipliers[i] == 0)
                revert MemberRegistry__InvalidActivityMultiplier(_members[i], _activityMultipliers[i]);
            _setNewMember(_members[i], _activityMultipliers[i], _startDates[i]);
        }
        members.totalActiveMembers += batchSize;
        // make sure registry is ahead of a member most recent start date
        lastActivityUpdate = uint32(block.timestamp);
    }

    /**
     * @notice Updates the activity multiplier for an existing member.
     * Consider updating a member activity multiplier for the next activity update epoch.
     * @dev {_getMember} function makes sure member is in the registry.
     * Activity multiplier can be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time).
     * Notice function is set as virtual so base functionality can be overridden by the implementer.
     * @param _memberAddress member address
     * @param _activityMultiplier member new activity multiplier
     */
    function _updateMemberActivity(address _memberAddress, uint32 _activityMultiplier) internal virtual {
        if (_activityMultiplier > MULTIPLIER_UPPER_BOUND)
            revert MemberRegistry__InvalidActivityMultiplier(_memberAddress, _activityMultiplier);

        DataTypes.Member storage member = _getMember(_memberAddress);
        if (member.secondsActive == 0 && _activityMultiplier == 0)
            revert MemberRegistry__InvalidActivityMultiplier(_memberAddress, _activityMultiplier);
        member.activityMultiplier = _activityMultiplier;

        emit UpdateMember(_memberAddress, _activityMultiplier, member.startDate, member.secondsActive);
    }

    /**
     * @notice Updates the activity multiplier for a set of existing members
     * @param _members A list of existing members
     * @param _activityMultipliers New activity multipliers for each member
     */
    function _batchUpdateMembersActivity(address[] memory _members, uint32[] memory _activityMultipliers) internal {
        uint256 batchSize = _members.length;
        if (_activityMultipliers.length != batchSize) revert Registry__ParamsSizeMismatch();
        for (uint256 i = 0; i < batchSize; ++i) {
            _updateMemberActivity(_members[i], _activityMultipliers[i]);
            if (_activityMultipliers[i] == 0) --members.totalActiveMembers;
        }
    }

    /**
     * @notice Removes an existing member from the registry.
     * @dev {_getMember} function makes sure member is in the registry.
     * Notice function is set as virtual so base functionality can be overridden by the implementer.
     * @param _memberAddress member address
     */
    function _removeMember(address _memberAddress) internal virtual {
        uint256 memberId = _getMemberId(_memberAddress);
        if (memberId == 0) revert MemberRegistry__NotRegistered(_memberAddress);
        DataTypes.Member storage member = _getMemberById(memberId);
        uint256 maxId = totalMembers();
        if (member.activityMultiplier > 0) --members.totalActiveMembers;
        if (memberId != maxId) {
            DataTypes.Member memory swapMember = _getMemberById(maxId);
            // swap index
            members.index[swapMember.account] = memberId;
            // swap member records
            member.account = swapMember.account;
            member.secondsActive = swapMember.secondsActive;
            member.startDate = swapMember.startDate;
            member.activityMultiplier = swapMember.activityMultiplier;
        }
        // update db
        members.db.pop();
        // update index
        members.index[_memberAddress] = 0;

        emit RemoveMember(_memberAddress);
    }

    /**
     * @notice Removes a set of existing members from the registry
     * @param _members A list of existing members
     */
    function _batchRemoveMembers(address[] memory _members) internal {
        uint256 batchSize = _members.length;
        for (uint256 i = 0; i < batchSize; ++i) {
            _removeMember(_members[i]);
        }
    }

    /**
     * @notice Updates seconds active for each member in the registry since the last update (epoch).
     * This function is called periodically (i.e. each quarter) so member's activity should be properly
     * updated before calling this function.
     * @dev Manages a {lastActivityUpdate} state variable to update member's activity time since the
     * last registry update. Member's seconds active are calculated as follows:
     * - For new members (secondsActive == 0) it will consider the period {_cutoffDate - member.startDate}
     * - Else for existing members it will consider the period {_cutoffDate - lastActivityUpdate}
     * If there are registered members previously marked as inactive (activityMultiplier == 0) that should be
     * considered in the current epoch, you should make the proper updates to their state prior executing the
     * function.
     * Notice function is set as virtual so base functionality can be overridden by the implementer.
     * @param _cutoffDate in seconds to calculate registry member's activity
     */
    function _updateSecondsActive(uint32 _cutoffDate) internal virtual {
        if (_cutoffDate <= lastActivityUpdate || _cutoffDate > block.timestamp)
            revert MemberRegistry__InvalidCutoffDate();
        uint256 membersLength = totalMembers();
        // update Member total seconds active
        for (uint256 i = 0; i < membersLength; ++i) {
            DataTypes.Member storage _member = _getMemberByIndex(i);
            uint32 newSecondsActive;
            if (_member.activityMultiplier > 0) {
                uint32 initDate = _member.secondsActive > 0 ? lastActivityUpdate : _member.startDate;
                uint256 totalSeconds = _cutoffDate - initDate;
                // divide activityMultiplier by 100 -> then multiply seconds active by "modifier %"
                newSecondsActive = uint32((totalSeconds * _member.activityMultiplier) / MULTIPLIER_UPPER_BOUND);
                _member.secondsActive += newSecondsActive;
            }
            emit UpdateMemberSeconds(_member.account, newSecondsActive);
        }
        emit RegistryActivityUpdate(_cutoffDate, membersLength);
        lastActivityUpdate = _cutoffDate;
    }

    /**
     * @dev Fetch a member by Members.db index position.
     * Methods calling this function must ensure that index is within the boundaries.
     * @param _memberIdx member index position in Members.db
     * @return Member metadata
     */
    function _getMemberByIndex(uint256 _memberIdx) internal view returns (DataTypes.Member storage) {
        return members.db[_memberIdx];
    }

    /**
     * @dev Fetch a member by record ID
     * _memberId must be greater than zero.
     * @param _memberId member record ID
     * @return Member metadata
     */
    function _getMemberById(uint256 _memberId) internal view returns (DataTypes.Member storage) {
        return _getMemberByIndex(_memberId - 1);
    }

    /**
     * @dev Query the Members.index by address to obtain a member's record ID.
     * Returns 0 if member is not registered.
     * @param _memberAddress member address
     * @return member record ID
     */
    function _getMemberId(address _memberAddress) internal view returns (uint256) {
        return members.index[_memberAddress];
    }

    /**
     * @dev Fetch a member's metadata from the registry.
     * It should throw an exception if member is not in the db
     * @param _memberAddress member address
     * @return member metadata
     */
    function _getMember(address _memberAddress) internal view returns (DataTypes.Member storage) {
        uint256 memberId = _getMemberId(_memberAddress);
        if (memberId == 0) revert MemberRegistry__NotRegistered(_memberAddress);
        return _getMemberById(memberId);
    }

    /**
     * @notice Fetch a member's metadata from the registry.
     * @dev It throws an exception if member is not in the db
     * @inheritdoc IMemberRegistry
     */
    function getMember(address _memberAddress) public view returns (DataTypes.Member memory member) {
        member = _getMember(_memberAddress);
    }

    /**
     * @notice Returns the total No of members in the registry
     * @inheritdoc IMemberRegistry
     */
    function totalMembers() public view returns (uint256) {
        return members.db.length;
    }

    /**
     * @notice Returns the total No of active members in the registry
     * @inheritdoc IMemberRegistry
     */
    function totalActiveMembers() public view returns (uint256) {
        return members.totalActiveMembers;
    }

    /**
     * @notice Fetch members metadata as separate property arrays
     * @inheritdoc IMemberRegistry
     */
    function getMembersProperties(
        address[] memory _members
    ) public view returns (uint32[] memory, uint32[] memory, uint32[] memory) {
        uint256 membersLength = _members.length;
        uint32[] memory activityMultipliers = new uint32[](membersLength);
        uint32[] memory startDates = new uint32[](membersLength);
        uint32[] memory secondsActive = new uint32[](membersLength);
        for (uint256 i = 0; i < membersLength; ++i) {
            DataTypes.Member memory member = _getMember(_members[i]);
            activityMultipliers[i] = member.activityMultiplier;
            startDates[i] = member.startDate;
            secondsActive[i] = member.secondsActive;
        }
        return (activityMultipliers, startDates, secondsActive);
    }

    /**
     * @notice Fetch all members from the registry
     * @inheritdoc IMemberRegistry
     */
    function getMembers() external view returns (DataTypes.Member[] memory) {
        return members.db;
    }

    /**
     * @notice Fetch a subset of members from the registry
     * @inheritdoc IMemberRegistry
     */
    function getMembersPaginated(
        uint256 _fromIndex,
        uint256 _toIndex
    ) external view returns (DataTypes.Member[] memory memberList) {
        uint256 maxIndex = totalMembers();
        if (_fromIndex >= maxIndex || _toIndex >= maxIndex) revert MemberRegistry__IndexOutOfBounds();
        memberList = new DataTypes.Member[](_toIndex - _fromIndex + 1);
        for (uint256 i = _fromIndex; i <= _toIndex; ++i) {
            DataTypes.Member memory member = _getMemberByIndex(i);
            memberList[i] = member;
        }
    }

    // solhint-disable-next-line state-visibility, var-name-mixedcase
    uint256[49] __gap_mr;
}
