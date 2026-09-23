import {
  createPublicClient, createWalletClient, custom, http, defineChain, parseAbi,
  formatEther, isAddress, toHex, getAddress, keccak256, encodeAbiParameters, pad,
} from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";
import { CONFIG } from "./config.js";

export { CONFIG, formatEther, isAddress, toHex, getAddress };

export const chain = defineChain({
  id: CONFIG.chainId,
  name: CONFIG.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: CONFIG.explorer } },
});
export const client = createPublicClient({ chain, transport: http() });
export const live = isAddress(CONFIG.launcher);
export const externalLive = isAddress(CONFIG.externalLauncher || "");
export const ROBINHOOD = CONFIG.chainId;
export const chainName = (id) => CONFIG.chains[Number(id)]?.name || `Chain ${id}`;

/** Round chain logo; pages that load from a sub-folder pass `base = "../"` is not needed since
 *  every page lives at the site root. */
export function chainIcon(id) {
  const c = CONFIG.chains[Number(id)];
  return c?.icon ? `<img class="chain-icon" src="${c.icon}" alt="" width="16" height="16" />` : "";
}

/** Collection logo (from collections.json), or a coloured initial when there is none. */
export function collectionLogo(name, image, size = 44) {
  const style = `width:${size}px;height:${size}px`;
  const initial = `<span class="col-logo col-logo-fallback" style="${style};background:${colorFor(name || "?")}">${esc((name || "?").slice(0, 1))}</span>`;
  if (!image) return initial;
  return `<img class="col-logo" style="${style}" src="${esc(image)}" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.fallback" data-fallback="${esc(initial)}" />`;
}

/** Logo + name pill, e.g. for coin cards and collection rows. */
export const chainBadge = (id) => `<span class="pill-chain">${chainIcon(id)}${esc(chainName(id))}</span>`;

/** Chain id for a display name (used by the filter chips). */
export const chainIdByName = (name) => Number(Object.keys(CONFIG.chains).find((k) => CONFIG.chains[k].name === name));

export const ABI = {
  pons: parseAbi([
    "function launchFee() view returns (uint256)",
    "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  ]),
  launcher: parseAbi([
    "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
    "struct LaunchParams { string name; string symbol; string logo; string description; Socials socials; uint16 creatorTaxBps; uint256 launchConfigId; bytes32 expectedEconomics; bytes32 salt; address collection; uint8 policy; }",
    "function launch(LaunchParams p) payable returns (uint256)",
    "function launchCount() view returns (uint256)",
    "function registry() view returns (address)",
    "function launches(uint256) view returns (address token, address curve, address router, address vault, address collection, address creator)",
  ]),
  registry: parseAbi([
    "event CollectionSet(address collection, bool listed)",
    "function isCollection(address) view returns (bool)",
    "function keeper() view returns (address)",
    "function treasury() view returns (address)",
  ]),
  router: parseAbi(["function pending() view returns (uint256)", "function harvest()"]),
  vault: parseAbi([
    "function policy() view returns (uint8)",
    "function ceiling() view returns (uint256)",
    "function ceilingExpiry() view returns (uint256)",
    "function raffles() view returns (address)",
    "event Bought(address indexed marketplace, uint256 indexed tokenId, uint256 price)",
  ]),
  raffles: parseAbi([
    "struct Raffle { uint256 tokenId; bytes32 root; uint256 totalTickets; uint64 publishedAt; uint64 drawBlock; uint256 winningTicket; bool drawn; bool claimed; }",
    "function raffleCount(address vault) view returns (uint256)",
    "function raffles(address vault, uint256 id) view returns (Raffle)",
    "function claim(address vault, uint256 id, address account, uint256 start, uint256 end, bytes32[] proof)",
  ]),
  extLauncher: parseAbi([
    "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
    "struct LaunchParams { string name; string symbol; string logo; string description; Socials socials; uint16 creatorTaxBps; uint256 launchConfigId; bytes32 expectedEconomics; bytes32 salt; uint64 chainId; bytes32 collection; bool isEvm; uint8 policy; }",
    "function launch(LaunchParams p) payable returns (uint256)",
    "function launchCount() view returns (uint256)",
    "function launches(uint256) view returns (address token, address curve, address router, address vault, address collection, address creator)",
    "function collectionKey(uint64 chainId, bytes32 collection) pure returns (address)",
  ]),
  extVault: parseAbi([
    "function policy() view returns (uint8)",
    "function raffles() view returns (address)",
    "function externalChainId() view returns (uint64)",
    "function externalCollection() view returns (bytes32)",
    "function externalIsEvm() view returns (bool)",
    "function pendingAmount() view returns (uint256)",
    "function pendingReadyAt() view returns (uint256)",
    "function totalWithdrawn() view returns (uint256)",
    "function totalSpent() view returns (uint256)",
    "function prizeOwedTo(uint256) view returns (address)",
    "function prizeDestination(uint256) view returns (bytes32)",
    "function setPrizeDestination(uint256 tokenId, bytes32 destination)",
    "function cancelWithdrawal()",
    "event ExternalPurchase(uint256 indexed tokenId, uint256 price, bytes32 externalTx)",
    "event PrizeOwed(uint256 indexed tokenId, address indexed to)",
    "event PrizeDelivered(uint256 indexed tokenId, address indexed to, bytes32 destination, bytes32 externalTx)",
  ]),
  erc20: parseAbi(["function name() view returns (string)", "function symbol() view returns (string)"]),
  erc721: parseAbi([
    "function name() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function tokenURI(uint256) view returns (string)",
  ]),
};

export const POLICIES = ["Raffle", "Hold", "Burn"];

export const $ = (s, el = document) => el.querySelector(s);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
export const eth = (wei, dp = 3) => Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: dp });
export const addrLink = (a, label) => `<a class="mono" href="${CONFIG.explorer}/address/${a}" target="_blank" rel="noopener">${esc(label || short(a))}</a>`;
export const txLink = (h) => `${CONFIG.explorer}/tx/${h}`;

