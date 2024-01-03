import "@nomicfoundation/hardhat-foundry";
import "@nomicfoundation/hardhat-toolbox";
import { config as dotenvConfig } from "dotenv";
import "hardhat-deploy";
import type { HardhatUserConfig } from "hardhat/config";
import type { NetworkUserConfig } from "hardhat/types";
import { resolve } from "path";

import "./tasks/accounts";
import "./tasks/members";
import "./tasks/registry";
import "./tasks/taskDeploy";

const dotenvConfigPath: string = process.env.DOTENV_CONFIG_PATH || "./.env";
dotenvConfig({ path: resolve(__dirname, dotenvConfigPath) });

// Ensure that we have all the environment variables we need.
const mnemonic: string = process.env.MNEMONIC || "";
if (!mnemonic) {
  throw new Error("Please set your MNEMONIC in a .env file");
}

const infuraApiKey: string | undefined = process.env.INFURA_API_KEY;
if (!infuraApiKey) {
  throw new Error("Please set your INFURA_API_KEY in a .env file");
}

const chainIds = {
  hardhat: 31337,
  goerli: 5,
  sepolia: 11155111,
  mainnet: 1,
  gnosis: 100,
  "arbitrum-mainnet": 42161,
  "arbitrum-goerli": 421613,
  "optimism-mainnet": 10,
  "optimism-goerli": 420,
  "polygon-mainnet": 137,
  "polygon-mumbai": 80001,
};

const explorerApiKey = (networkName: keyof typeof chainIds) => {
  const fromEnv = () => {
    switch (networkName) {
      case "mainnet":
      case "goerli":
        return process.env.ETHERSCAN_APIKEY;
      case "gnosis":
        return process.env.GNOSISSCAN_APIKEY;
      case "polygon-mainnet":
      case "polygon-mumbai":
        return process.env.POLYGONSCAN_APIKEY;
      case "optimism-mainnet":
      case "optimism-goerli":
        return process.env.OPTIMISTICSCAN_APIKEY;
      case "arbitrum-mainnet":
      case "arbitrum-goerli":
        return process.env.ARBISCAN_APIKEY;
      default:
        break;
    }
  };
  return fromEnv() || "";
};

const getNodeURI = (networkName: keyof typeof chainIds) => {
  switch (networkName) {
    case "arbitrum-mainnet":
      return "https://rpc.ankr.com/arbitrum";
    case "arbitrum-goerli":
      return "https://goerli-rollup.arbitrum.io/rpc";
    // return "https://arbitrum-goerli.publicnode.com";
    case "optimism-mainnet":
      return "https://rpc.ankr.com/optimism";
    case "optimism-goerli":
      return "https://goerli.optimism.io";
    case "polygon-mainnet":
      return "https://rpc.ankr.com/polygon";
    case "polygon-mumbai":
      return "https://rpc.ankr.com/polygon_mumbai";
    case "gnosis":
      return "https://rpc.gnosischain.com";
    default:
      return "https://" + networkName + ".infura.io/v3/" + infuraApiKey;
  }
};

function getChainConfig(chain: keyof typeof chainIds): NetworkUserConfig {
  const jsonRpcUrl: string = getNodeURI(chain);
  return {
    accounts: process.env.ACCOUNT_PK
      ? [process.env.ACCOUNT_PK]
      : {
          count: 10,
          mnemonic,
          path: "m/44'/60'/0'/0",
        },
    chainId: chainIds[chain],
    url: jsonRpcUrl,
    verify: {
      etherscan: {
        apiKey: explorerApiKey(chain),
      },
    },
  };
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,
  },
  // etherscan: {
  //   apiKey: {
  //     arbitrumOne: process.env.ARBISCAN_APIKEY || "",
  //     // avalanche: process.env.SNOWTRACE_API_KEY || "",
  //     // bsc: process.env.BSCSCAN_API_KEY || "",
  //     mainnet: process.env.ETHERSCAN_APIKEY || "",
  //     optimisticEthereum: process.env.OPTIMISM_APIKEY || "",
  //     polygon: process.env.POLYGONSCAN_API_KEY || "",
  //     polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
  //     sepolia: process.env.ETHERSCAN_API_KEY || "",
  //   },
  // },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
    src: "./contracts",
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic,
      },
      chainId: chainIds.hardhat,
      forking: process.env.HARDHAT_FORK_NETWORK
        ? {
            url: getNodeURI(process.env.HARDHAT_FORK_NETWORK as keyof typeof chainIds),
            blockNumber: process.env.HARDHAT_FORK_BLOCKNUMBER
              ? parseInt(process.env.HARDHAT_FORK_BLOCKNUMBER)
              : undefined,
          }
        : undefined,
      companionNetworks: {
        l2: "hardhat",
      },
      initialDate: "2023-05-01T00:00:00.000-05:00",
    },
    // ganache: {
    //   accounts: {
    //     mnemonic,
    //   },
    //   chainId: chainIds.ganache,
    //   url: "http://localhost:8545",
    // },
    // avalanche: getChainConfig("avalanche"),
    // bsc: getChainConfig("bsc"),
    goerli: {
      ...getChainConfig("goerli"),
      companionNetworks: {
        "l2-optimism": "optimismGoerli",
        "l2-arbitrum": "arbitrumGoerli",
      },
      gas: 5000000,
      gasPrice: 8000000000,
      gasMultiplier: 2,
    },
    mainnet: getChainConfig("mainnet"),
    gnosis: getChainConfig("gnosis"),
    arbitrum: getChainConfig("arbitrum-mainnet"),
    arbitrumGoerli: {
      ...getChainConfig("arbitrum-goerli"),
      companionNetworks: {
        l1: "goerli",
      },
      initialBaseFeePerGas: 1635190000,
      gasPrice: 1635190000,
      gasMultiplier: 1.2,
    },
    optimism: getChainConfig("optimism-mainnet"),
    optimismGoerli: {
      ...getChainConfig("optimism-goerli"),
      companionNetworks: {
        l1: "goerli",
      },
    },
    polygon: getChainConfig("polygon-mainnet"),
    mumbai: {
      ...getChainConfig("polygon-mumbai"),
      companionNetworks: {
        l1: "goerli",
      },
    },
    sepolia: getChainConfig("sepolia"),
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.7",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.13",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.21",
        settings: {
          metadata: {
            // Not including the metadata hash
            // https://github.com/paulrberg/hardhat-template/issues/31
            bytecodeHash: "none",
          },
          // Disable the optimizer when debugging
          // https://hardhat.org/hardhat-network/#solidity-optimizer-support
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  mocha: {
    timeout: 120000,
  },
  typechain: {
    outDir: "types",
    target: "ethers-v5",
  },
  external: {
    contracts: [
      {
        artifacts: "node_modules/@daohaus/baal-contracts/export/artifacts",
        deploy: "node_modules/@daohaus/baal-contracts/export/deploy",
      },
    ],
  },
};

export default config;
