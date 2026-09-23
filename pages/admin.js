import {
  CONFIG, ABI, client, $, esc, toast, renderChrome, connect, walletClient, getAccount, onAccount,
  isAddress, getAddress, addrLink, txLink, eth,
} from "../lib.js";
import { parseAbi, encodeDeployData } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";

renderChrome("");

const REGISTRY_ADMIN = parseAbi([
  "function owner() view returns (address)",
  "function keeper() view returns (address)",
  "function treasury() view returns (address)",
  "function isCollection(address) view returns (bool)",
  "function setMarketplace(address marketplace, bool allowed)",
  "function setCollection(address collection, bool listed)",
  "function setKeeper(address keeper)",
]);
const ERC165 = parseAbi(["function supportsInterface(bytes4) view returns (bool)"]);
const ERC721_ID = "0x80ac58cd";
const PROGRESS_KEY = "launchnft-deploy";

let registry = null;

const saved = () => { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...saved(), ...v })); } catch {} };

function logStep(text, href) {
  const li = document.createElement("li");
  li.innerHTML = href ? `${esc(text)} — <a href="${href}" target="_blank" rel="noopener">tx</a>` : esc(text);
  $("#deployLog").append(li);
}

async function mustChain() {
  const id = await (await walletClient()).getChainId();
  if (id !== CONFIG.chainId) throw new Error(`Switch your wallet to ${CONFIG.chainName} (chain ${CONFIG.chainId})`);
}

// Wallets on Arbitrum-based chains sometimes under-estimate gas for large deployments,
// so estimate against the RPC ourselves and add a 30% margin.
const withMargin = (g) => (g * 13n) / 10n;

