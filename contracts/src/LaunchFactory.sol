// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Registry} from "./Registry.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {CurveMarket} from "./CurveMarket.sol";
import {FeeSplitter} from "./FeeSplitter.sol";
import {SweepVault} from "./SweepVault.sol";

/// @notice One call launches a coin, its bonding-curve market, fee splitter and vault.
/// The collection pairing and NFT policy are fixed forever at this point.
contract LaunchFactory {
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant VIRTUAL_ETH = 1 ether;

    Registry public immutable registry;

    struct Launch {
        address token;
        address market;
        address splitter;
        address vault;
        address collection;
        address creator;
    }

    Launch[] public launches;

    event Launched(
        uint256 indexed id,
        address indexed creator,
        address indexed collection,
        address token,
        address market,
        address splitter,
        address vault,
        SweepVault.Policy policy
    );

    constructor(Registry registry_) {
        registry = registry_;
    }

    function launch(string calldata name, string calldata symbol, IERC721 collection, SweepVault.Policy policy)
        external
        returns (uint256 id)
    {
        require(collection.supportsInterface(type(IERC721).interfaceId), "not ERC721");

        SweepVault vault = new SweepVault(registry, collection, policy);
        FeeSplitter splitter = new FeeSplitter(registry, address(vault));
        CurveMarket market = new CurveMarket(address(splitter), VIRTUAL_ETH);
        LaunchToken token = new LaunchToken(name, symbol, SUPPLY, address(market));
        market.init(token);

        id = launches.length;
        launches.push(Launch(address(token), address(market), address(splitter), address(vault), address(collection), msg.sender));
        emit Launched(id, msg.sender, address(collection), address(token), address(market), address(splitter), address(vault), policy);
    }

    function launchCount() external view returns (uint256) {
        return launches.length;
    }
}
