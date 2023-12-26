// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { UD60x18 } from "@prb/math/src/UD60x18.sol";

import { DataTypes } from "../libraries/DataTypes.sol";
import { MemberRegistry } from "../registry/MemberRegistry.sol";

/// @notice Member list must be sorted in ascending order
/// @param _index index where a member address is not properly sorted
error InvalidSplit__AccountsOutOfOrder(uint256 _index);
/// @notice Member is not registered
/// @param _member member address
error InvalidSplit__MemberNotRegistered(address _member);

/**
 * @title A 0xSplit allocations calculator library
 * @author DAOHaus
 * @notice A Library that calculates 0xSplit allocations using ProtocolGuild MemberRegistry
 * time-based member contributions
 * @dev The DataTypes.Members data model is used to feed member's metadata to the calculate function
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
    uint256 private constant PERCENTAGE_SCALE = 1e6;

    /**
     * @notice Calculate 0xSplit allocations
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
        DataTypes.Members storage self,
        address[] memory _sortedList
    ) external view returns (address[] memory _receivers, uint32[] memory _percentAllocations) {
        uint256 activeMembers;
        uint256 total;
        address previous;

        MemberContribution[] memory memberDistribution = new MemberContribution[](_sortedList.length);
        for (uint256 i = 0; i < _sortedList.length; ) {
            address memberAddress = _sortedList[i];
            DataTypes.Member memory member = getMember(self, memberAddress);
            if (previous >= memberAddress) revert InvalidSplit__AccountsOutOfOrder(i);

            // ignore inactive members
            if (member.activityMultiplier > 0) {
                memberDistribution[i] = MemberContribution({
                    // TODO: how to allow recipient to assign different addresses per network?
                    receiverAddress: memberAddress,
                    calcContribution: calculateContributionOf(self, member)
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
     * @notice Fetch a member metadata from the registry
     * @dev throw an exception if member is not in the registry
     * @param _memberAddress member address
     * @return a Member's metadata
     */
    function getMember(
        DataTypes.Members storage self,
        address _memberAddress
    ) internal view returns (DataTypes.Member memory) {
        if (self.index[_memberAddress] == 0) revert InvalidSplit__MemberNotRegistered(_memberAddress);
        return self.db[self.index[_memberAddress] - 1];
    }

    /**
     * @notice Calculates individual contribution based on member activity
     * @dev Contribution is calculated as SQRT(member.secondsActive)
     * @param _member Member metadata
     * @return calculated contribution as uint256 value
     */
    function calculateContributionOf(
        DataTypes.Members storage /*self*/,
        DataTypes.Member memory _member
    ) public pure returns (uint256) {
        return UD60x18.unwrap(UD60x18.wrap(_member.secondsActive).sqrt());
    }
}
