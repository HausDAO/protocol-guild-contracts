// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { UD60x18 } from "@prb/math/src/UD60x18.sol";

import { MemberRegistry } from "../registry/MemberRegistry.sol";

/// @notice Member list size doesn't match the current amount of members in the registry
error InvalidSplit__MemberListSizeMismatch();
/// @notice Member list must be sorted in ascending order
/// @param _index index where a member address is not properly sorted
error InvalidSplit__AccountsOutOfOrder(uint256 _index);
/// @notice Member is not registered
/// @param _member member address
error Member__NotRegistered(address _member);

/**
 * @title A helper library to calculate member contributions and 0xSplit allocations using
 * the Protocol Guild MemberRegistry
 * @author DAOHaus
 * @notice A Library that calculates 0xSplit allocations based on time-based member contributions
 * @dev It uses the MemberRegistry.Members data model to feed the calculate function with
 * member's metadata
 */
library PGContribCalculator {
    /// @dev used to store individual members contributions prior getting overall split percentages
    struct MemberContribution {
        /// @notice member address
        address receiverAddress;
        /// @notice member calculated contribution
        /// @dev use calculateContributionOf(member)
        uint256 calcContribution;
    }

    // @dev constant to scale UINT values into percentages (1e6 == 100%)
    uint256 constant PERCENTAGE_SCALE = 1e6;

    /**
     * @notice Calculate split allocations
     * @dev Verifies if the address list is sorted, has no duplicates and is valid.
     * Formula to calculate individual allocations:
     *  - (SQRT(secondsActive * activityMultiplier) * PERCENTAGE_SCALE) / totalContributions
     *  - Total allocations from all members must be equal to 0xSplit PERCENTAGE_SCALE
     * The goal of the weighting formula is to reduce the total variance range of every member weight (hence using SQRT)
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @return _receivers list of eligible recipients (non-zero allocation) for the next split distribution
     * @return _percentAllocations list of split allocations for each eligible recipient
     */
    function calculate(
        MemberRegistry.Members storage self,
        address[] memory _sortedList
    ) public view returns (address[] memory _receivers, uint32[] memory _percentAllocations) {
        uint256 activeMembers;
        uint256 total;
        address previous;

        // verify list is current members and is sorted
        if (_sortedList.length != self.db.length) revert InvalidSplit__MemberListSizeMismatch(); // TODO:
        MemberContribution[] memory memberDistribution = new MemberContribution[](_sortedList.length);
        for (uint256 i = 0; i < _sortedList.length; ) {
            address memberAddress = _sortedList[i];
            MemberRegistry.Member memory member = getMember(self, memberAddress); // TODO:
            if (previous >= memberAddress) revert InvalidSplit__AccountsOutOfOrder(i);

            // ignore inactive members
            if (member.activityMultiplier > 0) {
                memberDistribution[i] = MemberContribution({
                    // TODO: how to allow recipient to assign different addresses per network?
                    receiverAddress: memberAddress,
                    calcContribution: calculateContributionOf(self, member) // TODO:
                });
                // get the total seconds in the last period
                // total = total + unwrap(wrap(members[memberIdx - 1].secondsActive).sqrt());
                total += memberDistribution[i].calcContribution;
                unchecked {
                    // gas optimization: very unlikely to overflow
                    ++activeMembers;
                }
                previous = memberAddress;
            }
            unchecked {
                ++i;
            }
        }

        // define variables for split params
        _receivers = new address[](activeMembers);
        _percentAllocations = new uint32[](activeMembers);

        // define variables for second loop
        uint32 runningTotal;
        uint256 nonZeroIndex; // index counter for non zero allocations
        // fill 0xSplits arrays with sorted list
        for (uint256 i = 0; i < _sortedList.length; ) {
            if (memberDistribution[i].calcContribution > 0) {
                _receivers[nonZeroIndex] = memberDistribution[i].receiverAddress;
                _percentAllocations[nonZeroIndex] = uint32(
                    (memberDistribution[i].calcContribution * PERCENTAGE_SCALE) / total
                );

                runningTotal += _percentAllocations[nonZeroIndex];
                unchecked {
                    ++nonZeroIndex;
                }
            }
            unchecked {
                ++i;
            }
        }

        // if there was any loss add it to the first account.
        if (activeMembers > 0 && runningTotal != PERCENTAGE_SCALE) {
            _percentAllocations[0] += uint32(PERCENTAGE_SCALE - runningTotal);
        }
    }

    /**
     * @notice gets a member metadata if registered
     * @dev throw an exception if member is not in the registry
     * @param _memberAddress member address
     * @return a Member metadata
     */
    function getMember(
        MemberRegistry.Members storage self,
        address _memberAddress
    ) internal view returns (MemberRegistry.Member memory) {
        if (self.index[_memberAddress] == 0) revert Member__NotRegistered(_memberAddress);
        return self.db[self.index[_memberAddress] - 1];
    }

    /**
     * @notice Calculates individual contribution based on member activity
     * @dev Contribution is calculated as SQRT(member.secondsActive)
     * @param _member Member metadata
     * @return calculated contribution as uint256 value
     */
    function calculateContributionOf(
        MemberRegistry.Members storage /*self*/,
        MemberRegistry.Member memory _member
    ) public pure returns (uint256) {
        return UD60x18.unwrap(UD60x18.wrap(_member.secondsActive).sqrt());
    }
}
