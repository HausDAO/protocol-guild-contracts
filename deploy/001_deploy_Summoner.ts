import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

// NOTICE: In case you want to deploy Safe + Baal infrstructure on a public testnet
const deployFn: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { ethers, deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    // uncomment if you get gas-related errors and need current network fee data to update params
    // console.log('Feedata', await ethers.provider.getFeeData());

    const summonerDeployed = await deploy('NetworkRegistrySummoner', {
        contract: 'NetworkRegistrySummoner',
        from: deployer,
        args: [],
        log: true,
    });

    const registrySingletonDeployed = await deploy('NetworkRegistry', {
        contract: 'NetworkRegistry',
        from: deployer,
        args: [],
        log: true,
    });

    const registryShamanSingletonDeployed = await deploy('NetworkRegistryShaman', {
        contract: 'NetworkRegistryShaman',
        from: deployer,
        args: [],
        log: true,
    });

    // console.log('NetworkRegistrySummoner deployed at', summonerDeployed.address);
    // console.log('PGNetworkRegistry singleton deployed at', registrySingletonDeployed.address);
    // console.log('PGNetworkRegistryShaman singleton deployed at', registryShamanSingletonDeployed.address);
}

export default deployFn;
deployFn.tags = ['NetworkRegistry', 'Summoner'];
