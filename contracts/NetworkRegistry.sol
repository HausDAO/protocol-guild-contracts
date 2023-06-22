// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IConnext } from "@connext/interfaces/core/IConnext.sol";
import { IXReceiver } from "@connext/interfaces/core/IXReceiver.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@prb/math/src/UD60x18.sol";

import { IMemberRegistry, INetworkMemberRegistry, ISplitManager } from "./interfaces/INetworkMemberRegistry.sol";
import { ISplitMain } from "./interfaces/ISplitMain.sol";
import { MemberRegistry } from "./registry/MemberRegistry.sol";

// import "hardhat/console.sol";

//*********************************************************************//
// --------------------------- custom errors ------------------------- //
//*********************************************************************//
error INVALID_LIST();
error NOT_MEMBER_OR_NOT_SORTED();

// DAO member registry
//  - keeps track of members
//  - keeps track of member part/full time activity (activity multiplier)
//  - keeps track of member start date
//  - keeps track of member total seconds active

contract NetworkRegistry is OwnableUpgradeable, IXReceiver, INetworkMemberRegistry, MemberRegistry {
    // Connext contract in the current domain
    IConnext public connext;
    // The domain ID where the source updater contract is deployed
    uint32 public updaterDomain;
    // The address of the source updater contract
    address public updater;

    // NetworkRegistry[] public networkRegistry;
    // chainId => NetworkRegistry
    mapping (uint32 => NetworkRegistry) public networkRegistry;

    ISplitMain public splitMain;
    address public split;
    uint32 public splitDistributorFee;

    uint32 public constant PERCENTAGE_SCALE = 1e6;

    struct Split {
        address receiver;
        uint32 percentAllocations;
    }

    /** @notice A modifier for authenticated calls.
     * This is an important security consideration. If the target contract
     * function should be authenticated, it must check three things:
     *    1) The originating call comes from the expected origin domain.
     *    2) The originating call comes from the expected source contract.
     *    3) The call to this contract comes from Connext.
     */
    modifier onlyUpdater(address _originSender, uint32 _origin) {
        // console.log("onlyUpdater: %s %s %s", _origin, _originSender, _msgSender());
        require(
        _origin == updaterDomain &&
            _originSender == updater &&
            _msgSender() == address(connext),
        "NetworkRegistry: Expected original caller to be source contract on origin domain and this to be called by Connext"
        );
        _;
    }

    modifier onlyOwnerOrUpdater() {
        // console.log("address(this) %s", address(this));
        // console.log("onlyOwnerOrUpdater %s %s %s %s", updater, _msgSender(), address(connext));
        require(
            owner() == _msgSender() ||
            (updater != address(0) && _msgSender() == address(this)),
            // (updater != address(0) && _msgSender() == address(connext)),
            "NetworkRegistry: caller is not foreign updater or owner"
        );
        _;
    }

    modifier validNetworkParams(uint32[] memory _chainIds, uint256[] memory _relayerFees) {
        require(_chainIds.length == _relayerFees.length, "NetworkRegistry: Wrong network params");
        uint256 totalRelayerFees = 0;
        for (uint8 i = 0; i < _relayerFees.length; i++) {
            totalRelayerFees += _relayerFees[i];
        }
        require(
            msg.value == totalRelayerFees,
            "NetworkRegistry: Value sent not enough to cover relayer fees"
        );
        _;
    }

    modifier validNetworkRegistry(NetworkRegistry storage _registry) {
        require(_registry.domainId != 0, "NetworkRegistry: Not Supported Network");
        require(_registry.registryAddress != (address(0)), "NetworkRegistry:Not Supported Network");
        // require(_registry.delegate != (address(0)), "NetworkRegistry: Missing delegate"); // TODO: really need a delegate in case of failed tx?
        _;
    }

    event NetworkRegistryUpdated(address indexed _registryAddress, uint32 indexed _chainId, uint32 _domainId, address _delegate);
    event SyncMessageSubmitted(bytes4 indexed _action, uint32 indexed _chainId, bytes32 indexed _transferId, address _registryAddress);
    event SyncActionPerformed(bytes32 _transferId, bytes4 indexed _action, bool indexed _success, uint32 _originDomain, address _originSender);

    constructor() {
        // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/proxy/utils/Initializable.sol#L45
        _disableInitializers();
    }

    function __NetworkRegistry_init_unchained(
        address _connext,
        uint32 _updaterDomain,
        address _updater,
        address _splitMain,
        address _split,
        uint32 _splitDistributorFee
    ) internal onlyInitializing {
        connext = IConnext(_connext);
        updaterDomain = _updaterDomain;
        updater = _updater;
        splitMain = ISplitMain(_splitMain);
        split = _split;
        splitDistributorFee = _splitDistributorFee;
    }

    function __NetworkRegistry_init(
        address _connext,
        uint32 _updaterDomain,
        address _updater,
        address _splitMain,
        address _split,
        uint32 _splitDistributorFee,
        address _owner
    ) internal onlyInitializing {
        __Ownable_init();
        __NetworkRegistry_init_unchained(
            _connext,
            _updaterDomain,
            _updater,
            _splitMain,
            _split,
            _splitDistributorFee
        );
        if (_owner == address(0)) renounceOwnership();
        else transferOwnership(_owner);
    }

    function initialize(bytes memory _initializationParams) external virtual initializer {
        (
            address _connext,
            uint32 _updaterDomain,
            address _updater,
            address _splitMain,
            address _split,
            uint32 _splitDistributorFee,
            address _owner
        ) = abi.decode(_initializationParams, (address, uint32, address, address, address, uint32, address));
        __NetworkRegistry_init(
            _connext,
            _updaterDomain,
            _updater,
            _splitMain,
            _split,
            _splitDistributorFee,
            _owner
        );
    }

    function isMainRegistry() public view returns (bool) {
        return updaterDomain == 0 && updater == address(0);
    }

    // Connext Config
    function setUpdater(uint32 _updaterDomain, address _updater) external onlyOwner {
        updaterDomain = _updaterDomain;
        updater = _updater;
    }

    function updateNetworkRegistry(uint32 _chainId, NetworkRegistry memory _registry) external onlyOwner {
        require(_registry.registryAddress != address(0), "Invalid registry address");
        networkRegistry[_chainId] = _registry;
        emit NetworkRegistryUpdated(_registry.registryAddress, _chainId, _registry.domainId, _registry.delegate);
    }

    function _executeXCall(
        uint32 _chainId,
        bytes memory _callData,
        uint256 _relayerFee
    ) internal validNetworkRegistry(networkRegistry[_chainId]) returns (bytes32 transferId) {
        transferId = connext.xcall{value: _relayerFee}(
            networkRegistry[_chainId].domainId, // _destination: domain ID of the destination chain
            networkRegistry[_chainId].registryAddress,            // _to: address of the target contract (Pong)
            address(0),        // _asset: use address zero for 0-value transfers
            networkRegistry[_chainId].delegate,        // _delegate: address that can revert or forceLocal on destination
            0,                 // _amount: 0 because no funds are being transferred
            0,                 // _slippage: can be anything between 0-10000 because no funds are being transferred
            _callData           // _callData: the encoded calldata to send
        );
    }

    function _execSyncAction(bytes4 action, bytes memory _callData, uint32 _chainId, uint256 _relayerFee) internal {
        bytes32 transferId = _executeXCall(_chainId, _callData, _relayerFee);
        emit SyncMessageSubmitted(action, _chainId, transferId, networkRegistry[_chainId].registryAddress);
    }

    function _syncRegistries(bytes4 action , bytes memory _callData, uint32[] memory _chainIds, uint256[] memory _relayerFees) internal {
        for (uint8 i = 0; i < _chainIds.length; i++) {
            _execSyncAction(action, _callData, _chainIds[i], _relayerFees[i]);
        }
    }

    // add member to registry
    function setNewMember(
        address _member,
        uint8 _activityMultiplier,
        uint32 _startDate
    ) public virtual onlyOwnerOrUpdater {
        _setNewMember(_member, _activityMultiplier, _startDate);  
    }

    function syncSetNewMember(
        address _member,
        uint8 _activityMultiplier,
        uint32 _startDate,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        setNewMember(_member, _activityMultiplier, _startDate);
        bytes4 action = IMemberRegistry.setNewMember.selector;
        bytes memory callData = abi.encode(action, _member, _activityMultiplier, _startDate);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    // update member activity multiplier
    function updateMember(address _member, uint8 _activityMultiplier)
        public virtual
        onlyOwnerOrUpdater
    {
        _updateMember(_member, _activityMultiplier);
    }

    function syncUpdateMember(
        address _member,
        uint8 _activityMultiplier,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        updateMember(_member, _activityMultiplier);
        bytes4 action = IMemberRegistry.updateMember.selector;
        bytes memory callData = abi.encode(action, _member, _activityMultiplier);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    // BATCH OPERATIONS

    function batchNewMember(
        address[] memory _members,
        uint8[] memory _activityMultipliers,
        uint32[] memory _startDates
    ) public onlyOwnerOrUpdater {
        for (uint256 i = 0; i < _members.length; i++) {
            setNewMember(_members[i], _activityMultipliers[i], _startDates[i]);
        }
    }

    // TODO: should we cover edge cases when we want to sync a replica registry from scratch?
    function syncBatchNewMember(
        address[] memory _members,
        uint8[] memory _activityMultipliers,
        uint32[] memory _startDates,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        batchNewMember(_members, _activityMultipliers, _startDates);
        bytes4 action = IMemberRegistry.batchNewMember.selector;
        bytes memory callData = abi.encode(action, _members, _activityMultipliers, _startDates);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    function syncNetworkMemberRegistry(
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        address[] memory _members = new address[](members.length);
        uint8[] memory _activityMultipliers = new uint8[](members.length);
        uint32[] memory _startDates = new uint32[](members.length);
        for (uint256 i = 0; i < members.length; i++) {
            _members[i] = members[i].account;
            _activityMultipliers[i] = members[i].activityMultiplier;
            _startDates[i] = members[i].startDate;
        }
        bytes4 action = IMemberRegistry.batchNewMember.selector;
        bytes memory callData = abi.encode(action, _members, _activityMultipliers, _startDates);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    function batchUpdateMember(
        address[] memory _members,
        uint8[] memory _activityMultipliers
    ) public onlyOwnerOrUpdater {
        for (uint256 i = 0; i < _members.length; i++) {
            updateMember(_members[i], _activityMultipliers[i]);
        } 
    }

    function syncBatchUpdateMember(
        address[] memory _members,
        uint8[] memory _activityMultipliers,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        batchUpdateMember(_members, _activityMultipliers);
        bytes4 action = IMemberRegistry.batchUpdateMember.selector;
        bytes memory callData = abi.encode(action, _members, _activityMultipliers);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    // UPDATE ACTIONS

    // update member total seconds and seconds in last period
    // TODO: do we want to make it permissionless in case of a replica registry?
    function updateSecondsActive() public {
        _updateSecondsActive();
    }

    function syncUpdateSecondsActive(
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable validNetworkParams(_chainIds, _relayerFees) {
        updateSecondsActive();
        bytes4 action = IMemberRegistry.updateSecondsActive.selector;
        bytes memory callData = abi.encode(action);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    // takes a sorted (offchain) list of addresses from the member array
    // send update to 0xsplits
    function updateSplits(address[] memory _sortedList)
        public
        returns (
            address[] memory _receivers,
            uint32[] memory _percentAllocations
        )
    {
        (_receivers, _percentAllocations) = calculate(_sortedList);

        // run splits update
        splitMain.updateSplit(
            split,
            _receivers,
            _percentAllocations,
            splitDistributorFee
        );
    }

    function syncUpdateSplits(
        address[] memory _sortedList,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable validNetworkParams(_chainIds, _relayerFees) {
        updateSplits(_sortedList);
        bytes4 action = ISplitManager.updateSplits.selector;
        bytes memory callData = abi.encode(action, _sortedList);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    // update member registry and update splits
    function updateAll(address[] memory _sortedList)
        public
        returns (
            address[] memory _receivers,
            uint32[] memory _percentAllocations
        )
    {
        updateSecondsActive();
        (_receivers, _percentAllocations) = updateSplits(_sortedList);
        
    }

    function syncUpdateAll(
        address[] memory _sortedList,
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable validNetworkParams(_chainIds, _relayerFees) {
        updateAll(_sortedList);
        bytes4 action = ISplitManager.updateAll.selector;
        bytes memory callData = abi.encode(action, _sortedList);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    // update member registry, update splits, and distribute ETH
    // wraps 0xsplits distributeETH
    function updateAllAndDistributeETH(address[] memory _sortedList, address _distributorAddress) external {
        (
            address[] memory _receivers,
            uint32[] memory _percentAllocations
        ) = updateAll(_sortedList);
        splitMain.distributeETH(
            split,
            _receivers,
            _percentAllocations,
            splitDistributorFee,
            _distributorAddress
        );   
    }

    // update member registry, update splits, and distribute ERC20
    // wraps 0xsplits distributeERC20
    function updateAllAndDistributeERC20(
        address[] memory _sortedList,
        IERC20 _token,
        address _distributorAddress
    ) external {
        (
            address[] memory _receivers,
            uint32[] memory _percentAllocations
        ) = updateAll(_sortedList);
        splitMain.distributeERC20(
            split,
            _token,
            _receivers,
            _percentAllocations,
            splitDistributorFee,
            _distributorAddress
        );
        
    }

    // calculate the split allocations
    // verifys the address list is sorted, has no dups, and is valid
    // gets the total seconds from all members square rooted for % calc
    // set up arrays and parameters for 0xsplits contract call
    //  addresses sorted, only non zero allocations
    //  keep track of running total of allocations because it must equal PERCENTAGE_SCALE
    function calculate(address[] memory _sortedList)
        public
        view
        returns (
            address[] memory _receivers,
            uint32[] memory _percentAllocations
        )
    {
        uint256 nonZeroCount;
        uint256 total;
        address previous;

        // verify list is current members and is sorted
        if (_sortedList.length != members.length) revert INVALID_LIST();
        for (uint256 i = 0; i < _sortedList.length; i++) {
            address listAddr = _sortedList[i];
            if (memberIdxs[listAddr] == 0 && listAddr >= previous)
                revert NOT_MEMBER_OR_NOT_SORTED();
            previous = listAddr;

            // get the total seconds in the last period
            // ignore inactive members
            if (members[i].activityMultiplier > 0) {
                total = total + unwrap(wrap(members[i].secondsActive).sqrt());
                nonZeroCount++;
            }
        }

        // define variables for split params
        _receivers = new address[](nonZeroCount);
        _percentAllocations = new uint32[](nonZeroCount);

        // define variables for second loop
        uint32 runningTotal;
        uint256 nonZeroIndex; // index counter for non zero allocations
        // fill 0xsplits arrays with sorted list
        for (uint256 i = 0; i < _sortedList.length; i++) {
            uint256 memberIdx = memberIdxs[_sortedList[i]];
            Member memory _member = members[memberIdx - 1];
            if (_member.activityMultiplier > 0) {
                _receivers[nonZeroIndex] = _member.account;

                _percentAllocations[nonZeroIndex] = uint32(
                    (unwrap(wrap(_member.secondsActive).sqrt()) *
                        PERCENTAGE_SCALE) / total
                );

                runningTotal += _percentAllocations[nonZeroIndex];
                nonZeroIndex++;
            }
        }

        // if there was any loss add it to the first account.
        if (runningTotal != PERCENTAGE_SCALE) {
            _percentAllocations[0] += uint32(PERCENTAGE_SCALE - runningTotal);
        }
    }

    // Split CONFIG

    function setSplitMain(address _splitMain) public onlyOwnerOrUpdater {
        splitMain = ISplitMain(_splitMain);
    }

    function updateNetworkSplitMain(
        uint32[] memory _chainIds,
        address[] memory _splitsMain,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        require(_splitsMain.length == _chainIds.length, "NetworkRegistry: network params length does not match");
        bytes4 action = ISplitManager.setSplitMain.selector;
        for(uint8 i = 0; i < _chainIds.length; i++) {
            bytes memory callData = abi.encode(action, _splitsMain[i]);
            _execSyncAction(action, callData, _chainIds[i], _relayerFees[i]);
        }
    }

    function setSplit(address _split, uint32 _splitDistributorFee) public onlyOwnerOrUpdater {
        split = _split;
        splitDistributorFee = _splitDistributorFee;
    }

    function updateNetworkSplit(
        uint32[] memory _chainIds,
        address[] memory _splits,
        uint32[] memory _splitDistributorFees,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        require(
            _splits.length == _chainIds.length && _splitDistributorFees.length == _chainIds.length,
            "NetworkRegistry: network params length does not match"
        );
        bytes4 action = ISplitManager.setSplit.selector;
        for(uint8 i = 0; i < _chainIds.length; i++) {
            bytes memory callData = abi.encode(action, _splits[i], _splitDistributorFees[i]);
            _execSyncAction(action, callData, _chainIds[i], _relayerFees[i]);
        }
    }

    // 0xSplits OWNERSHIP INTERFCE WRAPPERS

    function transferSplitControl(address _newController) public onlyOwnerOrUpdater {
        splitMain.transferControl(split, _newController);
    }

    function transferNetworkSplitControl(
        uint32[] memory _chainIds,
        address[] memory _newControllers,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        require(_newControllers.length == _chainIds.length, "NetworkRegistry: network params length does not match");
        bytes4 action = ISplitManager.transferSplitControl.selector;
        for(uint8 i = 0; i < _chainIds.length; i++) {
            bytes memory callData = abi.encode(action, _newControllers[i]);
            _execSyncAction(action, callData, _chainIds[i], _relayerFees[i]);
        }
    }

    function acceptSplitControl() public onlyOwnerOrUpdater {
        splitMain.acceptControl(split);
    }

    function acceptNetworkSplitControl(
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        bytes4 action = ISplitManager.acceptSplitControl.selector;
        bytes memory callData = abi.encode(action);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    function cancelSplitControlTransfer() public onlyOwnerOrUpdater {
        splitMain.cancelControlTransfer(split);
    }

    function cancelNetworkSplitControlTransfer(
        uint32[] memory _chainIds,
        uint256[] memory _relayerFees
    ) external payable onlyOwner validNetworkParams(_chainIds, _relayerFees) {
        bytes4 action = ISplitManager.cancelSplitControlTransfer.selector;
        bytes memory callData = abi.encode(action);
        _syncRegistries(action, callData, _chainIds, _relayerFees);
    }

    /** @notice The receiver function as required by the IXReceiver interface.
     * @dev 
     */
    function xReceive(
        bytes32 _transferId,
        uint256 /* _amount */,
        address /* _asset */,
        address _originSender,
        uint32 _origin,
        bytes memory _incomingCalldata
    ) external onlyUpdater(_originSender, _origin) returns (bytes memory) {
        bytes4 action = abi.decode(_incomingCalldata, (bytes4));
        bytes memory callData;
        if (action == IMemberRegistry.setNewMember.selector) {
            (
                ,
                address _member,
                uint8 _activityMultiplier,
                uint32 _startDate
            ) = abi.decode(_incomingCalldata, (bytes4, address, uint8, uint32));
            callData = abi.encodeWithSelector(IMemberRegistry.setNewMember.selector, _member, _activityMultiplier, _startDate);
        } else if (action == IMemberRegistry.updateMember.selector) {
            (, address _member, uint8 _activityMultiplier) = abi.decode(_incomingCalldata, (bytes4, address, uint8));
            callData = abi.encodeWithSelector(action, _member, _activityMultiplier);
        } else if (action == IMemberRegistry.batchNewMember.selector) {
            (
                ,
                address[] memory _members,
                uint8[] memory _activityMultipliers,
                uint32[] memory _startDates
            ) = abi.decode(_incomingCalldata, (bytes4, address[], uint8[], uint32[]));
            callData = abi.encodeWithSelector(action, _members, _activityMultipliers, _startDates);
        } else if (action == IMemberRegistry.batchUpdateMember.selector) {
            (
                ,
                address[] memory _members,
                uint8[] memory _activityMultipliers
            ) = abi.decode(_incomingCalldata, (bytes4, address[], uint8[]));
            callData = abi.encodeWithSelector(action, _members, _activityMultipliers);
        } else if (action == IMemberRegistry.updateSecondsActive.selector) {
            callData = abi.encodeWithSelector(action);
        } else if (action == ISplitManager.updateSplits.selector) {
            (, address[] memory _sortedList) = abi.decode(_incomingCalldata, (bytes4, address[]));
            callData = abi.encodeWithSelector(action, _sortedList);
        } else if (action == ISplitManager.updateAll.selector) {
            (, address[] memory _sortedList) = abi.decode(_incomingCalldata, (bytes4, address[]));
            callData = abi.encodeWithSelector(action, _sortedList);
        } else if (action == ISplitManager.setSplitMain.selector) {
            (, address _splitMain) = abi.decode(_incomingCalldata, (bytes4, address));
            callData = abi.encodeWithSelector(action, _splitMain);
        } else if (action == ISplitManager.setSplit.selector) {
            (, address _split, uint32 _splitDistributorFee) = abi.decode(_incomingCalldata, (bytes4, address, uint32));
            callData = abi.encodeWithSelector(action, _split, _splitDistributorFee);
        } else if (action == ISplitManager.transferSplitControl.selector) {
            (, address _newController) = abi.decode(_incomingCalldata, (bytes4, address));
            callData = abi.encodeWithSelector(action, _newController);
        } else if (action == ISplitManager.acceptSplitControl.selector) {
            callData = abi.encodeWithSelector(action);
        } else if (action == ISplitManager.cancelSplitControlTransfer.selector) {
            callData = abi.encodeWithSelector(action);
        }

        (bool success, bytes memory data) = address(this).call(callData);
        // console.log("xReceive success? %s", success);
        emit SyncActionPerformed(_transferId, action, success, _origin, _originSender);
        return data;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[45] private __gap;
}
