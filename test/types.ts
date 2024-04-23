import { BigNumberish } from "ethers";

// import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

// type Fixture<T> = () => Promise<T>;

// declare module "mocha" {
//   export interface Context {
//     greeter: Greeter;
//     loadFixture: <T>(fixture: Fixture<T>) => Promise<T>;
//     signers: Signers;
//   }
// }

// export interface Signers {
//   admin: SignerWithAddress;
// }

export type NetworkRegistryArgs = {
  connext: string;
  updaterDomainId: number;
  updaterAddress: string;
  splitMain: string;
  split: string;
  owner: string;
};

export type GuildRegistryArgs = {
  splitMain: string;
  split: string;
  owner: string;
};

export type Member = {
  account: string;
  secondsActive?: BigNumberish;
  startDate: BigNumberish;
  activityMultiplier: BigNumberish;
};
