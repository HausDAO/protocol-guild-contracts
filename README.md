# Protocol Guild - Networked Member Registry contracts [![Hardhat][hardhat-badge]][hardhat] [![License: MIT][license-badge]][license]

[hardhat]: https://hardhat.org/
[hardhat-badge]: https://img.shields.io/badge/Built%20with-Hardhat-FFDB1C.svg
[license]: https://opensource.org/licenses/MIT
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg

## Protocol Guild's V2 architecture (WIP)

For a background in Protocol Guild V1 architecture check the [docs](docs/README.md) folder.

![PG V2](https://github.com/cheeky-gorilla/protocol-guild-contracts/assets/76262359/66bea386-0910-4dc4-9a2e-fa098715d6e3)

### Goals

1. Remove trusted components
   - Multisig dependencies to update weights
   - Close the loop between record keeping and time-weight updates
2. Scale funding (while also reducing need for trust)
   - Expand funding mechanism to L2s

### Summary

To achieve these goals, the Guild's architecture will be modularized as follows:

1. **0xSplits** Split and Vesting contracts continue to handle all finances (donations, vesting + distributions)
2. **Moloch V3 DAO** used for governance (voting on and executing membership changes)
3. **Onchain membership registry** updated via DAO proposals, fed into Split contract
4. **Connext state bridging** allows the mainnet DAO to control membership registries, Vesting and Split contracts on
   L2s

To remove the need for a multisig, we aim to convert the Guild's membership governance into an onchain process. We have
identified [Moloch v3](https://moloch.daohaus.fun/) as a suitable tool for this, due to its ability to execute external
contracts via proposals.

The **Moloch DAO** would include all Guild members, with one person one vote, including vote delegation. Note that the
DAO would hold no funds, all funds would continue to go through 0xSplits. DAO members would create proposals to update
an onchain **membership registry** , which keeps track of member addresses, their status (_timeWeighting_ multiplier)
and their start date. Once updated, a function can be triggered to update the **0xSplits Split contract** to mirror the
onchain registry.

### Contracts

Please help us audit these contracts!

- This repo: [https://github.com/HausDAO/protocol-guild-contracts](https://github.com/HausDAO/protocol-guild-contracts)
- Frontend:
  [https://ipfs.io/ipfs/bafybeia4o2lfias2kfnxmvsdoerxvtnrgurjk5gwhchmfnty6ph3xeptnq/#/](https://ipfs.io/ipfs/bafybeia4o2lfias2kfnxmvsdoerxvtnrgurjk5gwhchmfnty6ph3xeptnq/#/)
- Frontend repo: [https://github.com/HausDAO/protocol-guild](https://github.com/HausDAO/protocol-guild)

### Video Demos

- PG registry csv upload demo:
  [https://www.loom.com/share/e3f9c15d75f44b1a9dfe9d487e9fa366?sid=d44bad8c-c1ed-4613-898d-0d0477cd2cb0](https://www.loom.com/share/e3f9c15d75f44b1a9dfe9d487e9fa366?sid=d44bad8c-c1ed-4613-898d-0d0477cd2cb0)
- Network Registry Demo:
  [https://www.loom.com/share/ac3308640d92410a97d59c48703b8d3d?sid=9d0323a7-9aa4-482e-979a-71730018cb1e](https://www.loom.com/share/ac3308640d92410a97d59c48703b8d3d?sid=9d0323a7-9aa4-482e-979a-71730018cb1e)

## Process Flow

The complete workflow on how to interact with the smart contracts through the frontend check the
[process flow guide](docs/FLOW.md).

## V2 tradeoffs

**0xSplits** Split and Vesting contracts continue to handle all finances (donations, vesting + distributions):

- Pros:
  - 0xSplits has proven itself extremely effective for handling donations, vesting and distributions over the course of
    the pilot
  - Allows the onchain membership registry to be the "Controller" of the Vesting and Split contract, instead of the
    current multisig
  - Updating Split contract recipients is automated via DAO proposals
  - No code / UI modifications required to 0xSplits
  - 0xSplits is planning future upgrades to 1) enable custom withdrawal logic (e.g. disallow third parties to distribute
    on recipients behalf), 2) introduce
    [new incentive mechanisms](https://docs.google.com/document/d/1RlWcD149Zj-AwdskyWVcpWIxRIBqcKfpPmsrLcKlvkw/edit?usp=sharing)
    to make third-party distributions more competitive and 3) make contracts more gas efficient
  - 0xSplits has been deployed on Optimism, Arbitrum, Zora and Polygon
- Cons:
  - Gas fees: Distributing 5 tokens to 128 members costs $85 in gas @ ~14 Gwei. This could quickly become prohibitively
    expensive as gas fees increase.
  - Changing to 4-year vesting stream post-pilot will require a brand new Vesting contract (i.e. a new donation address,
    though the Guild's ENS can be redirected to this new address)
  - No way to earn yield on vesting funds (though unclear if this is actually desired)
  - No way to use the same address for L2 Vesting contracts

**Moloch v3 DAO** used for governance only (voting on and executing membership changes):

- Pros:
  - Moloch's DAO infrastructure is extremely battle tested
  - DAO functionality is reduced to bare essential (don't need
    "[loot](https://moloch.daohaus.fun/features/updates#shares-and-loot)" shares, shamans / minions, or any treasury
    management)
  - Could leverage plugins ("[Boosts](https://daohaus.club/docs/users/boosts/)") to 1) conduct offchain voting via
    [Snapshot](https://snapshot.org/#/) and 2) add proposals as [Discourse](https://www.discourse.org/) forum posts for
    discussions
  - DAOHaus is helping the Guild develop everything
  - Allows vote delegation for members who prefer to be hands off
  - Moloch V3 is launched and audited
- Cons:
  - Requires more engagement from members to vote (e.g. quarterly) - though votes can be delegated if preferred
  - Proposing, voting and executing proposals will require members to pay gas (though gasless voting could be achieved
    via [Snapshot](https://snapshot.org/#/))

**Onchain membership registry**, updated via DAO proposals, fed into Split contract:

- Pros:
  - Registry becomes "Controller" of 0xSplits contracts, instead of multisig
  - Only DAO can update registry
- Cons:
  - Registry introduces significant and untested contract complexity
  - Privacy considerations: Keeping an onchain registry could make it easier to associate member addresses with
    real-world identities (e.g. via "Start Date")

**Connext state bridging** : Membership registries, Vesting + Split contracts deployed on L2s, controlled by mainnet DAO

- Pros:
  - Donors have more choice (+ cheaper) of where to donate
  - Connext passes messages through the canonical bridges, and thus inherits those trust assumptions
  - Can leverage existing modules (no new code required)
  - Avoids issues where L2 tokens might not have liquidity on L1
  - Value-aligned for the Guild to be deployed on all its ecosystems chains, given that it wants to rely on donations
    from said ecosystem (and not just L1 apps)
- Cons:
  - Cost of sending messages from L1 \> L2 is unclear
  - Requires members to withdraw funds from multiple chains
  - So reduce complexity associated with pushing the membership registry state to other chains, members would be
    requires to use an EOA as their Split recipient (instead of a smart contract wallet)

## Getting Started

TBD

## Usage

### Pre Requisites

Before being able to run any command, you need to create a `.env` file and set a BIP-39 compatible mnemonic or account
private key as an environment variable. You can follow the example in `.env.example`. If you don't already have a
mnemonic, you can use this [website](https://iancoleman.io/bip39/) to generate one.

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
$ pnpm test
```

Run fuzz/invariant tests using Foundry

```sh
$ forge test --nmc GasUsage --ffi -vvv
```

### Lint

Lint + Prettier check:

```sh
$ pnpm lint
```

#### Lint Solidity

Lint the Solidity code:

```sh
$ pnpm lint:sol
```

#### Lint TypeScript

Lint the TypeScript code:

```sh
$ pnpm lint:ts
```

#### Prettier

Prettier both Solidity and TS code:

```sh
$ pnpm prettier:write
```

### Coverage

**IMPORTANT** In order for `solidity-coverage` to work, you must disable the `@nomicfoundation/hardhat-foundry` plugin
in `hardhat.config.ts` while running the coverage command.

Generate the code coverage report:

```sh
$ pnpm coverage
```

### Report Gas

See the gas usage per unit test and average gas per method call:

```sh
$ REPORT_GAS=true pnpm test
```

If you want to analyze the gas consumption when calling the registry activity update functions check the
[\*.gasTest.t.sol](test/foundry) files for settings and execute the following:

```sh
$ forge clean
$ forge test --mc "GasUsage" --ffi -vvv
```

### Clean

Delete the smart contract artifacts, the coverage reports and the Hardhat cache:

```sh
$ pnpm clean
```

### Deploy

Deploy NetworkRegistry using a UUPS Upgradeable Proxy

```sh
$ pnpm hardhat --network <network_name> deploy --tags UpgradeablePGNetworkRegistry
```

Deploy GuildRegistry using a UUPS Upgradeable Proxy

```sh
$ pnpm hardhat --network <network_name> deploy --tags UpgradeablePGuildRegistry
```

### Verify contracts

```sh
$ pnpm hardhat --network <network_name> verify --contract contracts/libraries/PGContribCalculator.sol:PGContribCalculator <library_address>
```

```sh
$ pnpm hardhat --network <network_name> verify --contract contracts/NetworkRegistry.sol:NetworkRegistry --libraries libraries.js <implementation_contract_address>
```

Notice you'll need to modify the `libraries.js` file to include the list of libraries that need to be attached to the
contract, like the following:

```js
module.exports = {
  PGContribCalculator: "0x...",
};
```

### Tasks

TBD

## Testing Workflow

- **Generate Initial member list** with at least 2 members

```
# Member files will be stored by default in ./memberlist.json
pnpm hardhat memberlist:generate
```

- **Deploy Split contracts** on relevant test networks. Then, update the `split` contract addresses on
  `./constants/config.ts`

```sh
# Split V1
pnpm hardhat --network sepolia deploy:split --controller
pnpm hardhat --network optimismSepolia deploy:split --controller
pnpm hardhat --network arbitrumSepolia deploy:split --controller
```

```sh
# Split V2
pnpm hardhat --network sepolia deploy:splitV2 --controller
pnpm hardhat --network optimismSepolia deploy:splitV2 --controller
pnpm hardhat --network arbitrumSepolia deploy:splitV2 --controller
```

The `--controller` flag will set the deployer address as the 0xSplit controller..

- **Deploy a Main NetworkRegistry** using the deploy script. The registry will be owned either by `safe` address, or
  `moloch`.avatar() address you define in `./constants/config.ts`, otherwise the `deployer` will be set as owner by
  default. Finally don't forget to set the `pgRegistry` to the deployed contract address in `./constants/config.ts`.

GuildRegistry:

```sh
pnpm hardhat --network sepolia deploy --tags GuildRegistry
# or using SplitV2
pnpm hardhat --network sepolia deploy --tags GuildRegistryV2
```

NetworkRegistry:

```sh
pnpm hardhat --network sepolia deploy --tags NetworkRegistry
# or using SplitV2
pnpm hardhat --network sepolia deploy --tags NetworkRegistryV2
```

- **Transfer 0xSplit control to NetworkRegistry contract**: if NetworkRegistry is owner by the DAO safe, remember to
  trigger an action later to accept control.

```sh
pnpm hardhat --network sepolia registry:ownSplit
```

- **Deploy a Replica NetworkRegistry on relevant L2's**. The registry will be owned by a temporary `registryOwner`
  address if set in `./constants/config.ts`, otherwise the `deployer` will renounce ownership (Zero address) by default.
  Finally don't forget to set the `pgRegistry` to the deployed contract address in `./constants/config.ts`.

GuildRegistry:

```sh
pnpm hardhat --network optimismSepolia deploy --tags GuildRegistry
# or using SplitV2
pnpm hardhat --network optimismSepolia deploy --tags GuildRegistryV2
```

NetworkRegistry:

```sh
pnpm hardhat --network optimismSepolia deploy --tags NetworkRegistry
# or using SplitV2
pnpm hardhat --network optimismSepolia deploy --tags NetworkRegistryV2
```

- **Register a new Replicas on the Main NetworkRegistry**

```
pnpm hardhat --network sepolia registry:addNetwork --foreign-chain-id 420 --foreign-domain-id 1735356532 --foreign-registry-address <registry_address>

pnpm hardhat --network sepolia registry:addNetwork --foreign-chain-id 421613 --foreign-domain-id 1734439522 --foreign-registry-address <registry_address>
```

- **Transfer 0xSplit control in L2s to replica NetworkRegistry contracts**. In case of Replica registries that have
  `registryOwner != deployer`, these require an extra step after running the script, which is to accept Split control
  through the Main registry via a cross-chain call (see below).

- **Accept 0xSplit control on Replica registries**. This can be done through the UI when registering a new replica.

```sh
# TODO: implement hardhat task
```

- **Test New Member Sync Action**

```
pnpm hardhat --network sepolia registry:newMember --member <member_address> --multiplier 100
```

- Copy the hash from the latest tx and open
  [Sepolia subgraph](https://thegraph.com/hosted-service/subgraph/connext/runtime-v1-sepolia)
- Copy/Paste Origin Transfer query from [this link](https://docs.connext.network/developers/guides/xcall-status) and
  replace the txHash parameter. You'll get the `transferId` from both cross-chain actions submitted to optimism and
  arbitrum
- Open [Connextscan](https://testnet.connextscan.io/) to monitor cross-chain actions status. It usually takes ~30min to get a Complete status (Tx
  Reconciled & Executed)

## Deployed Contracts

### Sepolia

| Contract                          | Address |
| --------------------------------- | ------- |
| NetworkRegistry Proxy             | TBD     |
| NetworkRegistry Implementation    | TBD     |
| NetworkRegistryV2 Proxy           | TBD     |
| NetworkRegistryV2  Implementation | TBD     |
| GuildRegistry Proxy               | TBD     |
| GuildRegistry Implementation      | TBD     |
| GuildRegistryV2 Proxy             | TBD     |
| GuildRegistryV2 Implementation    | TBD     |
| PGContribCalculator               | TBD     |

### Polygon Mumbai

| Contract                        | Address                                        |
| ------------------------------- | ---------------------------------------------- |
| NetworkRegistrySummoner         | ~~0x00CA834F2e6505a860bEbb3eCb315D3b90D8Ecf7~~ |
| NetworkRegistry Singleton       | ~~0xaC4137Ef604bF4DAf22F1d992B9c83A9E39A0FE1~~ |
| NetworkRegistryShaman Singleton | <None>                                         |

## Gas Analysis

### GuildRegistry deployed using the UUPS proxy pattern

| Active Members | Method                                     |
| -------------- | ------------------------------------------ |
| 167            | testUpdateAll() (gas: 3.033.062)           |
|                | testUpdateSecondsActive() (gas: 1.370.681) |
| 500            | testUpdateAll() (gas: 9.091.520)           |
|                | testUpdateSecondsActive() (gas: 4.051.664) |
| 800            | testUpdateAll() (gas: 14.702.025)          |
|                | testUpdateSecondsActive() (gas: 6.466.964) |
| 1000           | testUpdateAll() (gas: 18.522.582)          |
|                | testUpdateSecondsActive() (gas: 8.077.164) |

### GuildRegistryV2 deployed using the UUPS proxy pattern

| Active Members | Method                                     |
| -------------- | ------------------------------------------ |
| 167            | testUpdateAll() (gas: 3.077.926)           |
|                | testUpdateSecondsActive() (gas: 1.370.743) |
| 500            | testUpdateAll() (gas: 9.214.433)           |
|                | testUpdateSecondsActive() (gas: 4.051.726) |
| 800            | testUpdateAll() (gas: 14.889.324)          |
|                | testUpdateSecondsActive() (gas: 6.467.026) |
| 1000           | testUpdateAll() (gas: 18.749.677)          |
|                | testUpdateSecondsActive() (gas: 8.077.226) |

### NetworkRegistry deployed using the UUPS proxy pattern

| Active Members | Method                                         |
| -------------- | ---------------------------------------------- |
| 167            | testSyncUpdateAll() (gas: 3.063.537)           |
|                | testSyncUpdateSecondsActive() (gas: 1.383.241) |
| 500            | testSyncUpdateAll() (gas: 9.161.885)           |
|                | testSyncUpdateSecondsActive() (gas: 4.064.224) |
| 800            | testSyncUpdateAll() (gas: 14.813.891)          |
|                | testSyncUpdateSecondsActive() (gas: 6.479.524) |
| 1000           | testSyncUpdateAll() (gas: 18.665.045)          |
|                | testSyncUpdateSecondsActive() (gas: 8.089.724) |

### NetworkRegistryV2 deployed using the UUPS proxy pattern

| Active Members | Method                                         |
| -------------- | ---------------------------------------------- |
| 167            | testSyncUpdateAll() (gas: 3.106.957)           |
|                | testSyncUpdateSecondsActive() (gas: 1.383.273) |
| 500            | testSyncUpdateAll() (gas: 9.275.791)           |
|                | testSyncUpdateSecondsActive() (gas: 4.064.256) |
| 800            | testSyncUpdateAll() (gas: 14.979.806)          |
|                | testSyncUpdateSecondsActive() (gas: 6.479.556) |
| 1000           | testSyncUpdateAll() (gas: 18.859.574)          |
|                | testSyncUpdateSecondsActive() (gas: 8.089.756) |

## License

This project is licensed under [MIT](LICENSE.md).
