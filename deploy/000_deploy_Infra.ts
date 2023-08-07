import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

// NOTICE: In case you want to deploy Safe + Baal infrstructure on a public testnet
const deployFn: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments } = hre;
  // const { deploy, read } = deployments;
  // const { deployer } = await getNamedAccounts();

  await deployments.run(["Infra", "BaalSummoner"]); // Deploy Safe Infrastructure & Baal Summoner
  console.log("Safe + BaalSummoner contracts deployed!\n");

  // const splitMainDeployed = await deploy('SplitMain', {
  // from: deployer,
  // log: true,
  // });

  // const splitSingleton = await read('SplitMain', 'walletImplementation');

  // console.log('SplitMain deployed at', splitMainDeployed.address);
  // console.log('SplitWallet singleton deployed at', splitSingleton);
};

export default deployFn;
deployFn.tags = ["Local"];
