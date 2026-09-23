import {
  createPublicClient, createWalletClient, custom, http, defineChain, parseAbi,
  formatEther, isAddress, toHex, getAddress,
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
        <a class="btn btn-dark" href="index.html#launch">Launch</a>
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

/** Full view of one launch, including live vault numbers. */
export async function loadLaunch(id) {
  const [token, curve, router, vault, collection, creator] = await read(CONFIG.launcher, ABI.launcher, "launches", [BigInt(id)]);
  const [name, symbol, collectionName, vaultBalance, nfts, pending, policy] = await Promise.all([
    read(token, ABI.erc20, "name"),
    read(token, ABI.erc20, "symbol"),
    read(collection, ABI.erc721, "name").catch(() => short(collection)),
    client.getBalance({ address: vault }),
    read(collection, ABI.erc721, "balanceOf", [vault]),
    read(router, ABI.router, "pending").catch(() => 0n),
    read(vault, ABI.vault, "policy"),
  ]);
  return {
    id: Number(id), token, curve, router, vault, collection, creator,
    name, symbol, collectionName, vaultBalance, nfts: Number(nfts), pending, policy: POLICIES[policy],
  };
}

export async function loadLaunches(limit = 60) {
  const count = await launchCount();
  const ids = [...Array(Math.min(count, limit)).keys()].map((i) => count - 1 - i);
  return Promise.all(ids.map(loadLaunch));
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

export async function listedCollections() {
  const registry = await read(CONFIG.launcher, ABI.launcher, "registry");
  const logs = await client.getContractEvents({
    address: registry, abi: ABI.registry, eventName: "CollectionSet", fromBlock: BigInt(CONFIG.startBlock || 0), toBlock: "latest",
  });
  const state = new Map();
  for (const { args } of logs) state.set(getAddress(args.collection), args.listed);
  return [...state].filter(([, listed]) => listed).map(([a]) => a);
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
      <div class="meta"><span>Collects <b>${esc(c.collectionName)}</b></span></div>
      <div class="meta"><span>Vault <b>${eth(c.vaultBalance)} ETH</b></span><span><b>${c.nfts}</b> NFTs</span></div>
    </div>
  </${href ? "a" : "article"}>`;
}
