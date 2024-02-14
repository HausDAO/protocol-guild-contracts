// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IConnext } from "@connext/interfaces/core/IConnext.sol";
import { IXReceiver } from "@connext/interfaces/core/IXReceiver.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { UD60x18 } from "@prb/math/src/UD60x18.sol";

import { IMemberRegistry, INetworkMemberRegistry, ISplitManager } from "./interfaces/INetworkMemberRegistry.sol";
import { ISplitMain } from "./interfaces/ISplitMain.sol";
import { DataTypes } from "./libraries/DataTypes.sol";
import { PGContribCalculator } from "./libraries/PGContribCalculator.sol";
import { MemberRegistry } from "./registry/MemberRegistry.sol";

/**
 * CUSTOM ERRORS
 */

/// @notice Connext address cannot be 0x0
error NetworkRegistry__InvalidConnextAddress();
/// @notice Network Registry must have an owner or updater address assigned.
error NetworkRegistry__NeitherOwnableNorReplicaUpdater();
/// @notice The function is callable through Connext only.
error NetworkRegistry__ConnextOnly();
/// @notice The function is callable only by the owner or by the updater through Connext.
error NetworkRegistry__OnlyOwnerOrUpdater();
/// @notice The function is callable only on a main registry setup.
error NetworkRegistry__OnlyMainRegistry();
/// @notice The function is callable only on a replica registry setup.
error NetworkRegistry__OnlyReplicaRegistry();
/// @notice The function is callable only on a replica by the owner or through a sync event.
error NetworkRegistry__OnlyReplicaRegistrySync();
/// @notice msg value sent does not cover relayer fees
error NetworkRegistry__ValueSentLessThanRelayerFees();
/// @notice No replica registered on network with ID `_chainId`
error NetworkRegistry__NoReplicaOnNetwork(uint32 _chainId);
/// @notice Control of 0xSplit contract hasn't been transferred to the registry
error Split_ControlNotHandedOver();
/// @notice Function array parameter size mismatch
error NetWorkRegistry__ParamsSizeMismatch();
/// @notice Registry has invalid domainId or registry address values
error NetworkRegistry__InvalidReplica();
/// @notice 0xSplit doesn't exists or is immutable
error NetworkRegistry__InvalidOrImmutableSplit();
/// @notice Unauthorized to execute contract upgradeability
error NetworkRegistry__UnauthorizedToUpgrade();

/**
 * @title A cross-chain network registry to distribute funds escrowed in 0xSplit based on member activity
 * @author DAOHaus
 * @notice Manage a cross-chain member registry to distribute funds hold in 0xSplit based on member activity
 * @dev Uses Connext XApp architecture to manage main + multiple replica registries across different networks.
 * Features and important things to consider:
 * - There are syncing methods for adding/updating members, update registry activity & split funds across networks.
 * - Funds are escrowed in a 0xSplit contract so in order to split funds the NetworkRegistry must be set
 *   as the controller.
 * - A NetworkRegistry contract can be setup either as the main registry (updater == address(0)) or as a replica.
 * - A main NetworkRegistry should be owned by the community (i.e. Safe or a DAO)
 * - A replica NetworkRegistry must set the `updater` role to the main registry address and be registered in the main
 *   NetworkRegistry in order to get in sync.
 * - A replica NetworkRegistry should not be owned by anyone so it can only be controlled by the main registry (updater)
 *   however another Safe or DAO in the replica network can act as a trusted delegate in case of a halt of the Connext
 *   bridge which could potentially froze the 0xSplit funds as the replica NetworkRegistry and thus its controller will
 *   become inaccessible.
 */
