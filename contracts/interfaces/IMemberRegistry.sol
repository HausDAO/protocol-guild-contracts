// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface IMemberRegistry {
    function setNewMember(address _member, uint8 _activityMultiplier, uint32 _startDate) external;
    function updateMember(address _member, uint8 _activityMultiplier) external;
    function batchNewMember(address[] memory _members, uint8[] memory _activityMultipliers, uint32[] memory _startDates) external;
    function batchUpdateMember(address[] memory _members, uint8[] memory _activityMultipliers) external;

    function updateSecondsActive() external;
}
