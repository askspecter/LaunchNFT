import {
  CONFIG, ABI, client, live, $, toast, renderChrome, walletClient, loadLaunches, coinCard,
  eth, formatEther, toHex,
} from "./lib.js";
import { zeroAddress } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";

const RULES = [
  ["PAIRING", "locked at launch"],
  ["FEE SPLIT", "80 vault / 20 protocol"],
  ["SPEND LIMIT", "price ≤ posted ceiling"],
  ["CEILING TTL", "expires after 1 hour"],
  ["MARKET", "Seaport 1.6 only"],
  ["WITHDRAW", "not implemented, by design"],
  ["HARVEST", "callable by anyone"],
  ["DRAW", "future chain block hash"],
  ["POLICY", "raffle, hold or burn"],
  ["ADMIN KEYS", "none on the vault"],
];

const SAMPLE = [
  { name: "Floor Muncher", symbol: "MUNCH", collectionName: "Pixel Pals", vaultBalance: 12_400000000000000000n, nfts: 31, policy: "Raffle" },
  { name: "Ape Sweeper", symbol: "SWEEP", collectionName: "Jungle Club", vaultBalance: 48_100000000000000000n, nfts: 9, policy: "Hold" },
  { name: "Punk Bucket", symbol: "BUCKET", collectionName: "Block Punks", vaultBalance: 22_700000000000000000n, nfts: 4, policy: "Burn" },
  { name: "Cat Collector", symbol: "MEOW", collectionName: "Night Cats", vaultBalance: 3_900000000000000000n, nfts: 57, policy: "Raffle" },
];

const POLICY = { raffle: 0, hold: 1, burn: 2 };
let coins = live ? [] : SAMPLE;
let currentSort = "new";

renderChrome("index.html");

function renderRules() {
  const html = RULES.map(([k, v]) => `<div class="rule"><small>${k}</small><span>${v}</span></div>`).join("");
  $("#track").innerHTML = html + html; // duplicated for a seamless loop
}

function renderGrid() {
  const sorted = [...coins].sort((a, b) =>
    currentSort === "vault" ? (b.vaultBalance > a.vaultBalance ? 1 : -1)
      : currentSort === "nfts" ? b.nfts - a.nfts
      : 0 // already newest first
  );
  $("#grid").innerHTML = sorted.length
    ? sorted.slice(0, 8).map(coinCard).join("")
    : `<p class="empty">No coins launched yet. Be the first.</p>`;
}

function countUp(el, to, dec = 0) {
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 900);
    el.textContent = (to * p).toFixed(dec);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderStats() {
  countUp($("#statCoins"), coins.length);
  countUp($("#statNfts"), coins.reduce((s, c) => s + c.nfts, 0));
  countUp($("#statVault"), coins.reduce((s, c) => s + Number(formatEther(c.vaultBalance)), 0), 1);
}

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
  currentSort = btn.dataset.sort;
  renderGrid();
});

// ------------------------------------------------------------------ launch

const dlg = $("#launchDialog");
document.querySelectorAll("[data-open-launch]").forEach((b) => b.addEventListener("click", () => dlg.showModal()));
if (location.hash === "#launch") dlg.showModal();

$("#launchForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "submit") return;
  e.preventDefault();
  if (!live) return toast("Launcher not deployed yet — set CONFIG.launcher in config.js");
  const f = new FormData(e.target);
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const wallet = await walletClient();
    const [fee, economics] = await Promise.all([
      client.readContract({ address: CONFIG.ponsFactory, abi: ABI.pons, functionName: "launchFee" }),
      client.readContract({ address: CONFIG.ponsFactory, abi: ABI.pons, functionName: "previewLaunchEconomics", args: [0n, zeroAddress] }),
    ]);
    btn.textContent = "Confirm in wallet…";
    const hash = await wallet.writeContract({
      address: CONFIG.launcher,
      abi: ABI.launcher,
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
        salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
        collection: f.get("collection"),
        policy: POLICY[f.get("policy")],
      }],
    });
    btn.textContent = "Launching…";
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Launch reverted");
    dlg.close();
    e.target.reset();
    toast("Coin launched on Pons");
    await refresh();
    location.href = `coin.html?id=${coins.length ? coins[0].id : 0}`;
  } catch (err) {
    toast(err.shortMessage || err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Launch";
  }
});

async function loadLaunchFee() {
  try {
    const fee = await client.readContract({ address: CONFIG.ponsFactory, abi: ABI.pons, functionName: "launchFee" });
    $("#launchFee").textContent = `${eth(fee, 6)} ETH`;
  } catch {
    $("#launchFee").textContent = "unavailable";
  }
}

async function refresh() {
  if (live) coins = await loadLaunches(24);
  renderGrid();
  renderStats();
}

renderRules();
loadLaunchFee();
refresh().catch((e) => toast("Could not load launches: " + (e.shortMessage || e.message)));
