import {
  CONFIG, ABI, client, $, esc, live, toast, renderChrome, loadLaunch, loadRaffles, write,
  eth, short, addrLink, txLink, colorFor, chainName, externalTxLink,
} from "../lib.js";

renderChrome("explore.html");
const id = new URLSearchParams(location.search).get("id");

async function boughtNfts(l) {
  const logs = await client.getContractEvents({
    address: l.vault, abi: ABI.vault, eventName: "Bought", fromBlock: BigInt(CONFIG.startBlock || 0), toBlock: "latest",
  });
  return logs.reverse().map((x) => ({ tokenId: x.args.tokenId, price: x.args.price, tx: x.transactionHash }));
}

function raffleStatus(r) {
  if (r.claimed) return "Delivered";
  if (r.drawn) return "Drawn — delivering";
  if (r.drawBlock) return "Drawing";
  const ready = r.publishedAt + 15 * 60;
  return Date.now() / 1000 < ready ? `Snapshot public until ${new Date(ready * 1000).toLocaleTimeString()}` : "Ready to draw";
}

async function render() {
  if (!live) return ($("#coin").innerHTML = `<p class="empty">Contracts not deployed yet.</p>`);
  if (id == null) return ($("#coin").innerHTML = `<p class="empty">No coin selected. <a href="explore.html">Explore coins</a>.</p>`);

  const l = await loadLaunch(id);
  document.title = `$${l.symbol} · LaunchNFT`;
  const [ceiling, expiry, bought, raffles] = await Promise.all([
    l.external ? 0n : client.readContract({ address: l.vault, abi: ABI.vault, functionName: "ceiling" }),
    l.external ? 0n : client.readContract({ address: l.vault, abi: ABI.vault, functionName: "ceilingExpiry" }),
    l.external ? [] : boughtNfts(l),
    l.policy === "Raffle" ? loadRaffles(l) : [],
  ]);
  const ceilingLive = Number(expiry) > Date.now() / 1000;
  const currency = CONFIG.chains[l.chainId]?.currency || "ETH";

  $("#coin").innerHTML = `
    <section class="coin-head">
      <div class="coin-badge" style="background:linear-gradient(135deg, ${colorFor(l.symbol)}, #1b1d21)">$${esc(l.symbol)}</div>
      <div>
        <h1 class="page-title">${esc(l.name)}</h1>
        <p class="muted">Collects ${l.external ? `<b>${esc(l.collectionName)}</b> on ${esc(chainName(l.chainId))}` : addrLink(l.collection, l.collectionName)} · Policy <b>${l.policy}</b> · Created by ${addrLink(l.creator)}</p>
        <div class="cta-left">
          <a class="btn btn-dark" href="${CONFIG.explorer}/token/${l.token}" target="_blank" rel="noopener">Token on explorer</a>
          <button class="btn btn-ghost" id="harvest">Harvest ${eth(l.pending, 4)} ETH</button>
        </div>
      </div>
    </section>

    <div class="kpis">
      <div class="kpi"><span>Vault balance</span><b>${eth(l.vaultBalance)} ETH</b></div>
      <div class="kpi"><span>NFTs held</span><b>${l.nfts}</b></div>
      <div class="kpi"><span>Fees awaiting harvest</span><b>${eth(l.pending, 4)} ETH</b></div>
      ${l.external
        ? `<div class="kpi"><span>Sent to ${esc(chainName(l.chainId))} / spent</span><b>${eth(l.withdrawn, 4)} / ${eth(l.spent, 4)}</b></div>`
        : `<div class="kpi"><span>Price ceiling</span><b>${ceilingLive ? `${eth(ceiling, 4)} ETH` : "—"}</b></div>`}
    </div>
    ${l.external && l.pendingAmount > 0n ? `<div class="card notice">Withdrawal of <b>${eth(l.pendingAmount, 4)} ETH</b> announced — it can leave the vault after ${new Date(l.pendingReadyAt * 1000).toLocaleString()} to buy on ${esc(chainName(l.chainId))}. The registry owner can cancel it until then.</div>` : ""}

    <h2 class="sub">Floor buys</h2>
    ${l.external ? (l.purchases.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>NFT</th><th>Paid (ETH)</th><th>Receipt</th></tr></thead><tbody>
      ${l.purchases.slice().reverse().map((b) => {
        const link = externalTxLink(l.chainId, b.externalTx);
        return `<tr><td class="mono">#${String(b.tokenId).length > 12 ? short(`0x${b.tokenId.toString(16)}`) : b.tokenId}</td><td>${eth(b.price, 4)}</td><td>${link ? `<a class="mono" href="${link}" target="_blank" rel="noopener">${short(b.externalTx)}</a>` : `<span class="mono">${short(b.externalTx)}</span>`}</td></tr>`;
      }).join("")}
    </tbody></table></div>` : `<p class="empty">No NFTs bought yet. Once the vault can afford the floor on ${esc(chainName(l.chainId))} (in ${currency}), the keeper announces a withdrawal and buys.</p>`) : bought.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>NFT</th><th>Price</th><th>Tx</th></tr></thead><tbody>
      ${bought.map((b) => `<tr><td>#${b.tokenId}</td><td>${eth(b.price, 4)} ETH</td><td><a class="mono" href="${txLink(b.tx)}" target="_blank" rel="noopener">${short(b.tx)}</a></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="empty">No NFTs bought yet. The keeper buys once the vault can afford the floor.</p>`}

    ${l.policy === "Raffle" ? `<h2 class="sub">Raffles</h2>
    ${raffles.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>NFT</th><th>Status</th></tr></thead><tbody>
      ${raffles.slice().reverse().map((r) => `<tr><td>${r.id}</td><td>#${r.tokenId}</td><td>${raffleStatus(r)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="empty">No raffles yet.</p>`}` : ""}

    <h2 class="sub">Contracts</h2>
    <dl class="addresses">
      <dt>Token</dt><dd>${addrLink(l.token, l.token)}</dd>
      <dt>Pons curve</dt><dd>${addrLink(l.curve, l.curve)}</dd>
      <dt>Fee router</dt><dd>${addrLink(l.router, l.router)}</dd>
      <dt>Vault</dt><dd>${addrLink(l.vault, l.vault)}</dd>
    </dl>`;

  $("#harvest").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await write({ address: l.router, abi: ABI.router, functionName: "harvest" });
      toast("Harvested — fees moved to the vault");
      await render();
    } catch (err) {
      toast(err.shortMessage || err.message);
      e.target.disabled = false;
    }
  });
}

render().catch((e) => ($("#coin").innerHTML = `<p class="empty">Could not load coin: ${esc(e.shortMessage || e.message)}</p>`));
