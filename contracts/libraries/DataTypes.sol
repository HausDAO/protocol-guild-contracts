// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * @title A helper library that contains data types used for creating a registry data model
 * @author DAOHaus
 */
library DataTypes {
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
        /// @notice
        /// @dev total active members in the registry
        uint256 totalActiveMembers;
    }

    /// @dev Data structure to store a NetworkRegistry replica config
    struct Registry {
        /// @notice Connext Domain ID where the NetworkRegistry lives
        uint32 domainId;
        /// @notice NetworkRegistry address
        address registryAddress;
        /// @notice delegate address that can revert or forceLocal on destination (not used)
        /// @dev It is very unlikely for this use case to get a failed tx on the replica if it doesn't revert
        /// in the main registry first. More info at https://docs.connext.network/developers/guides/handling-failures
        address delegate;
    }
}
