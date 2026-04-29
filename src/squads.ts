import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getProgramDerivedAddress,
  isAddress,
} from '@solana/kit'

export const ACTIVATE_DISC = new Uint8Array([0x0b, 0x22, 0x5c, 0xf8, 0x9a, 0x1b, 0x33, 0x6a])
export const APPROVE_DISC = new Uint8Array([0x90, 0x25, 0xa4, 0x88, 0xbc, 0xd8, 0x2a, 0xf8])
export const BATCH_DISCRIMINATOR = new Uint8Array([0x9c, 0xc2, 0x46, 0x2c, 0x16, 0x58, 0x89, 0x2c])
export const CONFIG_TX_DISCRIMINATOR = new Uint8Array([0x5e, 0x08, 0x04, 0x23, 0x71, 0x8b, 0x8b, 0x70])
export const CREATE_DISC = new Uint8Array([0xdc, 0x3c, 0x49, 0xe0, 0x1e, 0x6c, 0x4f, 0x9f])
export const MULTISIG_DISCRIMINATOR = new Uint8Array([0xe0, 0x74, 0x79, 0xba, 0x44, 0xa1, 0x4f, 0xec])
export const PERMISSION_NAMES: Record<number, string> = { 1: 'Initiate', 2: 'Vote', 4: 'Execute' }
export const PROGRAM_CONFIG_DISCRIMINATOR = new Uint8Array([0xc4, 0xd2, 0x5a, 0xe7, 0x90, 0x95, 0x8c, 0x3f])
export const PROGRAM_ID = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'
export const PROPOSAL_DISCRIMINATOR = new Uint8Array([0x1a, 0x5e, 0xbd, 0xbb, 0x74, 0x88, 0x35, 0x21])
export const PROPOSAL_STATUS_NAMES = [
  'Draft',
  'Active',
  'Rejected',
  'Approved',
  'Executing',
  'Executed',
  'Cancelled',
] as const
export const REJECT_DISC = new Uint8Array([0xf3, 0x3e, 0x86, 0x9c, 0xe6, 0x6a, 0xf6, 0x87])
export const SPENDING_LIMIT_DISCRIMINATOR = new Uint8Array([0x0a, 0xc9, 0x1b, 0xa0, 0xda, 0xc3, 0xde, 0x98])
export const TX_BUFFER_DISCRIMINATOR = new Uint8Array([0x5a, 0x24, 0x23, 0xdb, 0x5d, 0xe1, 0x6e, 0x60])
export const VAULT_BATCH_TX_DISC = new Uint8Array([0xc4, 0x79, 0x2e, 0x24, 0x0c, 0x13, 0xfc, 0x07])
export const VAULT_TX_DISCRIMINATOR = new Uint8Array([0xa8, 0xfa, 0xa2, 0x64, 0x51, 0x0e, 0xa2, 0xcf])

type AddressTableLookup = {
  accountKey: string
  readonlyIndexes: number[]
  writableIndexes: number[]
}

type CompiledInstruction = {
  accountIndexes: number[]
  data: Uint8Array
  programIdIndex: number
}

type ConfigAction =
  | { member: { key: string; permissions: string[] }; name: string }
  | { key: string; name: string }
  | { name: string; threshold: number }
  | { name: string; timeLock: number }
  | { name: string; raw: true }

type Member = {
  key: string
  permissions: string[]
  permissionsMask: number
}

type ProposalStatus = {
  name: string
  tag: number
  timestamp: bigint | null
}

type TransactionMessage = {
  accountKeys: string[]
  addressTableLookups: AddressTableLookup[]
  instructions: CompiledInstruction[]
  numSigners: number
  numWritableNonSigners: number
  numWritableSigners: number
}

const ADDRESS_DECODER = getAddressDecoder()
const ADDRESS_ENCODER = getAddressEncoder()
const BASE58_DECODER = getBase58Decoder()
const BASE58_ENCODER = getBase58Encoder()
const CONFIG_ACTION_NAMES = [
  'AddMember',
  'RemoveMember',
  'ChangeThreshold',
  'SetTimeLock',
  'AddSpendingLimit',
  'RemoveSpendingLimit',
] as const

export class BorshReader {
  readonly buf: Uint8Array
  offset: number
  private readonly view: DataView

