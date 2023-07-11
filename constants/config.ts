// 0xSplits contracts
export const defaultSplitsConfig = {
  splitMain: "0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE", // same address on all live/test networks
};

// NOTICE: DAO + Connext + 0xSplits config
export const deploymentConfig: { [key: string]: any } = {
  "1": {
    // mainnet
    domainId: 6648936,
    connext: "0x8898B472C54c31894e3B9bb83cEA802a5d0e63C6",
    moloch: "0x7839755b77aadcd6a8cdb76248b3dddfa9b7f5f1",
    safe: "0xaccd85e73639b5213a001630eb2512dbd6292e32",
    splitMain: defaultSplitsConfig.splitMain,
    split: "0x50730dF422AF6c5465C6EfdE58dEC6443908a059",
    pgRegistry: "", // TODO:
  },
  "100": {
    // gnosis
    l2: true,
    domainId: 6778479,
    connext: "0x5bB83e95f63217CDa6aE3D181BA580Ef377D2109",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
  },
  "137": {
    // polygon
    l2: true,
    domainId: 1886350457,
    connext: "0x11984dc4465481512eb5b777E44061C158CF2259",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
  },
  "42161": {
    // arbitrum
    l2: true,
    domainId: 1634886255,
    connext: "0xEE9deC2712cCE65174B561151701Bf54b99C24C8",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
  },
  "10": {
    // optimism
    l2: true,
    domainId: 1869640809,
    connext: "0x8f7492DE823025b4CfaAB1D34c58963F2af5DEDA",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
  },
  "5": {
    // goerli
    domainId: 1735353714,
    connext: "0xFCa08024A6D4bCc87275b1E4A1E22B71fAD7f649",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "0x3023F7f106888C4F21d579D0d0FA0a334986FB54",
    pgRegistry: "0x3cFe6EE0664954c27E2D1Cfbe14E455e502527eB",
  },
  "80001": {
    // mumbai
    l2: true,
    domainId: 9991,
    connext: "0x2334937846Ab2A3FCE747b32587e1A1A2f6EEC5a",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "", // TODO:
  },
  "420": {
    // optimismGoerli
    l2: true,
    domainId: 1735356532,
    connext: "0x5Ea1bb242326044699C3d81341c5f535d5Af1504",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitsMain: "0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE",
    splitMain: defaultSplitsConfig.splitMain,
    split: "0xec2b5aa0a85a6b30ccdd298e576bb25c7c93c51d",
    pgRegistry: "0x29cB372f45604475781492cC688683a7202c13e5",
  },
  "421613": {
    // arbitrumGoerli
    l2: true,
    domainId: 1734439522,
    connext: "0x2075c9E31f973bb53CAE5BAC36a8eeB4B082ADC2",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: defaultSplitsConfig.splitMain,
    split: "0xfde01489c4e420d35d2fcb208089037ef5f7d4f5",
    pgRegistry: "0x29cB372f45604475781492cC688683a7202c13e5",
  },
};
