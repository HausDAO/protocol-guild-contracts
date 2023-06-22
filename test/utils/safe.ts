import { BigNumber } from "@ethersproject/bignumber";
import { encodeMultiSend, MetaTransaction } from "@gnosis.pm/safe-contracts";
import { MultiSend } from "@daohaus/baal-contracts"

export const encodeMultiAction = (multisend: MultiSend, actions: string[], tos: string[], values: BigNumber[], operations: number[]) => {
  let metatransactions: MetaTransaction[] = []
  for (let index = 0; index < actions.length; index++) {
    metatransactions.push({
      to: tos[index],
      value: values[index],
      data: actions[index],
      operation: operations[index],
    })
  }
  const encodedMetatransactions = encodeMultiSend(metatransactions)
  const multi_action = multisend.interface.encodeFunctionData('multiSend', [encodedMetatransactions])
  return multi_action
}
