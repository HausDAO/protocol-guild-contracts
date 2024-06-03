// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.23 <0.9.0;

import { NetworkRegistry } from "contracts/NetworkRegistry.sol";
import { NetworkRegistryV2 } from "contracts/NetworkRegistryV2.sol";
import { InvariantTest } from "test/foundry/invariant/Invariant.t.sol";
import {
    NetworkRegistryHandler,
    NetworkRegistryV2Handler
} from "test/foundry/invariant/handlers/NetworkRegistryHandler.sol";

contract NetworkRegistry_Invariant_Test is InvariantTest {
    address internal owner = makeAddr("owner");

    NetworkRegistry internal registry;

    NetworkRegistryHandler internal registryHandler;

    function setUp() public virtual override {
        InvariantTest.setUp();

        vm.label({ account: owner, newLabel: "Registry owner" });
        address registryProxy = deployNetworkRegistry(owner);
        vm.label({ account: registryProxy, newLabel: "NetworkRegistry" });
        registry = NetworkRegistry(registryProxy);

        registryHandler = new NetworkRegistryHandler(registry);
        vm.label({ account: address(registryHandler), newLabel: "NetworkRegistryHandler" });
        targetContract(address(registryHandler));
    }

    function invariant_totalActiveUsers() public {
        assertEq(
            registry.totalActiveMembers(),
            registry.totalMembers() - registryHandler.totalInactiveMembers(),
            "Member count error"
        );
    }
}

contract NetworkRegistry_V2_Invariant_Test is InvariantTest {
    address internal owner = makeAddr("owner");

    NetworkRegistryV2 internal registry;

    NetworkRegistryV2Handler internal registryHandler;

    function setUp() public virtual override {
        InvariantTest.setUp();

        vm.label({ account: owner, newLabel: "Registry owner" });
        address registryProxy = deployNetworkRegistryV2(owner);
        vm.label({ account: registryProxy, newLabel: "NetworkRegistryV2" });
        registry = NetworkRegistryV2(registryProxy);

        registryHandler = new NetworkRegistryV2Handler(registry);
        vm.label({ account: address(registryHandler), newLabel: "NetworkRegistryV2Handler" });
        targetContract(address(registryHandler));
    }

    function invariant_totalActiveUsers() public {
        assertEq(
            registry.totalActiveMembers(),
            registry.totalMembers() - registryHandler.totalInactiveMembers(),
            "Member count error"
        );
    }
}