export function toast(msg) {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3200);
}

// ------------------------------------------------------------------ wallet

let account = null;
const listeners = new Set();
export const getAccount = () => account;
export const onAccount = (fn) => listeners.add(fn);

export async function connect() {
  if (!window.ethereum) throw new Error("No wallet found — install a browser wallet");
  const [acc] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const hexId = toHex(CONFIG.chainId);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    if (err.code !== 4902) throw err;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hexId, chainName: CONFIG.chainName, rpcUrls: [CONFIG.rpcUrl],
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [CONFIG.explorer],
      }],
    });
  }
  account = getAddress(acc);
  document.querySelectorAll("[data-connect]").forEach((b) => (b.textContent = short(account)));
  listeners.forEach((fn) => fn(account));
  return account;
}

export async function walletClient() {
  const from = account || (await connect());
  return createWalletClient({ account: from, chain, transport: custom(window.ethereum) });
}

/** Sends a contract write from the connected wallet and waits for it. */
export async function write(req) {
  const wallet = await walletClient();
  const { request } = await client.simulateContract({ account: wallet.account, ...req });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  return receipt;
}

// ------------------------------------------------------------------ layout

const NAV = [
  ["index.html", "Home"],
  ["explore.html", "Explore"],
  ["collections.html", "Collections"],
  ["claims.html", "Claims"],
  ["docs.html", "Docs"],
];

export function renderChrome(active) {
  const header = $("#site-header");
  if (header) {
    header.className = "nav";
    header.innerHTML = `
      <a href="index.html" class="brand">launch<span>nft</span><i>.</i></a>
      <nav class="nav-links" id="navLinks">
        ${NAV.map(([href, label]) => `<a href="${href}"${href === active ? ' class="active"' : ""}>${label}</a>`).join("")}
      </nav>
      <div class="nav-actions">
        <button class="btn btn-ghost" data-connect>Connect</button>
        <a class="btn btn-dark" href="launch.html">Launch</a>
        <button class="burger" id="burger" aria-label="Menu">☰</button>
      </div>`;
    $("[data-connect]", header).addEventListener("click", () => connect().catch((e) => toast(e.shortMessage || e.message)));
    $("#burger", header).addEventListener("click", () => $("#navLinks").classList.toggle("open"));
  }
  const footer = $("#site-footer");
  if (footer) {
    footer.className = "footer";
    footer.innerHTML = `
      <div>
        <a href="index.html" class="brand">launch<span>nft</span><i>.</i></a>
        <p>Pons coins on Robinhood Chain whose creator fees buy NFT floors. Vault rules are enforced on-chain.</p>
      </div>
      <div class="foot-links">${NAV.slice(1).map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}</div>
      <small>© ${new Date().getFullYear()} LaunchNFT. Not affiliated with Robinhood Markets or Pons. Not financial advice.</small>`;
  }
  if (!live) {
    const banner = document.createElement("div");
    banner.className = "banner";
    banner.textContent = "Contracts not deployed yet — showing sample data. Set CONFIG.launcher in config.js after deploying.";
    document.body.prepend(banner);
  }
}

