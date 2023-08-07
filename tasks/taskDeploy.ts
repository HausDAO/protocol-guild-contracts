import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, ethers } from "ethers";
import fs from "fs";
import { task, types } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import { MAX_DISTRIBUTION_FEE, PERCENTAGE_SCALE, deploymentConfig } from "../constants";
import { Member } from "../src/utils";
import type { ISplitMain } from "../types/contracts/interfaces/ISplitMain";

task("deploy:split")
  .addFlag("controller", "Set the deployer address as Split controller")
  .addOptionalParam("controllerAddress", "Split contract controller address", ethers.constants.AddressZero)
  .addOptionalParam("memberList", "JSON file containg member list records", "./memberlist.json", types.inputFile)
  .addOptionalParam("distributorFee", "Split distributorFee", 0, types.int)
  .setAction(async function (taskArguments: TaskArguments, { ethers, getChainId, getNamedAccounts, network }) {
    const chainId = await getChainId();
    if (!deploymentConfig[chainId]?.splitMain) {
      console.error("Not Supported Network", network.name, chainId);
      return;
    }
    console.log(`Deploying Split to ${network.name}\n TaskArguments:`, taskArguments);

    const { deployer } = await getNamedAccounts();

    const inputFile = taskArguments.memberList;
    const data = fs.readFileSync(inputFile, { encoding: "utf-8" });
    const memberList = JSON.parse(data);
    memberList.sort((a: Member, b: Member) => {
      return parseInt(a.memberAddress.slice(2), 16) - parseInt(b.memberAddress.slice(2), 16);
    });
    console.log("Total Members:", memberList.length);

    const accounts = memberList.map((m: Member) => m.memberAddress);
    const percentAllocations = memberList.map((m: Member) => m.percentAllocation) as Array<number>;
    const { distributorFee } = taskArguments;
    const controller = taskArguments.controller ? deployer : taskArguments.controllerAddress;

    const total = percentAllocations.reduce((prev: number, curr: number) => prev + curr, 0);
    if (total != PERCENTAGE_SCALE.toNumber()) {
      throw new Error(
        `percentAllocations mismatch 0xSplit PERCENTAGE_SCALE (${total} != ${PERCENTAGE_SCALE.toString()})`,
      );
    }
    // console.log('total', total, PERCENTAGE_SCALE.toString());
    if (BigNumber.from(distributorFee).gt(MAX_DISTRIBUTION_FEE)) {
      throw new Error(`distributorFee must not be greater than ${MAX_DISTRIBUTION_FEE.toString()}`);
    }

    const signer: SignerWithAddress = await ethers.getSigner(deployer);

    const splitMain = (await ethers.getContractAt(
      "ISplitMain",
      deploymentConfig[chainId]?.splitMain,
      signer,
    )) as ISplitMain;

    const tx = await splitMain.createSplit(accounts, percentAllocations, distributorFee, controller);

    const receipt = await tx.wait();

    const splitAddress = receipt.events?.[0].topics[1] && ethers.utils.hexStripZeros(receipt.events?.[0].topics[1]);

    console.log(
      `New Split contract deployed to ${network.name}:`,
      splitAddress,
      ` txhash: (${receipt.transactionHash})`,
    );
  });
