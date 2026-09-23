# Deploy LaunchNFT ke Robinhood Chain mainnet

Panduan ini menjalankan semua bagian: kontrak, keeper, dan website. Semua perintah dijalankan dari komputer Anda sendiri, dengan wallet Anda sendiri. **Jangan pernah membagikan private key ke siapa pun, termasuk ke AI.**

> ⚠️ Kontrak belum diaudit. Pertimbangkan audit sebelum membuka untuk publik, dan mulai dengan batas kecil (`MAX_CEILING_ETH` rendah).

## 0. Siapkan tiga wallet terpisah

| Peran | Fungsi | Butuh ETH? |
| --- | --- | --- |
| **Owner / deployer** | Deploy kontrak, mengatur keeper, treasury dan daftar koleksi. Simpan di hardware wallet kalau bisa. | Ya, ±0.001 ETH untuk deploy + listing |
| **Keeper** | Wallet bot, dipakai terus-menerus oleh program keeper | Ya, sedikit untuk gas (mis. 0.01 ETH) |
| **Treasury** | Penerima 20% fee | Tidak |

ETH di Robinhood Chain bisa di-bridge dari Ethereum atau Arbitrum.

## 1. Pasang tools

```sh
curl -L https://foundry.paradigm.xyz | bash && foundryup   # forge, cast
# Node.js 20+ untuk keeper
```

## 2. Impor wallet deployer (terenkripsi)

```sh
cast wallet import deployer --interactive   # tempel private key, lalu buat password
cast wallet address --account deployer      # cek alamatnya
```

## 3. Deploy kontrak

```sh
cd contracts
npm install
forge test                                   # harus lulus semua
FORK=1 forge test --match-contract PonsFork  # uji terhadap Pons asli (fork mainnet)

# Simulasi dulu (tidak mengirim apa-apa):
KEEPER=0xALAMAT_KEEPER TREASURY=0xALAMAT_TREASURY \
  forge script script/Deploy.s.sol --rpc-url robinhood --account deployer

# Kirim sungguhan + verifikasi source di Blockscout:
KEEPER=0xALAMAT_KEEPER TREASURY=0xALAMAT_TREASURY \
  forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --broadcast \
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

Catat alamat **Registry**, alamat **Launcher**, dan **nomor blok** deploy. Nomor bloknya ada di `broadcast/Deploy.s.sol/4663/run-latest.json`, atau cari transaksinya di explorer.

## 4. Daftarkan koleksi NFT

Hanya koleksi yang terdaftar yang bisa dipasangkan dengan koin baru.

```sh
REGISTRY=0xALAMAT_REGISTRY COLLECTIONS=0xKOLEKSI1,0xKOLEKSI2 \
  forge script script/ListCollections.s.sol --rpc-url robinhood --account deployer --broadcast
```

Pilih koleksi yang memang aktif diperdagangkan di OpenSea (Robinhood Chain). Kalau tidak ada listing, vault tidak akan pernah bisa membeli.

## 5. Jalankan keeper

```sh
cd keeper
npm install
cp .env.example .env
```

Isi `.env`:
- `KEEPER_PRIVATE_KEY`: private key wallet keeper. Harus sama dengan alamat `KEEPER` saat deploy.
- `LAUNCHER`, `START_BLOCK`: dari langkah 3.
- `OPENSEA_API_KEY`: minta di https://docs.opensea.io/reference/api-keys.
- `SNAPSHOT_DIR`: folder yang ikut di-hosting bersama website (lihat langkah 6).

```sh
DRY_RUN=1 npm run once   # simulasi saja, cek log-nya
npm start                # jalan terus
```

Jalankan di server yang selalu hidup (VPS dengan pm2/systemd, Railway, Fly.io, dll.). Contoh pm2:

```sh
npm i -g pm2 && pm2 start src/index.js --name launchnft-keeper && pm2 save
```

## 6. Publikasikan website

1. Edit `config.js`:
   ```js
   launcher: "0xALAMAT_LAUNCHER",
   startBlock: NOMOR_BLOK_DEPLOY,
   snapshotBaseUrl: "snapshots/",   // atau URL lengkap tempat SNAPSHOT_DIR di-hosting
   ```
2. Upload folder root (`index.html`, `explore.html`, `coin.html`, `collections.html`, `claims.html`, `docs.html`, `*.js`, `pages/`, `styles.css`) ke hosting statis apa pun: Vercel, Netlify, Cloudflare Pages, atau GitHub Pages. Tidak perlu proses build.
3. Pastikan file snapshot raffle dari keeper bisa diakses di `snapshotBaseUrl`. Cara termudah: jalankan keeper di server yang sama dan sajikan folder `snapshots/` bersama website, atau sinkronkan ke storage (S3/R2) lalu set `snapshotBaseUrl` ke URL-nya.

## 7. Cek setelah live

- [ ] `docs.html` menampilkan alamat Launcher dan Registry yang benar
- [ ] Launch 1 koin percobaan dengan koleksi yang terdaftar, lalu cek muncul di Explore
- [ ] Beli sedikit koin itu di Pons, lalu tunggu keeper melakukan harvest (atau klik Harvest di halaman koin)
- [ ] Log keeper tidak ada `WARN` berulang

## Kalau terjadi masalah

| Situasi | Tindakan |
| --- | --- |
| Key keeper bocor | `cast send <Registry> "setKeeper(address)" <keeperBaru> --rpc-url robinhood --account deployer` |
| Ganti treasury | `setTreasury(address)` |
| Hentikan pembelian lewat Seaport | `setMarketplace(0x0000000000000068F116a894984e2DB1123eB395,false)` |
| Tutup koleksi untuk launch baru | `LISTED=false` di `ListCollections.s.sol` |

Owner **tidak bisa** menarik ETH atau NFT dari vault. Ini disengaja.
