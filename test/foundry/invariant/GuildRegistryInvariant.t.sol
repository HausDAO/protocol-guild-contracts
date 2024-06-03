// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.23 <0.9.0;

import { GuildRegistry } from "contracts/GuildRegistry.sol";
import { GuildRegistryV2 } from "contracts/GuildRegistryV2.sol";
import { InvariantTest } from "test/foundry/invariant/Invariant.t.sol";
import { GuildRegistryHandler, GuildRegistryV2Handler } from "test/foundry/invariant/handlers/GuildRegistryHandler.sol";

contract GuildRegistry_Invariant_Test is InvariantTest {
    address internal owner = makeAddr("owner");

    GuildRegistry internal registry;

    GuildRegistryHandler internal registryHandler;

    function setUp() public virtual override {
        InvariantTest.setUp();

        vm.label({ account: owner, newLabel: "Registry owner" });
        address registryProxy = deployGuildRegistry(owner);
        vm.label({ account: registryProxy, newLabel: "GuildRegistry" });
        registry = GuildRegistry(registryProxy);

        registryHandler = new GuildRegistryHandler(registry);
        vm.label({ account: address(registryHandler), newLabel: "GuildRegistryHandler" });
        targetContract(address(registryHandler));
    }

    function invariant_totalActiveUsers() public {
        assertEq(registry.totalActiveMembers(), registry.totalMembers(), "Member count error");
    }
}

contract GuildRegistry_V2_Invariant_Test is InvariantTest {
    address internal owner = makeAddr("owner");

    GuildRegistryV2 internal registry;

    GuildRegistryV2Handler internal registryHandler;

    function setUp() public virtual override {
        InvariantTest.setUp();

        vm.label({ account: owner, newLabel: "Registry owner" });
        address registryProxy = deployGuildRegistryV2(owner);
        vm.label({ account: registryProxy, newLabel: "GuildRegistryV2" });
        registry = GuildRegistryV2(registryProxy);

        registryHandler = new GuildRegistryV2Handler(registry);
        vm.label({ account: address(registryHandler), newLabel: "GuildRegistryV2Handler" });
        targetContract(address(registryHandler));
    }

    function invariant_totalActiveUsers() public {
        assertEq(registry.totalActiveMembers(), registry.totalMembers(), "Member count error");
    }
}
