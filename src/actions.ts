import type { GetLatestBlockhashApi, Rpc } from '@solana/kit'
import { fetchLatestBlockhash, type RpcReadConfig } from './rpc.ts'
import { APPROVE_DISC, decodeBase58, getProposalPda, PROGRAM_ID, REJECT_DISC } from './squads.ts'
import { AccountRole, buildUnsignedTransaction, serializeTransactionMessage } from './transaction.ts'

export async function buildVoteTransaction(
  multisigAddress: string,
  memberAddress: string,
  transactionIndex: bigint | number,
  approve: boolean,
  rpc: Rpc<GetLatestBlockhashApi>,
  config: RpcReadConfig = {},
): Promise<Uint8Array> {
  const [proposalPdaBytes] = await getProposalPda(multisigAddress, transactionIndex)
  const data = new Uint8Array(9)

  data.set(approve ? APPROVE_DISC : REJECT_DISC, 0)
  data[8] = 0x00

  const { blockhash } = await fetchLatestBlockhash(rpc, config)
  const messageBytes = serializeTransactionMessage({
    feePayer: decodeBase58(memberAddress),
    instructions: [
      {
        accounts: [
          { pubkey: decodeBase58(multisigAddress), role: AccountRole.READONLY },
          { pubkey: decodeBase58(memberAddress), role: AccountRole.READONLY_SIGNER },
          { pubkey: proposalPdaBytes, role: AccountRole.WRITABLE },
        ],
        data,
        programId: decodeBase58(PROGRAM_ID),
      },
    ],
    recentBlockhash: decodeBase58(blockhash),
  })

  return buildUnsignedTransaction(messageBytes, 1)
}
