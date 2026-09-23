// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Registry} from "../src/Registry.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {CurveMarket} from "../src/CurveMarket.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {SweepVault} from "../src/SweepVault.sol";

contract MockNFT is ERC721("Mock", "MOCK") {
    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

/// @dev Minimal marketplace: sellers escrow an NFT at a fixed price, buyers pay exactly that.
contract MockMarket {
    struct Listing { address seller; uint256 price; }
    IERC721 public immutable nft;
    mapping(uint256 => Listing) public listings;

    constructor(IERC721 nft_) { nft = nft_; }

    function list(uint256 id, uint256 price) external {
        nft.transferFrom(msg.sender, address(this), id);
        listings[id] = Listing(msg.sender, price);
    }

    function fill(uint256 id) external payable {
        Listing memory l = listings[id];
        require(msg.value == l.price, "price");
        delete listings[id];
        nft.transferFrom(address(this), msg.sender, id);
        payable(l.seller).transfer(msg.value);
    }
}

contract LaunchNFTTest is Test {
    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address seller = makeAddr("seller");

    Registry registry;
    LaunchFactory factory;
    MockNFT nft;
    MockMarket market;

    function setUp() public {
        registry = new Registry(owner, keeper, treasury);
        factory = new LaunchFactory(registry);
        nft = new MockNFT();
        market = new MockMarket(nft);
        vm.prank(owner);
        registry.setMarketplace(address(market), true);
    }

    function _launch(SweepVault.Policy policy)
        internal
        returns (LaunchToken token, CurveMarket curve, FeeSplitter splitter, SweepVault vault)
    {
        vm.prank(creator);
        uint256 id = factory.launch("Floor Muncher", "MUNCH", nft, policy);
        (address t, address m, address s, address v,,) = factory.launches(id);
        return (LaunchToken(t), CurveMarket(m), FeeSplitter(payable(s)), SweepVault(payable(v)));
    }

    function _list(uint256 id, uint256 price) internal {
        nft.mint(seller, id);
        vm.startPrank(seller);
        nft.approve(address(market), id);
        market.list(id, price);
        vm.stopPrank();
    }

    function _fundVault(CurveMarket curve, FeeSplitter splitter, uint256 volume) internal {
        vm.deal(alice, volume);
        vm.prank(alice);
        curve.buy{value: volume}(0);
        splitter.harvest();
    }

    function test_launchWiresEverything() public {
        (LaunchToken token, CurveMarket curve,, SweepVault vault) = _launch(SweepVault.Policy.Raffle);
        assertEq(token.balanceOf(address(curve)), factory.SUPPLY());
        assertEq(address(vault.collection()), address(nft));
        assertEq(uint8(vault.policy()), uint8(SweepVault.Policy.Raffle));
        assertEq(factory.launchCount(), 1);
    }

    function test_launchRejectsNonNft() public {
        vm.expectRevert();
        factory.launch("X", "X", IERC721(address(registry)), SweepVault.Policy.Hold);
    }

    function test_buySellAndFeeSplit() public {
        (LaunchToken token, CurveMarket curve, FeeSplitter splitter, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        vm.deal(alice, 10 ether);

        vm.prank(alice);
        uint256 got = curve.buy{value: 10 ether}(0);
        assertGt(got, 0);
        assertEq(address(splitter).balance, 0.1 ether);

        vm.startPrank(alice);
        token.approve(address(curve), got);
        uint256 back = curve.sell(got, 0);
        vm.stopPrank();
        assertLt(back, 10 ether);
        assertLe(curve.ethReserve(), 1); // everything paid back except rounding dust

        uint256 fees = address(splitter).balance;
        splitter.harvest();
        assertEq(address(vault).balance, fees * 8_000 / 10_000);
        assertEq(treasury.balance, fees - fees * 8_000 / 10_000);
    }

    function test_buySlippage() public {
        (, CurveMarket curve,,) = _launch(SweepVault.Policy.Hold);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert("slippage");
        curve.buy{value: 1 ether}(type(uint256).max);
    }

    function test_vaultBuysUnderCeiling() public {
        (, CurveMarket curve, FeeSplitter splitter, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        _fundVault(curve, splitter, 100 ether); // 1 ETH fee -> 0.8 ETH vault
        _list(7, 0.5 ether);

        vm.startPrank(keeper);
        vault.postCeiling(0.6 ether);
        vault.buy(address(market), abi.encodeCall(MockMarket.fill, (7)), 7, 0.5 ether);
        vm.stopPrank();

        assertEq(nft.ownerOf(7), address(vault));
        assertEq(address(vault).balance, 0.3 ether);
        assertEq(seller.balance, 0.5 ether);
    }

    function test_vaultRejectsAboveCeilingExpiredOrUnlisted() public {
        (, CurveMarket curve, FeeSplitter splitter, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        _fundVault(curve, splitter, 100 ether);
        _list(1, 0.5 ether);
        bytes memory data = abi.encodeCall(MockMarket.fill, (1));

        vm.startPrank(keeper);
        vault.postCeiling(0.4 ether);
        vm.expectRevert("above ceiling");
        vault.buy(address(market), data, 1, 0.5 ether);

        vault.postCeiling(0.6 ether);
        skip(1 hours);
        vm.expectRevert("ceiling expired");
        vault.buy(address(market), data, 1, 0.5 ether);

        vault.postCeiling(0.6 ether);
        vm.expectRevert("marketplace not allowed");
        vault.buy(alice, data, 1, 0.5 ether);
        vm.stopPrank();

        vm.expectRevert("not keeper");
        vault.buy(address(market), data, 1, 0.5 ether);
    }

    function test_burnPolicy() public {
        (, CurveMarket curve, FeeSplitter splitter, SweepVault vault) = _launch(SweepVault.Policy.Burn);
        _fundVault(curve, splitter, 100 ether);
        _list(3, 0.5 ether);

        vm.startPrank(keeper);
        vault.postCeiling(1 ether);
        vault.buy(address(market), abi.encodeCall(MockMarket.fill, (3)), 3, 0.5 ether);
        vm.stopPrank();
        assertEq(nft.ownerOf(3), vault.BURN_ADDRESS());
    }

    function test_rejectsOtherCollections() public {
        (,,, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        MockNFT other = new MockNFT();
        other.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert("wrong collection");
        other.safeTransferFrom(alice, address(vault), 1);
    }

    function test_raffleFlow() public {
        (, CurveMarket curve, FeeSplitter splitter, SweepVault vault) = _launch(SweepVault.Policy.Raffle);
        _fundVault(curve, splitter, 100 ether);
        _list(9, 0.5 ether);
        vm.startPrank(keeper);
        vault.postCeiling(1 ether);
        vault.buy(address(market), abi.encodeCall(MockMarket.fill, (9)), 9, 0.5 ether);

        // Two holders: alice owns tickets [0, 60), bob owns [60, 100).
        address bob = makeAddr("bob");
        bytes32 leafA = keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(0), uint256(60)))));
        bytes32 leafB = keccak256(bytes.concat(keccak256(abi.encode(bob, uint256(60), uint256(100)))));
        bytes32 root = leafA < leafB ? keccak256(abi.encode(leafA, leafB)) : keccak256(abi.encode(leafB, leafA));
        uint256 id = vault.openRaffle(9, root, 100);
        vm.stopPrank();

        vm.expectRevert("too early");
        vault.draw(id);

        (,,,, uint64 drawBlock,,,) = vault.raffles(id);
        vm.roll(drawBlock + 1);
        skip(15 minutes);
        vault.draw(id);
        (,,,,, uint256 winning, bool drawn,) = vault.raffles(id);
        assertTrue(drawn);

        bytes32[] memory proof = new bytes32[](1);
        if (winning < 60) {
            proof[0] = leafB;
            vault.claim(id, alice, 0, 60, proof);
            assertEq(nft.ownerOf(9), alice);
        } else {
            proof[0] = leafA;
            vault.claim(id, bob, 60, 100, proof);
            assertEq(nft.ownerOf(9), bob);
        }

        vm.expectRevert("not claimable");
        vault.claim(id, alice, 0, 60, proof);
    }

    function test_raffleRetargetsStaleBlock() public {
        (, CurveMarket curve, FeeSplitter splitter, SweepVault vault) = _launch(SweepVault.Policy.Raffle);
        _fundVault(curve, splitter, 100 ether);
        _list(2, 0.5 ether);
        vm.startPrank(keeper);
        vault.postCeiling(1 ether);
        vault.buy(address(market), abi.encodeCall(MockMarket.fill, (2)), 2, 0.5 ether);
        uint256 id = vault.openRaffle(2, keccak256("root"), 10);
        vm.stopPrank();

        (,,,, uint64 drawBlock,,,) = vault.raffles(id);
        vm.roll(drawBlock + 300);
        skip(15 minutes);
        vault.draw(id);
        (,,,, uint64 newBlock,, bool drawn,) = vault.raffles(id);
        assertFalse(drawn);
        assertEq(newBlock, block.number + 5);
    }

    function testFuzz_curveNeverPaysOutMoreThanReserve(uint96 ethIn, uint96 sellPart) public {
        (LaunchToken token, CurveMarket curve,,) = _launch(SweepVault.Policy.Hold);
        ethIn = uint96(bound(ethIn, 1e12, 1_000 ether));
        vm.deal(alice, ethIn);
        vm.startPrank(alice);
        uint256 got = curve.buy{value: ethIn}(0);
        uint256 toSell = bound(sellPart, 1, got);
        token.approve(address(curve), toSell);
        (uint256 quote,) = curve.quoteSell(toSell);
        if (quote > 0) curve.sell(toSell, 0);
        vm.stopPrank();
        assertGe(address(curve).balance, curve.ethReserve());
    }
}
