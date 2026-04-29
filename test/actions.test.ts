import { describe, expect, test } from 'bun:test'
import { type Address, address, type Blockhash, type GetLatestBlockhashApi, type Rpc } from '@solana/kit'
import { buildVoteTransaction } from '../src/actions.ts'
import { APPROVE_DISC, decodeBase58, encodeBase58, getProposalPda, PROGRAM_ID, REJECT_DISC } from '../src/squads.ts'
import { AccountRole, buildUnsignedTransaction, serializeTransactionMessage } from '../src/transaction.ts'

type LatestBlockhashCall = {
  abortSignal?: AbortSignal
  config?: unknown
}

const MEMBER_ADDRESS = addressForSeed(2)
const MULTISIG_ADDRESS = addressForSeed(1)

describe('buildVoteTransaction', () => {
  test('builds an unsigned approve transaction and fetches a fresh blockhash', async () => {
    const abortController = new AbortController()
    const blockhash = blockhashForSeed(3)
    const { calls, rpc } = createLatestBlockhashRpc(blockhash)
    const transaction = await buildVoteTransaction(MULTISIG_ADDRESS, MEMBER_ADDRESS, 7, true, rpc, {
      abortSignal: abortController.signal,
      commitment: 'confirmed',
    })
    const expected = await expectedVoteTransaction({
      approve: true,
      blockhash,
      memberAddress: MEMBER_ADDRESS,
      multisigAddress: MULTISIG_ADDRESS,
      transactionIndex: 7,
    })

    expect(transaction).toEqual(expected)
    expect(extractInstructionData(transaction)).toEqual(new Uint8Array([...APPROVE_DISC, 0]))
    expect(calls).toEqual([{ abortSignal: expect.any(AbortSignal), config: { commitment: 'confirmed' } }])
  })

  test('builds an unsigned reject transaction', async () => {
    const blockhash = blockhashForSeed(4)
    const { rpc } = createLatestBlockhashRpc(blockhash)
    const transaction = await buildVoteTransaction(MULTISIG_ADDRESS, MEMBER_ADDRESS, 8n, false, rpc)

    expect(extractInstructionData(transaction)).toEqual(new Uint8Array([...REJECT_DISC, 0]))
  })
})

function addressForSeed(seed: number): Address {
  return address(encodeBase58(new Uint8Array(32).fill(seed)))
}

function blockhashForSeed(seed: number): Blockhash {
  return encodeBase58(new Uint8Array(32).fill(seed)) as Blockhash
}

function createLatestBlockhashRpc(blockhash: Blockhash) {
  const calls: LatestBlockhashCall[] = []
  const rpc = {
    getLatestBlockhash(config?: unknown) {
      return {
        async send(options?: { abortSignal?: AbortSignal }) {
          calls.push({ abortSignal: options?.abortSignal, config })

          return {
            context: { slot: 1n },
            value: {
              blockhash,
              lastValidBlockHeight: 2n,
            },
          }
        },
      }
    },
  } as unknown as Rpc<GetLatestBlockhashApi>

  return { calls, rpc }
}

async function expectedVoteTransaction({
  approve,
  blockhash,
  memberAddress,
  multisigAddress,
  transactionIndex,
}: {
  approve: boolean
  blockhash: Blockhash
  memberAddress: string
  multisigAddress: string
  transactionIndex: bigint | number
}): Promise<Uint8Array> {
  const [proposalPdaBytes] = await getProposalPda(multisigAddress, transactionIndex)
  const data = new Uint8Array([...(approve ? APPROVE_DISC : REJECT_DISC), 0])
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

function extractInstructionData(transaction: Uint8Array): Uint8Array {
  let offset = 1 + 64

  offset += 1
  offset += 3

  const accountCount = transaction[offset]
  offset += 1 + Number(accountCount) * 32
  offset += 32
  offset += 1
  offset += 1

  const instructionAccountCount = transaction[offset]
  offset += 1 + Number(instructionAccountCount)

  const dataLength = transaction[offset]
  offset += 1

  return transaction.slice(offset, offset + Number(dataLength))
}
