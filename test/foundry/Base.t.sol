// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.23 <0.9.0;

import { PRBTest } from "@prb/test/PRBTest.sol";
import { console2 } from "forge-std/console2.sol";
import { StdCheats } from "forge-std/StdCheats.sol";
import { StdUtils } from "forge-std/StdUtils.sol";

import { GuildRegistry } from "contracts/GuildRegistry.sol";
import { GuildRegistryV2 } from "contracts/GuildRegistryV2.sol";
import { NetworkRegistry } from "contracts/NetworkRegistry.sol";
import { NetworkRegistryV2 } from "contracts/NetworkRegistryV2.sol";
import { SplitMain } from "contracts/fixtures/SplitMain.sol";
import { SplitsWarehouse } from "contracts/fixtures/splitV2/SplitsWarehouse.sol";
import { SplitV2Lib } from "contracts/fixtures/splitV2/libraries/SplitV2.sol";
import { SplitWalletV2 } from "contracts/fixtures/splitV2/splitters/SplitWalletV2.sol";
import { PullSplitFactory } from "contracts/fixtures/splitV2/splitters/pull/PullSplitFactory.sol";
import { ConnextMock } from "contracts/mocks/ConnextMock.sol";

abstract contract BaseTest is PRBTest, StdCheats, StdUtils {
    uint32 private constant HOME_DOMAIN_ID = 1;

    modifier executeAs(address account) {
        vm.startPrank(account);
        _;
        vm.stopPrank();
    }

    function _deployFromBytecode(bytes memory bytecode) private returns (address) {
        address addr;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            addr := create(0, add(bytecode, 32), mload(bytecode))
        }
        return addr;
    }

    function _deployContract(string memory contractName, bytes memory constructorData) private returns (address) {
        bytes memory creationCode = vm.getCode(contractName);
        address deployedAddress = _deployFromBytecode(abi.encodePacked(creationCode, constructorData));
        if (deployedAddress == address(0)) {
            revert(
                string.concat(
                    "Failed to deploy contract ",
                    contractName,
                    " using constructor data '",
                    string(constructorData),
                    "'"
                )
            );
        }
        return deployedAddress;
    }

    /// @dev A function invoked before each test case is run.
    // solhint-disable-next-line no-empty-blocks
    function setUp() public virtual {
        // add any pre-requisites
    }

    function deployGuildRegistry(address _registryOwner) internal returns (address proxy) {
        // Deploy 0xSplit infra
        SplitMain splitMain = new SplitMain();
        address[] memory accounts = new address[](2);
        accounts[0] = _registryOwner;
        accounts[1] = address(splitMain); // dummy
        uint32[] memory percentAllocations = new uint32[](2);
        percentAllocations[0] = 500_000;
        percentAllocations[1] = 500_000;
        address split = splitMain.createSplit(accounts, percentAllocations, 0, _registryOwner);

        bytes memory initParams = abi.encode(address(splitMain), split, _registryOwner);

        // USING UUPS Proxy
        // // TODO: how to make it work with external libraries
        // Options memory opts;
        // opts.unsafeAllow = "external-library-linking"; // TODO: https://zpl.in/upgrades/error-006
        // // opts.unsafeSkipAllChecks = true;
        // address proxy = Upgrades.deployUUPSProxy(
        //     "NetworkRegistry.sol",
        //     abi.encodeCall(NetworkRegistry.initialize, (mainInitParams)),
        //     opts
        // );
        // console2.log("proxy", proxy);
        // registry = NetworkRegistry(proxy);

        // NOTICE: Custom Proxy deploy impl
        bytes memory initializerData = abi.encodeCall(GuildRegistry.initialize, (initParams));
        address impl = address(new GuildRegistry());
        proxy = address(_deployContract("ERC1967Proxy.sol:ERC1967Proxy.0.8.23", abi.encode(impl, initializerData)));
    }

    function deployGuildRegistryV2(address _registryOwner) internal returns (address proxy) {
        // Deploy 0xSplit infra
        SplitsWarehouse warehouse = new SplitsWarehouse("Ether", "ETH");
        PullSplitFactory splitFactory = new PullSplitFactory(address(warehouse));
        address[] memory accounts = new address[](2);
        accounts[0] = _registryOwner;
        accounts[1] = address(this); // dummy
        uint256[] memory percentAllocations = new uint256[](2);
        percentAllocations[0] = 500_000;
        percentAllocations[1] = 500_000;
        address split = splitFactory.createSplit(
            SplitV2Lib.Split({
                recipients: accounts,
                allocations: percentAllocations,
                totalAllocation: 1e6,
                distributionIncentive: 0
            }),
            _registryOwner,
            address(this)
        );

        bytes memory initParams = abi.encode(split, _registryOwner);

        // USING UUPS Proxy
        // // TODO: how to make it work with external libraries
        // Options memory opts;
        // opts.unsafeAllow = "external-library-linking"; // TODO: https://zpl.in/upgrades/error-006
        // // opts.unsafeSkipAllChecks = true;
        // address proxy = Upgrades.deployUUPSProxy(
        //     "NetworkRegistry.sol",
        //     abi.encodeCall(NetworkRegistry.initialize, (mainInitParams)),
        //     opts
        // );
        // console2.log("proxy", proxy);
        // registry = NetworkRegistry(proxy);

        // NOTICE: Custom Proxy deploy impl
        bytes memory initializerData = abi.encodeCall(GuildRegistryV2.initialize, (initParams));
        address impl = address(new GuildRegistryV2());
        proxy = address(_deployContract("ERC1967Proxy.sol:ERC1967Proxy.0.8.23", abi.encode(impl, initializerData)));
    }

    function deployNetworkRegistry(address _registryOwner) internal returns (address proxy) {
        // Deploy 0xSplit infra
        SplitMain splitMain = new SplitMain();
        address[] memory accounts = new address[](2);
        accounts[0] = _registryOwner;
        accounts[1] = address(splitMain); // dummy
        uint32[] memory percentAllocations = new uint32[](2);
        percentAllocations[0] = 500_000;
        percentAllocations[1] = 500_000;
        address split = splitMain.createSplit(accounts, percentAllocations, 0, _registryOwner);

        // Deploy Connext infra
        address connext = address(new ConnextMock(HOME_DOMAIN_ID));

        // Deploy main registry
        bytes memory initParams = abi.encode(connext, 0, address(0), address(splitMain), split, _registryOwner);

        // USING UUPS Proxy
        // // TODO: how to make it work with external libraries
        // Options memory opts;
        // opts.unsafeAllow = "external-library-linking"; // TODO: https://zpl.in/upgrades/error-006
        // // opts.unsafeSkipAllChecks = true;
        // address proxy = Upgrades.deployUUPSProxy(
        //     "NetworkRegistry.sol",
        //     abi.encodeCall(NetworkRegistry.initialize, (mainInitParams)),
        //     opts
        // );
        // console2.log("proxy", proxy);
        // registry = NetworkRegistry(proxy);

        // NOTICE: Custom Proxy deploy impl
        bytes memory initializerData = abi.encodeCall(NetworkRegistry.initialize, (initParams));
        address impl = address(new NetworkRegistry());
        proxy = address(_deployContract("ERC1967Proxy.sol:ERC1967Proxy.0.8.23", abi.encode(impl, initializerData)));
    }

    function deployNetworkRegistryV2(address _registryOwner) internal returns (address proxy) {
        // Deploy 0xSplit infra
        SplitMain splitMain = new SplitMain();
        address[] memory accounts = new address[](2);
        accounts[0] = _registryOwner;
        accounts[1] = address(splitMain); // dummy
        uint32[] memory percentAllocations = new uint32[](2);
        percentAllocations[0] = 500_000;
        percentAllocations[1] = 500_000;
        address split = splitMain.createSplit(accounts, percentAllocations, 0, _registryOwner);

        // Deploy Connext infra
        address connext = address(new ConnextMock(HOME_DOMAIN_ID));

        // Deploy main registry
        bytes memory initParams = abi.encode(connext, 0, address(0), split, _registryOwner);

        // USING UUPS Proxy
        // // TODO: how to make it work with external libraries
        // Options memory opts;
        // opts.unsafeAllow = "external-library-linking"; // TODO: https://zpl.in/upgrades/error-006
        // // opts.unsafeSkipAllChecks = true;
        // address proxy = Upgrades.deployUUPSProxy(
        //     "NetworkRegistry.sol",
        //     abi.encodeCall(NetworkRegistry.initialize, (mainInitParams)),
        //     opts
        // );
        // console2.log("proxy", proxy);
        // registry = NetworkRegistry(proxy);

        // NOTICE: Custom Proxy deploy impl
        bytes memory initializerData = abi.encodeCall(NetworkRegistryV2.initialize, (initParams));
        address impl = address(new NetworkRegistryV2());
        proxy = address(_deployContract("ERC1967Proxy.sol:ERC1967Proxy.0.8.23", abi.encode(impl, initializerData)));
    }
}
