# Protocol Guild - Networked Member Registry contracts [![Hardhat][hardhat-badge]][hardhat] [![License: MIT][license-badge]][license]

[hardhat]: https://hardhat.org/
[hardhat-badge]: https://img.shields.io/badge/Built%20with-Hardhat-FFDB1C.svg
[license]: https://opensource.org/licenses/MIT
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg

## Background: Protocol Guild's V1 Architecture

For Protocol Guild's 1-year pilot, the [smart contract architecture](https://protocol-guild.readthedocs.io/en/latest/3-smart-contract.html) used [0xSplits](https://docs.0xsplits.xyz/) to manage all funds, including both the vesting of donated funds and distribution of vested funds to members:

1. **Donations**
    - Anyone can send ETH and ERC-20 tokens to the Guild's [Vesting contract address](https://app.0xsplits.xyz/accounts/0xF29Ff96aaEa6C9A1fBa851f74737f3c069d4f1a9/) on mainnet.
      - NFT donations are not supported - standard NFT transfers (safeTransfer) will be rejected by the contract, i.e. will cause the transaction to fail. Non-safeTransfer NFT donations will be lost.
      - Funds donated on L2s were bridged over to mainnet.
2. **Vesting**
    - Whenever funds are added to the 0xSplits Vesting contract, a "stream" needs to be started to begin the vesting process.
      - Starting a stream is permissionless.
      - Any funds donated during the pilot vest over 1 year (from the point the stream is started).
