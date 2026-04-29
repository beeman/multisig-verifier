import { encodeBase58, toHex } from './squads.ts'

type DecoderResult = {
  action: string
  description: string
  details: Record<string, unknown>
}

type InstructionDecoder = (
  data: Uint8Array,
  accountKeys: readonly string[],
  accountIndexes: readonly number[],
) => DecoderResult

export type DecodedInstruction =
  | (DecoderResult & {
      program: string
      rawHex: string
      type: 'decoded'
    })
  | {
      isKnown: boolean
      program: string
      rawHex: string
      type: 'unknown'
    }

export const KNOWN_PROGRAMS = new Map<string, string>([
  ['11111111111111111111111111111111', 'System Program'],
  ['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'Associated Token'],
  ['ComputeBudget111111111111111111111111111111', 'Compute Budget'],
  ['SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', 'Squads v4'],
  ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'SPL Token'],
  ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'Token-2022'],
])

const SYSTEM_CREATE_ACCOUNT = 0
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'
const SYSTEM_TRANSFER = 2
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_TRANSFER = 3
const TOKEN_TRANSFER_CHECKED = 12
const decoders = new Map<string, InstructionDecoder>()

export function decodeInstruction(
  programId: string,
  data: Uint8Array,
  accountKeys: readonly string[],
  accountIndexes: readonly number[],
): DecodedInstruction {
  const programName = KNOWN_PROGRAMS.get(programId)
  const decoder = decoders.get(programId)

  if (decoder) {
    try {
      const decoded = decoder(data, accountKeys, accountIndexes)

      return {
        ...decoded,
        program: programName ?? programId,
        rawHex: toHex(data),
        type: 'decoded',
      }
    } catch {
      // Source behavior: unparseable known instructions fall back to raw display.
    }
  }

  return {
    isKnown: Boolean(programName),
    program: programName ?? programId,
    rawHex: toHex(data),
    type: 'unknown',
  }
}

export function registerDecoder(programId: string, decodeFn: InstructionDecoder): void {
  decoders.set(programId, decodeFn)
}

function accountKeyAt(accountKeys: readonly string[], accountIndexes: readonly number[], position: number): string {
  const accountIndex = accountIndexes[position]

  if (accountIndex === undefined) {
    return '?'
  }

  return accountKeys[accountIndex] ?? '?'
}

function decodeSystemInstruction(
  data: Uint8Array,
  accountKeys: readonly string[],
  accountIndexes: readonly number[],
): DecoderResult {
  if (data.length < 4) {
    throw new Error('System instruction data too short')
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const type = view.getUint32(0, true)

  switch (type) {
    case SYSTEM_CREATE_ACCOUNT: {
      if (data.length < 52) {
        throw new Error('CreateAccount data too short')
      }

      const lamports = view.getBigUint64(4, true)
      const owner = encodeBase58(data.slice(20, 52))
      const space = view.getBigUint64(12, true)
      const solAmount = Number(lamports) / 1e9

      return {
        action: 'CreateAccount',
        description: `Create account with ${solAmount.toFixed(4)} SOL`,
        details: {
          lamports: lamports.toString(),
          owner,
          space: space.toString(),
        },
      }
    }

    case SYSTEM_TRANSFER: {
      if (data.length < 12) {
        throw new Error('System Transfer data too short')
      }

      const from = accountKeyAt(accountKeys, accountIndexes, 0)
      const lamports = view.getBigUint64(4, true)
      const solAmount = Number(lamports) / 1e9
      const to = accountKeyAt(accountKeys, accountIndexes, 1)

      return {
        action: 'Transfer',
        description: `Transfer ${solAmount.toFixed(4)} SOL`,
        details: {
          from,
          lamports: lamports.toString(),
          solAmount,
          to,
        },
      }
    }

    default:
      throw new Error(`Unknown System instruction type: ${type}`)
  }
}

function decodeTokenInstruction(
  data: Uint8Array,
  accountKeys: readonly string[],
  accountIndexes: readonly number[],
): DecoderResult {
  if (data.length === 0) {
    throw new Error('Empty instruction data')
  }

  const type = data[0] ?? -1

  switch (type) {
    case TOKEN_TRANSFER: {
      if (data.length < 9) {
        throw new Error('Token Transfer data too short')
      }

      const amount = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true)
      const authority = accountKeyAt(accountKeys, accountIndexes, 2)
      const destination = accountKeyAt(accountKeys, accountIndexes, 1)
      const source = accountKeyAt(accountKeys, accountIndexes, 0)

      return {
        action: 'Transfer',
        description: `Transfer ${amount.toString()} tokens`,
        details: {
          amount: amount.toString(),
          authority,
          destination,
          source,
        },
      }
    }

    case TOKEN_TRANSFER_CHECKED: {
      if (data.length < 10) {
        throw new Error('Token TransferChecked data too short')
      }

      const amount = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true)
      const amountFormatted = formatTokenAmount(amount, data[9] ?? 0)
      const decimals = data[9] ?? 0
      const destination = accountKeyAt(accountKeys, accountIndexes, 2)
      const mint = accountKeyAt(accountKeys, accountIndexes, 1)
      const source = accountKeyAt(accountKeys, accountIndexes, 0)

      return {
        action: 'TransferChecked',
        description: `Transfer ${amountFormatted} tokens`,
        details: {
          amount: amount.toString(),
          amountFormatted,
          decimals,
          destination,
          mint,
          source,
        },
      }
    }

    default:
      throw new Error(`Unknown Token instruction type: ${type}`)
  }
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  const str = amount.toString()

  if (decimals === 0) {
    return str
  }

  if (str.length <= decimals) {
    return `0.${str.padStart(decimals, '0')}`
  }

  return `${str.slice(0, str.length - decimals)}.${str.slice(str.length - decimals)}`
}

registerDecoder(SYSTEM_PROGRAM_ID, decodeSystemInstruction)
registerDecoder(TOKEN_PROGRAM_ID, decodeTokenInstruction)
