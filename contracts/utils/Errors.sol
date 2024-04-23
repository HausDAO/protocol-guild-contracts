// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * Registry Errors
 */

/// @notice Function array parameter size mismatch
error Registry__ParamsSizeMismatch();

///@notice cutoff date must not be greater than block timestamp
error MemberRegistry__InvalidCutoffDate();

/// @notice Member index out of bounds
error MemberRegistry__IndexOutOfBounds();

/// @notice Member is already registered
/// @param _memberAddress member address
error MemberRegistry__AlreadyRegistered(address _memberAddress);

/// @notice Member is not registered
/// @param _memberAddress member address
error MemberRegistry__NotRegistered(address _memberAddress);

/// @notice Invalid member address
/// @param _memberAddress submitted member address
error MemberRegistry__InvalidAddress(address _memberAddress);

/// @notice Invalid value for member activity multiplier given current state
/// @param _memberAddress member address
/// @param _activityMultiplier activity multiplier
error MemberRegistry__InvalidActivityMultiplier(address _memberAddress, uint32 _activityMultiplier);

/// @notice Invalid member start date
/// @param _memberAddress member address
/// @param _startDate start date in seconds
error MemberRegistry__StartDateInTheFuture(address _memberAddress, uint32 _startDate);

/**
 * 0xSplit related errors
 */

/// @notice Invalid 0xSplit contract addresses
error Split_InvalidAddress();
/// @notice Control of 0xSplit contract hasn't been transferred to the registry
error Split__ControlNotHandedOver();
/// @notice 0xSplit doesn't exists or is immutable
error Split__InvalidOrImmutable();

/**
 * Split distribution Errors
 */

/// @notice Member list size must match the amount of active members in the registry
error SplitDistribution__MemberListSizeMismatch();

/// @notice Member list must be sorted in ascending order
/// @param _index index where a member address is not properly sorted
error SplitDistribution__AccountsOutOfOrder(uint256 _index);

/// @notice The registry does not have any active member
error SplitDistribution__NoActiveMembers();

/// @notice Member is currently inactive
/// @param _member member address
error SplitDistribution__InactiveMember(address _member);

// @notice Empty Split distribution
error SplitDistribution__EmptyDistribution();

/**
 * UUPS Upgradeability Errors
 */

/// @notice Unauthorized to execute contract upgradeability
error Registry__UnauthorizedToUpgrade();
