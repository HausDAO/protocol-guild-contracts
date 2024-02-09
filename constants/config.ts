// 0xSplits contracts
export const defaultSplitsConfig = {
  splitMain: "0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE", // same address on all live/test networks
};

// NOTICE: DAO + Connext + 0xSplits config
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export const deploymentConfig: { [key: string]: any } = {
  "1": {
    // mainnet
    domainId: 6648936,
    connext: "0x8898B472C54c31894e3B9bb83cEA802a5d0e63C6",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
    pgRegistry: "", // TODO:
  },
  "100": {
    // gnosis
    l2: true,
    domainId: 6778479,
    connext: "0x5bB83e95f63217CDa6aE3D181BA580Ef377D2109",
    registryOwner: "", // TODO:
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
    pgRegistry: "", // TODO:
  },
  "137": {
    // polygon
    l2: true,
    domainId: 1886350457,
    connext: "0x11984dc4465481512eb5b777E44061C158CF2259",
    registryOwner: "", // TODO:
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
    pgRegistry: "", // TODO:
  },
  "42161": {
    // arbitrum
    l2: true,
    domainId: 1634886255,
    connext: "0xEE9deC2712cCE65174B561151701Bf54b99C24C8",
    registryOwner: "", // TODO:
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
    pgRegistry: "", // TODO:
  },
  "10": {
    // optimism
    l2: true,
    domainId: 1869640809,
    connext: "0x8f7492DE823025b4CfaAB1D34c58963F2af5DEDA",
    registryOwner: "", // TODO:
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
    pgRegistry: "", // TODO:
  },
  "5": {
    // goerli
    domainId: 1735353714,
    connext: "0xFCa08024A6D4bCc87275b1E4A1E22B71fAD7f649",
    moloch: "0xbfb34e1e13d68922cb86769f4abcdab9bd68e5ff", // TODO:
    safe: "0x7201030e136734e92560427b1346af2219d12074", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "0xe650e123237920d5f620579fb42670145361a0a9", // TODO:
    pgRegistry: "0x9eF64c547477b2263ed56821ce6Be79564824F44", // TODO:
  },
  "80001": {
    // mumbai
    l2: true,
    domainId: 9991,
    connext: "0x2334937846Ab2A3FCE747b32587e1A1A2f6EEC5a",
    registryOwner: "0x10136Fa41B6522E4DBd068C6F7D80373aBbCFBe6", // TODO:
    moloch: "",
    safe: "",
    splitMain: defaultSplitsConfig.splitMain,
    split: "0x6f9a5dc2903a2bcb51caf05978e4f260a531c578", // TODO:
    pgRegistry: "0x07E1eF1E6Eff099c082232a9AcA0Fa5551602d62", // TODO:
  },
  "420": {
    // optimismGoerli
    l2: true,
    domainId: 1735356532,
    connext: "0x5Ea1bb242326044699C3d81341c5f535d5Af1504",
    registryOwner: "0x10136Fa41B6522E4DBd068C6F7D80373aBbCFBe6", // TODO:
    moloch: "",
    safe: "",
    splitsMain: "0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE",
    splitMain: defaultSplitsConfig.splitMain,
    split: "0xb12a8499c8aca88fe2270ba5552d0a2a1fd8b7fe", // TODO:
    pgRegistry: "0x8054874b08783070a189218a22e7ffb4600430c0", // TODO:
  },
  "421613": {
    // arbitrumGoerli
    l2: true,
    domainId: 1734439522,
    connext: "0x2075c9E31f973bb53CAE5BAC36a8eeB4B082ADC2",
    registryOwner: "0x10136Fa41B6522E4DBd068C6F7D80373aBbCFBe6", // TODO:
    moloch: "",
    safe: "",
    splitMain: defaultSplitsConfig.splitMain,
    split: "0x14ff51c8806f1730d64137fcf79ba38c67d593c8", // TODO:
    pgRegistry: "0x8054874b08783070a189218a22e7ffb4600430c0", // TODO:
  },
  "11155111": {
    // sepolia
    domainId: 0, // TODO:
    connext: "0xFCa08024A6D4bCc87275b1E4A1E22B71fAD7f649", // TODO:
    moloch: "0x832ec97051ed6a1abdbafa74dace307af59b1ef3", // TODO:
    safe: "0x79c740401f76b8a7b26baf3e522571add38362d0", // TODO:
    splitMain: "0x5924cD81dC672151527B1E4b5Ef57B69cBD07Eda",
    split: "0xccc8922d223f5bb2e623bf100970913ac85fd17d", // TODO:
    pgRegistry: "0x7A69DbBFF504FAB98ADe857992BC6d1Ae94Ba0d0", // TODO:
  },
  "11155420": {
    // optimismSepolia
    l2: true,
    domainId: 0, // TODO:
    connext: "", // TODO:
    registryOwner: "0x10136Fa41B6522E4DBd068C6F7D80373aBbCFBe6", // TODO:
    moloch: "",
    safe: "",
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
    pgRegistry: "", // TODO:
  },
  "421614": {
    // arbitrumSepolia
    l2: true,
    domainId: 0, // TODO:
    connext: "", // TODO:
    registryOwner: "0x10136Fa41B6522E4DBd068C6F7D80373aBbCFBe6", // TODO:
    moloch: "",
    safe: "",
    splitMain: "", // TODO:
    split: "", // TODO:
    pgRegistry: "", // TODO:
  },
};
