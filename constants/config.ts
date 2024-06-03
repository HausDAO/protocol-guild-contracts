// 0xSplits contracts
export const defaultSplitsConfig = {
  splitMain: "0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE", // same address on all live/test networks
  splitV2Factory: "0x80f1B766817D04870f115fEBbcCADF8DBF75E017", // PullSplitFactory
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
    splitv2: "", // TODO:
    splitV2Factory: defaultSplitsConfig.splitV2Factory,
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
    splitv2: "", // TODO:
    splitV2Factory: defaultSplitsConfig.splitV2Factory,
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
    splitv2: "", // TODO:
    splitV2Factory: defaultSplitsConfig.splitV2Factory,
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
    splitv2: "", // TODO:
    splitV2Factory: defaultSplitsConfig.splitV2Factory,
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
    splitv2: "", // TODO:
    splitV2Factory: defaultSplitsConfig.splitV2Factory,
    pgRegistry: "", // TODO:
  },
  "11155111": {
    // sepolia
    domainId: 1936027759,
    connext: "0x445fbf9cCbaf7d557fd771d56937E94397f43965",
    moloch: "", // TODO:
    safe: "", // TODO:
    splitMain: "0x54E4a6014D36c381fC43b7E24A1492F556139a6F",
    split: "", // TODO:
    splitV2: "0x5e3058D49074b6Ce2419672BAFBCAfaA0835758d", // TODO:
    splitV2Factory: defaultSplitsConfig.splitV2Factory,
    pgRegistry: "", // TODO:
  },
  "11155420": {
    // optimismSepolia
    l2: true,
    domainId: 1869640549,
    connext: "0x8247ed6d0a344eeae4edBC7e44572F1B70ECA82A",
    registryOwner: "0x10136Fa41B6522E4DBd068C6F7D80373aBbCFBe6", // TODO:
    moloch: "",
    safe: "",
    splitMain: "0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694E",
    split: "", // TODO:
    splitV2: "", // TODO:
    splitV2Factory: defaultSplitsConfig.splitV2Factory,
    pgRegistry: "", // TODO:
  },
  "421614": {
    // arbitrumSepolia
    l2: true,
    domainId: 1633842021,
    connext: "0x1780Ac087Cbe84CA8feb75C0Fb61878971175eb8",
    registryOwner: "0x10136Fa41B6522E4DBd068C6F7D80373aBbCFBe6", // TODO:
    moloch: "",
    safe: "",
    splitMain: "", // TODO:
    split: "", // TODO:
    splitV2: "", // TODO:
    splitV2Factory: defaultSplitsConfig.splitV2Factory,
    pgRegistry: "", // TODO:
  },
};
