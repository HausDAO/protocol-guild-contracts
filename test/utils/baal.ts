import { Baal } from "@daohaus/baal-contracts";
import { moveForwardPeriods } from "@daohaus/baal-contracts/hardhat";
import { BigNumberish } from "ethers";
import { ethers } from "hardhat";

export type DAOSettings = {
  PROPOSAL_OFFERING: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  GRACE_PERIOD_IN_SECONDS: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  VOTING_PERIOD_IN_SECONDS: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  QUORUM_PERCENT: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  SPONSOR_THRESHOLD: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  MIN_RETENTION_PERCENT: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  MIN_STAKING_PERCENT: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  TOKEN_NAME: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  TOKEN_SYMBOL: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type ProposalType = {
  flag: BigNumberish;
  account?: `0x${string}`;
  data: string;
  details: string;
  expiration: BigNumberish;
  baalGas: BigNumberish;
};

export const defaultDAOSettings = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  VOTING_PERIOD_IN_SECONDS: 86400,
  PROPOSAL_OFFERING: 0,
  SPONSOR_THRESHOLD: 1,
  MIN_RETENTION_PERCENT: 0,
  MIN_STAKING_PERCENT: 0,
  QUORUM_PERCENT: 0,
  TOKEN_NAME: "wrapped ETH",
  TOKEN_SYMBOL: "WETH",
};

export const submitAndProcessProposal = async ({
  baal,
  encodedAction,
  proposal,
  proposalId,
  daoSettings,
}: {
  baal: Baal;
  encodedAction: string;
  proposal: ProposalType;
  proposalId?: BigNumberish;
  daoSettings?: DAOSettings;
}) => {
  await baal.submitProposal(encodedAction, proposal.expiration, proposal.baalGas, ethers.utils.id(proposal.details));
  const id = proposalId ? proposalId : await baal.proposalCount();
  await baal.submitVote(id, true);
  await moveForwardPeriods(daoSettings?.VOTING_PERIOD_IN_SECONDS || defaultDAOSettings.VOTING_PERIOD_IN_SECONDS, 2);
  return await baal.processProposal(id, encodedAction);
};
