// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@prb/math/src/UD60x18.sol";

// import "hardhat/console.sol";

/**
 * CUSTOM ERRORS 
 */

/// @notice Member is already registered
/// @param _member member address
error Member__AlreadyRegistered(address _member);
/// @notice Member is not registered
/// @param _member member address
error Member__NotRegistered(address _member);
/// @notice Invalid member address
/// @param _member submitted member address
error InvalidMember__Address(address _member);
/// @notice Invalid member start date
/// @param _member member address
/// @param _startDate start date in seconds
error InvalidMember__StartDateInTheFuture(address _member, uint32 _startDate);
/// @notice Invalid value for member activity multiplier
/// @param _member member address
/// @param _activityMultiplier activity multiplier
error InvalidMember__ActivityMultiplier(address _member, uint32 _activityMultiplier);

/**
 * @title An on-chain member activity registry
 * @author DAOHaus
 * @notice Manage an on-chain member activity registry
 * @dev Includes minimal functions to implement an on-chain registry to track members & time active
 */
abstract contract MemberRegistry {

    /// @dev Member struct to track minimal information about member activity in the registry
    struct Member {
        /// @notice member address
        address account;
        /// @notice active time in seconds
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

    /// @notice current list members in the registry
    Member[] public members;
    /// @dev internal index counter for members
    uint256 internal count = 0;
    /// @notice member index in the registry
    /// @dev mapping between member registry and index assigned during registration
    mapping(address => uint256) public memberIdxs;

    /// @notice last timestamp where the registry got updated
    /// @dev should be assigned to uint32(block.timestamp)
    uint32 public lastActivityUpdate;

    /** 
     * EVENTS
    */

    /**
     * @notice emitted after a new member is added to the registry
     * @param _member member address
     * @param _startDate timestamp the member started activities in seconds
     * @param _activityMultiplier member activity multiplier
     */
    event NewMember(address indexed _member, uint32 _startDate, uint32 _activityMultiplier);
    /**
     * @notice emitted after the an existing member is updated
     * @param _member member address
     * @param _activityMultiplier new member activity multiplier
     */
    event UpdateMember(address indexed _member, uint32 _activityMultiplier);
    /**
     * @notice emitted after each time a member registry activity is updated
     * @param _member member address
     * @param _secondsActive updated activity in seconds since last registry update
     */
    event UpdateMemberSeconds(address indexed _member, uint32 _secondsActive);
    /**
     * @notice emitted after an registry activity update epoch is executed
     * @param _timestamp timestamp registry activity update epoch was executed
     * @param _totalMemberUpdates total updated members during the epoch
     */
    event RegistryActivityUpdate(uint32 _timestamp, uint256 _totalMemberUpdates);

    /**
     * @notice Adds a new member to the registry
     * @dev Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _member new member address
     * @param _activityMultiplier member activity multiplier
     * @param _startDate timestamp (in seconds) when the member got active
     */
    function _setNewMember(
        address _member,
        uint32 _activityMultiplier,
        uint32 _startDate
    ) internal virtual {
        if (_member == address(0)) revert InvalidMember__Address(_member);
        if (memberIdxs[_member] != 0) revert Member__AlreadyRegistered(_member);
        if (_activityMultiplier > 100) revert InvalidMember__ActivityMultiplier(_member, _activityMultiplier);
        if (_startDate > block.timestamp) revert InvalidMember__StartDateInTheFuture(_member, _startDate);

        // set to 0, will be updated in next update
        uint32 secondsActive = 0;
        members.push(
            Member(_member, secondsActive, _startDate, _activityMultiplier)
        );
        unchecked {
            memberIdxs[_member] = ++count;
        }
        emit NewMember(_member, _startDate, _activityMultiplier);
    }

    /**
     * @notice Updates the activity multiplier of an existing member
     * @dev Make sure member is in the registry
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _member member address
     * @param _activityMultiplier member new activity multiplier
     */
    function _updateMember(
        address _member,
        uint32 _activityMultiplier
    ) internal virtual {
        uint256 memberIdx = memberIdxs[_member];
        if(memberIdx == 0) revert Member__NotRegistered(_member);
        if(_activityMultiplier > 100) revert InvalidMember__ActivityMultiplier(_member, _activityMultiplier);

        Member storage member = members[memberIdxs[_member] - 1];
        member.activityMultiplier = _activityMultiplier;

        emit UpdateMember(_member, _activityMultiplier);
    }

    /**
     * @notice Updates seconds active for each member in the registry since the last update epoch
     * @dev manages a lastActivityUpdate state variable to update activity based on last update epoch.
     * However for new members it should update seconds based each member startDate.
     * Notice function is set as virtual so base functionality can be overriden by the implementer
     */
    function _updateSecondsActive() internal virtual {
        uint32 currentDate = uint32(block.timestamp);
        // update struct with total seconds active and seconds in last claim
        uint256 i;
        for (i = 0; i < members.length; ) {
            Member storage _member = members[i];
            uint32 newSecondsActive = 0;
            if (_member.activityMultiplier > 0) {
                uint32 initDate = _member.secondsActive > 0 ? lastActivityUpdate : _member.startDate;
                uint256 activeSeconds = currentDate - initDate;
                // multiply by modifier and divide by 100 to get modifier % of seconds
                newSecondsActive = uint32((activeSeconds * _member.activityMultiplier) / 100);
            }
            _member.secondsActive += newSecondsActive;
            emit UpdateMemberSeconds(_member.account, newSecondsActive);
            unchecked {
                i++; // gas optimization: very unlikely to overflow
            }
        }
        emit RegistryActivityUpdate(currentDate, i);
        lastActivityUpdate = currentDate;
    }

    /**
     * @notice gets a list of current members in the registry including all metadata
     * @return an array of Members
     */
    function getMembers() public view returns (Member[] memory) {
        return members;
    }

    /**
     * @notice gets a member metadata if registered
     * @dev throw an exception if member is not in the registry
     * @param _member member address
     * @return a Member metadata
     */
    function getMember(address _member) public view returns (Member memory) {
        if(memberIdxs[_member] == 0) revert Member__NotRegistered(_member);
        return members[memberIdxs[_member] - 1];
    }

    /**
     * @notice gets the current amount of members in the registry
     * @return total members in the registry
     */
    function totalMembers() public view returns (uint256) {
        return members.length;
    }

    /**
     * @notice gets all member's properties in the registry as separate property arrays
     * @return list of member addresses
     * @return list of member activity multipliers
     * @return list of member start dates
     */
    function getMembersProperties() public view returns (
        address[] memory,
        uint32[] memory,
        uint32[] memory
    ) {
        address[] memory _members = new address[](members.length);
        uint32[] memory _activityMultipliers = new uint32[](members.length);
        uint32[] memory _startDates = new uint32[](members.length);
        for (uint256 i = 0; i < members.length; ) {
            _members[i] = members[i].account;
            _activityMultipliers[i] = members[i].activityMultiplier;
            _startDates[i] = members[i].startDate;
            unchecked {
                i++;
            }
        }
        return (_members, _activityMultipliers, _startDates);
    }
}