  constructor(buffer: ArrayBuffer | Uint8Array) {
    this.buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    this.offset = 0
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength)
  }

  matchDiscriminator(expected: Uint8Array): boolean {
    const discriminator = this.readDiscriminator()

    return arrayEqual(discriminator, expected)
  }

  readBytes(length: number): Uint8Array {
    this.check(length)

    const bytes = this.buf.slice(this.offset, this.offset + length)
    this.offset += length

    return bytes
  }

  readDiscriminator(): Uint8Array {
    return this.readBytes(8)
  }

  readI64(): bigint {
    this.check(8)

    const value = this.view.getBigInt64(this.offset, true)
    this.offset += 8

    return value
  }

  readOption<T>(readFn: (reader: BorshReader) => T): T | null {
    const tag = this.readU8()

    if (tag === 0) {
      return null
    }

    if (tag === 1) {
      return readFn(this)
    }

    throw new Error(`Borsh: invalid Option tag ${tag}`)
  }

  readPubkey(): Uint8Array {
    return this.readBytes(32)
  }

  readPubkeyBase58(): string {
    return ADDRESS_DECODER.decode(this.readPubkey())
  }

  readString(maxLen = 1024): string {
    const length = this.readU32()

    if (length > maxLen) {
      throw new Error(`Borsh: string length ${length} exceeds max ${maxLen}`)
    }

    this.check(length)

    const value = new TextDecoder().decode(this.buf.slice(this.offset, this.offset + length))
    this.offset += length

    return value
  }

  readU8(): number {
    this.check(1)

    const value = this.view.getUint8(this.offset)
    this.offset += 1

    return value
  }

  readU16(): number {
    this.check(2)

    const value = this.view.getUint16(this.offset, true)
    this.offset += 2

    return value
  }

  readU32(): number {
    this.check(4)

    const value = this.view.getUint32(this.offset, true)
    this.offset += 4

    return value
  }

  readU64(): bigint {
    this.check(8)

    const value = this.view.getBigUint64(this.offset, true)
    this.offset += 8

    return value
  }

  readVec<T>(readFn: (reader: BorshReader) => T, maxLen = 65535): T[] {
    const length = this.readU32()

    if (length > maxLen) {
      throw new Error(`Borsh: vec length ${length} exceeds max ${maxLen}`)
    }

    const result: T[] = []

    for (let index = 0; index < length; index++) {
      result.push(readFn(this))
    }

    return result
  }

  readVecU8(maxLen = 65535): Uint8Array {
    const length = this.readU32()

    if (length > maxLen) {
      throw new Error(`Borsh: byte vec length ${length} exceeds max ${maxLen}`)
    }

    return this.readBytes(length)
  }

  private check(length: number): void {
    if (this.offset + length > this.buf.length) {
      throw new Error(
        `Borsh: attempted to read ${length} bytes at offset ${this.offset}, buffer length ${this.buf.length}`,
      )
    }
  }
}

export function deserializeBatch(data: Uint8Array) {
  const reader = new BorshReader(data)

  if (!reader.matchDiscriminator(BATCH_DISCRIMINATOR)) {
    throw new Error('Invalid Batch account discriminator')
  }

  const multisig = reader.readPubkeyBase58()
  const creator = reader.readPubkeyBase58()
  const index = reader.readU64()
  const bump = reader.readU8()
  const vaultIndex = reader.readU8()
  const vaultBump = reader.readU8()
  const size = reader.readU32()
  const executedTransactionIndex = reader.readU32()

  return {
    bump,
    creator,
    executedTransactionIndex,
    index,
    multisig,
    size,
    type: 'batch' as const,
    vaultBump,
    vaultIndex,
  }
}

export function deserializeConfigTransaction(data: Uint8Array) {
  const reader = new BorshReader(data)

  if (!reader.matchDiscriminator(CONFIG_TX_DISCRIMINATOR)) {
    throw new Error('Invalid ConfigTransaction account discriminator')
  }

  const multisig = reader.readPubkeyBase58()
  const creator = reader.readPubkeyBase58()
  const index = reader.readU64()
  const bump = reader.readU8()

  let actions: ConfigAction[]

  try {
    actions = reader.readVec(readConfigAction, 32)
  } catch {
    actions = [{ name: 'UnparseableActions', raw: true }]
  }

  return {
    actions,
    bump,
    creator,
    index,
    multisig,
    type: 'config' as const,
  }
}

