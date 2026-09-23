import { $, live, toast, renderChrome, listedCollections, loadLaunches, client, ABI, addrLink, eth, short } from "../lib.js";

renderChrome("collections.html");

async function render() {
  const body = $("#table tbody");
  if (!live) return (body.innerHTML = `<tr><td colspan="4" class="empty">Contracts not deployed yet.</td></tr>`);
  const [listed, launches] = await Promise.all([listedCollections(), loadLaunches(500)]);
  if (!listed.length) return (body.innerHTML = `<tr><td colspan="4" class="empty">No collections listed yet.</td></tr>`);

  const rows = await Promise.all(listed.map(async (addr) => {
    const coins = launches.filter((l) => l.collection.toLowerCase() === addr.toLowerCase());
    const name = await client.readContract({ address: addr, abi: ABI.erc721, functionName: "name" }).catch(() => short(addr));
    return {
      addr, name, coins: coins.length,
      eth: coins.reduce((s, c) => s + c.vaultBalance, 0n),
      nfts: coins.reduce((s, c) => s + c.nfts, 0),
    };
  }));
  rows.sort((a, b) => (b.eth > a.eth ? 1 : -1));
  body.innerHTML = rows.map((r) => `<tr><td>${addrLink(r.addr, r.name)}</td><td>${r.coins}</td><td>${eth(r.eth)}</td><td>${r.nfts}</td></tr>`).join("");
}

render().catch((e) => toast("Could not load collections: " + (e.shortMessage || e.message)));