contract NetworkRegistry is UUPSUpgradeable, OwnableUpgradeable, IXReceiver, INetworkMemberRegistry, MemberRegistry {
    using PGContribCalculator for DataTypes.Members;

    /// @notice Connext contract in the current domain
    IConnext public connext;
    /// @notice Connext domain ID where the updater contract is deployed
    /// @dev In case of a main registry, the updater domain must be set to 0
    /// @dev In case of a replica, the Connext Domain ID must match to the network where main registry lives
    uint32 public updaterDomain;
    /// @notice Address of the updater role that can update the registry through the Connext bridge
    /// @dev In case of a main registry, the updater role must not be assigned to anyone (address(0))
    /// @dev In case of a replica deployed on a L2, the updater role must be the main NetworkRegistry address
    address public updater;
    /// @notice replicas tied to the current registry
    /// @dev chainId => Registry
    // solhint-disable-next-line named-parameters-mapping
    mapping(uint32 => DataTypes.Registry) public replicaRegistry;
    /// @notice 0xSplit proxy contract
    /// @dev 0xSplitMain contract
    ISplitMain public splitMain;
    /// @notice 0xSplit contract where funds are hold
    /// @dev 0xSplitWallet contract
    address public split;

    /**
     * @notice A modifier for authenticated calls coming from the Connext bridge.
     * @dev This is an important security consideration. If the target contract
     * function should be authenticated, it must check three things:
     *    1) The originating call comes from the expected origin domain.
     *    2) The originating call comes from the expected source contract.
     *    3) The call to this contract comes from Connext.
     * This is useful when sending cross-chain messages for syncing / interacting with
     * replica registries.
     * @param _originSender source contract or updater
     * @param _origin origin domain ID
     */
    modifier onlyConnext(address _originSender, uint32 _origin) {
        if (_origin != updaterDomain || _originSender != updater || _msgSender() != address(connext))
            revert NetworkRegistry__ConnextOnly();
        _;
    }

    /**
     * @notice A modifier for methods that should be called either by the owner or by the updater through Connext
     * @dev (updater != address(0) && _msgSender() == address(this)) means a method is called
     * through the xReceive function
     */
    modifier onlyOwnerOrUpdater() {
        if (_msgSender() != owner() && (updater == address(0) || _msgSender() != address(this)))
            revert NetworkRegistry__OnlyOwnerOrUpdater();
        _;
    }

    /**
     * @notice A modifier for methods that can be only called on a main registry
     */
    modifier onlyMain() {
        if (!isMainRegistry()) revert NetworkRegistry__OnlyMainRegistry();
        _;
    }

    /**
     * @notice A modifier for methods that can be only called on a replica registry
     */
    modifier onlyReplica() {
        if (isMainRegistry()) revert NetworkRegistry__OnlyReplicaRegistry();
        _;
    }

    /**
     * @notice A modifier for methods that can be only called on a replica registry
     * through a cross-chain sync call
     * @dev (updater != address(0) && _msgSender() == address(this)) means method is called
     * through the xReceive function
     */
    modifier onlyReplicaSync() {
        if (updater == address(0) || _msgSender() != address(this)) revert NetworkRegistry__OnlyReplicaRegistrySync();
        _;
    }

    /**
     * @notice A modifier to check that parameters for cross-chain messaging are correct
     * @dev there must be a replica NetworkRegistry for each chainId. This is checked later on {validNetworkRegistry}
     * Total relayer fees must match the tx msg.value
     * @param _chainIds list of chainIds for each network a sync message should be forward to
     * @param _relayerFees relayer fee to be paid for executing a sync message on each network
     */
    modifier validNetworkParams(uint32[] memory _chainIds, uint256[] memory _relayerFees) {
        if (_chainIds.length != _relayerFees.length) revert NetWorkRegistry__ParamsSizeMismatch();
        uint256 totalRelayerFees;
        for (uint256 i = 0; i < _chainIds.length; ) {
            totalRelayerFees += _relayerFees[i];
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
        if (msg.value < totalRelayerFees) revert NetworkRegistry__ValueSentLessThanRelayerFees();
        _;
    }

    /**
     * @notice A modifier to validates there's a replica NetworkRegistry setup for the `_chainId` chainId
     */
    modifier validNetworkRegistry(uint32 _chainId) {
        if (replicaRegistry[_chainId].registryAddress == address(0))
            revert NetworkRegistry__NoReplicaOnNetwork(_chainId);
        _;
    }

    /**
     * EVENTS
     */

    /**
     * @notice emitted after the Connext and Updater role settings are updated
     * @param _connext Connext contract address
     * @param _updaterDomain new Updater domain ID
     * @param _updater new Updater address
     */
    event NewUpdaterConfig(address _connext, uint32 _updaterDomain, address _updater);
    /**
     * @notice emitted when the 0xSplit contract is updated
     * @param _splitMain new 0xSplitMain contract address
     * @param _split new 0xSplitWallet contract address
     */
    event SplitUpdated(address _splitMain, address _split);
    /**
     * @notice emitted when a new replica NetworkRegistry is added/updated
     * @param _chainId network chainId where the replica lives
     * @param _registryAddress replica contract address
     * @param _domainId Connext domain ID that correspond to the network where the replica lives
     * @param _delegate Delegate address in case of a bridge tx failure (currently not in use)
     */
    event NetworkRegistryUpdated(
        uint32 indexed _chainId,
        address indexed _registryAddress,
        uint32 indexed _domainId,
        address _delegate
    );
    /**
     * @notice emitted when a new split distribution is registered on the 0xSplit contract
     * @param _split 0xSplit contract address
     * @param _splitHash hash of the split distribution parameters
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     */
    event SplitsDistributionUpdated(address _split, bytes32 _splitHash, uint32 _splitDistributorFee);
    /**
     * @notice emitted when a registry synchronization message is forwarded through the Connext bridge
     * @param _transferId Transfer ID returned by Connext to identify the executed xCall
     * @param _chainId chainId of the destination network
     * @param _action Function selector for the action to be executed on the replica
     * @param _registryAddress replica NetworkRegistry address
     */
    event SyncMessageSubmitted(
        bytes32 indexed _transferId,
        uint32 indexed _chainId,
        bytes4 indexed _action,
        address _registryAddress
    );
    /**
     * @notice emitted when a registry synchronization message is received and executed on a replica
     * @param _transferId transfer ID returned by Connext that identifies the received xCall message
     * @param _originDomain Connext domain ID that correspond to the network where the sync message was submitted
     * @param _action Function selector for the action executed on the replica
     * @param _success Whether or not the action execution succeeded
     * @param _originSender main NetworkRegistry address that forwarded the sync message through the Connext bridge
     */
    event SyncActionPerformed(
        bytes32 indexed _transferId,
        uint32 indexed _originDomain,
        bytes4 indexed _action,
        bool _success,
        address _originSender
    );

    // constructor() {
    //     // disable initialization on singleton contract
    //     _disableInitializers();
    // }

    /**
     * @dev Setup the Connext bridge, Updater role & 0xSplit contracts settings.
     * If deploying a main registry both {updaterDomain} & {_updater} should be set to zero.
     * @param _connext Connext contract address in the current network
     * @param _updaterDomain Connext domain ID where the updater lives (replica only)
     * @param _updater Account that will update a registry through the Connext bridge (replica only)
     * @param _splitMain 0xSplit proxy contract
     * @param _split 0xSplit contract address
     */
    // solhint-disable-next-line func-name-mixedcase
    function __NetworkRegistry_init_unchained(
        address _connext,
        uint32 _updaterDomain,
        address _updater,
        address _splitMain,
        address _split
    ) internal onlyInitializing {
        connext = IConnext(_connext);
        updaterDomain = _updaterDomain;
        updater = _updater;
        splitMain = ISplitMain(_splitMain);
        split = _split;
        lastActivityUpdate = uint32(block.timestamp);
    }

    /**
     * @dev Executes initializers from parent contracts
     * @param _connext Connext contract address in the current network
     * @param _updaterDomain Connext domain ID where the updater lives (replica only)
     * @param _updater Account that will update the registry through the Connext bridge (replica only)
     * @param _splitMain 0xSplit proxy contract
     * @param _split 0xSplit contract address
     * @param _owner Account address that will own the registry contract
     */
    // solhint-disable-next-line func-name-mixedcase
    function __NetworkRegistry_init(
        address _connext,
        uint32 _updaterDomain,
        address _updater,
        address _splitMain,
        address _split,
        address _owner
    ) internal onlyInitializing {
        if (_connext == address(0)) revert NetworkRegistry__InvalidConnextAddress();
        address registryOwner = _owner == address(0) ? _msgSender() : _owner;
        __Ownable_init(registryOwner);
        if (_owner == address(0)) {
            if (_updater == address(0)) revert NetworkRegistry__NeitherOwnableNorReplicaUpdater();
            renounceOwnership();
        }
        __NetworkRegistry_init_unchained(_connext, _updaterDomain, _updater, _splitMain, _split);
    }

    /**
     * @notice Initializes the registry contract
     * @dev Initialization parameters are abi-encoded (i.e. through the NetworkRegistrySummoner contract)
     * @param _initializationParams abi-encoded parameters
     */
    function initialize(bytes memory _initializationParams) external virtual initializer {
        (
            address _connext,
            uint32 _updaterDomain,
            address _updater,
            address _splitMain,
            address _split,
            address _owner
        ) = abi.decode(_initializationParams, (address, uint32, address, address, address, address));
        __NetworkRegistry_init(_connext, _updaterDomain, _updater, _splitMain, _split, _owner);
    }

    /**
     * @dev Forwards a message to a replica NetworkRegistry through the Connext bridge
     * {validNetworkRegistry} verifies {_chainId} has a valid replica in {networkRegistry}
     * @param _chainId Network chainId where the replica lives
     * @param _callData Function calldata to forward
     * @param _relayerFee Fee to be paid to the Connext relayer
     * @return transferId ID returned by Connext that identifies the submitted xCall message
     */
    function _executeXCall(
        uint32 _chainId,
        bytes memory _callData,
        uint256 _relayerFee
    ) internal validNetworkRegistry(_chainId) returns (bytes32 transferId) {
        transferId = connext.xcall{ value: _relayerFee }(
            replicaRegistry[_chainId].domainId, // _destination: domain ID of the destination chain
            replicaRegistry[_chainId].registryAddress, // _to: address of the target contract (Pong)
            address(0), // _asset: use address zero for 0-value transfers
            replicaRegistry[_chainId].delegate, // _delegate: address that can revert or forceLocal on destination
            0, // _amount: 0 because no funds are being transferred
            0, // _slippage: can be anything between 0-10000 because no funds are being transferred
            _callData // _callData: the encoded calldata to send
        );
    }

    /**
     * @dev Executes a syncing action through Connext
     * @param _action Function selector of the action that will be executed on the replica
     * @param _callData Function calldata to forward
     * @param _chainId Network chainId where the replica lives
     * @param _relayerFee Fee to be paid to the Connext relayer
     */
    function _execSyncAction(bytes4 _action, bytes memory _callData, uint32 _chainId, uint256 _relayerFee) internal {
        bytes32 transferId = _executeXCall(_chainId, _callData, _relayerFee);
        emit SyncMessageSubmitted(transferId, _chainId, _action, replicaRegistry[_chainId].registryAddress);
    }

    /**
     * @dev Send syncing messages to registered networkRegistry replicas
     * @param _action Function selector of the action that will be executed on the replica
     * @param _callData Function calldata to forward
     * @param _chainIds A list of network chainIds where valid replicas live
     * @param _relayerFees A list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function _syncRegistries(
        bytes4 _action,
        bytes memory _callData,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) internal {
        for (uint256 i = 0; i < _chainIds.length; ) {
            _execSyncAction(_action, _callData, _chainIds[i], _relayerFees[i]);
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }

    /**
     * @notice Adds a new set of members to the registry
     * @dev Callable on a replica registry through the Connext bridge
     * @inheritdoc IMemberRegistry
     */
    function batchNewMembers(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] memory _startDates
    ) external onlyReplicaSync {
        _batchNewMembers(_members, _activityMultipliers, _startDates);
    }

    /**
     * @notice Adds a new set of members to the registry and sync with replicas
     * @dev Callable by the main registry owner
     * @inheritdoc INetworkMemberRegistry
     */
    function syncBatchNewMembers(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] memory _startDates,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner onlyMain validNetworkParams(_chainIds, _relayerFees) {
        _batchNewMembers(_members, _activityMultipliers, _startDates);
        bytes4 action = IMemberRegistry.batchNewMembers.selector;
        bytes memory callData = abi.encode(action, _members, _activityMultipliers, _startDates);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Updates the activity multiplier for a set of existing members
     * @dev Callable on a replica registry through the Connext bridge
     * @inheritdoc IMemberRegistry
     */
    function batchUpdateMembersActivity(
        address[] memory _members,
        uint32[] memory _activityMultipliers
    ) external onlyReplicaSync {
        _batchUpdateMembersActivity(_members, _activityMultipliers);
    }

    /**
     * @notice Updates the activity multiplier for a set of existing members and sync with replicas
     * @dev Callable by the main registry owner
     * @inheritdoc INetworkMemberRegistry
     */
    function syncBatchUpdateMembersActivity(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner onlyMain validNetworkParams(_chainIds, _relayerFees) {
        _batchUpdateMembersActivity(_members, _activityMultipliers);
        bytes4 action = IMemberRegistry.batchUpdateMembersActivity.selector;
        bytes memory callData = abi.encode(action, _members, _activityMultipliers);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Adds and/or updates a set of members on the registry
     * @dev Callable on a replica registry through the Connext bridge.
     * The syncNetworkMemberRegistry function ensures that array params will always
     * be the same length so there is no need for args validation
     * @inheritdoc IMemberRegistry
     */
    function addOrUpdateMembersBatch(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] memory _startDates,
        uint32[] memory _secondsActive
    ) external onlyReplicaSync {
        uint256 totalMembers = _members.length;
        for (uint256 i = 0; i < totalMembers; ) {
            uint256 memberId = _getMemberId(_members[i]);
            if (memberId == 0) {
                _setNewMember(_members[i], _activityMultipliers[i], _startDates[i]);
            } else {
                DataTypes.Member storage member = _getMemberById(memberId);
                // overrides member startDate and secondsActive in order to
                // get in sync with the main registry
                member.startDate = _startDates[i];
                member.secondsActive = _secondsActive[i];
                _updateMemberActivity(_members[i], _activityMultipliers[i]);
            }
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }

    /**
     * @notice Sync the state of a set of registry members across networks.
     * Useful whether you're looking to sync a new replica from scratch or a subset of members. For example
     * this function can be used to sync member's state in batches instead of doing a full registry sync
     * which could become pretty gas intensive with a growing list of members.
     * @dev Callable by the main registry owner
     * @inheritdoc INetworkMemberRegistry
     */
    function syncNetworkMemberRegistry(
        address[] memory _members,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner onlyMain validNetworkParams(_chainIds, _relayerFees) {
        (
            uint32[] memory _activityMultipliers,
            uint32[] memory _startDates,
            uint32[] memory _secondsActive
        ) = getMembersProperties(_members);
        bytes4 action = IMemberRegistry.addOrUpdateMembersBatch.selector;
        bytes memory callData = abi.encode(action, _members, _activityMultipliers, _startDates, _secondsActive);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Updates seconds active since the last update epoch for every member in the registry.
     * If _cutoffDate is zero its will be override with block.timestamp
     * @inheritdoc IMemberRegistry
     */
    function updateSecondsActive(uint32 _cutoffDate) external onlyReplica {
        if (_cutoffDate == 0) _cutoffDate = uint32(block.timestamp);
        _updateSecondsActive(_cutoffDate);
    }

    /**
     * @notice Updates activity for each member in the registry since the last update epoch and sync with replicas
     * @inheritdoc INetworkMemberRegistry
     */
    function syncUpdateSecondsActive(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyMain validNetworkParams(_chainIds, _relayerFees) {
        uint32 cutoffDate = uint32(block.timestamp);
        _updateSecondsActive(cutoffDate);
        bytes4 action = IMemberRegistry.updateSecondsActive.selector;
        bytes memory callData = abi.encode(action, cutoffDate);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Updates the 0xSplit distribution based on member activity during the last epoch
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set as reward for the address that executes the distribution
     */
    function _updateSplits(address[] memory _sortedList, uint32 _splitDistributorFee) internal {
        (address[] memory _receivers, uint32[] memory _percentAllocations) = calculate(_sortedList);
        // run splits update
        splitMain.updateSplit(split, _receivers, _percentAllocations, _splitDistributorFee);
        bytes32 splitHash = keccak256(abi.encodePacked(_receivers, _percentAllocations, _splitDistributorFee));
        emit SplitsDistributionUpdated(split, splitHash, _splitDistributorFee);
    }

    /**
     * @notice Updates the 0xSplit distribution based on member activity during the last epoch
     * Consider calling {updateSecondsActive} prior triggering a 0xSplit distribution update
     * @inheritdoc ISplitManager
     */
    function updateSplits(address[] memory _sortedList, uint32 _splitDistributorFee) external onlyReplica {
        _updateSplits(_sortedList, _splitDistributorFee);
    }

    /**
     * @notice Updates the 0xSplit distribution on all networks based on reported member activity during the last epoch.
     * Consider calling {syncUpdateSecondsActive} prior or after applying a 0xSplit distribution update
     * @dev Addresses in _sortedList must be in the member registry
     * @inheritdoc INetworkMemberRegistry
     */
    function syncUpdateSplits(
        address[] memory _sortedList,
        uint32 _splitDistributorFee,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyMain validNetworkParams(_chainIds, _relayerFees) {
        _updateSplits(_sortedList, _splitDistributorFee);
        bytes4 action = ISplitManager.updateSplits.selector;
        bytes memory callData = abi.encode(action, _sortedList, _splitDistributorFee);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Executes both {updateSecondsActive} to update registry member's activity and {updateSplits}
     * for split distribution
     * @inheritdoc ISplitManager
     */
    function updateAll(
        uint32 _cutoffDate,
        address[] memory _sortedList,
        uint32 _splitDistributorFee
    ) external onlyReplica {
        _updateSecondsActive(_cutoffDate);
        _updateSplits(_sortedList, _splitDistributorFee);
    }

    /**
     * @notice Executes both {updateSecondsActive} to update member's activity and {updateSplits}
     * for split distribution across all networks
     * @dev Addresses in _sortedList must be in the member registry
     * @inheritdoc INetworkMemberRegistry
     */
    function syncUpdateAll(
        address[] memory _sortedList,
        uint32 _splitDistributorFee,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyMain validNetworkParams(_chainIds, _relayerFees) {
        uint32 cutoffDate = uint32(block.timestamp);
        _updateSecondsActive(cutoffDate);
        _updateSplits(_sortedList, _splitDistributorFee);
        bytes4 action = ISplitManager.updateAll.selector;
        bytes memory callData = abi.encode(action, cutoffDate, _sortedList, _splitDistributorFee);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Calculate 0xSplit distribution allocations
     * @dev It uses the PGContribCalculator library to calculate member allocations
     * @inheritdoc ISplitManager
     */
    function calculate(
        address[] memory _sortedList
    ) public view virtual returns (address[] memory _receivers, uint32[] memory _percentAllocations) {
        (_receivers, _percentAllocations) = members.calculate(_sortedList);
    }

    /**
     * @notice Calculates a member individual contribution
     * @dev It uses the PGContribCalculator library
     * @inheritdoc ISplitManager
     */
    function calculateContributionOf(address _memberAddress) external view returns (uint256) {
        DataTypes.Member memory member = getMember(_memberAddress);
        return members.calculateContributionOf(member);
    }

    /**
     * @notice Calculates the sum of all member contributions
     * @dev omit members with activityMultiplier == 0
     * @inheritdoc ISplitManager
     */
    function calculateTotalContributions() external view returns (uint256 total) {
        uint256 totalRegistryMembers = totalMembers();
        for (uint256 i = 0; i < totalRegistryMembers; ) {
            DataTypes.Member memory member = _getMemberByIndex(i);
            if (member.activityMultiplier > 0) {
                total += members.calculateContributionOf(member);
            }
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }

    /**
     * @notice Returns whether or not a registry has been setup as a main registry
     * @inheritdoc INetworkMemberRegistry
     */
    function isMainRegistry() public view returns (bool) {
        return updater == address(0) && updaterDomain == 0;
    }

    /**
     * @notice Adds a replica NetworkRegistry that should get in sync with a main registry
     * @dev Callable by main registry owner
     * @inheritdoc INetworkMemberRegistry
     */
    function updateNetworkRegistry(
        uint32 _chainId,
        DataTypes.Registry memory _newRegistry
    ) external onlyOwner onlyMain {
        if (replicaRegistry[_chainId].registryAddress != address(0) && _newRegistry.registryAddress == address(0)) {
            delete replicaRegistry[_chainId];
        } else {
            if (_newRegistry.domainId == 0 || _newRegistry.registryAddress == address(0))
                revert NetworkRegistry__InvalidReplica();
            replicaRegistry[_chainId] = _newRegistry;
        }
        emit NetworkRegistryUpdated(
            _chainId,
            _newRegistry.registryAddress,
            _newRegistry.domainId,
            _newRegistry.delegate
        );
    }

    /**
     * @notice Upgrade replica NetworkRegistry implementation
     * @inheritdoc INetworkMemberRegistry
     */
    function upgradeNetworkRegistryImplementation(
        uint32[] memory _chainIds,
        address[] memory _newImplementations,
        bytes[] memory _data,
        uint256[] memory _relayerFees
    ) external payable onlyOwner onlyMain validNetworkParams(_chainIds, _relayerFees) {
        uint256 totalParams = _chainIds.length;
        if (_newImplementations.length != totalParams || _data.length != totalParams)
            revert NetWorkRegistry__ParamsSizeMismatch();
        bytes4 action = UUPSUpgradeable.upgradeToAndCall.selector;
        for (uint256 i = 0; i < totalParams; ) {
            bytes memory callData = abi.encode(action, _newImplementations[i], _data[i]);
            _execSyncAction(action, callData, _chainIds[i], _relayerFees[i]);
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }

    /**
     * @notice Set Connext and Updater config parameters
     * @dev Callable on both main and replica registries
     * @inheritdoc INetworkMemberRegistry
     */
    function setUpdaterConfig(address _connext, uint32 _updaterDomain, address _updater) external onlyOwnerOrUpdater {
        if (_connext == address(0)) revert NetworkRegistry__InvalidConnextAddress();
        connext = IConnext(_connext);
        updaterDomain = _updaterDomain;
        updater = _updater;
        emit NewUpdaterConfig(_connext, _updaterDomain, _updater);
    }

    /**
     * @notice Set Connext & Updater config settings for existing NetworkRegistry replicas via sync message
     * @dev Callable by main registry owner
     * @inheritdoc INetworkMemberRegistry
     */
    function setNetworkUpdaterConfig(
        uint32[] memory _chainIds,
        address[] memory _connextAddrs,
        uint32[] memory _updaterDomains,
        address[] memory _updaterAddrs,
        uint256[] memory _relayerFees
    ) external payable onlyOwner onlyMain validNetworkParams(_chainIds, _relayerFees) {
        uint256 totalParams = _chainIds.length;
        if (
            _connextAddrs.length != totalParams ||
            _updaterDomains.length != totalParams ||
            _updaterAddrs.length != totalParams
        ) revert NetWorkRegistry__ParamsSizeMismatch();
        bytes4 action = INetworkMemberRegistry.setUpdaterConfig.selector;
        for (uint256 i = 0; i < totalParams; ) {
            bytes memory callData = abi.encode(action, _connextAddrs[i], _updaterDomains[i], _updaterAddrs[i]);
            _execSyncAction(action, callData, _chainIds[i], _relayerFees[i]);
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }

    /**
     * @notice Updates the the 0xSplitMain proxy and 0xSplit contract addresses
     * @dev Callable on both main and replica registries
     * @inheritdoc ISplitManager
     */
    function setSplit(address _splitMain, address _split) external onlyOwnerOrUpdater {
        splitMain = ISplitMain(_splitMain);
        address currentController = splitMain.getController(_split);
        if (currentController == address(0)) revert NetworkRegistry__InvalidOrImmutableSplit();
        address newController = splitMain.getNewPotentialController(_split);
        if (currentController != address(this) && newController != address(this)) revert Split_ControlNotHandedOver();
        split = _split;
        emit SplitUpdated(_splitMain, split);
        acceptSplitControl();
    }

    /**
     * @notice Updates the 0xSplit contracts on existing NetworkRegistry replicas via sync message
     * @dev Callable by main registry owner
     * @inheritdoc INetworkMemberRegistry
     */
    function updateNetworkSplit(
        uint32[] memory _chainIds,
        address[] memory _splitsMain,
        address[] memory _splits,
        uint256[] memory _relayerFees
    ) external payable onlyOwner onlyMain validNetworkParams(_chainIds, _relayerFees) {
        uint256 totalParams = _chainIds.length;
        if (_splitsMain.length != totalParams || _splits.length != totalParams)
            revert NetWorkRegistry__ParamsSizeMismatch();
        bytes4 action = ISplitManager.setSplit.selector;
        for (uint256 i = 0; i < totalParams; ) {
            bytes memory callData = abi.encode(action, _splitsMain[i], _splits[i]);
            _execSyncAction(action, callData, _chainIds[i], _relayerFees[i]);
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }

    /**
     * @notice Transfer control of the current 0xSplit contract to `_newController`
     * @dev Callable on both main and replica registries
     * @inheritdoc ISplitManager
     */
    function transferSplitControl(address _newController) external onlyOwnerOrUpdater {
        splitMain.transferControl(split, _newController);
    }

    /**
     * @notice Submit sync messages to replicas in order to transfer control
     * of the current 0xSplit contract to `_newController`
     * @dev Callable by main registry owner
     * @inheritdoc INetworkMemberRegistry
     */
    function transferNetworkSplitControl(
        uint32[] memory _chainIds,
        address[] memory _newControllers,
        uint256[] memory _relayerFees
    ) external payable onlyOwner onlyMain validNetworkParams(_chainIds, _relayerFees) {
        uint256 totalParams = _chainIds.length;
        if (_newControllers.length != totalParams) revert NetWorkRegistry__ParamsSizeMismatch();
        bytes4 action = ISplitManager.transferSplitControl.selector;
        for (uint256 i = 0; i < totalParams; ) {
            bytes memory callData = abi.encode(action, _newControllers[i]);
            _execSyncAction(action, callData, _chainIds[i], _relayerFees[i]);
            unchecked {
                ++i; // gas optimization: very unlikely to overflow
            }
        }
    }

    /**
     * @notice Accepts control of the current 0xSplit contract
     * @dev Callable on both main and replica registries
     * @inheritdoc ISplitManager
     */
    function acceptSplitControl() public onlyOwnerOrUpdater {
        splitMain.acceptControl(split);
    }

    /**
     * @notice Submit sync messages to replicas in order to accept control of the current 0xSplit contract
     * @dev Callable by main registry owner
     * @inheritdoc INetworkMemberRegistry
     */
    function acceptNetworkSplitControl(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner onlyMain validNetworkParams(_chainIds, _relayerFees) {
        bytes4 action = ISplitManager.acceptSplitControl.selector;
        bytes memory callData = abi.encode(action);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Cancel controller transfer of the current 0xSplit contract
     * @dev Callable on both main and replica registries
     * @inheritdoc ISplitManager
     */
    function cancelSplitControlTransfer() external onlyOwnerOrUpdater {
        splitMain.cancelControlTransfer(split);
    }

    /**
     * @notice Submit sync messages to replicas in order to cancel a transfer control request
     * of the current 0xSplit contract
     * @dev Callable by main registry owner
     * @inheritdoc INetworkMemberRegistry
     */
    function cancelNetworkSplitControlTransfer(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner onlyMain validNetworkParams(_chainIds, _relayerFees) {
        bytes4 action = ISplitManager.cancelSplitControlTransfer.selector;
        bytes memory callData = abi.encode(action);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Accepts incoming sync messages from a main registry via Connext authenticated calls
     * @dev Forwarded messages can only be executed if the function selector is listed as valid action
     * @param _transferId transfer ID set by Connext to identify the incoming xCall message
     * @param _originSender main registry address that forwarded the xCall message through the Connext bridge
     * @param _origin Connext domain ID that correspond to the network where the the xCall message was submitted
     * @param _incomingCalldata message calldata to be used to invoke the required syncing action
     * @return any data returned by the action call
     */
    function xReceive(
        bytes32 _transferId,
        uint256 /* _amount */,
        address /* _asset */,
        address _originSender,
        uint32 _origin,
        bytes memory _incomingCalldata
    ) external onlyConnext(_originSender, _origin) returns (bytes memory) {
        bytes4 action = abi.decode(_incomingCalldata, (bytes4));
        bytes memory callData;
        if (action == IMemberRegistry.batchNewMembers.selector) {
            (, address[] memory _members, uint32[] memory _activityMultipliers, uint32[] memory _startDates) = abi
                .decode(_incomingCalldata, (bytes4, address[], uint32[], uint32[]));
            callData = abi.encodeWithSelector(action, _members, _activityMultipliers, _startDates);
        } else if (action == IMemberRegistry.batchUpdateMembersActivity.selector) {
            (, address[] memory _members, uint32[] memory _activityMultipliers) = abi.decode(
                _incomingCalldata,
                (bytes4, address[], uint32[])
            );
            callData = abi.encodeWithSelector(action, _members, _activityMultipliers);
        } else if (action == IMemberRegistry.addOrUpdateMembersBatch.selector) {
            (
                ,
                address[] memory _members,
                uint32[] memory _activityMultipliers,
                uint32[] memory _startDates,
                uint32[] memory _secondsActive
            ) = abi.decode(_incomingCalldata, (bytes4, address[], uint32[], uint32[], uint32[]));
            callData = abi.encodeWithSelector(action, _members, _activityMultipliers, _startDates, _secondsActive);
        } else if (action == IMemberRegistry.updateSecondsActive.selector) {
            (, uint32 cutoffDate) = abi.decode(_incomingCalldata, (bytes4, uint32));
            callData = abi.encodeWithSelector(action, cutoffDate);
        } else if (action == ISplitManager.updateSplits.selector) {
            (, address[] memory _sortedList, uint32 _splitDistributorFee) = abi.decode(
                _incomingCalldata,
                (bytes4, address[], uint32)
            );
            callData = abi.encodeWithSelector(action, _sortedList, _splitDistributorFee);
        } else if (action == ISplitManager.updateAll.selector) {
            (, uint32 cutoffDate, address[] memory _sortedList, uint32 _splitDistributorFee) = abi.decode(
                _incomingCalldata,
                (bytes4, uint32, address[], uint32)
            );
            callData = abi.encodeWithSelector(action, cutoffDate, _sortedList, _splitDistributorFee);
        } else if (action == INetworkMemberRegistry.setUpdaterConfig.selector) {
            (, address _connext, uint32 _updaterDomain, address _updater) = abi.decode(
                _incomingCalldata,
                (bytes4, address, uint32, address)
            );
            callData = abi.encodeWithSelector(action, _connext, _updaterDomain, _updater);
        } else if (action == ISplitManager.setSplit.selector) {
            (, address _splitMain, address _split) = abi.decode(_incomingCalldata, (bytes4, address, address));
            callData = abi.encodeWithSelector(action, _splitMain, _split);
        } else if (action == ISplitManager.transferSplitControl.selector) {
            (, address _newController) = abi.decode(_incomingCalldata, (bytes4, address));
            callData = abi.encodeWithSelector(action, _newController);
        } else if (action == ISplitManager.acceptSplitControl.selector) {
            callData = abi.encodeWithSelector(action);
        } else if (action == ISplitManager.cancelSplitControlTransfer.selector) {
            callData = abi.encodeWithSelector(action);
        } else if (action == UUPSUpgradeable.upgradeToAndCall.selector) {
            (, address _newImplementation, bytes memory _data) = abi.decode(
                _incomingCalldata,
                (bytes4, address, bytes)
            );
            callData = abi.encodeWithSelector(action, _newImplementation, _data);
        }

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory data) = address(this).call(callData);
        emit SyncActionPerformed(_transferId, _origin, action, success, _originSender);
        return data;
    }

    /**
     * @dev Function that should revert when `msg.sender` is not authorized to upgrade the contract.
     */
    function _authorizeUpgrade(address /*newImplementation*/) internal view override {
        if (_msgSender() != owner() && (updater == address(0) || _msgSender() != address(this)))
            revert NetworkRegistry__UnauthorizedToUpgrade();
    }

    // solhint-disable-next-line state-visibility
    uint256[49] __gap;
}
