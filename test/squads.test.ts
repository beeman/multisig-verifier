import { describe, expect, test } from 'bun:test'
import { getAddressDecoder } from '@solana/kit'
import {
  ACTIVATE_DISC,
  APPROVE_DISC,
  BATCH_DISCRIMINATOR,
  BorshReader,
  CONFIG_TX_DISCRIMINATOR,
  CREATE_DISC,
  decodeBase58,
  deserializeBatch,
  deserializeConfigTransaction,
  deserializeMultisig,
  deserializeProposal,
  deserializeTransaction,
  deserializeVaultBatchTransaction,
  deserializeVaultTransaction,
  encodeBase58,
  getBatchTransactionPda,
  getMultisigVaultPda,
  getProposalPda,
  getTransactionPda,
  isValidBase58,
  MULTISIG_DISCRIMINATOR,
  PERMISSION_NAMES,
  PROGRAM_CONFIG_DISCRIMINATOR,
  PROGRAM_ID,
  PROPOSAL_DISCRIMINATOR,
  PROPOSAL_STATUS_NAMES,
  REJECT_DISC,
  SPENDING_LIMIT_DISCRIMINATOR,
  shortenAddress,
  TX_BUFFER_DISCRIMINATOR,
  toHex,
  VAULT_BATCH_TX_DISC,
  VAULT_TX_DISCRIMINATOR,
} from '../src/squads.ts'

const ADDRESS_DECODER = getAddressDecoder()
const SQUADS_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

class BorshWriter {
  private readonly bytes: number[] = []

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes)
  }

  writeBytes(bytes: Iterable<number>): this {
    for (const byte of bytes) {
      this.bytes.push(byte)
    }

    return this
  }

  writeI64(value: bigint): this {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigInt64(0, value, true)

    return this.writeBytes(bytes)
  }

  writePubkey(seed: number): this {
    return this.writeBytes(pubkeyBytes(seed))
  }

  writeU8(value: number): this {
    this.bytes.push(value)

    return this
  }

  writeU16(value: number): this {
    const bytes = new Uint8Array(2)
    new DataView(bytes.buffer).setUint16(0, value, true)

    return this.writeBytes(bytes)
  }

  writeU32(value: number): this {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value, true)

    return this.writeBytes(bytes)
  }

  writeU64(value: bigint): this {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigUint64(0, value, true)

    return this.writeBytes(bytes)
  }

  writeVec<T>(items: readonly T[], writeItem: (item: T, writer: BorshWriter) => void): this {
    this.writeU32(items.length)

    for (const item of items) {
      writeItem(item, this)
    }

    return this
  }

  writeVecU8(bytes: readonly number[]): this {
    this.writeU32(bytes.length)

    return this.writeBytes(bytes)
  }
}

describe('BorshReader', () => {
  test('reads primitive values and options', () => {
    const data = new BorshWriter()
      .writeU8(66)
      .writeU16(513)
      .writeU32(16909060)
      .writeU64(72623859790382856n)
      .writeU8(1)
      .writeU8(170)
      .writeU8(0)
      .toBytes()

    const reader = new BorshReader(data)

    expect(reader.readU8()).toBe(66)
    expect(reader.readU16()).toBe(513)
    expect(reader.readU32()).toBe(16909060)
    expect(reader.readU64()).toBe(72623859790382856n)
    expect(reader.readOption((nestedReader) => nestedReader.readU8())).toBe(170)
    expect(reader.readOption((nestedReader) => nestedReader.readU8())).toBeNull()
  })

  test('rejects invalid reads', () => {
    const reader = new BorshReader(new Uint8Array([1]))

    reader.readU8()

    expect(() => reader.readU8()).toThrow('Borsh: attempted to read 1 bytes')
    expect(() => new BorshReader(new Uint8Array([2])).readOption((nestedReader) => nestedReader.readU8())).toThrow(
      'Borsh: invalid Option tag 2',
    )
  })
})

