# Protocol Guild NetworkRegisry - Process Flow

V2 will have two frontends -
[one specifically for the membership registry](https://ipfs.io/ipfs/bafybeia4o2lfias2kfnxmvsdoerxvtnrgurjk5gwhchmfnty6ph3xeptnq/#/),
and another which is the "normal" Moloch V3 DAO UI. Separate frontends makes everything easier to compartmentalize for
now, but it could make sense to unify everything for
[future iterations of PGs smart contract architecture](https://docs.google.com/document/d/1BL8MaCCrrqjdIfpaZnvlp6IEZc0y1uxVr97qJ3MaqDo/edit).

Here's the process flow for quarterly membership updates:

1. Members can use the custom
   [frontend](https://ipfs.io/ipfs/bafybeia4o2lfias2kfnxmvsdoerxvtnrgurjk5gwhchmfnty6ph3xeptnq/#/) to interact with the
   membership registry, which 1) shows the state of the membership registries (on mainnet and L2s), 2) allows the
   creation of proposals to update the registries, and 3) update the Split contracts (on mainnet and L2s).

![Custom Frontend](https://github.com/cheeky-gorilla/protocol-guild-contracts/assets/76262359/dd5f1f4c-8c9d-4a4f-9afd-f751322ff613)

2. In this frontend, DAO members can upload a CSV to create a proposal to add new members / edit existing members.

![Upload CSV](https://github.com/cheeky-gorilla/protocol-guild-contracts/assets/76262359/cdf6be7c-96e7-4b9c-a55c-0bb8bbc0144d)

4. The CSV will have three fields:
   - _address_
     - PG member address
   - _activityMultiplier_ aka _modifier_ aka _timeWeighting_
     - This is a whole number from 0-100, where 50 = part time and 100 = full time.
     - This in theory would allow us to set a member's weight as quarter-time (e.g. 25). However, this shouldn't be done
       unless the membership decides to expand the standard _activityMultiplier_ modifiers beyond full-time (1) and part
       time (0.5)
     - Having a more granular _activityMultiplier_ will be beneficial in situations like adding members who have worked
       full time and part time in the past
     - Note that _activityMultiplier_ replaces _monthsOnBreak_ from V1. So if a member is a full-time contributor, but
       only worked 2 months in the quarter, their timeWeighting for that quarter would be 67 (i.e. 2/3). More on this
       further below.
     - **To remove members from the registry**, their Activity Modifier can be set to 0, but this does not actually
       remove them from the DAO (for that the member needs to ragequit or a separate proposal can be made to remove the
       member). Former members rejoining the Guild will need to use a new address
   - _startDate_
     - PG member start date
     - [Epoch & Unix timestamp](https://www.epochconverter.com/)
5. Submitting this form will create a proposal in the DAO, with a voting period (e.g. 1 week), allowing members to audit
   the proposal.
   - The proposal itself will be visible in the "normal" Moloch V3 DAO UI, not the custom-built registry frontend.
   - Moloch V3 allows **vote delegation** to \*any\* Ethereum account on mainnet, i.e. even to people outside the DAO.
     - Delegation can only be made to one address. Delegated power cannot be transferred.
     - If the membership thinks that delegation should only be allowed to members \*within\* the DAO, then this would
       require some custom development (update to the Shares token contract), which may not be worth the additional
       complexity.
       - Pros of being able to delegate to any account:
         - Allows members to have different security models for their Split and DAO voting addresses
         - Makes it harder (but not impossible) to know who is voting for what
       - Cons of being able to delegate to any account:
         - Members could delegate their votes to non-members
     - **Important**: The Moloch V3 contract takes a snapshot of delegation when a proposal is sponsored. So if a member
       delegates to someone mid-proposal (i.e. after the proposal is sponsored), they must still vote for the existing
       proposal, as delegation will first come into effect from the subsequent proposal.
6. Once the vote passes, there's a grace period before the proposal can be executed. The grace period will become more
   relevant if PG adopts a legal wrapper.
7. Once executed, the proposal does several things;
   - The first action is "_mintShares_", which create shares in the DAO for each new member address (1 share per member)
   - The second action is "_batchNewMember_", which interacts with the external membership registry / contract, adding
     new member addresses, and setting their activity modifiers and start date (or adjusting the activity modifier for
     existing members).

At this point, the proposal flow is complete, but the Split contract has not been updated yet. This can be done via the
"Update" function in the custom frontend, which calculates _timeActive_ to get the normalized weights per member, and
then updates the 0xSplits Split contract.

![Update](https://github.com/cheeky-gorilla/protocol-guild-contracts/assets/76262359/7704e136-dbe4-4492-9ac8-205d52df5ac1)

1. "Update" will first calculate active seconds for each member since the last time update
   - A new member will have 0 active seconds when first added to the registry. In this case, it will calculate active
     seconds between now and the member's start date, otherwise it will calculate seconds since the last update.
   - The active seconds are then multiplied by each member's activity multiplier, then appended to the prior total (if
     there is one, new members won't have a prior total)
     - The implication of appending new totals means that active members who change status (e.g. going from full time to
       part time), wont have their entire historical weights readjusted by the new status.
     - Assuming updates are done quarterly, if a member is a full-time contributor, but only worked 2 months in the
       quarter, their timeWeighting for that quarter would be 67 (2/3 expressed as a whole number).
2. Then the contract goes through the registry to perform two calculation loops: once to take the sum of the square root
   of each member's total, then again to calculate the square root of each member's total as a proportion of the total,
   to allow us to get the percent allocated per member for 0xSplits.
   - Members whose activity multiplier = 0 are skipped in the calculation loops
3. At this point there are two arrays (the accounts and their percentages), which are passed to the Split contract, to
   update it.

**A note on the timing of creating proposals, "Update" and "Distribute":**

Unlike the previous version
([V0.3](https://docs.google.com/document/d/1IVgZlVK8147dDb0kv9OOdGNbQH1eAvh2WcHqU_69l_k/edit)) the "Update" function
will \*not\* trigger the "Distribute" function in 0xSplits. The two have been decoupled for simplicity. Instead,
distributions can be triggered separately via the 0xSplits frontend (like today).

This is important because both "Update" (in the registry frontend) and "Distribute" (in 0xSplits) are permissionless.
This will create an interesting dynamic: new members will be financially incentivized to "update" registry weights more
frequently as it increases their share of donated funds relative to more long-term members (due to the square root
function). Similarly, members returning from time off will also be financially incentivized to "Update" to ensure that
their weight in 0xSplits is higher. On the other hand, since "Distribute" in 0xSplits is also permissionless, long-term
members will be financially incentivized to trigger the "Distribute" function more frequently, as each "Update" dilutes
their share of donated funds compared to newer members.

So, whenever a proposal is made to update the registry, newer members and members returning from time off are
financially incentivized to "Update" the 0xSplits contract, while more long-term members are financially incentivized to
"Distribute" vested funds. Given that there will be gas fees associated with each function, it's good that there are
different incentives in different PG cohorts to Update and Distribute, as it means that potentially the person proposing
the registry update doesn't need to Update and Distribute as well.

That being said, there are open questions about the "correct" flow in terms of distributing the Split contract \*before
or after\* the Split contract update.

1. Currently distributions are done before the Split is updated, with the rational that it's the existing membership
   cohort that is entitled to the vested funds from the last three months, so it makes sense to pay them first, then add
   new members.
2. Argument for doing the opposite, i.e. updating first then distributing: if funds are from the last three months, then
   you want the weights to reflect the last three months. If you do the opposite (distribute and then update), you're
   potentially distributing based on old weights. Could result in situations where people are not getting credit for
   work they've done the last few months (if updating quarterly).
   - Members who know they're going to be removed at the next update can still trigger distribution via 0xSplits
     interface just before the update gets executed, to maximize their vested rewards.
3. As long as we are consistent, it should all even out.

#### L2 Donation Management

[Connext](https://www.connext.network/) allows us to deploy registries, Vesting and Split contracts on various L2 and
EVM chains, which are all controlled by the Moloch DAO on mainnet.

This section will be expanded upon once DAOHaus shares more information on its implementation. Notes from the first call
can be seen [here](https://docs.google.com/document/d/1PB9VQzBhvVpnbRwEFXWwBhv26y3xecFIrQFY3JLRIQU/edit#).

[Mimic](https://mimic.fi/) was previously considered as a potential solution to enabling L2 donations, as it would have
allowed PG to consolidate all funds donated on L2s onto mainnet. However, Connext seems like a more neutral,
future-proof implementation, as it allows PG to embrace Ethereum's L2 ecosystem and benefit from gas savings and
liquidity on those chains.
