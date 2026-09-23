// Scans OpenSea for NFT collections worth listing on LaunchNFT and writes
// data/collection-candidates.json. Run by .github/workflows/scan-collections.yml.
//
// For each chain it pages through collections ordered by 7-day volume, fetches stats for
// the top ones, checks on-chain that the contract is an ERC-721 (what the vaults can buy
// through Seaport), and keeps collections that are actually trading.
import { writeFile, mkdir } from "node:fs/promises";

const KEY = process.env.OPENSEA_API_KEY;
if (!KEY) throw new Error("OPENSEA_API_KEY missing");
const CHAINS = {
  ethereum: { id: 1, rpc: "https://ethereum-rpc.publicnode.com" },
  base: { id: 8453, rpc: "https://base-rpc.publicnode.com" },
  robinhood: { id: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com" },
  hyperevm: { id: 999, rpc: "https://rpc.hyperliquid.xyz/evm" },
};
const SOLANA_ID = 792703809;
const PER_CHAIN = Number(process.env.PER_CHAIN || 200); // collections examined per chain
const MIN_SALES_7D = Number(process.env.MIN_SALES_7D || 5);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function os(path) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`https://api.opensea.io/api/v2${path}`, { headers: { accept: "application/json", "x-api-key": KEY } });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`OpenSea ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    await sleep(250); // stay well under the rate limit
    return res.json();
  }
  throw new Error(`OpenSea kept rate limiting ${path}`);
}

async function isErc721(rpc, address) {
  const res = await fetch(rpc, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: address, data: "0x01ffc9a780ac58cd00000000000000000000000000000000000000000000000000000000" }, "latest"] }),
  }).then((r) => r.json()).catch(() => null);
  return !!res?.result && res.result !== "0x" && BigInt(res.result) === 1n;
}

const out = { scannedAt: new Date().toISOString(), minSales7d: MIN_SALES_7D, chains: {} };
for (const [chain, cfg] of Object.entries(CHAINS)) {
  const seen = [];
  let next = "";
  while (seen.length < PER_CHAIN) {
    const page = await os(`/collections?chain=${chain}&order_by=seven_day_volume&limit=100${next ? `&next=${next}` : ""}`);
    seen.push(...(page.collections || []));
    if (!page.next || !page.collections?.length) break;
    next = encodeURIComponent(page.next);
  }
  console.log(`${chain}: ${seen.length} collections to examine`);

  const rows = [];
  for (const c of seen.slice(0, PER_CHAIN)) {
    const contract = (c.contracts || []).find((x) => x.chain === chain)?.address;
    if (!contract || c.trading_enabled === false) continue;
    let stats;
    try { stats = await os(`/collections/${c.collection}/stats`); } catch (e) { console.warn(c.collection, e.message); continue; }
    const week = (stats.intervals || []).find((i) => i.interval === "seven_day") || {};
    const day = (stats.intervals || []).find((i) => i.interval === "one_day") || {};
    const row = {
      chainId: cfg.id, chain, slug: c.collection, name: c.name, address: contract, image: c.image_url || null,
      verified: c.safelist_status === "verified",
      floor: stats.total?.floor_price ?? 0, floorSymbol: stats.total?.floor_price_symbol || "ETH",
      volume7d: week.volume ?? 0, sales7d: week.sales ?? 0, volume1d: day.volume ?? 0, sales1d: day.sales ?? 0,
      owners: stats.total?.num_owners ?? 0, supply: c.total_supply ?? null,
    };
    if (!row.floor || row.sales7d < MIN_SALES_7D) continue;
    row.erc721 = await isErc721(cfg.rpc, contract);
    rows.push(row);
  }
  rows.sort((a, b) => b.volume7d - a.volume7d);
  out.chains[chain] = rows;
  console.log(`${chain}: ${rows.length} active, ${rows.filter((r) => r.erc721).length} ERC-721`);
}

// Solana: Magic Eden's public popular-collections and stats endpoints (no key needed to read).
async function me(path) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`https://api-mainnet.magiceden.dev/v2${path}`, { headers: { accept: "application/json" } });
    if (res.status === 429) { await sleep(2 ** attempt * 1000); continue; }
    if (!res.ok) throw new Error(`Magic Eden ${res.status} ${path}`);
    await sleep(600); // public rate limit is ~2 req/s
    return res.json();
  }
  throw new Error(`Magic Eden kept rate limiting ${path}`);
}
try {
  const popular = [
    ...(await me("/marketplace/popular_collections?timeRange=7d&limit=100")),
    ...(await me("/marketplace/popular_collections?timeRange=30d&limit=100")),
  ];
  const bySymbol = new Map(popular.map((c) => [c.symbol, c]));
  const rows = [];
  for (const c of bySymbol.values()) {
    let stats;
    try { stats = await me(`/collections/${encodeURIComponent(c.symbol)}/stats`); } catch { continue; }
    const floor = (stats.floorPrice ?? c.floorPrice ?? 0) / 1e9;
    if (!floor) continue;
    rows.push({
      chainId: SOLANA_ID, chain: "solana", slug: c.symbol, name: c.name, address: c.symbol, image: c.image || null,
      verified: true, floor, floorSymbol: "SOL", volume7d: (c.volumeAll ?? 0) / 1e9, sales7d: null,
      listed: stats.listedCount ?? null, erc721: false,
    });
  }
  rows.sort((a, b) => b.floor - a.floor);
  out.chains.solana = rows;
  console.log(`solana: ${rows.length} popular collections`);
} catch (e) {
  console.warn("solana scan failed:", e.message);
}

await mkdir("../data", { recursive: true });
await writeFile("../data/collection-candidates.json", JSON.stringify(out, null, 2));
console.log("wrote data/collection-candidates.json");
