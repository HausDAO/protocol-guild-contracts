// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/**
 * @title An on-chain member activity registry
 * @author DAOHaus
 * @notice Interface to manage an on-chain member activity registry
 * @dev Includes minimal interfaces to implement a registry to track members & active time
 */
interface IMemberRegistry {

    /**
     * @notice Adds a new member to the registry
     * @dev Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _member new member address
     * @param _activityMultiplier member activity multiplier
     * @param _startDate timestamp (in seconds) when the member got active
     */
    function setNewMember(address _member, uint32 _activityMultiplier, uint32 _startDate) external;
    /**
     * @notice Updates the activity multiplier of an existing member
     * @dev Make sure member is in the registry
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _member member address
     * @param _activityMultiplier member new activity multiplier
     */
    function updateMember(address _member, uint32 _activityMultiplier) external;
    /**
     * @notice Adds a new set of members to the registry
     * @dev Make sure array parameters are of the same length
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _members A list of member addresses to be added to the registry
     * @param _activityMultipliers Activity multipliers for each new member
     * @param _startDates A list of dates when each member got active
     */
    function batchNewMember(address[] memory _members, uint32[] memory _activityMultipliers, uint32[] memory _startDates) external;
    /**
     * @notice Updates the activity multiplier for a set of existing members
     * @dev Make sure members are in the registry
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _members A list of existing members
     * @param _activityMultipliers New activity multipliers for each member
     */
    function batchUpdateMember(address[] memory _members, uint32[] memory _activityMultipliers) external;
    /**
     * @notice Updates seconds active for each member in the registry since the last update epoch
     * @dev manages a lastActivityUpdate state variable to update activity based on last update epoch.
     * However for new members it should update seconds based each member startDate.
     */
    function updateSecondsActive() external;
}
