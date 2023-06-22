// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IBaal } from "@daohaus/baal-contracts/contracts/interfaces/IBaal.sol";

import { NetworkRegistry } from "./NetworkRegistry.sol";

contract NetworkRegistryShaman is NetworkRegistry {

    // string public name;

    IBaal public baal;
    uint256 public sharesToMint;
    bool public burnShares;

    modifier isManagerShaman() {
        require(address(baal) != address(0), "PGNetworkRegistryShaman: !init");
        require(baal.isManager(address(this)), "PGNetworkRegistryShaman: Shaman is not manager");
        _;
    }

    function initialize(bytes memory _initializationParams) external override initializer {
        (
            address _connext,
            uint32 _updaterDomain,
            address _updater,
            address _splitMain,
            address _split,
            uint32 _splitDistributorFee,
            address _baal,
            uint256 _sharesToMint,
            bool _burnShares
        ) = abi.decode(_initializationParams, (address, uint32, address, address, address, uint32, address, uint256, bool));
        __NetworkRegistry_init(
            _connext,
            _updaterDomain,
            _updater,
            _splitMain,
            _split,
            _splitDistributorFee,
            _baal
        );
        baal = IBaal(_baal);
        sharesToMint = _sharesToMint;
        burnShares = _burnShares;
    }

    function setNewMember(
        address _member,
        uint8 _activityMultiplier,
        uint32 _startDate
    ) public override onlyOwnerOrUpdater isManagerShaman {
        super.setNewMember(_member, _activityMultiplier, _startDate);
        if (isMainRegistry()) {
            require(address(baal) != address(0), "PGNetworkRegistryShaman: !init");
            require(baal.isManager(address(this)), "PGNetworkRegistryShaman: Shaman is not manager");
            address[] memory _receivers = new address[](1);
            _receivers[0] = _member;
            uint256[] memory _amounts = new uint256[](1);
            _amounts[0] = sharesToMint;
            baal.mintShares(_receivers, _amounts);
        }
    }

    function updateMember(
        address _member,
        uint8 _activityMultiplier
    ) public override onlyOwnerOrUpdater isManagerShaman
    {
        super.updateMember(_member, _activityMultiplier);
        if (isMainRegistry() && burnShares) {
            require(address(baal) != address(0), "PGNetworkRegistryShaman: !init");
            require(baal.isManager(address(this)), "PGNetworkRegistryShaman: Shaman is not manager");
            address[] memory _from = new address[](1);
            _from[0] = _member;
            uint256[] memory _amounts = new uint256[](1);
            _amounts[0] = sharesToMint;
            baal.burnShares(_from, _amounts);
        }
    }
}