describe('Squads constants', () => {
  test('exports the canonical Squads v4 program id', () => {
    expect(PROGRAM_ID).toBe(SQUADS_PROGRAM)
  })

  test('exports account discriminators from the source implementation', () => {
    expectBytes(BATCH_DISCRIMINATOR, [0x9c, 0xc2, 0x46, 0x2c, 0x16, 0x58, 0x89, 0x2c])
    expectBytes(CONFIG_TX_DISCRIMINATOR, [0x5e, 0x08, 0x04, 0x23, 0x71, 0x8b, 0x8b, 0x70])
    expectBytes(MULTISIG_DISCRIMINATOR, [0xe0, 0x74, 0x79, 0xba, 0x44, 0xa1, 0x4f, 0xec])
    expectBytes(PROGRAM_CONFIG_DISCRIMINATOR, [0xc4, 0xd2, 0x5a, 0xe7, 0x90, 0x95, 0x8c, 0x3f])
    expectBytes(PROPOSAL_DISCRIMINATOR, [0x1a, 0x5e, 0xbd, 0xbb, 0x74, 0x88, 0x35, 0x21])
    expectBytes(SPENDING_LIMIT_DISCRIMINATOR, [0x0a, 0xc9, 0x1b, 0xa0, 0xda, 0xc3, 0xde, 0x98])
    expectBytes(TX_BUFFER_DISCRIMINATOR, [0x5a, 0x24, 0x23, 0xdb, 0x5d, 0xe1, 0x6e, 0x60])
    expectBytes(VAULT_BATCH_TX_DISC, [0xc4, 0x79, 0x2e, 0x24, 0x0c, 0x13, 0xfc, 0x07])
    expectBytes(VAULT_TX_DISCRIMINATOR, [0xa8, 0xfa, 0xa2, 0x64, 0x51, 0x0e, 0xa2, 0xcf])
  })

  test('exports instruction discriminators from the source implementation', () => {
    expectBytes(ACTIVATE_DISC, [0x0b, 0x22, 0x5c, 0xf8, 0x9a, 0x1b, 0x33, 0x6a])
    expectBytes(APPROVE_DISC, [0x90, 0x25, 0xa4, 0x88, 0xbc, 0xd8, 0x2a, 0xf8])
    expectBytes(CREATE_DISC, [0xdc, 0x3c, 0x49, 0xe0, 0x1e, 0x6c, 0x4f, 0x9f])
    expectBytes(REJECT_DISC, [0xf3, 0x3e, 0x86, 0x9c, 0xe6, 0x6a, 0xf6, 0x87])
  })

  test('exports proposal status and permission name tables', () => {
    expect(PROPOSAL_STATUS_NAMES).toEqual([
      'Draft',
      'Active',
      'Rejected',
      'Approved',
      'Executing',
      'Executed',
      'Cancelled',
    ])
    expect(PERMISSION_NAMES).toEqual({ 1: 'Initiate', 2: 'Vote', 4: 'Execute' })
  })
})

describe('base58 address helpers', () => {
  test('decodes and encodes known Solana addresses', () => {
    const squadsBytes = decodeBase58(SQUADS_PROGRAM)
    const systemBytes = decodeBase58(SYSTEM_PROGRAM)
    const tokenBytes = decodeBase58(TOKEN_PROGRAM)

    expect(squadsBytes).toHaveLength(32)
    expect(systemBytes).toEqual(new Uint8Array(32))
    expect(tokenBytes).toHaveLength(32)
    expect(encodeBase58(squadsBytes)).toBe(SQUADS_PROGRAM)
    expect(encodeBase58(systemBytes)).toBe(SYSTEM_PROGRAM)
    expect(encodeBase58(tokenBytes)).toBe(TOKEN_PROGRAM)
  })

  test('handles empty base58 payloads', () => {
    expect(decodeBase58('')).toEqual(new Uint8Array())
    expect(encodeBase58(new Uint8Array())).toBe('')
  })

  test('validates base58 public keys', () => {
    expect(isValidBase58(SQUADS_PROGRAM)).toBeTrue()
    expect(isValidBase58('')).toBeFalse()
    expect(isValidBase58('0OIl')).toBeFalse()
    expect(isValidBase58('invalid')).toBeFalse()
  })

  test('shortens addresses for display', () => {
    expect(shortenAddress('7xKp3nRm5tKp', 4)).toBe('7xKp...5tKp')
    expect(shortenAddress(SQUADS_PROGRAM, 6)).toBe('SQDS4e...j52pCf')
    expect(shortenAddress('')).toBe('')
  })
})

