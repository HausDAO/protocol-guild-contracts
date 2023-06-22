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

NetworkRegistrySummoner 0xdDF554Cf7863C86f42D395E21a64Ab39569Cfd29
NetworkRegistry 0x15c05Ba0be6D1eAF68C185247eb93293B5606042
NetworkRegistryShaman 0xA01337Ed43FD2A554Fef6c844c0B4B0a673dc276

### OptimismGoerli

NetworkRegistrySummoner 0xE8c26332C8Ecbc05a29e62E9c6bc3578EC82090f
NetworkRegistry 0x2fd59A6Dd1cF223934364bE4a7b51558931180Cd
NetworkRegistryShaman 0xD29fee98db74D7A9C7685c1c3cc9d459588991bF

### ArbitrumGoerli

NetworkRegistrySummoner 0xE8c26332C8Ecbc05a29e62E9c6bc3578EC82090f
NetworkRegistry 0x2fd59A6Dd1cF223934364bE4a7b51558931180Cd
NetworkRegistryShaman 0xD29fee98db74D7A9C7685c1c3cc9d459588991bF

## License

This project is licensed under [MIT](LICENSE.md).
