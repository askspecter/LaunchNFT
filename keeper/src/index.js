import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, formatEther, getAddress, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config.js";
import { launcherAbi, routerAbi, vaultAbi, erc721Abi, arbSysAbi, ARB_SYS, POLICY } from "./abi.js";
import { OpenSea, RateLimited } from "./opensea.js";
import { serveSnapshots } from "./server.js";
import { balancesAt, buildSnapshot, winnerOf } from "./snapshot.js";
import { log, warn } from "./log.js";

const cfg = loadConfig();
const chain = defineChain({
  id: cfg.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
const account = privateKeyToAccount(cfg.privateKey);
const wallet = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
const opensea = cfg.sweepDisabled ? null : new OpenSea({ apiKey: cfg.openseaApiKey, chain: cfg.openseaChain, log });

/** Chain time, not wall-clock time: the vault's checks use block.timestamp. */
async function chainNow() {
  return (await client.getBlock()).timestamp;
}

/** Waits until the chain (ArbSys) block number reaches `n`, up to ~2 minutes. */
async function waitForChainBlock(n) {
  for (let i = 0; i < 240; i++) {
    const current = await client.readContract({ address: ARB_SYS, abi: arbSysAbi, functionName: "arbBlockNumber" });
    if (current >= n) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`chain did not reach block ${n}`);
}

/** Simulate first so a bad call costs nothing, then send and wait. */
async function send(label, req) {
  const { request } = await client.simulateContract({ account, ...req });
  if (cfg.dryRun) return log(`[dry-run] ${label}`);
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  log(`${label} ✓ ${hash}`);
  return receipt;
}

async function readLaunches() {
  const count = await client.readContract({ address: cfg.launcher, abi: launcherAbi, functionName: "launchCount" });
  const out = [];
  for (let i = 0n; i < count; i++) {
    const [token, curve, router, vault, collection] = await client.readContract({
      address: cfg.launcher, abi: launcherAbi, functionName: "launches", args: [i],
    });
    const policy = await client.readContract({ address: vault, abi: vaultAbi, functionName: "policy" });
    out.push({ id: i, token, curve, router, vault, collection, policy: POLICY[policy] });
  }
  return out;
}

async function harvest(l) {
  const pending = await client.readContract({ address: l.router, abi: routerAbi, functionName: "pending" });
  if (pending < cfg.minHarvest) return;
  log(`#${l.id} harvesting ${formatEther(pending)} ETH`);
  await send(`#${l.id} harvest`, { address: l.router, abi: routerAbi, functionName: "harvest" });
}

async function sweep(l) {
  if (!opensea) return;
  const balance = await client.getBalance({ address: l.vault });
  if (balance === 0n) return;

  const listings = await opensea.bestListings(l.collection);
  const floor = listings[0];
  if (!floor || floor.price > balance) return;

  // Ceiling = observed floor + markup, capped. The vault enforces price <= ceiling on-chain.
  let ceiling = (floor.price * (10_000n + cfg.ceilingMarkupBps)) / 10_000n;
  if (ceiling > cfg.maxCeiling) ceiling = cfg.maxCeiling;
  if (floor.price > ceiling) return warn(`#${l.id} floor ${formatEther(floor.price)} above MAX_CEILING_ETH`);

  const [current, expiry] = await Promise.all([
    client.readContract({ address: l.vault, abi: vaultAbi, functionName: "ceiling" }),
    client.readContract({ address: l.vault, abi: vaultAbi, functionName: "ceilingExpiry" }),
  ]);
  const now = await chainNow();
  if (expiry <= now + 60n || current < floor.price) {
    await send(`#${l.id} postCeiling ${formatEther(ceiling)}`, {
      address: l.vault, abi: vaultAbi, functionName: "postCeiling", args: [ceiling],
    });
  }

  const tx = await opensea.fulfillment(floor, l.vault);
  if (getAddress(tx.to) !== getAddress(cfg.seaport)) throw new Error(`unexpected marketplace ${tx.to}`);
  if (tx.value !== floor.price) throw new Error(`fulfillment value ${tx.value} != listing ${floor.price}`);

  log(`#${l.id} buying token ${floor.tokenId} for ${formatEther(floor.price)} ETH`);
  await send(`#${l.id} buy ${floor.tokenId}`, {
    address: l.vault, abi: vaultAbi, functionName: "buy", args: [tx.to, tx.data, floor.tokenId, floor.price],
  });
}

function snapshotPath(vault, id) {
  return join(cfg.snapshotDir, `${vault.toLowerCase()}-${id}.json`);
}

async function heldTokenIds(l) {
  const logs = await client.getContractEvents({
    address: l.vault, abi: vaultAbi, eventName: "Bought", fromBlock: cfg.startBlock, toBlock: "latest",
  });
  const ids = [...new Set(logs.map((x) => x.args.tokenId))];
  const held = [];
  for (const id of ids) {
    const [owner, busy] = await Promise.all([
      client.readContract({ address: l.collection, abi: erc721Abi, functionName: "ownerOf", args: [id] }).catch(() => null),
      client.readContract({ address: l.vault, abi: vaultAbi, functionName: "inRaffle", args: [id] }),
    ]);
    if (owner && getAddress(owner) === getAddress(l.vault) && !busy) held.push(id);
  }
  return held;
}

async function openRaffles(l) {
  for (const tokenId of await heldTokenIds(l)) {
    const block = await client.getBlockNumber();
    const balances = await balancesAt(client, l.token, cfg.startBlock, block, cfg.logChunk);
    const snap = await buildSnapshot(client, balances, {
      exclude: [l.curve, l.router, l.vault, cfg.launcher],
      minBalance: cfg.minTicketBalance,
    });
    if (!snap) return warn(`#${l.id} no eligible holders for raffle`);

    const receipt = await send(`#${l.id} openRaffle token ${tokenId} (${snap.entries.length} holders)`, {
      address: l.vault, abi: vaultAbi, functionName: "openRaffle", args: [tokenId, snap.root, snap.totalTickets],
    });
    if (!receipt) return;
    const [opened] = parseEventLogs({
      abi: [{ type: "event", name: "RaffleOpened", inputs: [
        { name: "id", type: "uint256", indexed: true }, { name: "tokenId", type: "uint256", indexed: true },
        { name: "root", type: "bytes32" }, { name: "totalTickets", type: "uint256" }] }],
      logs: receipt.logs,
    });
    const id = opened.args.id;
    await mkdir(cfg.snapshotDir, { recursive: true });
    await writeFile(snapshotPath(l.vault, id), JSON.stringify({
      vault: l.vault, raffleId: id.toString(), tokenId: tokenId.toString(), collection: l.collection,
      token: l.token, block: block.toString(), root: snap.root, totalTickets: snap.totalTickets.toString(),
      entries: snap.entries,
    }, null, 2));
    log(`#${l.id} snapshot saved ${snapshotPath(l.vault, id)}`);
  }
}

async function progressRaffles(l) {
  const [count, delay] = await Promise.all([
    client.readContract({ address: l.vault, abi: vaultAbi, functionName: "raffleCount" }),
    client.readContract({ address: l.vault, abi: vaultAbi, functionName: "SNAPSHOT_DELAY" }),
  ]);
  const now = await chainNow();
  for (let id = 0n; id < count; id++) {
    const [, , , publishedAt, drawBlock, winningTicket, drawn, claimed] = await client.readContract({
      address: l.vault, abi: vaultAbi, functionName: "raffles", args: [id],
    });
    if (claimed) continue;

    if (!drawn) {
      // The pinned block's hash is readable for only 256 chain blocks (~25s on Robinhood
      // Chain), so commit and draw happen in the same pass instead of across ticks.
      let target = drawBlock;
      if (target === 0n) {
        if (now < publishedAt + delay) continue;
        await send(`#${l.id} raffle ${id} commitDraw`, { address: l.vault, abi: vaultAbi, functionName: "commitDraw", args: [id] });
        if (cfg.dryRun) continue;
        [, , , , target] = await client.readContract({ address: l.vault, abi: vaultAbi, functionName: "raffles", args: [id] });
      }
      await waitForChainBlock(target + 1n);
      await send(`#${l.id} raffle ${id} draw`, { address: l.vault, abi: vaultAbi, functionName: "draw", args: [id] });
      continue; // deliver next pass (or immediately below on the following tick)
    }
    if (drawn) {
      // Delivery is permissionless: the keeper claims on the winner's behalf.
      const snap = JSON.parse(await readFile(snapshotPath(l.vault, id), "utf8").catch(() => "null"));
      if (!snap) { warn(`#${l.id} raffle ${id}: snapshot file missing, winner must claim manually`); continue; }
      const w = winnerOf(snap, winningTicket);
      await send(`#${l.id} raffle ${id} deliver to ${w.account}`, {
        address: l.vault, abi: vaultAbi, functionName: "claim",
        args: [id, w.account, BigInt(w.start), BigInt(w.end), w.proof],
      });
    }
  }
}

async function tick() {
  const launches = await readLaunches();
  for (const l of launches) {
    for (const [name, step] of [["harvest", harvest], ["sweep", sweep], ["raffle-open", openRaffles], ["raffle-progress", progressRaffles]]) {
      if (l.policy !== "raffle" && name.startsWith("raffle")) continue;
      try {
        await step(l);
      } catch (e) {
        if (e instanceof RateLimited) { warn(e.message); continue; }
        warn(`#${l.id} ${name}: ${e.shortMessage || e.message}`);
      }
    }
  }
}

async function main() {
  const id = await client.getChainId();
  if (id !== cfg.chainId) throw new Error(`RPC chain ${id} != CHAIN_ID ${cfg.chainId}`);
  const mode = !opensea ? "sweeping disabled" : cfg.openseaApiKey ? "OpenSea key from env" : "OpenSea free-tier key (auto)";
  log(`keeper ${account.address} on chain ${id} — ${mode}${cfg.dryRun ? " (dry run)" : ""}`);
  if (cfg.snapshotPort) serveSnapshots(cfg.snapshotDir, cfg.snapshotPort, log);
  const once = process.argv.includes("--once");
  do {
    await tick().catch((e) => warn(`tick failed: ${e.shortMessage || e.message}`));
    if (!once) await new Promise((r) => setTimeout(r, cfg.intervalSec * 1000));
  } while (!once);
}

main().catch((e) => { console.error(e); process.exit(1); });
