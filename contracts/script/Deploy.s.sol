// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Registry} from "../src/Registry.sol";
import {Launcher} from "../src/Launcher.sol";
import {IPonsFactory} from "../src/interfaces/IPons.sol";

/// Deploys LaunchNFT to Robinhood Chain (chain id 4663) on top of Pons V2.
///
///   KEEPER=0x.. TREASURY=0x.. forge script script/Deploy.s.sol \
///     --rpc-url robinhood --account <keystore-name> --broadcast
///
/// The broadcasting account becomes the Registry owner. It then lists Seaport 1.6 as the
/// only marketplace; collections are listed afterwards with Registry.setCollection.
contract Deploy is Script {
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant SEAPORT_1_6 = 0x0000000000000068F116a894984e2DB1123eB395;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        address keeper = vm.envAddress("KEEPER");
        address treasury = vm.envAddress("TREASURY");

        vm.startBroadcast();
        Registry registry = new Registry(msg.sender, keeper, treasury);
        registry.setMarketplace(SEAPORT_1_6, true);
        Launcher launcher = new Launcher(IPonsFactory(PONS_V2_FACTORY), registry);
        vm.stopBroadcast();

        console.log("Registry:", address(registry));
        console.log("Launcher:", address(launcher));
    }
}
