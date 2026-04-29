import {
  AccountRole,
  type Address,
  address,
  appendTransactionMessageInstructions,
  type Blockhash,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getShortU16Encoder,
  type Instruction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'

export { AccountRole }

export type TransactionAccountMeta = {
  pubkey: Uint8Array
  role: AccountRole
}

export type TransactionInstruction = {
  accounts: readonly TransactionAccountMeta[]
  data: Uint8Array
  programId: Uint8Array
}

export type SerializeTransactionMessageParams = {
  feePayer: Uint8Array
  instructions: readonly TransactionInstruction[]
  recentBlockhash: Uint8Array
}

const ADDRESS_DECODER = getAddressDecoder()
const SHORT_U16_ENCODER = getShortU16Encoder()

export function buildUnsignedTransaction(messageBytes: Uint8Array, numSignatures: number): Uint8Array {
  const sigCount = encodeCompactU16(numSignatures)
  const sigSlots = new Uint8Array(64 * numSignatures)

  return concat(sigCount, sigSlots, messageBytes)
}

export function concat(...arrays: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((totalLength, array) => totalLength + array.length, 0))
  let offset = 0

  for (const array of arrays) {
    result.set(array, offset)
    offset += array.length
  }

  return result
}

export function encodeCompactU16(value: bigint | number): Uint8Array {
  return new Uint8Array(SHORT_U16_ENCODER.encode(value))
}

export function serializeTransactionMessage({
  feePayer,
  instructions,
  recentBlockhash,
}: SerializeTransactionMessageParams): Uint8Array {
  const transactionMessage = appendTransactionMessageInstructions(
    instructions.map(toKitInstruction),
    setTransactionMessageLifetimeUsingBlockhash(
      { blockhash: pubkeyBytesToBlockhash(recentBlockhash), lastValidBlockHeight: 0n },
      setTransactionMessageFeePayer(
        pubkeyBytesToAddress(feePayer, 'feePayer'),
        createTransactionMessage({ version: 0 }),
      ),
    ),
  )
  const transaction = compileTransaction(transactionMessage)

  return new Uint8Array(transaction.messageBytes)
}

function pubkeyBytesToAddress(pubkey: Uint8Array, label = 'pubkey'): Address {
  validateByteLength(pubkey, label)

  return address(ADDRESS_DECODER.decode(pubkey))
}

function pubkeyBytesToBlockhash(pubkey: Uint8Array): Blockhash {
  validateByteLength(pubkey, 'recentBlockhash')

  return blockhash(ADDRESS_DECODER.decode(pubkey))
}

function toKitInstruction(instruction: TransactionInstruction): Instruction {
  return {
    accounts: instruction.accounts.map((account) => ({
      address: pubkeyBytesToAddress(account.pubkey),
      role: account.role,
    })),
    data: instruction.data,
    programAddress: pubkeyBytesToAddress(instruction.programId),
  }
}

function validateByteLength(bytes: Uint8Array, label: string): void {
  if (bytes.length !== 32) {
    throw new Error(`${label} must be 32 bytes`)
  }
}
