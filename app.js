import {
  createPublicClient, createWalletClient, custom, http, defineChain, parseAbi,
  formatEther, isAddress, zeroAddress, toHex,
} from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";
import { CONFIG } from "./config.js";

const chain = defineChain({
  id: CONFIG.chainId,
  name: CONFIG.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: CONFIG.explorer } },
});
const client = createPublicClient({ chain, transport: http() });

const PONS_ABI = parseAbi([
  "function launchFee() view returns (uint256)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
]);
const LAUNCHER_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct LaunchParams { string name; string symbol; string logo; string description; Socials socials; uint16 creatorTaxBps; uint256 launchConfigId; bytes32 expectedEconomics; bytes32 salt; address collection; uint8 policy; }",
  "function launch(LaunchParams p) payable returns (uint256)",
  "function launchCount() view returns (uint256)",
  "function launches(uint256) view returns (address token, address curve, address router, address vault, address collection, address creator)",
]);
const ERC20_ABI = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)"]);
const NFT_ABI = parseAbi(["function name() view returns (string)", "function balanceOf(address) view returns (uint256)"]);
const POLICY = { raffle: 0, hold: 1, burn: 2 };

let account = null;
let launchFee = null;
const live = isAddress(CONFIG.launcher);

const RULES = [
  ["PAIRING", "locked at launch"],
  ["FEE SPLIT", "80 vault / 20 protocol"],
  ["SPEND LIMIT", "price ≤ posted ceiling"],
  ["CEILING TTL", "expires after 1 hour"],
  ["MARKET", "allow-listed orderbook only"],
  ["WITHDRAW", "not implemented, by design"],
  ["HARVEST", "callable by anyone"],
  ["DRAW", "verifiable randomness"],
  ["POLICY", "raffle, hold or burn"],
  ["ADMIN KEYS", "none on the vault"],
];

const COLORS = ["#ff5a3c", "#3b82f6", "#10b981", "#a855f7", "#f59e0b", "#ec4899", "#14b8a6", "#6366f1"];

const SAMPLE = [
  { name: "Floor Muncher", ticker: "MUNCH", collection: "Pixel Pals", vault: 12.4, nfts: 31, age: 5 },
  { name: "Ape Sweeper", ticker: "SWEEP", collection: "Jungle Club", vault: 48.1, nfts: 9, age: 30 },
  { name: "Punk Bucket", ticker: "BUCKET", collection: "Block Punks", vault: 22.7, nfts: 4, age: 120 },
  { name: "Cat Collector", ticker: "MEOW", collection: "Night Cats", vault: 3.9, nfts: 57, age: 2 },
  { name: "Ghost Floor", ticker: "BOO", collection: "Spectrals", vault: 7.2, nfts: 18, age: 60 },
  { name: "Robo Hoard", ticker: "BOLT", collection: "Mech Units", vault: 15.6, nfts: 22, age: 15 },
];
let coins = live ? [] : SAMPLE;

const $ = (s) => document.querySelector(s);

function renderRules() {
  const html = RULES.map(([k, v]) => `<div class="rule"><small>${k}</small><span>${v}</span></div>`).join("");
  $("#track").innerHTML = html + html; // duplicated for seamless loop
}

function ago(min) {
  if (min == null) return "";
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderGrid(sort = "new") {
  const sorted = [...coins].sort((a, b) =>
    sort === "vault" ? b.vault - a.vault : sort === "nfts" ? b.nfts - a.nfts : a.age - b.age
  );
  if (!sorted.length) {
    $("#grid").innerHTML = `<p class="empty">No coins launched yet. Be the first.</p>`;
    return;
  }
  $("#grid").innerHTML = sorted
    .map((c, i) => {
      const color = COLORS[c.ticker.length * 7 % COLORS.length] || COLORS[i % COLORS.length];
      const pct = Math.min(100, (c.vault % 5) * 20 + 8);
      const href = c.token ? `${CONFIG.explorer}/token/${c.token}` : null;
      return `<${href ? `a href="${href}" target="_blank" rel="noopener"` : "article"} class="coin">
        <div class="art" style="background:linear-gradient(135deg, ${color}, #1b1d21)">$${esc(c.ticker)}</div>
        <div class="body">
          <h4>${esc(c.name)} <small>${live ? "" : ago(c.age)}</small></h4>
          <div class="meta"><span>Collects <b>${esc(c.collection)}</b></span></div>
          <div class="meta"><span>Vault <b>${c.vault.toFixed(1)} ETH</b></span><span><b>${c.nfts}</b> NFTs</span></div>
          <div class="bar" title="Progress to next floor buy"><i style="width:${pct}%"></i></div>
        </div>
      </${href ? "a" : "article"}>`;
    })
    .join("");
}

function renderStats(total = coins.length) {
  const count = (el, to, dec = 0) => {
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / 900);
      el.textContent = (to * p).toFixed(dec);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  count($("#statCoins"), total);
  count($("#statNfts"), coins.reduce((s, c) => s + c.nfts, 0));
  count($("#statVault"), coins.reduce((s, c) => s + c.vault, 0), 1);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

let currentSort = "new";
$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
  currentSort = btn.dataset.sort;
  renderGrid(currentSort);
});

