import {
  live, $, toast, renderChrome, loadLaunches, coinCard, formatEther,
} from "./lib.js";

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

async function refresh() {
  if (live) coins = await loadLaunches(24);
  renderGrid();
  renderStats();
}

renderRules();
if (location.hash === "#launch") location.replace("launch.html");
refresh().catch((e) => toast("Could not load launches: " + (e.shortMessage || e.message)));
