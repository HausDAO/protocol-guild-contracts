// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.19 <0.9.0;

import { Vm } from "@prb/test/PRBTest.sol";
import { StdCheats } from "forge-std/StdCheats.sol";
import { StdUtils } from "forge-std/StdUtils.sol";

abstract contract BaseHandler is StdCheats, StdUtils {
    /// @dev The virtual address of the Foundry VM.
    address internal constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));

    /// @dev An instance of the Foundry VM, which contains cheatcodes for testing.
    Vm internal constant vm = Vm(VM_ADDRESS);

    modifier executeAs(address account) {
        vm.startPrank(account);
        _;
        vm.stopPrank();
    }

    // solhint-disable-next-line no-empty-blocks
    constructor() {}
}
