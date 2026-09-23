import { $, esc, live, toast, renderChrome, listedCollectionsDetailed, loadLaunches, addrLink, eth, chainBadge, ROBINHOOD, CONFIG } from "../lib.js";

renderChrome("collections.html");

async function render() {
  const body = $("#table tbody");
  if (!live) return (body.innerHTML = `<tr><td colspan="4" class="empty">Contracts not deployed yet.</td></tr>`);
  const [listed, launches] = await Promise.all([listedCollectionsDetailed(), loadLaunches(500)]);
  if (!listed.length) return (body.innerHTML = `<tr><td colspan="4" class="empty">No collections listed yet.</td></tr>`);
  const rows = listed.map((c) => {
    const coins = launches.filter((l) => l.collection.toLowerCase() === c.key.toLowerCase());
    return { ...c, coins: coins.length, eth: coins.reduce((s, x) => s + x.vaultBalance, 0n), nfts: coins.reduce((s, x) => s + x.nfts, 0) };
  });
  rows.sort((a, b) => (b.eth > a.eth ? 1 : -1));
  const cell = (r) => {
    const chain = CONFIG.chains[r.chainId];
    if (r.chainId === ROBINHOOD) return `${addrLink(r.address, r.name)} ${chainBadge(r.chainId)}`;
    return `<a class="mono" href="${chain.explorer}/address/${r.address}" target="_blank" rel="noopener">${esc(r.name)}</a> ${chainBadge(r.chainId)}`;
  };
  body.innerHTML = rows.map((r) => `<tr><td>${cell(r)}</td><td>${r.coins}</td><td>${eth(r.eth)}</td><td>${r.nfts}</td></tr>`).join("");
}

render().catch((e) => toast("Could not load collections: " + (e.shortMessage || e.message)));
