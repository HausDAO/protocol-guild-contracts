// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.23 <0.9.0;

import { GuildRegistry } from "contracts/GuildRegistry.sol";
import { NetworkRegistry } from "contracts/NetworkRegistry.sol";
import { InvariantTest } from "test/foundry/invariant/Invariant.t.sol";
import { GuildRegistryHandler } from "test/foundry/invariant/handlers/GuildRegistryHandler.sol";

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
