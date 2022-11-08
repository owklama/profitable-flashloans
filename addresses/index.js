const kyberMainnet = require("./kyber-mainnet.json");
const uniswapMainnet = require("./uniswap-mainnet.json");
const dydxMainnet = require("./dydx-mainnet.json");
const tokensMainnet = require("./tokens-mainnet.json");

// Currently supports only mainnet address of the following protocols,
// can also add testnet address for testing or practice puropses.
module.exports = {
  mainnet: {
    kyber: kyberMainnet,
    uniswap: uniswapMainnet,
    dydx: dydxMainnet,
    tokens: tokensMainnet,
  },
};
