# LaunchNFT contracts

Coins whose trading fees can only be spent on NFTs from one paired collection.

| Contract | Role |
| --- | --- |
| `LaunchFactory` | `launch(name, symbol, collection, policy)` deploys the four contracts below in one call. The collection and policy can never change afterwards. |
| `LaunchToken` | Fixed-supply ERC20 (1B), minted entirely to its market. |
| `CurveMarket` | Constant-product bonding curve with a 1 ETH virtual reserve. 1% of each buy/sell goes to the splitter. |
| `FeeSplitter` | `harvest()` is callable by anyone: 80% → vault, 20% → treasury. |
| `SweepVault` | Spends ETH only on the paired collection, through allow-listed marketplaces, at or below a keeper ceiling that expires after 1 hour. Has no withdraw function. |
| `Registry` | Keeper, treasury and marketplace allowlist. The owner cannot move vault funds or NFTs. |

## NFT policies

- **Raffle**: the keeper publishes a Merkle snapshot of holder ticket ranges. After 15 minutes, anyone can call `draw()`, which uses the hash of a block chosen when the snapshot was published. The winner claims with a Merkle proof.
- **Hold**: NFTs stay in the vault forever.
- **Burn**: each NFT is sent to `0x…dEaD` as soon as it is bought.

## Trust assumptions

The keeper chooses the price ceiling and which listing to buy. A dishonest keeper could overpay up to the ceiling or post a biased snapshot. These rules limit that: ceilings expire, marketplaces are allow-listed, and the delay before a draw leaves time to check the snapshot off-chain. **Not audited — do not use with real funds without an audit.**

## Develop

```sh
npm install          # OpenZeppelin + forge-std
forge build
forge test
OWNER=0x.. KEEPER=0x.. TREASURY=0x.. forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```
