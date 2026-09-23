import { parseAbi } from "viem";

export const launcherAbi = parseAbi([
  "function launchCount() view returns (uint256)",
  "function launches(uint256) view returns (address token, address curve, address router, address vault, address collection, address creator)",
  "function registry() view returns (address)",
]);

export const routerAbi = parseAbi([
  "function pending() view returns (uint256)",
  "function harvest()",
]);

export const vaultAbi = parseAbi([
  "function policy() view returns (uint8)",
  "function ceiling() view returns (uint256)",
  "function ceilingExpiry() view returns (uint256)",
  "function postCeiling(uint256 ceiling)",
  "function buy(address marketplace, bytes data, uint256 tokenId, uint256 price)",
  "function inRaffle(uint256) view returns (bool)",
  "function raffleCount() view returns (uint256)",
  "function raffles(uint256) view returns (uint256 tokenId, bytes32 root, uint256 totalTickets, uint64 publishedAt, uint64 drawBlock, uint256 winningTicket, bool drawn, bool claimed)",
  "function openRaffle(uint256 tokenId, bytes32 root, uint256 totalTickets) returns (uint256)",
  "function commitDraw(uint256 id)",
  "function draw(uint256 id)",
  "function claim(uint256 id, address account, uint256 start, uint256 end, bytes32[] proof)",
  "function SNAPSHOT_DELAY() view returns (uint256)",
  "event Bought(address indexed marketplace, uint256 indexed tokenId, uint256 price)",
]);

export const erc20Abi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const erc721Abi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
]);

export const arbSysAbi = parseAbi(["function arbBlockNumber() view returns (uint256)"]);
export const ARB_SYS = "0x0000000000000000000000000000000000000064";

export const POLICY = ["raffle", "hold", "burn"];
