// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Registry} from "../src/Registry.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";

/// Usage:
///   OWNER=0x.. KEEPER=0x.. TREASURY=0x.. forge script script/Deploy.s.sol \
///     --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("OWNER");
        address keeper = vm.envAddress("KEEPER");
        address treasury = vm.envAddress("TREASURY");

        vm.startBroadcast();
        Registry registry = new Registry(owner, keeper, treasury);
        LaunchFactory factory = new LaunchFactory(registry);
        vm.stopBroadcast();

        console.log("Registry:", address(registry));
        console.log("LaunchFactory:", address(factory));
    }
}
