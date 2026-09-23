const RULES = [
  ["PAIRING", "locked at launch"],
  ["FEE SPLIT", "75 vault / 25 protocol"],
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

let coins = [
  { name: "Floor Muncher", ticker: "MUNCH", collection: "Pixel Pals", vault: 12.4, nfts: 31, age: 5 },
  { name: "Ape Sweeper", ticker: "SWEEP", collection: "Jungle Club", vault: 48.1, nfts: 9, age: 30 },
  { name: "Punk Bucket", ticker: "BUCKET", collection: "Block Punks", vault: 22.7, nfts: 4, age: 120 },
  { name: "Cat Collector", ticker: "MEOW", collection: "Night Cats", vault: 3.9, nfts: 57, age: 2 },
  { name: "Ghost Floor", ticker: "BOO", collection: "Spectrals", vault: 7.2, nfts: 18, age: 60 },
  { name: "Robo Hoard", ticker: "BOLT", collection: "Mech Units", vault: 15.6, nfts: 22, age: 15 },
];

const $ = (s) => document.querySelector(s);

function renderRules() {
  const html = RULES.map(([k, v]) => `<div class="rule"><small>${k}</small><span>${v}</span></div>`).join("");
  $("#track").innerHTML = html + html; // duplicated for seamless loop
}

function ago(min) {
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
  $("#grid").innerHTML = sorted
    .map((c, i) => {
      const color = COLORS[c.ticker.length * 7 % COLORS.length] || COLORS[i % COLORS.length];
      const pct = Math.min(100, (c.vault % 5) * 20 + 8);
      return `<article class="coin">
        <div class="art" style="background:linear-gradient(135deg, ${color}, #1b1d21)">$${esc(c.ticker)}</div>
        <div class="body">
          <h4>${esc(c.name)} <small>${ago(c.age)}</small></h4>
          <div class="meta"><span>Collects <b>${esc(c.collection)}</b></span></div>
          <div class="meta"><span>Vault <b>${c.vault.toFixed(1)} ETH</b></span><span><b>${c.nfts}</b> NFTs</span></div>
          <div class="bar" title="Progress to next floor buy"><i style="width:${pct}%"></i></div>
        </div>
      </article>`;
    })
    .join("");
}

function renderStats() {
  const count = (el, to, dec = 0) => {
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / 900);
      el.textContent = (to * p).toFixed(dec);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  count($("#statCoins"), coins.length);
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

$("#launchForm").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "submit") return;
  const f = new FormData(e.target);
  coins.unshift({
    name: f.get("name").trim(),
    ticker: f.get("ticker").trim().toUpperCase(),
    collection: f.get("collection").slice(0, 6) + "…" + f.get("collection").slice(-4),
    vault: 0,
    nfts: 0,
    age: 0,
  });
  e.target.reset();
  renderGrid(currentSort);
  renderStats();
  toast("Coin launched (demo) — it's now in Recent launches");
  $("#launches").scrollIntoView();
});

$("#connectBtn").addEventListener("click", async () => {
  if (!window.ethereum) return toast("No wallet found — install a browser wallet");
  try {
    const [acc] = await window.ethereum.request({ method: "eth_requestAccounts" });
    $("#connectBtn").textContent = acc.slice(0, 6) + "…" + acc.slice(-4);
  } catch {
    toast("Wallet connection cancelled");
  }
});

$("#burger").addEventListener("click", () => $("#navLinks").classList.toggle("open"));
$("#navLinks").addEventListener("click", () => $("#navLinks").classList.remove("open"));
$("#year").textContent = new Date().getFullYear();

renderRules();
renderGrid();
renderStats();