3. **Distributions**
    - Donated funds which are vested need to be "released" in 0xSplits. Releasing vested funds pushes them to the Guild's [Split contract](https://app.0xsplits.xyz/accounts/0x84af3D5824F0390b9510440B6ABB5CC02BB68ea1/)
      - Releasing funds is permissionless.
    - To withdraw funds released into the Split contract, 0xSplits first requires to "Distribute" the funds (among all the Split's recipients), at which point the Split's recipients can "Withdraw" the funds.
      - There is a function to "Withdraw for myself" and "Withdraw for all".
      - Distribute and withdraw functions can be done separately, or combined into one transaction. Again both functions are permissionless.

**Managing 0xSplits**

While the Guild's Vesting contract is immutable, the Split contract can be updated by the Guild's 6/10 [Safe multisig](https://app.safe.global/transactions/history?safe=eth:0xF6CBDd6Ea6EC3C4359e33de0Ac823701Cc56C6c4). The multisig can be used to add / remove members from the Split contract, and change the % allocation to members. The % allocation is determined by a [weighting formula](https://protocol-guild.readthedocs.io/en/latest/6-operating-guidelines.html#weighting):

_= SQRT((eligibleMonths - monthsOnBreak) \* timeWeighting)_

The "timeWeighting" multiplier is 0.5 for part time contributors, and 1 for full time contributors. The goal of the weighting formula is to reduce the total variance range of every member weight (hence using a square root).

**Updating** the Split contract is a manual process. The membership list is kept in an offchain, permissioned Airtable using formulas to keep track of the weighting, based on member start dates and status (full time / part time). Updates to the membership are made quarterly. To update the Split contract, the multisig is used to import a CSV from the Airtable into the Split contract, which updates member addresses and their weights.

If someone is **removed** from the Split contract, they still have access to the funds distributed to them before being removed. But they will not receive any future vested funds.

If someone new is **added** to the Split contract, they will be eligible for their share of vested funds distributed from that point onward (i.e. will not have a claim on previously distributed funds).

## Protocol Guild's V2 architecture (WIP)

### Goals

1. Remove trusted components
    - Multisig dependencies to update weights
    - Close the loop between record keeping and time-weight updates
2. Scale funding (while also reducing need for trust)
    - Expand funding mechanism to L2s

![PG V2](https://github.com/cheeky-gorilla/protocol-guild-contracts/assets/76262359/66bea386-0910-4dc4-9a2e-fa098715d6e3)

### Summary

To achieve these goals, the Guild's architecture will be modularized as follows:

1. **0xSplits** Split and Vesting contracts continue to handle all finances (donations, vesting + distributions)
2. **Moloch V3 DAO** used for governance (voting on and executing membership changes)
3. **Onchain membership registry** updated via DAO proposals, fed into Split contract
4. **Connext state bridging** allows the mainnet DAO to control membership registries, Vesting and Split contracts on L2s

To remove the need for a multisig, we aim to convert the Guild's membership governance into an onchain process. We have identified [Moloch v3](https://moloch.daohaus.fun/) as a suitable tool for this, due to its ability to execute external contracts via proposals.

The **Moloch DAO** would include all Guild members, with one person one vote, including vote delegation. Note that the DAO would hold no funds, all funds would continue to go through 0xSplits. DAO members would create proposals to update an onchain **membership registry** , which keeps track of member addresses, their status (_timeWeighting_ multiplier) and their start date. Once updated, a function can be triggered to update the **0xSplits Split contract** to mirror the onchain registry.

### Contracts

Please help us audit these contracts!

- This repo: [https://github.com/HausDAO/protocol-guild-contracts](https://github.com/HausDAO/protocol-guild-contracts)
- Frontend: [https://ipfs.io/ipfs/bafybeia4o2lfias2kfnxmvsdoerxvtnrgurjk5gwhchmfnty6ph3xeptnq/#/](https://ipfs.io/ipfs/bafybeia4o2lfias2kfnxmvsdoerxvtnrgurjk5gwhchmfnty6ph3xeptnq/#/)
- Frontend repo: [https://github.com/HausDAO/protocol-guild](https://github.com/HausDAO/protocol-guild)

### Video Demos

- PG registry csv upload demo: [https://www.loom.com/share/e3f9c15d75f44b1a9dfe9d487e9fa366?sid=d44bad8c-c1ed-4613-898d-0d0477cd2cb0](https://www.loom.com/share/e3f9c15d75f44b1a9dfe9d487e9fa366?sid=d44bad8c-c1ed-4613-898d-0d0477cd2cb0)
- Network Registry Demo: [https://www.loom.com/share/ac3308640d92410a97d59c48703b8d3d?sid=9d0323a7-9aa4-482e-979a-71730018cb1e](https://www.loom.com/share/ac3308640d92410a97d59c48703b8d3d?sid=9d0323a7-9aa4-482e-979a-71730018cb1e)

### Process Flow

V2 will have two frontends - [one specifically for the membership registry](https://ipfs.io/ipfs/bafybeia4o2lfias2kfnxmvsdoerxvtnrgurjk5gwhchmfnty6ph3xeptnq/#/), and another which is the "normal" Moloch V3 DAO UI. Separate frontends makes everything easier to compartmentalize for now, but it could make sense to unify everything for [future iterations of PGs smart contract architecture](https://docs.google.com/document/d/1BL8MaCCrrqjdIfpaZnvlp6IEZc0y1uxVr97qJ3MaqDo/edit).

Here's the process flow for quarterly membership updates:

1. Members can use the custom [frontend](https://ipfs.io/ipfs/bafybeia4o2lfias2kfnxmvsdoerxvtnrgurjk5gwhchmfnty6ph3xeptnq/#/) to interact with the membership registry, which 1) shows the state of the membership registries (on mainnet and L2s), 2) allows the creation of proposals to update the registries, and 3) update the Split contracts (on mainnet and L2s).

![Custom Frontend](https://github.com/cheeky-gorilla/protocol-guild-contracts/assets/76262359/dd5f1f4c-8c9d-4a4f-9afd-f751322ff613)

2. In this frontend, DAO members can upload a CSV to create a proposal to add new members / edit existing members.

![Upload CSV](https://github.com/cheeky-gorilla/protocol-guild-contracts/assets/76262359/cdf6be7c-96e7-4b9c-a55c-0bb8bbc0144d)

4. The CSV will have three fields:
    - _address_
      - PG member address
    - _activityMultiplier_ aka _modifier_ aka _timeWeighting_
      - This is a whole number from 0-100, where 50 = part time and 100 = full time.
      - This in theory would allow us to set a member's weight as quarter-time (e.g. 25). However, this shouldn't be done unless the membership decides to expand the standard _activityMultiplier_ modifiers beyond full-time (1) and part time (0.5)
      - Having a more granular _activityMultiplier_ will be beneficial in situations like adding members who have worked full time and part time in the past
      - Note that _activityMultiplier_ replaces _monthsOnBreak_ from V1. So if a member is a full-time contributor, but only worked 2 months in the quarter, their timeWeighting for that quarter would be 67 (i.e. 2/3). More on this further below.
      - **To remove members from the registry**, their Activity Modifier can be set to 0, but this does not actually remove them from the DAO (for that the member needs to ragequit or a separate proposal can be made to remove the member). Former members rejoining the Guild will need to use a new address
    - _startDate_
      - PG member start date
      - [Epoch & Unix timestamp](https://www.epochconverter.com/)
5. Submitting this form will create a proposal in the DAO, with a voting period (e.g. 1 week), allowing members to audit the proposal.
    - The proposal itself will be visible in the "normal" Moloch V3 DAO UI, not the custom-built registry frontend.
    - Moloch V3 allows **vote delegation** to \*any\* Ethereum account on mainnet, i.e. even to people outside the DAO.
      - Delegation can only be made to one address. Delegated power cannot be transferred.
      - If the membership thinks that delegation should only be allowed to members \*within\* the DAO, then this would require some custom development (update to the Shares token contract), which may not be worth the additional complexity.
        - Pros of being able to delegate to any account:
          - Allows members to have different security models for their Split and DAO voting addresses
          - Makes it harder (but not impossible) to know who is voting for what
        - Cons of being able to delegate to any account:
          - Members could delegate their votes to non-members
      - **Important**: The Moloch V3 contract takes a snapshot of delegation when a proposal is sponsored. So if a member delegates to someone mid-proposal (i.e. after the proposal is sponsored), they must still vote for the existing proposal, as delegation will first come into effect from the subsequent proposal.
6. Once the vote passes, there's a grace period before the proposal can be executed. The grace period will become more relevant if PG adopts a legal wrapper.
7. Once executed, the proposal does several things;
    - The first action is "_mintShares_", which create shares in the DAO for each new member address (1 share per member)
    - The second action is "_batchNewMember_", which interacts with the external membership registry / contract, adding new member addresses, and setting their activity modifiers and start date (or adjusting the activity modifier for existing members).

At this point, the proposal flow is complete, but the Split contract has not been updated yet. This can be done via the "Update" function in the custom frontend, which calculates _timeActive_ to get the normalized weights per member, and then updates the 0xSplits Split contract.

![Update](https://github.com/cheeky-gorilla/protocol-guild-contracts/assets/76262359/7704e136-dbe4-4492-9ac8-205d52df5ac1)

1. "Update" will first calculate active seconds for each member since the last time update
    - A new member will have 0 active seconds when first added to the registry. In this case, it will calculate active seconds between now and the member's start date, otherwise it will calculate seconds since the last update.
    - The active seconds are then multiplied by each member's activity multiplier, then appended to the prior total (if there is one, new members won't have a prior total)
      - The implication of appending new totals means that active members who change status (e.g. going from full time to part time), wont have their entire historical weights readjusted by the new status.
      - Assuming updates are done quarterly, if a member is a full-time contributor, but only worked 2 months in the quarter, their timeWeighting for that quarter would be 67 (2/3 expressed as a whole number).
2. Then the contract goes through the registry to perform two calculation loops: once to take the sum of the square root of each member's total, then again to calculate the square root of each member's total as a proportion of the total, to allow us to get the percent allocated per member for 0xSplits.
    - Members whose activity multiplier = 0 are skipped in the calculation loops
3. At this point there are two arrays (the accounts and their percentages), which are passed to the Split contract, to update it.

**A note on the timing of creating proposals, "Update" and "Distribute":**

Unlike the previous version ([V0.3](https://docs.google.com/document/d/1IVgZlVK8147dDb0kv9OOdGNbQH1eAvh2WcHqU_69l_k/edit)) the "Update" function will \*not\* trigger the "Distribute" function in 0xSplits. The two have been decoupled for simplicity. Instead, distributions can be triggered separately via the 0xSplits frontend (like today).

This is important because both "Update" (in the registry frontend) and "Distribute" (in 0xSplits) are permissionless. This will create an interesting dynamic: new members will be financially incentivized to "update" registry weights more frequently as it increases their share of donated funds relative to more long-term members (due to the square root function). Similarly, members returning from time off will also be financially incentivized to "Update" to ensure that their weight in 0xSplits is higher. On the other hand, since "Distribute" in 0xSplits is also permissionless, long-term members will be financially incentivized to trigger the "Distribute" function more frequently, as each "Update" dilutes their share of donated funds compared to newer members.

So, whenever a proposal is made to update the registry, newer members and members returning from time off are financially incentivized to "Update" the 0xSplits contract, while more long-term members are financially incentivized to "Distribute" vested funds. Given that there will be gas fees associated with each function, it's good that there are different incentives in different PG cohorts to Update and Distribute, as it means that potentially the person proposing the registry update doesn't need to Update and Distribute as well.

That being said, there are open questions about the "correct" flow in terms of distributing the Split contract \*before or after\* the Split contract update.

1. Currently distributions are done before the Split is updated, with the rational that it's the existing membership cohort that is entitled to the vested funds from the last three months, so it makes sense to pay them first, then add new members.
2. Argument for doing the opposite, i.e. updating first then distributing: if funds are from the last three months, then you want the weights to reflect the last three months. If you do the opposite (distribute and then update), you're potentially distributing based on old weights. Could result in situations where people are not getting credit for work they've done the last few months (if updating quarterly).
    - Members who know they're going to be removed at the next update can still trigger distribution via 0xSplits interface just before the update gets executed, to maximize their vested rewards.
3. As long as we are consistent, it should all even out.

#### L2 Donation Management

[Connext](https://www.connext.network/) allows us to deploy registries, Vesting and Split contracts on various L2 and EVM chains, which are all controlled by the Moloch DAO on mainnet.

This section will be expanded upon once DAOHaus shares more information on its implementation. Notes from the first call can be seen [here](https://docs.google.com/document/d/1PB9VQzBhvVpnbRwEFXWwBhv26y3xecFIrQFY3JLRIQU/edit#).

[Mimic](https://mimic.fi/) was previously considered as a potential solution to enabling L2 donations, as it would have allowed PG to consolidate all funds donated on L2s onto mainnet. However, Connext seems like a more neutral, future-proof implementation, as it allows PG to embrace Ethereum's L2 ecosystem and benefit from gas savings and liquidity on those chains.

### V2 tradeoffs

**0xSplits** Split and Vesting contracts continue to handle all finances (donations, vesting + distributions):

- Pros:
  - 0xSplits has proven itself extremely effective for handling donations, vesting and distributions over the course of the pilot
  - Allows the onchain membership registry to be the "Controller" of the Vesting and Split contract, instead of the current multisig
  - Updating Split contract recipients is automated via DAO proposals
  - No code / UI modifications required to 0xSplits
  - 0xSplits may be able to disable "Withdraw for all" in the Guild's Split contract UI
  - 0xSplits is planning future upgrades to 1) enable custom withdrawal logic (e.g. disallow third parties to distribute on recipients behalf), 2) introduce [new incentive mechanisms](https://docs.google.com/document/d/1RlWcD149Zj-AwdskyWVcpWIxRIBqcKfpPmsrLcKlvkw/edit?usp=sharing) to make third-party distributions more competitive and 3) make contracts more gas efficient
  - 0xSplits team built the Vesting module for the Guild, and are willing to make more modifications / help out as needed
  - 0xSplits has been deployed on Optimism, Arbitrum and Polygon
- Cons:
  - Gas fees: Distributing 5 tokens to 128 members costs $85 in gas @ ~14 Gwei. may become prohibitively expensive in the future (bull market). We can turn on the distributor fee to incentivise this
  - Changing to 4-year vesting stream post-pilot will require new Vesting contract (i.e. new donation address, however, we can point the ENS at this new address to help)
  - No way to earn yield on vesting funds (this is also the status quo)
  - Current 0xSplits implementation does not allow donating NFTs (status quo)

**Moloch v3 DAO** used for governance only (voting on and executing membership changes):
- Pros:
    - Moloch's DAO infrastructure is extremely battle tested
    - DAO functionality is reduced to bare essential (don't need "[loot](https://moloch.daohaus.fun/features/updates#shares-and-loot)" shares, shamans / minions, or any treasury management)
    - DAO implementation does not doxx member addresses
    - Could leverage plugins ("[Boosts](https://daohaus.club/docs/users/boosts/)") to 1) conduct offchain voting via [Snapshot](https://snapshot.org/#/) and 2) add proposals as [Discourse](https://www.discourse.org/) forum posts for discussions
    - DAOHaus is helping us set everything up between Moloch and the registry
    - Allows vote delegation for members who prefer to be hands off
    - Moloch V3 is launched and audited
- Cons:
    - Requires more engagement from members to vote (e.g. quarterly) - though votes can be delegated if preferred
    - Proposing, voting and executing proposals will require members to pay gas (though gasless voting could be achieved via [Snapshot](https://snapshot.org/#/))

**Onchain membership registry**, updated via DAO proposals, fed into Split contract:

- Pros:
    - Registry becomes "Controller" of 0xSplits contracts, instead of multisig
    - Only DAO can update registry
- Cons:
    - Registry introduces significant and untested contract complexity
    - Privacy considerations: Keeping an onchain registry could make it easier to associate member addresses with real-world identities (e.g. via "Start Date")

**Connext state bridging** : Membership registries, Vesting + Split contracts deployed on L2s, controlled by mainnet DAO

- Pros:
    - Donors have more choice (+ cheaper) of where to donate
    - Connext passes messages through the canonical bridges, and thus inherits those trust assumptions
    - Can leverage existing modules (no new code required)
    - Avoids issues where L2 tokens might not have liquidity on L1
    - Value-aligned for the Guild to be deployed on all its ecosystems chains, given that it wants to rely on donations from said ecosystem (and not just L1 apps)
- Cons:
    - Cost of sending messages from L1 \> L2 is unclear
    - Requires members to withdraw funds from multiple chains
 
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
$ pnpm test
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
$ pnpm hardhat --network <network_name> deploy --tags Summoner
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
| NetworkRegistry         | 0xa5D9469f11C277A91d718D338eece150d93996b3 |
| NetworkRegistryShaman   | 0xe03F296b89c99a223E41c42E5d56acd51DB329A8 |

### OptimismGoerli

| Contract                | Address                                    |
| ----------------------  | ------------------------------------------ |
| NetworkRegistrySummoner | 0xE8c26332C8Ecbc05a29e62E9c6bc3578EC82090f |
| NetworkRegistry         | 0x813F246856A79898a2b49Eef7ff3feb740Fe4226 |
| NetworkRegistryShaman   | 0xC2c90e8328877737B9ac495833eE701f98F90Db1 |

### ArbitrumGoerli

| Contract                | Address                                    |
| ----------------------  | ------------------------------------------ |
| NetworkRegistrySummoner | 0xE8c26332C8Ecbc05a29e62E9c6bc3578EC82090f |
| NetworkRegistry         | 0x813F246856A79898a2b49Eef7ff3feb740Fe4226 |
| NetworkRegistryShaman   | 0xC2c90e8328877737B9ac495833eE701f98F90Db1 |

## License

This project is licensed under [MIT](LICENSE.md).
