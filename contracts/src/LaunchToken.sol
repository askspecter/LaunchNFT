// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply coin. The whole supply is minted once to its market.
contract LaunchToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address market)
        ERC20(name_, symbol_)
    {
        _mint(market, supply);
    }
}
