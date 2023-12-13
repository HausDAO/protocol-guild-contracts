// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IConnext } from "@connext/interfaces/core/IConnext.sol";
import { IXReceiver } from "@connext/interfaces/core/IXReceiver.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UD60x18 } from "@prb/math/src/UD60x18.sol";

import { IMemberRegistry, INetworkMemberRegistry, ISplitManager } from "./interfaces/INetworkMemberRegistry.sol";
import { ISplitMain } from "./interfaces/ISplitMain.sol";
import { PGContribCalculator } from "./libraries/PGContribCalculator.sol";
import { MemberRegistry } from "./registry/MemberRegistry.sol";

/**
 * CUSTOM ERRORS
 */

/// @notice The function is callable through Connext only.
error NetworkRegistry__ConnextOnly();
/// @notice The function is callable only by contract owner or updater contract.
error NetworkRegistry__OnlyOwnerOrUpdater();
/// @notice The function is callable only by the updater contract.
error NetworkRegistry__OnlyUpdater();
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

/**
 * @title A cross-chain network registry to distribute funds escrowed in 0xSplit based on member activity
 * @author DAOHaus
 * @notice Manage a cross-chain member registry to distribute funds hold in 0xSplit based on member activity
 * @dev Uses Connext XApp architecture to manage main + multiple replica registries across different networks.
 * Features and important things to consider:
 * - There are syncing methods for adding/updating members, update registry activity & split funds across networks.
 * - Funds are escrowed in a 0xSplit contract so NetworkRegistry must be set as the controller in oder to split funds.
 * - A NetworkRegistry contract can be setup either as the main registry (updater == address(0)) or as a replica.
 * - A main NetworkRegistry should be owned by the community (i.e. Safe or a DAO)
 * - A replica NetworkRegistry must set the `updater` to the main registry address and be registered in the main
 *   NetworkRegistry in order to get synced.
 * - A replica NetworkRegistry should not be owned by anyone so it can only be controlled by the main registry (updater)
 *   however another Safe or DAO in the replica network can act as a trusted delegate in case of a halt of the Connext
 *   bridge which could potentially froze the 0xSplit funds as the replica NetworkRegistry and thus its controller will
 *   become inaccessible.
 */
