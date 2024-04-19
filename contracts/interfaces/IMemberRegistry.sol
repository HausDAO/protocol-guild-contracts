// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { DataTypes } from "../libraries/DataTypes.sol";

/**
 * @title An on-chain member activity registry
 * @author DAOHaus
 * @notice Interface to manage an on-chain member activity registry
 * @dev Includes minimal interfaces to implement a registry to track members + activity time
 */
interface IMemberRegistry {
    /**
     * @notice Adds a new set of members to the registry
     * @dev Make sure array parameters are of the same length
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _members A list of member addresses to be added to the registry
     * @param _activityMultipliers Activity multipliers for each new member
     * @param _startDates A list of dates when each member got active
     */
    function batchNewMembers(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] memory _startDates
    ) external;

    /**
     * @notice Updates the activity multiplier for a set of existing members
     * @dev Make sure members are in the registry
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _members A list of existing members
     * @param _activityMultipliers New activity multipliers for each member
     */
    function batchUpdateMembersActivity(address[] memory _members, uint32[] memory _activityMultipliers) external;

    /**
     * @notice Remove a set of members from the registry
     * @param _members A list of existing members
     */
    function batchRemoveMembers(address[] memory _members) external;

    /**
     * @notice Adds and/or updates a set of members on the registry
     * @dev Make sure array parameters are of the same length
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _members A list of member addresses to be added to the registry
     * @param _activityMultipliers Activity multipliers for each new member
     * @param _startDates A list of dates when each member got active
     * @param _secondsActive A list of members reported activity in seconds
     */
    function addOrUpdateMembersBatch(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] memory _startDates,
        uint32[] memory _secondsActive
    ) external;

    /**
     * @notice Updates seconds active since the last update epoch for every member in the registry
     * @dev It should manage a lastActivityUpdate state variable to update activity based on last update epoch.
     * For new members it should update seconds based each member startDate.
     * @param _cutoffDate in seconds to calculate registry member's activity
     */
    function updateSecondsActive(uint32 _cutoffDate) external;

    /**
     * @notice Fetch a member's metadata
     * @dev It throws an exception if member is not in the registry
     * @param _memberAddress member address
     * @return member metadata
     */
    function getMember(address _memberAddress) external view returns (DataTypes.Member memory member);

    /**
     * @notice Returns the total No of members in the registry
     * @return total members in the registry
     */
    function totalMembers() external view returns (uint256);

    /**
     * @notice Returns the total No of active members in the registry
     * @return total active members in the registry
     */
    function totalActiveMembers() external view returns (uint256);

    /**
     * @notice Fetch members metadata as separate property arrays
     * @dev Function should revert if any address in _memberAddrs is not registered
     * @param _members list of registered member addresses
     * @return list of member activity multipliers
     * @return list of member start dates
     * @return list of member seconds active
     */
    function getMembersProperties(
        address[] memory _members
    ) external view returns (uint32[] memory, uint32[] memory, uint32[] memory);

    /**
     * @notice Fetch all members from the registry
     * @dev In case of a growing number of members in the registry
     * it is recommended to use {getMembersPaginated}
     * @return an array of Members in the registry
     */
    function getMembers() external view returns (DataTypes.Member[] memory);

    /**
     * @notice Fetch a subset of members from the registry
     * @param _fromIndex starting index in Member's db
     * @param _toIndex ending index in Member's db
     * @return an array of Members in the registry
     */
    function getMembersPaginated(
        uint256 _fromIndex,
        uint256 _toIndex
    ) external view returns (DataTypes.Member[] memory);
}
