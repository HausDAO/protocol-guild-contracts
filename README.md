# Protocol Guild - Networked Member Registry contracts [![Hardhat][hardhat-badge]][hardhat] [![License: MIT][license-badge]][license]

[hardhat]: https://hardhat.org/
[hardhat-badge]: https://img.shields.io/badge/Built%20with-Hardhat-FFDB1C.svg
[license]: https://opensource.org/licenses/MIT
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg

TBD: Definition

## Getting Started

TBD

## Usage

### Pre Requisites

Before being able to run any command, you need to create a `.env` file and set a BIP-39 compatible mnemonic or account private key as an
environment variable. You can follow the example in `.env.example`. If you don't already have a mnemonic, you can use
this [website](https://iancoleman.io/bip39/) to generate one.

Then, proceed with installing dependencies:

```sh
$ pnpm install
```

### Compile

Compile the smart contracts with Hardhat:

```sh
$ pnpm compile
```

### TypeChain

Compile the smart contracts and generate TypeChain bindings:

```sh
$ pnpm typechain
```

### Test

Run the tests with Hardhat:

```sh
$ pnpm hardhat test test/networkRegistry/NetworkRegistry.ts
```

### Lint Solidity

Lint the Solidity code:

```sh
$ pnpm lint:sol
```

### Lint TypeScript

Lint the TypeScript code:

```sh
$ pnpm lint:ts
```

### Coverage

Generate the code coverage report:

```sh
$ pnpm coverage
```

### Report Gas

See the gas usage per unit test and average gas per method call:

```sh
$ REPORT_GAS=true pnpm test
```

### Clean

Delete the smart contract artifacts, the coverage reports and the Hardhat cache:

```sh
$ pnpm clean
```

### Deploy

Deploy Summoner contract + singletons

```sh
$ pnpm hardhat --network <network_name> deploy --tags Summoner"
```

### Tasks

TBD

## Testing Workflow

* Generate Initial memeber list (at least 3 members)

```
# Member files will be stored by default in ./memberlist.json
pnpm hardhat memberlist:generate
```

* Deploy Split contracts on relevant test networks. Then, update Split contract addresses on `./constants/config.ts`

```
pnpm hardhat --network goerli deploy:split --controller
pnpm hardhat --network optimismGoerli deploy:split --controller
pnpm hardhat --network arbitrumGoerli deploy:split --controller
```

* Optional: Deploy & Verify Summoner + Singletons on relevant test networks (these should be already deployed)

```
pnpm hardhat --network goerli deploy --tags Summoner
pnpm hardhat --network goerli etherscan-verify

pnpm hardhat --network optimismGoerli deploy --tags Summoner
pnpm hardhat --network optimismGoerli etherscan-verify

pnpm hardhat --network arbitrumGoerli deploy --tags Summoner
pnpm hardhat --network arbitrumGoerli etherscan-verify
```

* Deploy Main Registry. Then update the resulting contract address on `./constants/config.ts`

```
pnpm hardhat --network goerli deploy --tags PGNetworkRegistry
```

* Deploy Replica registries on relevant L2's. Then update the resulting contract address on `./constants/config.ts`

```
pnpm hardhat --network optimismGoerli deploy --tags PGNetworkRegistry
pnpm hardhat --network arbitrumGoerli deploy --tags PGNetworkRegistry
```

* Set registries as Split controller

```
pnpm hardhat --network goerli registry:ownSplit
# Replica chains need to accept control via cross-chain call
pnpm hardhat --network optimismGoerli registry:ownSplit
pnpm hardhat --network arbitrumGoerli registry:ownSplit
```

* Accept control on replica registries

```
# TODO: hardhat task
```

* Register replicas on main NetworkRegistry

```
pnpm hardhat --network goerli registry:addNetwork --foreign-chain-id 420 --foreign-domain-id 1735356532 --foreign-registry-address <registry_address>
pnpm hardhat --network goerli registry:addNetwork --foreign-chain-id 421613 --foreign-domain-id 1734439522 --foreign-registry-address <registry_address>
```

* Test New Member Sync Action

```
pnpm hardhat --network goerli registry:newMember --member <member_address> --multiplier 100
```

* Copy the hash from the latest tx and open [Goerli subgraph](https://thegraph.com/hosted-service/subgraph/connext/nxtp-amarok-runtime-v0-goerli)
* Copy/Paste Origin Transfer query from [this link](https://docs.connext.network/developers/guides/xcall-status) and replace the txHash parameter. You'll get the `transferId` from both cross-chain actions submitted to optimism and arbitrum
* Open [Connextscan]() to monitor cross-chain actions status. It usually takes ~30min to get a Complete status (Tx Reconciled & Executed)

## Deployed Contracts

### Goerli

| Contract                | Address                                    |
| ----------------------  | ------------------------------------------ |
| NetworkRegistrySummoner | 0xd8453cEE3b86887829cd7622FDD39187DE8e8261 |
| NetworkRegistry         | 0x6A24DF62c9b1DE05442F59F2718ed2e6Ee6C3872 |
| NetworkRegistryShaman   | 0x5CE4aC4F49c43E42216f5F00503EF6c6EE672bFF |

### OptimismGoerli

| Contract                | Address                                    |
| ----------------------  | ------------------------------------------ |
| NetworkRegistrySummoner | 0xE8c26332C8Ecbc05a29e62E9c6bc3578EC82090f |
| NetworkRegistry         | 0xD5D162CAa5d1e54ADbcCBF881FB92F8C40f3343a |
| NetworkRegistryShaman   | 0xc42f263221367eF8F1291491223652AcF44bfB24 |

### ArbitrumGoerli

| Contract                | Address                                    |
| ----------------------  | ------------------------------------------ |
| NetworkRegistrySummoner | 0xE8c26332C8Ecbc05a29e62E9c6bc3578EC82090f |
| NetworkRegistry         | 0xD5D162CAa5d1e54ADbcCBF881FB92F8C40f3343a |
| NetworkRegistryShaman   | 0xc42f263221367eF8F1291491223652AcF44bfB24 |

## License

This project is licensed under [MIT](LICENSE.md).
