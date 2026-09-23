// Minimal Magic Eden (Solana) client: floor listings and signed buy transactions.
const BASE = "https://api-mainnet.magiceden.dev/v2";

export class MagicEden {
  constructor({ apiKey }) {
    this.apiKey = apiKey;
  }

  async #get(path) {
    const res = await fetch(BASE + path, {
      headers: { accept: "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
    });
    if (!res.ok) throw new Error(`Magic Eden ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  /** Cheapest listings of a collection (by Magic Eden symbol), lowest first. Price in lamports. */
  async bestListings(symbol, limit = 10) {
    const rows = await this.#get(`/collections/${encodeURIComponent(symbol)}/listings?limit=${limit}`);
    return rows
      .map((l) => ({
        mint: l.tokenMint,
        seller: l.seller,
        price: BigInt(Math.round(Number(l.price) * 1e9)),
        priceSol: Number(l.price),
        auctionHouse: l.auctionHouse || "",
        tokenAta: l.tokenAddress,
        sellerExpiry: l.expiry ?? -1,
        sellerReferral: l.sellerReferral || "",
      }))
      .sort((a, b) => (a.price < b.price ? -1 : 1));
  }

  /** Returns a base64 serialized transaction the buyer must sign (needs an API key). */
  async buyTransaction(listing, buyer) {
    if (!this.apiKey) throw new Error("MAGICEDEN_API_KEY is required to buy on Solana");
    const q = new URLSearchParams({
      buyer,
      seller: listing.seller,
      auctionHouseAddress: listing.auctionHouse,
      tokenMint: listing.mint,
      tokenATA: listing.tokenAta,
      price: String(listing.priceSol),
      sellerReferral: listing.sellerReferral,
      sellerExpiry: String(listing.sellerExpiry),
    });
    const res = await this.#get(`/instructions/buy_now?${q}`);
    return res.v0?.txSigned?.data ? Buffer.from(res.v0.txSigned.data) : Buffer.from(res.txSigned.data);
  }
}