export function deserializeMultisig(data: Uint8Array) {
  const reader = new BorshReader(data)

  if (!reader.matchDiscriminator(MULTISIG_DISCRIMINATOR)) {
    throw new Error('Invalid Multisig account discriminator')
  }

  const createKey = reader.readPubkeyBase58()
  const configAuthority = reader.readPubkeyBase58()
  const threshold = reader.readU16()
  const timeLock = reader.readU32()
  const transactionIndex = reader.readU64()
  const staleTransactionIndex = reader.readU64()
  const rentCollector = reader.readOption((nestedReader) => nestedReader.readPubkeyBase58())
  const bump = reader.readU8()
  const members = reader.readVec<Member>((nestedReader) => {
    const key = nestedReader.readPubkeyBase58()
    const permissionsMask = nestedReader.readU8()

    return {
      key,
      permissions: readPermissions(permissionsMask),
      permissionsMask,
    }
  }, 256)

  return {
    bump,
    configAuthority,
    createKey,
    members,
    rentCollector,
    staleTransactionIndex,
    threshold,
    timeLock,
    transactionIndex,
  }
}

export function deserializeProposal(data: Uint8Array) {
  const reader = new BorshReader(data)

  if (!reader.matchDiscriminator(PROPOSAL_DISCRIMINATOR)) {
    throw new Error('Invalid Proposal account discriminator')
  }

  const multisig = reader.readPubkeyBase58()
  const transactionIndex = reader.readU64()
  const status = readProposalStatus(reader)
  const bump = reader.readU8()
  const approved = reader.readVec((nestedReader) => nestedReader.readPubkeyBase58(), 256)
  const rejected = reader.readVec((nestedReader) => nestedReader.readPubkeyBase58(), 256)
  const cancelled = reader.readVec((nestedReader) => nestedReader.readPubkeyBase58(), 256)

  return {
    approved,
    bump,
    cancelled,
    multisig,
    rejected,
    status,
    transactionIndex,
  }
}

export function deserializeTransaction(data: Uint8Array) {
  if (data.length < 8) {
    throw new Error('Transaction data too short')
  }

  const discriminator = data.slice(0, 8)

  if (arrayEqual(discriminator, VAULT_TX_DISCRIMINATOR)) {
    return deserializeVaultTransaction(data)
  }

  if (arrayEqual(discriminator, CONFIG_TX_DISCRIMINATOR)) {
    return deserializeConfigTransaction(data)
  }

  if (arrayEqual(discriminator, VAULT_BATCH_TX_DISC)) {
    return deserializeVaultBatchTransaction(data)
  }

  if (arrayEqual(discriminator, BATCH_DISCRIMINATOR)) {
    return deserializeBatch(data)
  }

  return {
    discriminator: toHex(discriminator),
    type: 'unknown' as const,
  }
}

export function deserializeVaultBatchTransaction(data: Uint8Array) {
  const reader = new BorshReader(data)

  if (!reader.matchDiscriminator(VAULT_BATCH_TX_DISC)) {
    throw new Error('Invalid VaultBatchTransaction account discriminator')
  }

  const bump = reader.readU8()
  const ephemeralSignerBumps = reader.readVecU8(256)
  const message = readTransactionMessage(reader)

  return {
    bump,
    ephemeralSignerBumps: Array.from(ephemeralSignerBumps),
    message,
    subtype: 'batch' as const,
    type: 'vault' as const,
  }
}

export function deserializeVaultTransaction(data: Uint8Array) {
  const reader = new BorshReader(data)

  if (!reader.matchDiscriminator(VAULT_TX_DISCRIMINATOR)) {
    throw new Error('Invalid VaultTransaction account discriminator')
  }

  const multisig = reader.readPubkeyBase58()
  const creator = reader.readPubkeyBase58()
  const index = reader.readU64()
  const bump = reader.readU8()
  const vaultIndex = reader.readU8()
  const vaultBump = reader.readU8()
  const ephemeralSignerBumps = reader.readVecU8(256)
  const message = readTransactionMessage(reader)

  return {
    bump,
    creator,
    ephemeralSignerBumps: Array.from(ephemeralSignerBumps),
    index,
    message,
    multisig,
    type: 'vault' as const,
    vaultBump,
    vaultIndex,
  }
}

export function decodeBase58(str: string): Uint8Array {
  return new Uint8Array(BASE58_ENCODER.encode(str))
}

export function encodeBase58(bytes: Uint8Array): string {
  return BASE58_DECODER.decode(bytes)
}

export function isValidBase58(str: string): boolean {
  return isAddress(str)
}

export async function getBatchTransactionPda(
  multisigAddress: string,
  batchIndex: bigint | number,
  txIndex: number,
): Promise<readonly [Uint8Array, number]> {
  return getPdaBytes([
    textToBytes('multisig'),
    decodeBase58(multisigAddress),
    textToBytes('transaction'),
    u64ToLeBytes(batchIndex),
    textToBytes('batch_transaction'),
    u32ToLeBytes(txIndex),
  ])
}

