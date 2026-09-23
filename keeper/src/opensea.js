import { parseAbiItem, encodeFunctionData, getAddress } from "viem";

const BASE = "https://api.opensea.io/api/v2";

/** Minimal OpenSea v2 client: floor listings and Seaport fulfillment calldata. */
export class OpenSea {
  constructor({ apiKey, chain }) {
    this.apiKey = apiKey;
    this.chain = chain;
    this.slugs = new Map();
  }

  async #get(path, init = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      headers: { accept: "application/json", "x-api-key": this.apiKey, ...(init.headers || {}) },
    });
    if (!res.ok) throw new Error(`OpenSea ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async slugFor(contract) {
    const key = contract.toLowerCase();
    if (!this.slugs.has(key)) {
      const c = await this.#get(`/chain/${this.chain}/contract/${contract}`);
      this.slugs.set(key, c.collection);
    }
    return this.slugs.get(key);
  }

  /** Cheapest active ETH listings for a collection, lowest first. */
  async bestListings(contract, limit = 10) {
    const slug = await this.slugFor(contract);
    const data = await this.#get(`/listings/collection/${slug}/best?limit=${limit}`);
    return (data.listings || [])
      .map((l) => {
        const offer = l.protocol_data?.parameters?.offer?.[0];
        return {
          hash: l.order_hash,
          protocolAddress: l.protocol_address,
          price: BigInt(l.price.current.value),
          currency: l.price.current.currency,
          token: offer?.token,
          tokenId: offer ? BigInt(offer.identifierOrCriteria) : null,
          itemType: offer?.itemType,
        };
      })
      .filter((l) => l.currency === "ETH" && l.token && getAddress(l.token) === getAddress(contract) && l.itemType === 2)
      .sort((a, b) => (a.price < b.price ? -1 : 1));
  }

  /** Returns { to, value, data } for filling `listing` with `fulfiller` as the buyer. */
  async fulfillment(listing, fulfiller) {
    const res = await this.#get(`/listings/fulfillment_data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        listing: { hash: listing.hash, chain: this.chain, protocol_address: listing.protocolAddress },
        fulfiller: { address: fulfiller },
      }),
    });
    const tx = res.fulfillment_data.transaction;
    const item = parseAbiItem(`function ${tx.function}`);
    const args = Object.values(tx.input_data).map(toPositional);
    return { to: getAddress(tx.to), value: BigInt(tx.value), data: encodeFunctionData({ abi: [item], args }) };
  }
}

// OpenSea returns tuples as JSON objects in struct order; the ABI item has unnamed
// components, so convert objects to positional arrays recursively.
function toPositional(v) {
  if (Array.isArray(v)) return v.map(toPositional);
  if (v && typeof v === "object") return Object.values(v).map(toPositional);
  return v;
}
