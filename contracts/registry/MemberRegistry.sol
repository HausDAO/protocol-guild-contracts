// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@prb/math/src/UD60x18.sol";

// import "hardhat/console.sol";

//*********************************************************************//
// --------------------------- custom errors ------------------------- //
//*********************************************************************//
error Member__AlreadyRegistered(address _member);
error Member__NotRegistered(address _member);
error InvalidMember__Address(address _member);
error InvalidMember__StartDateInTheFuture(address _member, uint32 _startDate);
error InvalidMember__ActivityMultiplier(address _member, uint32 _activityMultiplier);

abstract contract MemberRegistry {
    struct Member {
        address account;
        uint32 secondsActive;
        uint32 startDate;
        uint32 activityMultiplier;
    }

    // iterable
    Member[] public members;
    uint256 internal count = 0;
    
    mapping(address => uint256) public memberIdxs;

    // store when a update happens
    uint32 public lastActivityUpdate;

    // EVENTS
    event NewMember(address indexed _member, uint32 _startDate, uint32 _activityMultiplier);
    event UpdateMember(address indexed _member, uint32 _activityMultiplier);
    event UpdateMemberSeconds(address indexed _member, uint32 _secondsActive);
    
    event RegistryActivityUpdate(uint32 _date, uint256 _totalMemberUpdates);

    // REGISTERY MODIFIERS

    // add member to registry
    // if member already exists, update their activity multiplier
    // if member does not exist, add them to the registry
    function _setNewMember(
        address _member,
        uint32 _activityMultiplier,
        uint32 _startDate
    ) internal {
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

    function _updateMember(
        address _member,
        uint32 _activityMultiplier // e.g. 0-100 %
    ) internal {
        uint256 memberIdx = memberIdxs[_member];
        if(memberIdx == 0) revert Member__NotRegistered(_member);
        if(_activityMultiplier > 100) revert InvalidMember__ActivityMultiplier(_member, _activityMultiplier);

        Member storage member = members[memberIdxs[_member] - 1];
        member.activityMultiplier = _activityMultiplier;

        emit UpdateMember(_member, _activityMultiplier);
    }

    // add seconds active to member from last update
    // for brand new members it will be an update from their start date
    // todo: this could be more generic, use a controller contract to update
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

    function calculateContributionOf(Member memory _member) public virtual pure returns (uint256) {
        return unwrap(wrap(_member.secondsActive).sqrt());
    }

    function getMembers() public view returns (Member[] memory) {
        return members;
    }

    function getMembersSplitProperties() public view returns(
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

    function getMember(address _member) public view returns (Member memory) {
        if(memberIdxs[_member] == 0) revert Member__NotRegistered(_member);
        return members[memberIdxs[_member] - 1];
    }

    function totalMembers() public view returns (uint256) {
        return members.length;
    }

    function calculateContributionOf(address _memberAddress) public view returns (uint256) {
        Member memory member = getMember(_memberAddress);
        return calculateContributionOf(member);
    }

    function calculateTotalContributions() public view returns (uint256 total) {
        for (uint256 i = 0; i < members.length; ) {
            total += calculateContributionOf(members[i]);
            unchecked {
                i++;
            }
        }
    }
}