async function send(label, req) {
  const wallet = await walletClient();
  const { request } = await client.simulateContract({ account: wallet.account, ...req });
  const gas = withMargin(await client.estimateContractGas({ account: wallet.account, ...req }));
  const hash = await wallet.writeContract({ ...request, gas });
  logStep(`${label}: sent`, txLink(hash));
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted`);
  return r;
}

async function deploy(label, artifact, args) {
  const wallet = await walletClient();
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
  // Estimating also surfaces a revert reason before anything is sent.
  const gas = withMargin(await client.estimateGas({ account: wallet.account, data }));
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args, gas });
  logStep(`${label}: sent (gas limit ${gas})`, txLink(hash));
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) {
    throw new Error(`${label} deploy failed (used ${r.gasUsed} of ${gas} gas) — tap the tx link for details`);
  }
  return r;
}

function showResult({ registry, launcher, block }) {
  $("#deployResult").innerHTML = `
    <h4>Deployed ✓</h4>
    <dl class="addresses">
      <dt>Registry</dt><dd>${addrLink(registry, registry)}</dd>
      <dt>Launcher</dt><dd>${addrLink(launcher, launcher)}</dd>
      <dt>Start block</dt><dd class="mono">${block}</dd>
    </dl>
    <p class="muted">Put these in <code>config.js</code> on GitHub (or send them to your developer), and set the keeper's <code>LAUNCHER</code> / <code>START_BLOCK</code> secrets:</p>
    <pre class="snippet" id="snippet">launcher: "${launcher}",\nstartBlock: ${block},</pre>
    <button class="btn btn-ghost" id="copy">Copy</button>`;
  $("#copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#snippet").textContent); toast("Copied"); } catch { toast("Copy failed — select the text manually"); }
  });
}

$("#deploy").addEventListener("click", async (e) => {
  const keeper = $("#keeper").value.trim();
  const treasury = $("#treasury").value.trim();
  if (!isAddress(keeper) || !isAddress(treasury)) return toast("Enter valid keeper and treasury addresses");
  const btn = e.target;
  btn.disabled = true;
  $("#deployLog").innerHTML = "";
  try {
    const owner = getAccount() || (await connect());
    await mustChain();
    if (getAddress(keeper) === owner) throw new Error("Use a separate wallet for the keeper, not the owner");
    const artifacts = await (await fetch("artifacts/deploy.json")).json();
    const progress = saved();

    // Resume if a previous attempt was interrupted (e.g. the phone browser reloaded).
    let reg = progress.owner === owner && progress.registry ? progress.registry : null;
    let block = progress.block;
    if (!reg) {
      const r = await deploy("Registry", artifacts.Registry, [owner, getAddress(keeper), getAddress(treasury)]);
      reg = r.contractAddress;
      block = Number(r.blockNumber);
      save({ owner, registry: reg, block });
    }
    logStep(`Registry at ${reg}`);

    if (!progress.seaport || progress.registry !== reg) {
      await send("Allow Seaport 1.6", { address: reg, abi: REGISTRY_ADMIN, functionName: "setMarketplace", args: [CONFIG.seaport, true] });
      save({ seaport: true });
    }

    let launcher = progress.registry === reg ? progress.launcher : null;
    if (!launcher) {
      const r = await deploy("Launcher", artifacts.Launcher, [CONFIG.ponsFactory, reg]);
      launcher = r.contractAddress;
      save({ launcher });
    }
    logStep(`Launcher at ${launcher}`);
    registry = reg;
    showResult({ registry: reg, launcher, block });
    await refreshRegistry();
  } catch (err) {
    toast(err.shortMessage || err.message);
    logStep(`Stopped: ${err.shortMessage || err.message}`);
  } finally {
    btn.disabled = false;
  }
});

async function refreshRegistry() {
  if (!registry && isAddress(CONFIG.launcher)) {
    registry = await client.readContract({ address: CONFIG.launcher, abi: ABI.launcher, functionName: "registry" });
  }
  if (!registry) return;
  const [owner, keeper, treasury] = await Promise.all(
    ["owner", "keeper", "treasury"].map((fn) => client.readContract({ address: registry, abi: REGISTRY_ADMIN, functionName: fn })),
  );
  const keeperBal = await client.getBalance({ address: keeper });
  $("#registryInfo").innerHTML = `Registry ${addrLink(registry)} · owner ${addrLink(owner)} · keeper ${addrLink(keeper)} (${eth(keeperBal, 4)} ETH for gas) · treasury ${addrLink(treasury)}`;
}

async function registryWrite(label, fn, args) {
  if (!registry) return toast("No registry yet");
  try {
    await connect();
    await mustChain();
    await send(label, { address: registry, abi: REGISTRY_ADMIN, functionName: fn, args });
    toast(`${label} ✓`);
    await refreshRegistry();
  } catch (err) {
    toast(err.shortMessage || err.message);
  }
}

async function collectionArg() {
  const a = $("#collection").value.trim();
  if (!isAddress(a)) throw new Error("Enter a valid collection address");
  const ok = await client.readContract({ address: a, abi: ERC165, functionName: "supportsInterface", args: [ERC721_ID] }).catch(() => false);
  if (!ok) throw new Error("That address is not an ERC-721 collection on Robinhood Chain");
  return getAddress(a);
}

$("#list").addEventListener("click", async () => {
  try { await registryWrite("List collection", "setCollection", [await collectionArg(), true]); } catch (e) { toast(e.message); }
});
$("#delist").addEventListener("click", async () => {
  try { await registryWrite("Delist collection", "setCollection", [await collectionArg(), false]); } catch (e) { toast(e.message); }
});
$("#setKeeper").addEventListener("click", () => {
  const k = $("#newKeeper").value.trim();
  if (!isAddress(k)) return toast("Enter a valid keeper address");
  registryWrite("Change keeper", "setKeeper", [getAddress(k)]);
});

$("#connect").addEventListener("click", () => connect().catch((e) => toast(e.shortMessage || e.message)));
onAccount(async (a) => {
  const bal = await client.getBalance({ address: a });
  $("#walletInfo").innerHTML = `${addrLink(a, a)} · ${eth(bal, 5)} ETH on ${CONFIG.chainName}`;
});

const p = saved();
if (p.registry && p.launcher) showResult({ registry: p.registry, launcher: p.launcher, block: p.block });
if (isAddress(CONFIG.launcher)) $("#deployCard").querySelector("#deploy").textContent = "Deploy again (already configured)";
refreshRegistry().catch(() => {});