describe('PDA helpers', () => {
  test('derives multisig vault PDAs', async () => {
    const [vault0, vault0Bump] = await getMultisigVaultPda(SYSTEM_PROGRAM, 0)
    const [vault1, vault1Bump] = await getMultisigVaultPda(SYSTEM_PROGRAM, 1)

    expect(vault0).toBeInstanceOf(Uint8Array)
    expect(vault0).toHaveLength(32)
    expect(encodeBase58(vault0)).toBe('HyvBpUqbXi4DEpVknM8Z6tUK3mKUTHaGmQ321rgvdDU6')
    expect(vault0Bump).toBe(253)
    expect(encodeBase58(vault1)).toBe('3hf7GkCzsdFzPxDdxTTSAbnyWvcBNCqyLoTAM4C4Mppb')
    expect(vault1Bump).toBe(254)
  })

  test('derives transaction and proposal PDAs for the same index', async () => {
    const [transactionPda, transactionBump] = await getTransactionPda(SYSTEM_PROGRAM, 1)
    const [proposalPda, proposalBump] = await getProposalPda(SYSTEM_PROGRAM, 1)

    expect(encodeBase58(transactionPda)).toBe('BjXeeZP2J7ntnFSngwZ2EcpyYeewhH5DEdYd9xi9n2kA')
    expect(transactionBump).toBe(255)
    expect(encodeBase58(proposalPda)).toBe('guwe5Au9JhZFp87oo5Z1BKMMaCu18Gs8VJtbGDZqG2c')
    expect(proposalBump).toBe(255)
    expect(encodeBase58(transactionPda)).not.toBe(encodeBase58(proposalPda))
  })

  test('derives batch transaction PDAs with a u32 transaction index seed', async () => {
    const [batchTransactionPda, bump] = await getBatchTransactionPda(SYSTEM_PROGRAM, 1, 2)

    expect(encodeBase58(batchTransactionPda)).toBe('CSWrHQzpSRgNMZbS5qYTLGRNAdJ23TECYNnWhtQZ6Rcv')
    expect(bump).toBe(255)
  })

  test('accepts bigint transaction indexes', async () => {
    const [transactionPda, bump] = await getTransactionPda(SQUADS_PROGRAM, 100n)

    expect(encodeBase58(transactionPda)).toBe('KQXgEP1tNTgPusw9VYGJayGd28xXvd97JrSHpqFcQhi')
    expect(bump).toBe(255)
  })
})

describe('deserializeBatch', () => {
  test('deserializes a batch account', () => {
    const data = buildBatch()

    expect(deserializeBatch(data)).toEqual({
      bump: 9,
      creator: addressForSeed(2),
      executedTransactionIndex: 5,
      index: 42n,
      multisig: addressForSeed(1),
      size: 4,
      type: 'batch',
      vaultBump: 11,
      vaultIndex: 10,
    })
  })

  test('rejects an invalid discriminator', () => {
    expect(() => deserializeBatch(PROPOSAL_DISCRIMINATOR)).toThrow('Invalid Batch account discriminator')
  })
})

describe('deserializeConfigTransaction', () => {
  test('deserializes known config actions', () => {
    const data = new BorshWriter()
      .writeBytes(CONFIG_TX_DISCRIMINATOR)
      .writePubkey(12)
      .writePubkey(13)
      .writeU64(14n)
      .writeU8(15)
      .writeVec([0, 1, 2, 3], (tag, writer) => {
        writer.writeU8(tag)

        if (tag === 0) {
          writer.writePubkey(16).writeU8(5)
        }

        if (tag === 1) {
          writer.writePubkey(17)
        }

        if (tag === 2) {
          writer.writeU16(3)
        }

        if (tag === 3) {
          writer.writeU32(60)
        }
      })
      .toBytes()

    expect(deserializeConfigTransaction(data)).toEqual({
      actions: [
        { member: { key: addressForSeed(16), permissions: ['Initiate', 'Execute'] }, name: 'AddMember' },
        { key: addressForSeed(17), name: 'RemoveMember' },
        { name: 'ChangeThreshold', threshold: 3 },
        { name: 'SetTimeLock', timeLock: 60 },
      ],
      bump: 15,
      creator: addressForSeed(13),
      index: 14n,
      multisig: addressForSeed(12),
      type: 'config',
    })
  })

  test('returns an unparseable action marker when action decoding fails', () => {
    const data = new BorshWriter()
      .writeBytes(CONFIG_TX_DISCRIMINATOR)
      .writePubkey(18)
      .writePubkey(19)
      .writeU64(20n)
      .writeU8(21)
      .writeU32(1)
      .writeU8(0)
      .toBytes()

    expect(deserializeConfigTransaction(data)).toEqual({
      actions: [{ name: 'UnparseableActions', raw: true }],
      bump: 21,
      creator: addressForSeed(19),
      index: 20n,
      multisig: addressForSeed(18),
      type: 'config',
    })
  })
})

