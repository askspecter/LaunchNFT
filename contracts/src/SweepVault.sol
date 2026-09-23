// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Registry} from "./Registry.sol";
import {ARB_SYS} from "./interfaces/IArbSys.sol";

/// @notice Holds a coin's share of fees and can spend it on exactly one thing:
/// NFTs from the paired collection, bought through an allow-listed marketplace
/// at or below a keeper-posted ceiling. There is deliberately no withdraw path.
contract SweepVault is IERC721Receiver, ReentrancyGuard {
    enum Policy { Raffle, Hold, Burn }

    uint256 public constant CEILING_TTL = 1 hours;
    uint256 public constant SNAPSHOT_DELAY = 15 minutes;
    /// @dev Chain blocks (~0.1s each) between committing a draw and the block whose hash seeds it.
    uint256 public constant DRAW_OFFSET = 20;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    Registry public immutable registry;
    IERC721 public immutable collection;
    Policy public immutable policy;

    uint256 public ceiling;
    uint256 public ceilingExpiry;

    struct Raffle {
        uint256 tokenId;
        bytes32 root; // leaves: keccak256(abi.encode(account, start, end)), tickets [start, end)
        uint256 totalTickets;
        uint64 publishedAt;
        uint64 drawBlock; // 0 until a draw is committed
        uint256 winningTicket;
        bool drawn;
        bool claimed;
    }

    Raffle[] public raffles;
    mapping(uint256 => bool) public inRaffle;

    event CeilingPosted(uint256 ceiling, uint256 expiry);
    event Bought(address indexed marketplace, uint256 indexed tokenId, uint256 price);
    event Burned(uint256 indexed tokenId);
    event RaffleOpened(uint256 indexed id, uint256 indexed tokenId, bytes32 root, uint256 totalTickets);
    event DrawCommitted(uint256 indexed id, uint64 drawBlock);
    event DrawExpired(uint256 indexed id, uint64 drawBlock);
    event RaffleDrawn(uint256 indexed id, uint256 winningTicket);
    event RaffleClaimed(uint256 indexed id, address indexed winner, uint256 tokenId);

    modifier onlyKeeper() {
        require(msg.sender == registry.keeper(), "not keeper");
        _;
    }

    constructor(Registry registry_, IERC721 collection_, Policy policy_) {
        registry = registry_;
        collection = collection_;
        policy = policy_;
    }

    receive() external payable {}

    // ---------------------------------------------------------------- buying

    function postCeiling(uint256 ceiling_) external onlyKeeper {
        ceiling = ceiling_;
        ceilingExpiry = block.timestamp + CEILING_TTL;
        emit CeilingPosted(ceiling_, ceilingExpiry);
    }

    /// @notice Buy `tokenId` by forwarding `price` wei and `data` to an allow-listed marketplace.
    /// Reverts unless the vault owns the NFT afterwards and spent no more than `price`.
    function buy(address marketplace, bytes calldata data, uint256 tokenId, uint256 price)
        external
        onlyKeeper
        nonReentrant
    {
        require(registry.isMarketplace(marketplace), "marketplace not allowed");
        require(block.timestamp < ceilingExpiry, "ceiling expired");
        require(price <= ceiling, "above ceiling");

        uint256 balanceBefore = address(this).balance;
        (bool ok,) = marketplace.call{value: price}(data);
        require(ok, "marketplace call failed");

        require(collection.ownerOf(tokenId) == address(this), "nft not received");
        require(balanceBefore - address(this).balance <= price, "overspent");
        emit Bought(marketplace, tokenId, price);

        if (policy == Policy.Burn) {
            collection.transferFrom(address(this), BURN_ADDRESS, tokenId);
            emit Burned(tokenId);
        }
    }

    // --------------------------------------------------------------- raffles

    /// @notice Keeper publishes a holder snapshot for one NFT held by the vault.
    function openRaffle(uint256 tokenId, bytes32 root, uint256 totalTickets) external onlyKeeper returns (uint256 id) {
        require(policy == Policy.Raffle, "policy");
        require(collection.ownerOf(tokenId) == address(this) && !inRaffle[tokenId], "nft unavailable");
        require(totalTickets > 0 && root != bytes32(0), "empty snapshot");

        inRaffle[tokenId] = true;
        id = raffles.length;
        raffles.push(Raffle(tokenId, root, totalTickets, uint64(block.timestamp), 0, 0, false, false));
        emit RaffleOpened(id, tokenId, root, totalTickets);
    }

    /// @notice Step 1, callable by anyone once the snapshot has been public for SNAPSHOT_DELAY:
    /// pins a block that does not exist yet, so nobody knows its hash at commit time.
    function commitDraw(uint256 id) external {
        Raffle storage r = raffles[id];
        require(!r.drawn && r.drawBlock == 0, "committed");
        require(block.timestamp >= r.publishedAt + SNAPSHOT_DELAY, "too early");
        r.drawBlock = uint64(ARB_SYS.arbBlockNumber() + DRAW_OFFSET);
        emit DrawCommitted(id, r.drawBlock);
    }

    /// @notice Step 2, callable by anyone after the pinned block. Block hashes are only
    /// readable for 256 blocks; if that window was missed the commit is cleared and
    /// `commitDraw` must be called again (logged via DrawExpired).
    function draw(uint256 id) external {
        Raffle storage r = raffles[id];
        require(!r.drawn && r.drawBlock != 0, "not committed");
        uint256 current = ARB_SYS.arbBlockNumber();
        require(current > r.drawBlock, "too early");

        if (current - r.drawBlock > 256) {
            emit DrawExpired(id, r.drawBlock);
            r.drawBlock = 0;
            return;
        }
        bytes32 seed = ARB_SYS.arbBlockHash(r.drawBlock);
        r.winningTicket = uint256(keccak256(abi.encode(seed, address(this), id))) % r.totalTickets;
        r.drawn = true;
        emit RaffleDrawn(id, r.winningTicket);
    }

    function claim(uint256 id, address account, uint256 start, uint256 end, bytes32[] calldata proof) external {
        Raffle storage r = raffles[id];
        require(r.drawn && !r.claimed, "not claimable");
        require(start <= r.winningTicket && r.winningTicket < end, "not winning range");
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, start, end))));
        require(MerkleProof.verifyCalldata(proof, r.root, leaf), "bad proof");

        r.claimed = true;
        collection.safeTransferFrom(address(this), account, r.tokenId);
        emit RaffleClaimed(id, account, r.tokenId);
    }

    function raffleCount() external view returns (uint256) {
        return raffles.length;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        require(msg.sender == address(collection), "wrong collection");
        return IERC721Receiver.onERC721Received.selector;
    }
}
