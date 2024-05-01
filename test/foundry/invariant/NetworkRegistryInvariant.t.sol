// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.23 <0.9.0;

import { NetworkRegistry } from "contracts/NetworkRegistry.sol";
import { InvariantTest } from "test/foundry/invariant/Invariant.t.sol";
import { NetworkRegistryHandler } from "test/foundry/invariant/handlers/NetworkRegistryHandler.sol";

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