describe('deserializeMultisig', () => {
  test('deserializes multisig members and permissions', () => {
    const data = new BorshWriter()
      .writeBytes(MULTISIG_DISCRIMINATOR)
      .writePubkey(22)
      .writePubkey(23)
      .writeU16(2)
      .writeU32(3600)
      .writeU64(24n)
      .writeU64(25n)
      .writeU8(1)
      .writePubkey(26)
      .writeU8(27)
      .writeVec([28, 29], (seed, writer) => {
        writer.writePubkey(seed).writeU8(seed === 28 ? 3 : 4)
      })
      .toBytes()

    expect(deserializeMultisig(data)).toEqual({
      bump: 27,
      configAuthority: addressForSeed(23),
      createKey: addressForSeed(22),
      members: [
        { key: addressForSeed(28), permissions: ['Initiate', 'Vote'], permissionsMask: 3 },
        { key: addressForSeed(29), permissions: ['Execute'], permissionsMask: 4 },
      ],
      rentCollector: addressForSeed(26),
      staleTransactionIndex: 25n,
      threshold: 2,
      timeLock: 3600,
      transactionIndex: 24n,
    })
  })
})

describe('deserializeProposal', () => {
  test('deserializes proposal status with timestamp', () => {
    const data = new BorshWriter()
      .writeBytes(PROPOSAL_DISCRIMINATOR)
      .writePubkey(30)
      .writeU64(31n)
      .writeU8(1)
      .writeI64(1700000000n)
      .writeU8(32)
      .writeVec([33, 34], (seed, writer) => writer.writePubkey(seed))
      .writeVec([35], (seed, writer) => writer.writePubkey(seed))
      .writeVec<number>([], (seed, writer) => writer.writePubkey(seed))
      .toBytes()

    expect(deserializeProposal(data)).toEqual({
      approved: [addressForSeed(33), addressForSeed(34)],
      bump: 32,
      cancelled: [],
      multisig: addressForSeed(30),
      rejected: [addressForSeed(35)],
      status: { name: 'Active', tag: 1, timestamp: 1700000000n },
      transactionIndex: 31n,
    })
  })

  test('deserializes executing status without a timestamp payload', () => {
    const data = new BorshWriter()
      .writeBytes(PROPOSAL_DISCRIMINATOR)
      .writePubkey(36)
      .writeU64(37n)
      .writeU8(4)
      .writeU8(38)
      .writeVec<number>([], (seed, writer) => writer.writePubkey(seed))
      .writeVec<number>([], (seed, writer) => writer.writePubkey(seed))
      .writeVec<number>([], (seed, writer) => writer.writePubkey(seed))
      .toBytes()

    expect(deserializeProposal(data).status).toEqual({ name: 'Executing', tag: 4, timestamp: null })
  })
})

