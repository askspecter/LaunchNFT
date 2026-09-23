// Fill LAUNCHER after running contracts/script/Deploy.s.sol on Robinhood Chain.
// While it is empty the site shows sample data and the launch form is disabled.
export const CONFIG = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  ponsFactory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  launcher: "", // e.g. "0x1234…"
};