// ------------------------------------------------------------------ data

const read = (address, abi, functionName, args) => client.readContract({ address, abi, functionName, args });

export async function launchCount() {
  return live ? Number(await read(CONFIG.launcher, ABI.launcher, "launchCount")) : 0;
}

// ---------------------------------------------------------------- collections metadata

let metaPromise;
/** Names and marketplace slugs for listed collections, from collections.json. */
export function collectionMeta() {
  metaPromise ||= fetch(CONFIG.collectionsUrl).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return metaPromise;
}

/** A collection id as the bytes32 the ExternalLauncher expects: the address, left-padded. */
export function collectionId(_chainId, address) {
  return pad(getAddress(address), { size: 32 });
}

/** Registry key: the address itself on Robinhood Chain, a hash of (chain, id) elsewhere. */
export function collectionKey(chainId, address) {
  if (Number(chainId) === ROBINHOOD) return getAddress(address);
  const hash = keccak256(encodeAbiParameters([{ type: "uint64" }, { type: "bytes32" }], [BigInt(chainId), collectionId(chainId, address)]));
  return getAddress(`0x${hash.slice(-40)}`);
}

export async function metaByKey() {
  const map = new Map();
  for (const c of await collectionMeta()) {
    try { map.set(collectionKey(c.chainId, c.address), c); } catch { /* malformed entry */ }
  }
  return map;
}


// ---------------------------------------------------------------- launches

async function nameFor(meta, collection) {
  const m = meta.get(getAddress(collection));
  if (m) return m.name;
  return read(collection, ABI.erc721, "name").catch(() => short(collection));
}

const imageFor = (meta, collection) => meta.get(getAddress(collection))?.image || null;

/** Full view of one launch. `id` is a number for Robinhood coins, "e<n>" for other chains. */
export async function loadLaunch(id) {
  if (String(id).startsWith("e")) return loadExternalLaunch(Number(String(id).slice(1)));
  const meta = await metaByKey();
  const [token, curve, router, vault, collection, creator] = await read(CONFIG.launcher, ABI.launcher, "launches", [BigInt(id)]);
  const [name, symbol, collectionName, vaultBalance, nfts, pending, policy] = await Promise.all([
    read(token, ABI.erc20, "name"),
    read(token, ABI.erc20, "symbol"),
    nameFor(meta, collection),
    client.getBalance({ address: vault }),
    read(collection, ABI.erc721, "balanceOf", [vault]).catch(() => 0n),
    read(router, ABI.router, "pending").catch(() => 0n),
    read(vault, ABI.vault, "policy"),
  ]);
  return {
    id: Number(id), chainId: ROBINHOOD, external: false, token, curve, router, vault, collection, creator,
    name, symbol, collectionName, collectionImage: imageFor(meta, collection), vaultBalance, nfts: Number(nfts), pending, policy: POLICIES[policy],
  };
}

export async function loadExternalLaunch(n) {
  const meta = await metaByKey();
  const [token, curve, router, vault, collection, creator] = await read(CONFIG.externalLauncher, ABI.extLauncher, "launches", [BigInt(n)]);
  const v = (fn) => read(vault, ABI.extVault, fn);
  const [name, symbol, vaultBalance, pending, policy, chainId, isEvm, withdrawn, spent, pendingAmount, pendingReadyAt, buys] = await Promise.all([
    read(token, ABI.erc20, "name"),
    read(token, ABI.erc20, "symbol"),
    client.getBalance({ address: vault }),
    read(router, ABI.router, "pending").catch(() => 0n),
    v("policy"), v("externalChainId"), v("externalIsEvm"), v("totalWithdrawn"), v("totalSpent"),
    v("pendingAmount"), v("pendingReadyAt"),
    client.getContractEvents({ address: vault, abi: ABI.extVault, eventName: "ExternalPurchase", fromBlock: BigInt(CONFIG.startBlock || 0), toBlock: "latest" }),
  ]);
  const m = meta.get(getAddress(collection));
  return {
    id: `e${n}`, chainId: Number(chainId), external: true, isEvm, token, curve, router, vault, collection, creator,
    name, symbol, collectionName: m?.name || `${chainName(chainId)} collection`, collectionAddress: m?.address, collectionImage: m?.image || null,
    vaultBalance, pending, policy: POLICIES[policy], nfts: buys.length,
    withdrawn, spent, pendingAmount, pendingReadyAt: Number(pendingReadyAt),
    purchases: buys.map((b) => ({ tokenId: b.args.tokenId, price: b.args.price, externalTx: b.args.externalTx })),
  };
}