describe('deserializeTransaction', () => {
  test('dispatches known transaction account discriminators', () => {
    expect(deserializeTransaction(buildBatch())).toMatchObject({ type: 'batch' })
    expect(deserializeTransaction(buildConfigTransaction())).toMatchObject({ type: 'config' })
    expect(deserializeTransaction(buildVaultBatchTransaction())).toMatchObject({ subtype: 'batch', type: 'vault' })
    expect(deserializeTransaction(buildVaultTransaction())).toMatchObject({ type: 'vault' })
  })

  test('returns a minimal unknown transaction result', () => {
    expect(deserializeTransaction(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual({
      discriminator: '01 02 03 04 05 06 07 08',
      type: 'unknown',
    })
  })

  test('rejects short transaction data', () => {
    expect(() => deserializeTransaction(new Uint8Array([1, 2, 3]))).toThrow('Transaction data too short')
  })
})

describe('deserializeVaultBatchTransaction', () => {
  test('deserializes a vault batch transaction account', () => {
    expect(deserializeVaultBatchTransaction(buildVaultBatchTransaction())).toEqual({
      bump: 44,
      ephemeralSignerBumps: [45, 46],
      message: emptyMessage(),
      subtype: 'batch',
      type: 'vault',
    })
  })
})

describe('deserializeVaultTransaction', () => {
  test('deserializes a vault transaction account with message data', () => {
    expect(deserializeVaultTransaction(buildVaultTransaction())).toEqual({
      bump: 54,
      creator: addressForSeed(53),
      ephemeralSignerBumps: [57, 58],
      index: 55n,
      message: populatedMessage(),
      multisig: addressForSeed(52),
      type: 'vault',
      vaultBump: 56,
      vaultIndex: 55,
    })
  })
})

describe('toHex', () => {
  test('formats bytes as lowercase hex pairs', () => {
    expect(toHex(new Uint8Array([0, 1, 254, 255]))).toBe('00 01 fe ff')
  })
})

function addressForSeed(seed: number): string {
  return ADDRESS_DECODER.decode(pubkeyBytes(seed))
}

function expectBytes(actual: Uint8Array, expected: number[]): void {
  expect(Array.from(actual)).toEqual(expected)
}

function buildBatch(): Uint8Array {
  return new BorshWriter()
    .writeBytes(BATCH_DISCRIMINATOR)
    .writePubkey(1)
    .writePubkey(2)
    .writeU64(42n)
    .writeU8(9)
    .writeU8(10)
    .writeU8(11)
    .writeU32(4)
    .writeU32(5)
    .toBytes()
}

function buildConfigTransaction(): Uint8Array {
  return new BorshWriter()
    .writeBytes(CONFIG_TX_DISCRIMINATOR)
    .writePubkey(39)
    .writePubkey(40)
    .writeU64(41n)
    .writeU8(42)
    .writeVec([4], (tag, writer) => writer.writeU8(tag))
    .toBytes()
}

function buildVaultBatchTransaction(): Uint8Array {
  const writer = new BorshWriter().writeBytes(VAULT_BATCH_TX_DISC).writeU8(44).writeVecU8([45, 46])

  writeEmptyMessage(writer)

  return writer.toBytes()
}

function buildVaultTransaction(): Uint8Array {
  const writer = new BorshWriter()
    .writeBytes(VAULT_TX_DISCRIMINATOR)
    .writePubkey(52)
    .writePubkey(53)
    .writeU64(55n)
    .writeU8(54)
    .writeU8(55)
    .writeU8(56)
    .writeVecU8([57, 58])

  writePopulatedMessage(writer)

  return writer.toBytes()
}

function emptyMessage() {
  return {
    accountKeys: [],
    addressTableLookups: [],
    instructions: [],
    numSigners: 0,
    numWritableNonSigners: 0,
    numWritableSigners: 0,
  }
}

function populatedMessage() {
  return {
    accountKeys: [addressForSeed(59), addressForSeed(60)],
    addressTableLookups: [
      {
        accountKey: addressForSeed(61),
        readonlyIndexes: [3, 4],
        writableIndexes: [2],
      },
    ],
    instructions: [
      {
        accountIndexes: [0, 1],
        data: new Uint8Array([170, 187]),
        programIdIndex: 1,
      },
    ],
    numSigners: 1,
    numWritableNonSigners: 3,
    numWritableSigners: 2,
  }
}

function pubkeyBytes(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed)
}

function writeEmptyMessage(writer: BorshWriter): void {
  writer
    .writeU8(0)
    .writeU8(0)
    .writeU8(0)
    .writeVec<number>([], (seed, nestedWriter) => nestedWriter.writePubkey(seed))
    .writeVec<number>([], (seed, nestedWriter) => nestedWriter.writeU8(seed))
    .writeVec<number>([], (seed, nestedWriter) => nestedWriter.writePubkey(seed))
}

function writePopulatedMessage(writer: BorshWriter): void {
  writer
    .writeU8(1)
    .writeU8(2)
    .writeU8(3)
    .writeVec([59, 60], (seed, nestedWriter) => nestedWriter.writePubkey(seed))
    .writeVec([0], (_item, nestedWriter) => {
      nestedWriter.writeU8(1).writeVecU8([0, 1]).writeVecU8([170, 187])
    })
    .writeVec([0], (_item, nestedWriter) => {
      nestedWriter.writePubkey(61).writeVecU8([2]).writeVecU8([3, 4])
    })
}
