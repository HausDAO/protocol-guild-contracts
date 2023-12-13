// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * CUSTOM ERRORS
 */

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
 * @title An on-chain member activity registry
 * @author DAOHaus
 * @notice Manage an on-chain member activity registry
 * @dev Includes minimal functions to implement an on-chain registry to track members & time active
 */
abstract contract MemberRegistry {
    /// @dev Member data model to track minimal information about member activity in the registry
    struct Member {
        /// @notice member address
        address account;
        /// @notice total active time in seconds
        uint32 secondsActive;
        /// @notice timestamp where member started activities
        /// @dev timestamp format in seconds
        uint32 startDate;
        /**
         * @notice member activity multiplier (i.e. 50 -> part-time 100 -> full-time)
         * @dev activity multiplier should be set as a 0-100 (%)
         * but it's up to the implementer to establish the multiplier boundaries
         */
        uint32 activityMultiplier;
    }

    /// @dev Data model to store a registry of Members
    struct Members {
        /// @notice list of members in the registry
        Member[] db;
        /// @dev internal counter to set a record ID for new members
        uint256 count;
        /// @notice index of member record IDs in the registry
        /// @dev mapping between member address and record ID assigned during registration
        // solhint-disable-next-line named-parameters-mapping
        mapping(address => uint256) index;
    }

    /// @notice Member registry
    /// @dev members should be fetched with proper getters that interact with Members db and index
    Members internal members;
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
     */
    event UpdateMember(address indexed _memberAddress, uint32 _activityMultiplier, uint32 _startDate);
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
     * @dev Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
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

        // set to 0, will be updated in next update
        uint32 secondsActive = 0;
        members.db.push(Member(_memberAddress, secondsActive, _startDate, _activityMultiplier));
        unchecked {
            members.index[_memberAddress] = ++members.count;
        }
        emit NewMember(_memberAddress, _startDate, _activityMultiplier);
    }

    /**
     * @notice Updates the activity multiplier of an existing member
     * @dev _getMember function makes sure member is in the registry
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * @param _memberAddress member address
     * @param _activityMultiplier member new activity multiplier
     */
    function _updateMember(address _memberAddress, uint32 _activityMultiplier) internal virtual {
        if (_activityMultiplier > MULTIPLIER_UPPER_BOUND)
            revert InvalidMember__ActivityMultiplier(_memberAddress, _activityMultiplier);

        Member storage member = _getMember(_memberAddress);
        member.activityMultiplier = _activityMultiplier;

        emit UpdateMember(_memberAddress, _activityMultiplier, member.startDate);
    }

    /**
     * @notice Updates seconds active for each member in the registry since the last update epoch
     * @dev manages a lastActivityUpdate state variable to update activity based on last update epoch.
     * However for new members it should update seconds based each member startDate.
     * Notice function is set as virtual so base functionality can be overridden by the implementer
     */
    function _updateSecondsActive() internal virtual {
        uint32 currentDate = uint32(block.timestamp);
        uint256 membersLength = totalMembers();
        // update Member total seconds active
        for (uint256 i = 0; i < membersLength; ) {
            Member storage _member = _getMemberByIndex(i);
            uint32 newSecondsActive = 0;
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
     * @dev Fetch a member by Members.db index position
     * It should revert if _memberIdx is greater than db size.
     * @param _memberIdx member index position in Members.db
     * @return Member metadata
     */
    function _getMemberByIndex(uint256 _memberIdx) internal view returns (Member storage) {
        if (_memberIdx >= members.db.length) revert Member__IndexOutOfBounds();
        return members.db[_memberIdx];
    }

    /**
     * @dev Fetch a member by record ID
     * _memberId must be greater than zero.
     * @param _memberId member record ID
     * @return Member metadata
     */
    function _getMemberById(uint256 _memberId) internal view returns (Member storage) {
        return _getMemberByIndex(_memberId - 1);
    }

    /**
     * @dev Query the Members.index by address to get a member record ID
     * Returns 0 if member is not registered.
     * @param _memberAddress member address
     * @return member record ID
     */
    function _getMemberId(address _memberAddress) internal view returns (uint256) {
        return members.index[_memberAddress];
    }

    /**
     * @dev Fetch a member metadata from storage
     * It should throw an exception if member is not in the registry
     * @param _memberAddress member address
     * @return member metadata
     */
    function _getMember(address _memberAddress) internal view returns (Member storage) {
        uint256 memberId = _getMemberId(_memberAddress);
        if (memberId == 0) revert Member__NotRegistered(_memberAddress);
        return _getMemberById(memberId);
    }

    /**
     * @notice Fetch a member metadata if registered
     * @dev It throws an exception if member is not in the registry
     * @param _memberAddress member address
     * @return member metadata
     */
    function getMember(address _memberAddress) public view returns (Member memory member) {
        member = _getMember(_memberAddress);
    }

    /**
     * @notice gets the current no. of members in the registry
     * @return total members in the registry
     */
    function totalMembers() public view returns (uint256) {
        return members.db.length;
    }

    /**
     * @notice gets all member's properties in the registry as separate property arrays
     * @return list of member addresses
     * @return list of member activity multipliers
     * @return list of member start dates
     */
    function getMembersProperties() public view returns (address[] memory, uint32[] memory, uint32[] memory) {
        uint256 membersLength = totalMembers();
        address[] memory _memberAddresses = new address[](membersLength);
        uint32[] memory _activityMultipliers = new uint32[](membersLength);
        uint32[] memory _startDates = new uint32[](membersLength);
        for (uint256 i = 0; i < membersLength; ) {
            Member memory member = members.db[i];
            _memberAddresses[i] = member.account;
            _activityMultipliers[i] = member.activityMultiplier;
            _startDates[i] = member.startDate;
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
        return (_memberAddresses, _activityMultipliers, _startDates);
    }

    /**
     * @notice gets a list of current members in the registry including all metadata
     * @return an array of Members in the registry
     */
    function getMembers() external view returns (Member[] memory) {
        return members.db;
    }
}
