// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Registry} from "./Registry.sol";

/// @notice Collects trading fees in ETH. Anyone can call `harvest` to forward
/// VAULT_BPS to the coin's vault and the rest to the protocol treasury.
contract FeeSplitter {
    uint256 public constant VAULT_BPS = 8_000;

    Registry public immutable registry;
    address public immutable vault;

    event Harvested(uint256 toVault, uint256 toTreasury);

    constructor(Registry registry_, address vault_) {
        registry = registry_;
        vault = vault_;
    }

    receive() external payable {}

    function harvest() external {
        uint256 amount = address(this).balance;
        if (amount == 0) return;
        uint256 toVault = amount * VAULT_BPS / 10_000;
        uint256 toTreasury = amount - toVault;

        (bool ok,) = vault.call{value: toVault}("");
        require(ok, "vault transfer failed");
        (ok,) = registry.treasury().call{value: toTreasury}("");
        require(ok, "treasury transfer failed");
        emit Harvested(toVault, toTreasury);
    }
}