export async function getMultisigVaultPda(
  multisigAddress: string,
  vaultIndex = 0,
): Promise<readonly [Uint8Array, number]> {
  return getPdaBytes([
    textToBytes('multisig'),
    decodeBase58(multisigAddress),
    textToBytes('vault'),
    new Uint8Array([vaultIndex]),
  ])
}

export async function getProposalPda(
  multisigAddress: string,
  index: bigint | number,
): Promise<readonly [Uint8Array, number]> {
  return getPdaBytes([
    textToBytes('multisig'),
    decodeBase58(multisigAddress),
    textToBytes('transaction'),
    u64ToLeBytes(index),
    textToBytes('proposal'),
  ])
}

export async function getTransactionPda(
  multisigAddress: string,
  index: bigint | number,
): Promise<readonly [Uint8Array, number]> {
  return getPdaBytes([
    textToBytes('multisig'),
    decodeBase58(multisigAddress),
    textToBytes('transaction'),
    u64ToLeBytes(index),
  ])
}

export function shortenAddress(addr: string | null | undefined, chars = 4): string {
  if (!addr) {
    return ''
  }

  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ')
}

function arrayEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }

  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return false
    }
  }

  return true
}

async function getPdaBytes(seeds: Uint8Array[]): Promise<readonly [Uint8Array, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: address(PROGRAM_ID),
    seeds,
  })

  return [new Uint8Array(ADDRESS_ENCODER.encode(pda)), bump]
}

function readAddressTableLookup(reader: BorshReader): AddressTableLookup {
  const accountKey = reader.readPubkeyBase58()
  const writableIndexes = reader.readVecU8(256)
  const readonlyIndexes = reader.readVecU8(256)

  return {
    accountKey,
    readonlyIndexes: Array.from(readonlyIndexes),
    writableIndexes: Array.from(writableIndexes),
  }
}

function textToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function u32ToLeBytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)

  return bytes
}

function u64ToLeBytes(value: bigint | number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true)

  return bytes
}

function readCompiledInstruction(reader: BorshReader): CompiledInstruction {
  const programIdIndex = reader.readU8()
  const accountIndexes = reader.readVecU8(256)
  const data = reader.readVecU8(65535)

  return {
    accountIndexes: Array.from(accountIndexes),
    data,
    programIdIndex,
  }
}

function readConfigAction(reader: BorshReader): ConfigAction {
  const tag = reader.readU8()
  const name = CONFIG_ACTION_NAMES[tag] ?? `Unknown(${tag})`

  switch (tag) {
    case 0: {
      const key = reader.readPubkeyBase58()
      const permissionsMask = reader.readU8()

      return { member: { key, permissions: readPermissions(permissionsMask) }, name }
    }
    case 1: {
      const key = reader.readPubkeyBase58()

      return { key, name }
    }
    case 2: {
      const threshold = reader.readU16()

      return { name, threshold }
    }
    case 3: {
      const timeLock = reader.readU32()

      return { name, timeLock }
    }
    default:
      return { name, raw: true }
  }
}

function readPermissions(mask: number): string[] {
  const permissions: string[] = []

  for (const [bit, name] of Object.entries(PERMISSION_NAMES)) {
    if (mask & Number(bit)) {
      permissions.push(name)
    }
  }

  return permissions
}

function readProposalStatus(reader: BorshReader): ProposalStatus {
  const tag = reader.readU8()
  const name = PROPOSAL_STATUS_NAMES[tag] ?? 'Unknown'

  if (tag === 4) {
    return { name, tag, timestamp: null }
  }

  if (tag >= 0 && tag <= 6) {
    return {
      name,
      tag,
      timestamp: reader.readI64(),
    }
  }

  throw new Error(`Unknown ProposalStatus tag: ${tag}`)
}

function readTransactionMessage(reader: BorshReader): TransactionMessage {
  const numSigners = reader.readU8()
  const numWritableSigners = reader.readU8()
  const numWritableNonSigners = reader.readU8()
  const accountKeys = reader.readVec((nestedReader) => nestedReader.readPubkeyBase58(), 256)
  const instructions = reader.readVec(readCompiledInstruction, 256)
  const addressTableLookups = reader.readVec(readAddressTableLookup, 64)

  return {
    accountKeys,
    addressTableLookups,
    instructions,
    numSigners,
    numWritableNonSigners,
    numWritableSigners,
  }
}
