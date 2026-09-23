// Fill `launcher` and `startBlock` after running contracts/script/Deploy.s.sol on Robinhood Chain.
// While `launcher` is empty the site shows sample data and launching is disabled.
export const CONFIG = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  ponsFactory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  seaport: "0x0000000000000068F116a894984e2DB1123eB395",
  launcher: "", // e.g. "0x1234…"
  startBlock: 0, // block the Launcher was deployed in
  snapshotBaseUrl: "snapshots/", // where the keeper's SNAPSHOT_DIR is served
};