const dlg = $("#launchDialog");
document.querySelectorAll("[data-open-launch]").forEach((b) => b.addEventListener("click", () => dlg.showModal()));

async function connect() {
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
  account = acc;
  $("#connectBtn").textContent = acc.slice(0, 6) + "…" + acc.slice(-4);
  return acc;
}

$("#connectBtn").addEventListener("click", () => connect().catch((e) => toast(e.shortMessage || e.message)));

$("#launchForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "submit") return;
  e.preventDefault();
  if (!live) return toast("Launcher not deployed yet — set CONFIG.launcher in config.js");
  const f = new FormData(e.target);
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const from = account || (await connect());
    const wallet = createWalletClient({ account: from, chain, transport: custom(window.ethereum) });
    const [fee, economics] = await Promise.all([
      client.readContract({ address: CONFIG.ponsFactory, abi: PONS_ABI, functionName: "launchFee" }),
      client.readContract({ address: CONFIG.ponsFactory, abi: PONS_ABI, functionName: "previewLaunchEconomics", args: [0n, zeroAddress] }),
    ]);
    const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
    btn.textContent = "Confirm in wallet…";
    const hash = await wallet.writeContract({
      address: CONFIG.launcher,
      abi: LAUNCHER_ABI,
      functionName: "launch",
      value: fee,
      args: [{
        name: f.get("name").trim(),
        symbol: f.get("ticker").trim().toUpperCase(),
        logo: f.get("logo") || "",
        description: f.get("description") || "",
        socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" },
        creatorTaxBps: Math.round(Number(f.get("tax") || 0) * 100),
        launchConfigId: 0n,
        expectedEconomics: economics,
        salt,
        collection: f.get("collection"),
        policy: POLICY[f.get("policy")],
      }],
    });
    btn.textContent = "Launching…";
    await client.waitForTransactionReceipt({ hash });
    dlg.close();
    e.target.reset();
    toast("Coin launched on Pons");
    await loadLaunches();
    $("#launches").scrollIntoView();
  } catch (err) {
    toast(err.shortMessage || err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Launch";
  }
});

async function loadLaunchFee() {
  try {
    launchFee = await client.readContract({ address: CONFIG.ponsFactory, abi: PONS_ABI, functionName: "launchFee" });
    $("#launchFee").textContent = `${formatEther(launchFee)} ETH`;
  } catch {
    $("#launchFee").textContent = "unavailable";
  }
}

async function loadLaunches() {
  if (!live) return;
  const count = Number(await client.readContract({ address: CONFIG.launcher, abi: LAUNCHER_ABI, functionName: "launchCount" }));
  const ids = [...Array(Math.min(count, 24)).keys()].map((i) => BigInt(count - 1 - i));
  coins = await Promise.all(ids.map(async (id, i) => {
    const [token, , , vault, collection] = await client.readContract({
      address: CONFIG.launcher, abi: LAUNCHER_ABI, functionName: "launches", args: [id],
    });
    const [name, symbol, colName, bal, nfts] = await Promise.all([
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "name" }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
      client.readContract({ address: collection, abi: NFT_ABI, functionName: "name" }).catch(() => collection.slice(0, 8) + "…"),
      client.getBalance({ address: vault }),
      client.readContract({ address: collection, abi: NFT_ABI, functionName: "balanceOf", args: [vault] }),
    ]);
    return { token, name, ticker: symbol, collection: colName, vault: Number(formatEther(bal)), nfts: Number(nfts), age: null, order: i };
  }));
  coins.forEach((c) => (c.age = c.order)); // newest first for the "New" tab
  renderGrid(currentSort);
  renderStats(count);
}

$("#burger").addEventListener("click", () => $("#navLinks").classList.toggle("open"));
$("#navLinks").addEventListener("click", () => $("#navLinks").classList.remove("open"));
$("#year").textContent = new Date().getFullYear();

renderRules();
renderGrid();
renderStats();
loadLaunchFee();
loadLaunches().catch((e) => toast("Could not load launches: " + (e.shortMessage || e.message)));