contract NetworkRegistry is OwnableUpgradeable, IXReceiver, INetworkMemberRegistry, MemberRegistry {
    using PGContribCalculator for MemberRegistry.Members;

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
    mapping(uint32 => Registry) public replicaRegistry;
    /// @notice 0xSplit proxy contract
    /// @dev 0xSplitMain contract
    ISplitMain public splitMain;
    /// @notice 0xSplit contract where funds are hold
    /// @dev 0xSplitWallet contract
    address public split;

    /// @dev constant to scale UINT values into percentages (1e6 == 100%)
    uint256 internal constant PERCENTAGE_SCALE = 1e6;

    /// @dev used to store individual members contributions prior getting overall split percentages
    struct MemberContribution {
        /// @notice member address
        address receiverAddress;
        /// @notice member calculated contribution
        /// @dev use calculateContributionOf(member)
        uint256 calcContribution;
    }

    /**
     * @notice A modifier for authenticated calls coming from the Connext bridge.
     * @dev This is an important security consideration. If the target contract
     * function should be authenticated, it must check three things:
     *    1) The originating call comes from the expected origin domain.
     *    2) The originating call comes from the expected source contract.
     *    3) The call to this contract comes from Connext.
     * This is useful when sending cross-chain messages for syncing replica registries.
     * @param _originSender source contract or updater
     * @param _origin origin domain ID
     */
    modifier onlyConnext(address _originSender, uint32 _origin) {
        if (_origin != updaterDomain || _originSender != updater || _msgSender() != address(connext))
            revert NetworkRegistry__ConnextOnly();
        _;
    }

    /**
     * @notice A modifier for methods that should only be called by the updater a.k.a. main registry
     * @dev (updater != address(0) && _msgSender() == address(this)) means method is called
     * through the xReceive function
     */
    modifier onlyUpdater() {
        if (updater == address(0) || _msgSender() != address(this)) revert NetworkRegistry__OnlyUpdater();
        _;
    }

    /**
     * @notice A modifier for methods that should be called by owner or main registry only
     * @dev (updater != address(0) && _msgSender() == address(this)) means method is called
     * through the xReceive function
     */
    modifier onlyOwnerOrUpdater() {
        if (_msgSender() != owner() && (updater == address(0) && _msgSender() != address(this)))
            revert NetworkRegistry__OnlyOwnerOrUpdater();
        _;
    }

    /**
     * @notice A modifier to check that parameters for cross-chain messaging are correct
     * @dev there must be a networkRegistry setup for each chainId. This is checked later on validNetworkRegistry
     * Total relayer fees must match the tx msg.value
     * @param _chainIds list of chainIds for each network a sync message should be forwarded
     * @param _relayerFees relayer fee to be paid on each network the sync message is forwarded
     */
    modifier validNetworkParams(uint32[] memory _chainIds, uint256[] memory _relayerFees) {
        if (_chainIds.length != _relayerFees.length) revert NetWorkRegistry__ParamsSizeMismatch();
        uint256 totalRelayerFees = 0;
        for (uint256 i = 0; i < _chainIds.length; ) {
            totalRelayerFees += _relayerFees[i];
            unchecked {
                ++i;
            }
        }
        if (msg.value < totalRelayerFees) revert NetworkRegistry__ValueSentLessThanRelayerFees();
        _;
    }

    /**
     * @notice A modifier to validates there's a replica NetworkRegistry setup for the `_chainId` chainId
     * @dev networkRegistry delegate is related Connext xCall but it is not being used so always set to address(0)
     * It it very unlikely for this use case to get a failed tx on the replica if it doesn't revert
     * in the main registry first.
     * More info at https://docs.connext.network/developers/guides/handling-failures#increasing-slippage-tolerance
     */
    modifier validNetworkRegistry(uint32 _chainId) {
        if (replicaRegistry[_chainId].domainId == 0 || replicaRegistry[_chainId].registryAddress == address(0))
            revert NetworkRegistry__NoReplicaOnNetwork(_chainId);
        _;
    }

    /**
     * EVENTS
     */

    /**
     * @notice emitted after the connection to the main registry (updater) domain & address are updated
     * @dev this should be emitted by replica registries only
     * @param _connext Connext contract address
     * @param _updaterDomain new Updater domain ID
     * @param _updater new updater contract address
     */
    event NewUpdaterConfig(address _connext, uint32 _updaterDomain, address _updater);
    /**
     * @notice emitted when the 0xSplit contract is updated
     * @param _splitMain new 0xSplitMain contract address
     * @param _split new 0xSplitWallet contract address
     */
    event SplitUpdated(address _splitMain, address _split);
    /**
     * @notice emitted when a new replica NetworkRegistry is added
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
     * @notice emitted when a new split of funds is registered on the 0xSplit contract
     * @param _split 0xSplit contract address
     * @param _splitHash hash of the split distribution parameters
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     */
    event SplitsUpdated(address _split, bytes32 _splitHash, uint32 _splitDistributorFee);
    /**
     * @notice emitted when a registry synchronization message is forwarded through the Connext bridge
     * @param _transferId Transfer ID returned by Connext to identify the executed xCall
     * @param _chainId chainId of the destination network
     * @param _action Selector of the function to be executed on the replica
     * @param _registryAddress replica contract address
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
     * @param _originDomain Connext domain ID that correspond to the network where the the sync message was submitted
     * @param _action selector of the function that was executed on the replica
     * @param _success flag whether or not the execution of the sync function succeeded
     * @param _originSender main registry address that forwarded the sync message through the Connext bridge
     */
    event SyncActionPerformed(
        bytes32 indexed _transferId,
        uint32 indexed _originDomain,
        bytes4 indexed _action,
        bool _success,
        address _originSender
    );

    constructor() {
        // disable initialization on singleton contract
        _disableInitializers();
    }

    /**
     * @dev Setup the values for using a Connext bridge & 0xSplit contracts
     * @param _connext Connext contract address in the current network
     * @param _updaterDomain Connext domain ID where the updater contract is deployed (if deploying a replica)
     * @param _updater Address of contract that will update the registry through the Connext bridge
     * @param _splitMain 0xSplit proxy contract
     * @param _split 0xSplit contract where funds are hold
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
    }

    /**
     * @dev Executes initializers from parent contracts
     * @param _connext Connext contract address in the current network
     * @param _updaterDomain Connext domain ID where the updater contract is deployed (if deploying a replica)
     * @param _updater Address of the updater contract that updates the registry through the Connext bridge
     * @param _splitMain 0xSplit proxy contract
     * @param _split 0xSplit contract where funds are hold
     * @param _owner who owns the registry contract
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
        __Ownable_init();
        __NetworkRegistry_init_unchained(_connext, _updaterDomain, _updater, _splitMain, _split);
        if (_owner == address(0)) renounceOwnership();
        else transferOwnership(_owner);
    }

    /**
     * @notice Initializes the registry contract
     * @dev Initialization parameters are abi-encoded through the NetworkRegistrySummoner contract
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
     * @param _action selector of the function that will be executed on the replica
     * @param _callData function calldata to forward
     * @param _chainId network chainId where the replica lives
     * @param _relayerFee Fee to be paid to the Connext relayer
     */
    function _execSyncAction(bytes4 _action, bytes memory _callData, uint32 _chainId, uint256 _relayerFee) internal {
        bytes32 transferId = _executeXCall(_chainId, _callData, _relayerFee);
        emit SyncMessageSubmitted(transferId, _chainId, _action, replicaRegistry[_chainId].registryAddress);
    }

    /**
     * @dev Send syncing messages to registered networkRegistry replicas
     * @param _action selector of the function that will be executed on the replica
     * @param _callData function calldata to forward
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
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
                ++i;
            }
        }
    }

    /**
     * @notice Adds a new member to the registry
     * @dev {onlyOwnerOrUpdater} verifies:
     *  - it can only be called by registry owner
     *  - it can only be called by main registry through the Connext bridge (in case it is a replica registry)
     * @param _member new member address
     * @param _activityMultiplier member activity multiplier
     * @param _startDate timestamp (in seconds) when the member got active
     */
    function setNewMember(address _member, uint32 _activityMultiplier, uint32 _startDate) public onlyOwnerOrUpdater {
        _setNewMember(_member, _activityMultiplier, _startDate);
    }

    /**
     * @notice Adds a new member to the registry and sync with replicas
     * @dev it can only be called by the main registry owner
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _member new member address
     * @param _activityMultiplier member activity multiplier
     * @param _startDate timestamp (in seconds) when the member got active
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncSetNewMember(
        address _member,
        uint32 _activityMultiplier,
        uint32 _startDate,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        _setNewMember(_member, _activityMultiplier, _startDate);
        bytes4 action = IMemberRegistry.setNewMember.selector;
        bytes memory callData = abi.encode(action, _member, _activityMultiplier, _startDate);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Updates the activity multiplier of an existing member
     * @dev {onlyOwnerOrUpdater} verifies:
     *  - it can only be called by registry owner
     *  - it can only be called by main registry through the Connext bridge (in case it is a replica registry)
     * @param _member member address
     * @param _activityMultiplier member new activity multiplier
     */
    function updateMember(address _member, uint32 _activityMultiplier) public onlyOwnerOrUpdater {
        _updateMember(_member, _activityMultiplier);
    }

    /**
     * @notice Updates the activity multiplier of an existing member and sync with replicas
     * @dev it can only be called by the main registry owner
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _member new member address
     * @param _activityMultiplier member new activity multiplier
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncUpdateMember(
        address _member,
        uint32 _activityMultiplier,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        _updateMember(_member, _activityMultiplier);
        bytes4 action = IMemberRegistry.updateMember.selector;
        bytes memory callData = abi.encode(action, _member, _activityMultiplier);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Adds a new set of members to the registry
     * @dev It should only be called by {owner} or {updater}
     * @param _members A list of member addresses to be added to the registry
     * @param _activityMultipliers Activity multipliers for each new member
     * @param _startDates A list of dates when each member got active
     */
    function _batchNewMember(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] memory _startDates
    ) internal {
        if (_members.length != _activityMultipliers.length || _members.length != _startDates.length)
            revert NetWorkRegistry__ParamsSizeMismatch();
        for (uint256 i = 0; i < _members.length; ) {
            _setNewMember(_members[i], _activityMultipliers[i], _startDates[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Adds a new set of members to the registry
     * @dev {onlyOwnerOrUpdater} verifies:
     *  - it can only be called by registry owner
     *  - it can only be called by main registry through the Connext bridge (in case it is a replica registry)
     * @param _members A list of member addresses to be added to the registry
     * @param _activityMultipliers Activity multipliers for each new member
     * @param _startDates A list of dates when each member got active
     */
    function batchNewMember(
        address[] memory _members,
        uint32[] memory _activityMultipliers,
        uint32[] memory _startDates
    ) public onlyOwnerOrUpdater {
        _batchNewMember(_members, _activityMultipliers, _startDates);
    }

    /**
     * @notice Adds a new set of members to the registry and sync with replicas
     * @dev Must be used only if registries are in sync. It can only be called by the main registry owner
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _members A list of member addresses to be added to the registry
     * @param _activityMultipliers Activity multipliers for each new member
     * @param _startDates A list of dates when each member got active
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncBatchNewMember(
        address[] calldata _members,
        uint32[] calldata _activityMultipliers,
        uint32[] calldata _startDates,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        _batchNewMember(_members, _activityMultipliers, _startDates);
        bytes4 action = IMemberRegistry.batchNewMember.selector;
        bytes memory callData = abi.encode(action, _members, _activityMultipliers, _startDates);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Updates the activity multiplier for a set of existing members
     * @dev It should only be called by {owner} or {updater}
     * @param _members A list of existing members
     * @param _activityMultipliers New activity multipliers for each member
     */
    function _batchUpdateMember(address[] memory _members, uint32[] memory _activityMultipliers) internal {
        if (_members.length != _activityMultipliers.length) revert NetWorkRegistry__ParamsSizeMismatch();
        for (uint256 i = 0; i < _members.length; ) {
            _updateMember(_members[i], _activityMultipliers[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Updates the activity multiplier for a set of existing members
     * @dev {onlyOwnerOrUpdater} verifies:
     *  - it can only be called by registry owner
     *  - it can only be called by main registry through the Connext bridge (in case it is a replica registry)
     * @param _members A list of existing members
     * @param _activityMultipliers New activity multipliers for each member
     */
    function batchUpdateMember(
        address[] memory _members,
        uint32[] memory _activityMultipliers
    ) public onlyOwnerOrUpdater {
        _batchUpdateMember(_members, _activityMultipliers);
    }

    /**
     * @notice Updates the activity multiplier for a set of existing members and sync with replicas
     * @dev Must be used only if registries are in sync. It can only be called by the main registry owner
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _members A list of existing members
     * @param _activityMultipliers New activity multipliers for each member
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncBatchUpdateMember(
        address[] calldata _members,
        uint32[] calldata _activityMultipliers,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        _batchUpdateMember(_members, _activityMultipliers);
        bytes4 action = IMemberRegistry.batchUpdateMember.selector;
        bytes memory callData = abi.encode(action, _members, _activityMultipliers);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Adds and/or updates a set of members on the registry
     * @dev Make sure array parameters are of the same length
     * Activity multiplier could be set within 0-100 (%) range (i.e. 50 -> part-time 100 -> full-time)
     * but it's up to the implementer to establish the multiplier boundaries
     * @param _members A list of member addresses to be added to the registry
     * @param _activityMultipliers Activity multipliers for each new member
     * @param _startDates A list of dates when each member got active
     */
    function addOrUpdateMembersBatch(
        address[] calldata _members,
        uint32[] calldata _activityMultipliers,
        uint32[] calldata _startDates
    ) public onlyUpdater {
        if (_members.length != _activityMultipliers.length || _members.length != _startDates.length)
            revert NetWorkRegistry__ParamsSizeMismatch();
        for (uint256 i = 0; i < _members.length; ) {
            uint256 memberId = _getMemberId(_members[i]);
            if (memberId == 0) {
                _setNewMember(_members[i], _activityMultipliers[i], _startDates[i]);
            } else {
                Member storage member = _getMemberById(memberId);
                // overrides member startDate and syncs it with the main registry
                member.startDate = _startDates[i];
                _updateMember(_members[i], _activityMultipliers[i]);
            }
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Sync all registry members. Useful if looking to sync a new replica from scratch
     * however action can be pretty gas intensive in case of the registry having a large amount of members
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * @dev For larger member registries calling this function can be costly or just not fit in a block gas limit
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncNetworkMemberRegistry(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        (
            address[] memory _members,
            uint32[] memory _activityMultipliers,
            uint32[] memory _startDates
        ) = getMembersProperties();
        bytes4 action = IMemberRegistry.addOrUpdateMembersBatch.selector;
        bytes memory callData = abi.encode(action, _members, _activityMultipliers, _startDates);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Updates seconds active for each member in the registry since the last update epoch
     * @dev permissionless action
     */
    function updateSecondsActive() public {
        _updateSecondsActive();
    }

    /**
     * @notice Updates activity for each member in the registry since the last update epoch and sync with replicas
     * @dev permissionless action
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * {msg.value} must match the total fees required to pay the Connext relayer to execute messages on the destination
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncUpdateSecondsActive(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable validNetworkParams(_chainIds, _relayerFees) {
        updateSecondsActive();
        bytes4 action = IMemberRegistry.updateSecondsActive.selector;
        bytes memory callData = abi.encode(action);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Updates the 0xSplit distribution based on member activity during the last epoch.
     * Consider calling {updateSecondsActive} prior or after applying a 0xSplit distribution update
     * @dev permissionless action, however the registry must hold the controller role of the 0xSplit contract
     * Addresses in _sortedList must be in the member registry
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     */
    function updateSplits(address[] calldata _sortedList, uint32 _splitDistributorFee) public {
        (address[] memory _receivers, uint32[] memory _percentAllocations) = calculate(_sortedList);

        // run splits update
        splitMain.updateSplit(split, _receivers, _percentAllocations, _splitDistributorFee);
        bytes32 splitHash = keccak256(abi.encodePacked(_receivers, _percentAllocations, _splitDistributorFee));
        emit SplitsUpdated(split, splitHash, _splitDistributorFee);
    }

    /**
     * @notice Updates the 0xSplit distribution across all networks based on member activity during the last epoch.
     * Consider calling {syncUpdateSecondsActive} prior or after applying a 0xSplit distribution update
     * @dev permissionless action, however the registry must hold the controller role of the 0xSplit contract
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * Addresses in _sortedList must be in the member registry
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncUpdateSplits(
        address[] calldata _sortedList,
        uint32 _splitDistributorFee,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable validNetworkParams(_chainIds, _relayerFees) {
        updateSplits(_sortedList, _splitDistributorFee);
        bytes4 action = ISplitManager.updateSplits.selector;
        bytes memory callData = abi.encode(action, _sortedList, _splitDistributorFee);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Updates both {updateSecondsActive} to update registry member activity and {updateSplits}
     * for split distribution
     * @dev permissionless action, however the registry must hold the controller role of the 0xSplit contract
     * Addresses in _sortedList must be in the member registry
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     */
    function updateAll(address[] calldata _sortedList, uint32 _splitDistributorFee) public {
        updateSecondsActive();
        updateSplits(_sortedList, _splitDistributorFee);
    }

    /**
     * @notice Updates both {updateSecondsActive} to update registry member activity and {updateSplits}
     * for split distribution across all networks
     * @dev permissionless action, however the registry must hold the controller role of the 0xSplit contract
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * Addresses in _sortedList must be in the member registry
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @param _splitDistributorFee split fee set at reward for the address that executes the distribution
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function syncUpdateAll(
        address[] calldata _sortedList,
        uint32 _splitDistributorFee,
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable validNetworkParams(_chainIds, _relayerFees) {
        updateAll(_sortedList, _splitDistributorFee);
        bytes4 action = ISplitManager.updateAll.selector;
        bytes memory callData = abi.encode(action, _sortedList, _splitDistributorFee);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Calculate 0xSplit allocations based on member calculated contributions
     * @dev It uses the PGContribCalculator library to calculate active member individual allocations.
     * @param _sortedList sorted list (ascending order) of members to be considered in the 0xSplit distribution
     * @return _receivers list of eligible recipients (non-zero allocation) for the next split distribution
     * @return _percentAllocations list of split allocations for each eligible recipient
     */
    function calculate(
        address[] memory _sortedList
    ) public view virtual returns (address[] memory _receivers, uint32[] memory _percentAllocations) {
        (_receivers, _percentAllocations) = members.calculate(_sortedList);
    }

    /**
     * @notice Calculates individual contribution based on member activity
     * @dev It uses the PGContribCalculator library
     * @param _memberAddress member address
     * @return calculated contribution as uin256 value
     */
    function calculateContributionOf(address _memberAddress) public view returns (uint256) {
        Member memory member = getMember(_memberAddress);
        return members.calculateContributionOf(member);
    }

    /**
     * @notice Calculates all active member contributions
     * @dev omit members with activityMultiplier == 0
     * @return total total calculated contributions from active members
     */
    function calculateTotalContributions() public view returns (uint256 total) {
        uint256 totalRegistryMembers = totalMembers();
        for (uint256 i = 0; i < totalRegistryMembers; ) {
            Member memory member = _getMemberByIndex(i);
            if (member.activityMultiplier > 0) {
                total += members.calculateContributionOf(member);
                unchecked {
                    ++i;
                }
            }
        }
    }

    /**
     * @notice Set connext and updater config parameters to setup the contract as a replica registry
     * @dev Must only be called by contract owner. Zero values will setup the contract as a main registry
     * @param _connext Connext contract address
     * @param _updaterDomain Connext domain ID where the updater contract is deployed
     * @param _updater Main NetworkRegistry address that will update the registry through the Connext bridge
     */
    function setUpdaterConfig(address _connext, uint32 _updaterDomain, address _updater) external onlyOwner {
        connext = IConnext(_connext);
        updaterDomain = _updaterDomain;
        updater = _updater;
        emit NewUpdaterConfig(_connext, _updaterDomain, _updater);
    }

    /**
     * @notice Adds a replica NetworkRegistry to get in sync with the main registry
     * @dev Must only be called by contract owner. Sending zero values on {_newRegistry} should disable
     * an existing replica
     * @param _chainId Network chainId where the replica registry lives
     * @param _newRegistry Connext domain ID and replica NetworkRegistry address
     */
    function updateNetworkRegistry(uint32 _chainId, Registry memory _newRegistry) external onlyOwner {
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
     * @notice Returns True if the registry has been setup as Main or Replica
     * @dev Verifies if updater params are set to zero
     */
    function isMainRegistry() public view returns (bool) {
        return updaterDomain == 0 && updater == address(0);
    }

    /**
     * @notice Updates the addresses for the 0xSplitMain proxy and 0xSplit contract
     * @dev Must only be called by owner or updater.
     * Should verify the 0xSplit contract exists and that it isn't immutable (no renounced ownership)
     * Also makes sure controller has already been handed over to the registry or it's waiting to be accepted.
     * If manager is already a potential controller, call acceptSplitControl()
     * @param _splitMain The address of the 0xSplitMain
     * @param _split The address of the 0xSplit contract
     */
    function setSplit(address _splitMain, address _split) public onlyOwnerOrUpdater {
        splitMain = ISplitMain(_splitMain);
        address currentController = splitMain.getController(_split);
        if (currentController == address(0)) revert NetworkRegistry__InvalidOrImmutableSplit();
        address newController = splitMain.getNewPotentialController(_split);
        if (currentController != address(this) && newController != address(this)) revert Split_ControlNotHandedOver();
        split = _split;
        emit SplitUpdated(_splitMain, split);
        if (newController == address(this)) {
            acceptSplitControl();
        }
    }

    /**
     * @notice Updates the 0xSplit contracts on existing NetworkRegistry replicas via sync message
     * @dev Must only be called by the owner.
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _splitsMain a list of 0xSplit proxy addresses for each replica
     * @param _splits a list of 0xSplit addresses for each replica
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function updateNetworkSplit(
        uint32[] memory _chainIds,
        address[] memory _splitsMain,
        address[] memory _splits,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        if (_splitsMain.length != _chainIds.length || _splits.length != _chainIds.length)
            revert NetWorkRegistry__ParamsSizeMismatch();
        bytes4 action = ISplitManager.setSplit.selector;
        for (uint256 i = 0; i < _chainIds.length; ) {
            bytes memory callData = abi.encode(action, _splitsMain[i], _splits[i]);
            _execSyncAction(action, callData, _chainIds[i], _relayerFees[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Transfer control of the current 0xSplit contract to `_newController`
     * @dev Must only be called by the owner or updater
     * @param _newController new controller address
     */
    function transferSplitControl(address _newController) public onlyOwnerOrUpdater {
        splitMain.transferControl(split, _newController);
    }

    /**
     * @notice Sends sync messages to replicas in order to transfer control of the current
     * 0xSplit contract to `_newController`
     * @dev Must only be called by the owner
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _newControllers new controller address per replica
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function transferNetworkSplitControl(
        uint32[] memory _chainIds,
        address[] memory _newControllers,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        if (_newControllers.length != _chainIds.length) revert NetWorkRegistry__ParamsSizeMismatch();
        bytes4 action = ISplitManager.transferSplitControl.selector;
        for (uint256 i = 0; i < _chainIds.length; ) {
            bytes memory callData = abi.encode(action, _newControllers[i]);
            _execSyncAction(action, callData, _chainIds[i], _relayerFees[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Accepts control of the current 0xSplit contract
     * @dev Must only be called by the owner or updater
     */
    function acceptSplitControl() public onlyOwnerOrUpdater {
        splitMain.acceptControl(split);
    }

    /**
     * @notice Sends sync messages to replicas in order to accept control of the current 0xSplit contract
     * @dev Must only be called by the owner
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function acceptNetworkSplitControl(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        bytes4 action = ISplitManager.acceptSplitControl.selector;
        bytes memory callData = abi.encode(action);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Cancel controller transfer of the current 0xSplit contract
     * @dev Must only be called by the owner or updater
     */
    function cancelSplitControlTransfer() public onlyOwnerOrUpdater {
        splitMain.cancelControlTransfer(split);
    }

    /**
     * @notice Sends sync messages to replicas in order to cancel a transfer control request of
     * the current 0xSplit contract
     * @dev Must only be called by the owner
     * {validNetworkParams} verifies for matching network param sizes & {msg.value}
     * @param _chainIds a list of network chainIds where valid replicas live
     * @param _relayerFees a list of fees to be paid to the Connext relayer per sync message forwarded
     */
    function cancelNetworkSplitControlTransfer(
        uint32[] calldata _chainIds,
        uint256[] calldata _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        bytes4 action = ISplitManager.cancelSplitControlTransfer.selector;
        bytes memory callData = abi.encode(action);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /**
     * @notice Accepts incoming sync messages from the main registry via Connext authenticated calls
     * @dev Forwarded messages can only be executed if their function selector is listed as valid action
     * @param _transferId transfer ID set by Connext to identify the incoming xCall message
     * @param _originSender main registry address that forwarded the xCall message through the Connext bridge
     * @param _origin Connext domain ID that correspond to the network where the the xCall message was submitted
     * @param _incomingCalldata message calldata to be used to invoke the required syncing action
     * @return any data returned by calling the action
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
        if (action == IMemberRegistry.setNewMember.selector) {
            (, address _member, uint32 _activityMultiplier, uint32 _startDate) = abi.decode(
                _incomingCalldata,
                (bytes4, address, uint32, uint32)
            );
            callData = abi.encodeWithSelector(
                IMemberRegistry.setNewMember.selector,
                _member,
                _activityMultiplier,
                _startDate
            );
        } else if (action == IMemberRegistry.updateMember.selector) {
            (, address _member, uint32 _activityMultiplier) = abi.decode(_incomingCalldata, (bytes4, address, uint32));
            callData = abi.encodeWithSelector(action, _member, _activityMultiplier);
        } else if (action == IMemberRegistry.batchNewMember.selector) {
            (, address[] memory _members, uint32[] memory _activityMultipliers, uint32[] memory _startDates) = abi
                .decode(_incomingCalldata, (bytes4, address[], uint32[], uint32[]));
            callData = abi.encodeWithSelector(action, _members, _activityMultipliers, _startDates);
        } else if (action == IMemberRegistry.batchUpdateMember.selector) {
            (, address[] memory _members, uint32[] memory _activityMultipliers) = abi.decode(
                _incomingCalldata,
                (bytes4, address[], uint32[])
            );
            callData = abi.encodeWithSelector(action, _members, _activityMultipliers);
        } else if (action == IMemberRegistry.addOrUpdateMembersBatch.selector) {
            (, address[] memory _members, uint32[] memory _activityMultipliers, uint32[] memory _startDates) = abi
                .decode(_incomingCalldata, (bytes4, address[], uint32[], uint32[]));
            callData = abi.encodeWithSelector(action, _members, _activityMultipliers, _startDates);
        } else if (action == IMemberRegistry.updateSecondsActive.selector) {
            callData = abi.encodeWithSelector(action);
        } else if (action == ISplitManager.updateSplits.selector) {
            (, address[] memory _sortedList, uint32 _splitDistributorFee) = abi.decode(
                _incomingCalldata,
                (bytes4, address[], uint32)
            );
            callData = abi.encodeWithSelector(action, _sortedList, _splitDistributorFee);
        } else if (action == ISplitManager.updateAll.selector) {
            (, address[] memory _sortedList, uint32 _splitDistributorFee) = abi.decode(
                _incomingCalldata,
                (bytes4, address[], uint32)
            );
            callData = abi.encodeWithSelector(action, _sortedList, _splitDistributorFee);
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
        }

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory data) = address(this).call(callData);
        emit SyncActionPerformed(_transferId, _origin, action, success, _originSender);
        return data;
    }
}
