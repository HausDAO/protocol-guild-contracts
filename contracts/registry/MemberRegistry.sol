// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IMemberRegistry } from "../interfaces/IMemberRegistry.sol";
import { DataTypes } from "../libraries/DataTypes.sol";
/**
 * CUSTOM ERRORS
 */

/// @notice Function array parameter size mismatch
error MemberRegistry__ParamsSizeMismatch();
/// @notice Member index out of bounds
error Member__IndexOutOfBounds();
/// @notice Member is already registered
/// @param _memberAddress member address
error Member__AlreadyRegistered(address _memberAddress);
/// @notice Member is not registered
/// @param _memberAddress member address
error Member__NotRegistered(address _memberAddress);
/// @notice Invalid member address
/// @param _memberAddress submitted member address
error InvalidMember__Address(address _memberAddress);
/// @notice Invalid member start date
/// @param _memberAddress member address
/// @param _startDate start date in seconds
error InvalidMember__StartDateInTheFuture(address _memberAddress, uint32 _startDate);
/// @notice Invalid value for member activity multiplier
/// @param _memberAddress member address
/// @param _activityMultiplier activity multiplier
error InvalidMember__ActivityMultiplier(address _memberAddress, uint32 _activityMultiplier);

/**
 * @title An On-chain member registry
 * @author DAOHaus
 * @notice Manage an on-chain member activity registry
 * @dev Includes minimal functions to implement an on-chain registry that tracks members & activity time
 */
abstract contract MemberRegistry is IMemberRegistry {
    /// @notice Member registry
    /// @dev members should be fetched with proper getters that interact with Members db and index
    DataTypes.Members internal members;
    /// @notice last timestamp where the registry got updated
    /// @dev should be assigned to uint32(block.timestamp)
    uint32 public lastActivityUpdate;
    /// @dev Activity multiplier upper bound
    uint32 internal constant MULTIPLIER_UPPER_BOUND = 100;

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

    /**
     * @notice Adds a new member to the registry
     * @dev Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time).
     * Notice function is set as virtual so base functionality can be overridden by the implementer.
     * @param _memberAddress new member address
     * @param _activityMultiplier member activity multiplier
     * @param _startDate timestamp (in seconds) when the member got active
     */
    function _setNewMember(address _memberAddress, uint32 _activityMultiplier, uint32 _startDate) internal virtual {
        if (_memberAddress == address(0)) revert InvalidMember__Address(_memberAddress);
        if (_getMemberId(_memberAddress) != 0) revert Member__AlreadyRegistered(_memberAddress);
        if (_activityMultiplier > MULTIPLIER_UPPER_BOUND)
            revert InvalidMember__ActivityMultiplier(_memberAddress, _activityMultiplier);
        if (_startDate > block.timestamp) revert InvalidMember__StartDateInTheFuture(_memberAddress, _startDate);

        // secondsActive set to 0, will be updated in next update
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
            revert MemberRegistry__ParamsSizeMismatch();
        for (uint256 i = 0; i < batchSize; ) {
            _setNewMember(_members[i], _activityMultipliers[i], _startDates[i]);
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }

    /**
     * @notice Updates the activity multiplier for an existing member
     * @dev {_getMember} function makes sure member is in the registry.
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time).
     * Notice function is set as virtual so base functionality can be overridden by the implementer
     * @param _memberAddress member address
     * @param _activityMultiplier member new activity multiplier
     */
    function _updateMemberActivity(address _memberAddress, uint32 _activityMultiplier) internal virtual {
        if (_activityMultiplier > MULTIPLIER_UPPER_BOUND)
            revert InvalidMember__ActivityMultiplier(_memberAddress, _activityMultiplier);

        DataTypes.Member storage member = _getMember(_memberAddress);
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
        if (_activityMultipliers.length != batchSize) revert MemberRegistry__ParamsSizeMismatch();
        for (uint256 i = 0; i < batchSize; ) {
            _updateMemberActivity(_members[i], _activityMultipliers[i]);
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }

    /**
     * @notice Updates seconds active for each member in the registry since the last update
     * @dev Manages a {lastActivityUpdate} state variable to update activity based on last update epoch.
     * However for new members it should update seconds based each member startDate.
     * Notice function is set as virtual so base functionality can be overridden by the implementer
     */
    function _updateSecondsActive() internal virtual {
        uint32 currentDate = uint32(block.timestamp);
        uint256 membersLength = totalMembers();
        // update Member total seconds active
        for (uint256 i = 0; i < membersLength; ) {
            DataTypes.Member storage _member = _getMemberByIndex(i);
            uint32 newSecondsActive;
            if (_member.activityMultiplier > 0) {
                uint32 initDate = _member.secondsActive > 0 ? lastActivityUpdate : _member.startDate;
                uint256 totalSeconds = currentDate - initDate;
                // divide activityMultiplier by 100 -> then multiply seconds active by "modifier %"
                newSecondsActive = uint32((totalSeconds * _member.activityMultiplier) / MULTIPLIER_UPPER_BOUND);
                _member.secondsActive += newSecondsActive;
            }
            emit UpdateMemberSeconds(_member.account, newSecondsActive);
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
        emit RegistryActivityUpdate(currentDate, membersLength);
        lastActivityUpdate = currentDate;
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
        if (memberId == 0) revert Member__NotRegistered(_memberAddress);
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
        for (uint256 i = 0; i < membersLength; ) {
            DataTypes.Member memory member = _getMember(_members[i]);
            activityMultipliers[i] = member.activityMultiplier;
            startDates[i] = member.startDate;
            secondsActive[i] = member.secondsActive;
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
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
        if (_fromIndex >= maxIndex || _toIndex >= maxIndex) revert Member__IndexOutOfBounds();
        memberList = new DataTypes.Member[](_toIndex - _fromIndex + 1);
        for (uint256 i = _fromIndex; i <= _toIndex; ) {
            DataTypes.Member memory member = _getMemberByIndex(i);
            memberList[i] = member;
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }
}
