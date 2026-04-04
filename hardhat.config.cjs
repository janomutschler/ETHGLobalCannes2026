require("@nomicfoundation/hardhat-toolbox");
require('dotenv').config();

module.exports = {
  solidity: "0.8.20",
  networks: {
    og_testnet: {
      url: "https://evmrpc-testnet.0g.ai",
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};