export async function loadLaunches(limit = 60) {
  const count = await launchCount();
  const ids = [...Array(Math.min(count, limit)).keys()].map((i) => count - 1 - i);
  let ext = [];
  if (externalLive) {
    const n = Number(await read(CONFIG.externalLauncher, ABI.extLauncher, "launchCount"));
    ext = [...Array(Math.min(n, limit)).keys()].map((i) => `e${n - 1 - i}`);
  }
  return Promise.all([...ids, ...ext].map(loadLaunch));
}

/** Explorer link for a purchase or delivery transaction on another chain. */
export function externalTxLink(chainId, txHash) {
  const c = CONFIG.chains[Number(chainId)];
  if (!c?.evm || !txHash || /^0x0+$/.test(txHash)) return null;
  return `${c.explorer}/tx/${txHash}`;
}

export async function loadRaffles(l) {
  const raffles = await read(l.vault, ABI.vault, "raffles");
  const count = Number(await read(raffles, ABI.raffles, "raffleCount", [l.vault]));
  return Promise.all([...Array(count).keys()].map(async (id) => {
    const r = await read(raffles, ABI.raffles, "raffles", [l.vault, BigInt(id)]);
    return { ...r, id, raffles, publishedAt: Number(r.publishedAt) };
  }));
}

export async function loadSnapshot(vault, id) {
  const url = `${CONFIG.snapshotBaseUrl}${vault.toLowerCase()}-${id}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Snapshot not published at ${url}`);
  return res.json();
}

export function winnerEntry(snapshot, ticket) {
  const t = BigInt(ticket);
  return snapshot.entries.find((e) => BigInt(e.start) <= t && t < BigInt(e.end));
}

/** Registry keys of every listed collection (Robinhood addresses and other-chain keys). */
export async function listedCollections() {
  const registry = await read(CONFIG.launcher, ABI.launcher, "registry");
  const logs = await client.getContractEvents({
    address: registry, abi: ABI.registry, eventName: "CollectionSet", fromBlock: BigInt(CONFIG.startBlock || 0), toBlock: "latest",
  });
  const state = new Map();
  for (const { args } of logs) state.set(getAddress(args.collection), args.listed);
  return [...state].filter(([, listed]) => listed).map(([a]) => a);
}

/** Listed collections with chain + name, ready for pickers and lists. */
export async function listedCollectionsDetailed() {
  const [keys, meta] = await Promise.all([listedCollections(), metaByKey()]);
  return Promise.all(keys.map(async (key) => {
    const m = meta.get(key);
    if (m) return { key, chainId: Number(m.chainId), address: m.address, name: m.name, slug: m.slug, image: m.image };
    // Unknown key: a Robinhood collection not in collections.json yet (other-chain keys need metadata).
    const name = await read(key, ABI.erc721, "name").catch(() => null);
    return name ? { key, chainId: ROBINHOOD, address: key, name } : null;
  })).then((rows) => rows.filter(Boolean));
}

export const COLORS = ["#ff5a3c", "#3b82f6", "#10b981", "#a855f7", "#f59e0b", "#ec4899", "#14b8a6", "#6366f1"];
export const colorFor = (s) => COLORS[[...String(s)].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length];

export function coinCard(c) {
  const href = c.id != null ? `coin.html?id=${c.id}` : null;
  const tag = href ? `a href="${href}"` : "article";
  return `<${tag} class="coin">
    <div class="art" style="background:linear-gradient(135deg, ${colorFor(c.symbol)}, #1b1d21)">$${esc(c.symbol)}</div>
    <div class="body">
      <h4>${esc(c.name)} <small>${esc(c.policy || "")}</small></h4>
      ${chainBadge(c.chainId || ROBINHOOD)}
      <div class="meta"><span class="collects">Collects ${collectionLogo(c.collectionName, c.collectionImage, 18)}<b>${esc(c.collectionName)}</b></span></div>
      <div class="meta"><span>Vault <b>${eth(c.vaultBalance)} ETH</b></span><span><b>${c.nfts}</b> NFTs</span></div>
    </div>
  </${href ? "a" : "article"}>`;
}
