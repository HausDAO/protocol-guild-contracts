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
    moloch: "0x7839755b77aadcd6a8cdb76248b3dddfa9b7f5f1", // TODO:
    safe: "0xaccd85e73639b5213a001630eb2512dbd6292e32", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "0x50730dF422AF6c5465C6EfdE58dEC6443908a059", // TODO:
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
    moloch: "0x1e4265037fbefb711c144cb0724d722ee3187e16", // TODO:
    safe: "0x42f822d337c19fdd63752b165df49d27ffcbc60c", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "0xda419a6b304a8394d76c483cac0aced93c165d44",
    pgRegistry: "0xeAC4e0196c6152Bd3307035dBB9A2E58f0e791eE",
  },
  "80001": {
    // mumbai
    l2: true,
    domainId: 9991,
    connext: "0x2334937846Ab2A3FCE747b32587e1A1A2f6EEC5a",
    registryOwner: "0x10136Fa41B6522E4DBd068C6F7D80373aBbCFBe6", // TODO:
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "0x7182c7d52f6c5d38327c19fe4fdbe53f4a5f6e82", // TODO:
    pgRegistry: "0xDb1058A3303AD2D83055613A47711458184E1845", // TODO:
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
    split: "0x4b7ef91969355e78de2ff6825ad266b3f231b88e", // TODO:
    pgRegistry: "0xa304c1053d187497ae1f27B6Ac825f09A3c99C40", // TODO:
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
    split: "0xf79ee05e577b9ad7d3e786945b8405be92515bc8", // TODO:
    pgRegistry: "0xa304c1053d187497ae1f27B6Ac825f09A3c99C40", // TODO:
  },
};
