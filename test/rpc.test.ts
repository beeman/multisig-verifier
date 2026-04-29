import { describe, expect, test } from 'bun:test'
import {
  type Address,
  address,
  type Blockhash,
  type GetAccountInfoApi,
  type GetBalanceApi,
  type GetLatestBlockhashApi,
  type GetMultipleAccountsApi,
  getAddressEncoder,
  getBase64Decoder,
  type Rpc,
  type SimulateTransactionApi,
} from '@solana/kit'
import {
  fetchAccountData,
  fetchBalance,
  fetchLatestBlockhash,
  fetchMultipleAccountData,
  fetchMultisig,
  fetchProposalBatch,
  fetchTransaction,
  resolveAddressTableLookups,
  sendRpcRequest,
  simulateTransaction,
  type TransactionMessageWithAddressTableLookups,
} from '../src/rpc.ts'
import {
  BATCH_DISCRIMINATOR,
  encodeBase58,
  getBatchTransactionPda,
  getProposalPda,
  getTransactionPda,
  MULTISIG_DISCRIMINATOR,
  PROPOSAL_DISCRIMINATOR,
  VAULT_BATCH_TX_DISC,
  VAULT_TX_DISCRIMINATOR,
} from '../src/squads.ts'

type GetMultipleAccountsCall = {
  abortSignal?: AbortSignal
  addresses: readonly Address[]
  config?: unknown
}

type RpcReadCall =
  | {
      abortSignal?: AbortSignal
      address: Address
      config?: unknown
      method: 'getAccountInfo' | 'getBalance'
    }
  | {
      abortSignal?: AbortSignal
      addresses: readonly Address[]
      config?: unknown
      method: 'getMultipleAccounts'
    }
  | {
      abortSignal?: AbortSignal
      config?: unknown
      method: 'getLatestBlockhash'
    }
  | {
      abortSignal?: AbortSignal
      config?: unknown
      method: 'simulateTransaction'
      transaction: string
    }

const ADDRESS_ENCODER = getAddressEncoder()
const BASE64_DECODER = getBase64Decoder()
const STATIC_ACCOUNT = addressForSeed(1)
const TABLE_A = addressForSeed(2)
const TABLE_B = addressForSeed(3)

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

  writePubkeyAddress(accountAddress: string): this {
    return this.writeBytes(decodeAddress(accountAddress))
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

describe('Kit RPC read helpers', () => {
  test('fetches and decodes one base64 account', async () => {
    const accountData = new Uint8Array([1, 2, 3])
    const { calls, rpc } = createRpcReadClient({
      accounts: {
        [STATIC_ACCOUNT]: accountData,
      },
    })

    await expect(fetchAccountData(rpc, STATIC_ACCOUNT, { commitment: 'confirmed' })).resolves.toEqual(accountData)
    expect(calls[0]).toEqual({
      abortSignal: expect.any(AbortSignal),
      address: address(STATIC_ACCOUNT),
      config: { commitment: 'confirmed', encoding: 'base64' },
      method: 'getAccountInfo',
    })
  })

  test('rejects a missing account', async () => {
    const { rpc } = createRpcReadClient()

    await expect(fetchAccountData(rpc, STATIC_ACCOUNT)).rejects.toThrow(`Account not found on-chain: ${STATIC_ACCOUNT}`)
  })

  test('rejects an account with no data and includes account metadata', async () => {
    const { rpc } = createRpcReadClient({
      accounts: {
        [STATIC_ACCOUNT]: new Uint8Array(),
      },
    })

    await expect(fetchAccountData(rpc, STATIC_ACCOUNT)).rejects.toThrow(
      `Account ${STATIC_ACCOUNT} exists but has no data (owner: ${addressForSeed(99)}, space: 0). Expected an initialized account with data. If this is a Squads vault or treasury address, pass the Squads multisig account address instead.`,
    )
  })

  test('fetches and decodes multiple base64 accounts while preserving missing accounts', async () => {
    const accountA = new Uint8Array([4, 5, 6])
    const accountC = new Uint8Array([7, 8, 9])
    const missingAccount = addressForSeed(4)
    const { calls, rpc } = createRpcReadClient({
      accounts: {
        [STATIC_ACCOUNT]: accountA,
        [TABLE_A]: accountC,
      },
    })

    await expect(fetchMultipleAccountData(rpc, [STATIC_ACCOUNT, missingAccount, TABLE_A])).resolves.toEqual([
      accountA,
      null,
      accountC,
    ])
    expect(calls[0]).toEqual({
      abortSignal: expect.any(AbortSignal),
      addresses: [address(STATIC_ACCOUNT), address(missingAccount), address(TABLE_A)],
      config: { encoding: 'base64' },
      method: 'getMultipleAccounts',
    })
  })

  test('returns an empty result without calling RPC for an empty multiple-account batch', async () => {
    const { calls, rpc } = createRpcReadClient()

    await expect(fetchMultipleAccountData(rpc, [])).resolves.toEqual([])
    expect(calls).toEqual([])
  })

  test('fetches balance and latest blockhash', async () => {
    const blockhash = blockhashForSeed(77)
    const { calls, rpc } = createRpcReadClient({
      balance: 123n,
      blockhash,
      lastValidBlockHeight: 456n,
    })

    await expect(fetchBalance(rpc, STATIC_ACCOUNT, { commitment: 'confirmed' })).resolves.toBe(123n)
    await expect(fetchLatestBlockhash(rpc, { commitment: 'processed' })).resolves.toEqual({
      blockhash,
      lastValidBlockHeight: 456n,
    })
    expect(calls.slice(0, 2)).toEqual([
      {
        abortSignal: expect.any(AbortSignal),
        address: address(STATIC_ACCOUNT),
        config: { commitment: 'confirmed' },
        method: 'getBalance',
      },
      {
        abortSignal: expect.any(AbortSignal),
        config: { commitment: 'processed' },
        method: 'getLatestBlockhash',
      },
    ])
  })

  test('simulates a base64 transaction with replacement blockhash enabled', async () => {
    const { calls, rpc } = createRpcReadClient()

    await expect(simulateTransaction(rpc, 'AQID', { commitment: 'confirmed' })).resolves.toEqual({
      accounts: null,
      err: null,
      logs: ['ok'],
      replacementBlockhash: {
        blockhash: blockhashForSeed(88),
        lastValidBlockHeight: 1n,
      },
      returnData: null,
    })
    expect(calls[0]).toEqual({
      abortSignal: expect.any(AbortSignal),
      config: { commitment: 'confirmed', encoding: 'base64', replaceRecentBlockhash: true },
      method: 'simulateTransaction',
      transaction: 'AQID',
    })
  })

  test('translates timed out aborts into source-compatible RPC timeout errors', async () => {
    await expect(sendRpcRequest((signal) => waitForAbort(signal), { timeoutMs: 1 })).rejects.toThrow(
      'RPC request timed out (1ms)',
    )
  })
})

describe('Squads RPC fetch helpers', () => {
  test('fetches and deserializes a multisig account', async () => {
    const { rpc } = createRpcReadClient({
      accounts: {
        [STATIC_ACCOUNT]: buildMultisigAccount(),
      },
    })

    await expect(fetchMultisig(rpc, STATIC_ACCOUNT)).resolves.toMatchObject({
      bump: 8,
      createKey: addressForSeed(30),
      threshold: 2,
      transactionIndex: 3n,
    })
  })

  test('fetches proposal batches newest first and skips missing or invalid proposal accounts', async () => {
    const proposal3 = await getProposalAddress(STATIC_ACCOUNT, 3)
    const proposal2 = await getProposalAddress(STATIC_ACCOUNT, 2)
    const proposal1 = await getProposalAddress(STATIC_ACCOUNT, 1)
    const { calls, rpc } = createRpcReadClient({
      accounts: {
        [proposal1]: buildProposalAccount(1n),
        [proposal3]: buildProposalAccount(3n),
        [proposal2]: new Uint8Array([1, 2, 3]),
      },
    })

    await expect(fetchProposalBatch(rpc, STATIC_ACCOUNT, 1, 3)).resolves.toMatchObject([
      { transactionIndex: 3n },
      { transactionIndex: 1n },
    ])
    expect(calls[0]).toMatchObject({
      addresses: [address(proposal3), address(proposal2), address(proposal1)],
      method: 'getMultipleAccounts',
    })
  })

  test('fetches a vault transaction and resolves address table lookups', async () => {
    const transactionPda = await getTransactionAddress(STATIC_ACCOUNT, 1)
    const lookupAddress = addressForSeed(70)
    const lookedUpWritable = addressForSeed(71)
    const lookedUpReadonly = addressForSeed(72)
    const { rpc } = createRpcReadClient({
      accounts: {
        [transactionPda]: buildVaultTransactionAccount({
          lookupAddress,
          multisigAddress: STATIC_ACCOUNT,
        }),
      },
      lookupTables: {
        [lookupAddress]: [lookedUpReadonly, lookedUpWritable],
      },
    })

    await expect(fetchTransaction(rpc, STATIC_ACCOUNT, 1)).resolves.toMatchObject({
      message: {
        accountKeys: [STATIC_ACCOUNT, lookedUpWritable, lookedUpReadonly],
      },
      type: 'vault',
    })
  })

  test('fetches a batch transaction with parseable inner transactions', async () => {
    const transactionPda = await getTransactionAddress(STATIC_ACCOUNT, 5)
    const inner1Pda = await getBatchTransactionAddress(STATIC_ACCOUNT, 5, 1)
    const inner2Pda = await getBatchTransactionAddress(STATIC_ACCOUNT, 5, 2)
    const { rpc } = createRpcReadClient({
      accounts: {
        [inner1Pda]: buildVaultBatchTransactionAccount(),
        [inner2Pda]: new Uint8Array([1, 2, 3]),
        [transactionPda]: buildBatchAccount({ size: 2 }),
      },
    })

    await expect(fetchTransaction(rpc, STATIC_ACCOUNT, 5)).resolves.toMatchObject({
      innerTransactions: [{ innerIndex: 1, subtype: 'batch', type: 'vault' }],
      size: 2,
      type: 'batch',
    })
  })
})

describe('resolveAddressTableLookups', () => {
  test('does nothing when the message has no address table lookups', async () => {
    const { calls, rpc } = createLookupTableRpc({})
    const message: TransactionMessageWithAddressTableLookups = {
      accountKeys: [STATIC_ACCOUNT],
      addressTableLookups: [],
    }

    await resolveAddressTableLookups(rpc, message)

    expect(calls).toEqual([])
    expect(message.accountKeys).toEqual([STATIC_ACCOUNT])
  })

  test('does nothing when the message omits address table lookups', async () => {
    const { calls, rpc } = createLookupTableRpc({})
    const message: TransactionMessageWithAddressTableLookups = {
      accountKeys: [STATIC_ACCOUNT],
    }

    await resolveAddressTableLookups(rpc, message)

    expect(calls).toEqual([])
    expect(message.accountKeys).toEqual([STATIC_ACCOUNT])
  })

  test('fetches lookup tables with Kit RPC and appends writable keys before readonly keys', async () => {
    const abortController = new AbortController()
    const tableA0 = addressForSeed(10)
    const tableA1 = addressForSeed(11)
    const tableA2 = addressForSeed(12)
    const tableB0 = addressForSeed(20)
    const tableB1 = addressForSeed(21)
    const tableB2 = addressForSeed(22)
    const tableAAddresses = [tableA0, tableA1, tableA2]
    const tableBAddresses = [tableB0, tableB1, tableB2]
    const { calls, rpc } = createLookupTableRpc({
      [TABLE_A]: tableAAddresses,
      [TABLE_B]: tableBAddresses,
    })
    const message: TransactionMessageWithAddressTableLookups = {
      accountKeys: [STATIC_ACCOUNT],
      addressTableLookups: [
        {
          accountKey: TABLE_A,
          readonlyIndexes: [0],
          writableIndexes: [1, 9],
        },
        {
          accountKey: TABLE_B,
          readonlyIndexes: [1, 8],
          writableIndexes: [2],
        },
      ],
    }

    await resolveAddressTableLookups(rpc, message, {
      abortSignal: abortController.signal,
      commitment: 'confirmed',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      abortSignal: expect.any(AbortSignal),
      addresses: [address(TABLE_A), address(TABLE_B)],
      config: { commitment: 'confirmed', encoding: 'jsonParsed' },
    })
    expect(message.accountKeys).toEqual([STATIC_ACCOUNT, tableA1, '?', tableA0, tableB2, tableB1, '?'])
  })

  test('applies timeout protection to lookup table fetches', async () => {
    const rpc = {
      getMultipleAccounts() {
        return {
          send(options?: { abortSignal?: AbortSignal }) {
            return waitForAbort(options?.abortSignal ?? new AbortController().signal)
          },
        }
      },
    } as unknown as Rpc<GetMultipleAccountsApi>
    const message: TransactionMessageWithAddressTableLookups = {
      accountKeys: [STATIC_ACCOUNT],
      addressTableLookups: [
        {
          accountKey: TABLE_A,
          readonlyIndexes: [],
          writableIndexes: [],
        },
      ],
    }

    await expect(resolveAddressTableLookups(rpc, message, { timeoutMs: 1 })).rejects.toThrow(
      'RPC request timed out (1ms)',
    )
  })
})

function addressForSeed(seed: number): Address {
  return address(encodeBase58(new Uint8Array(32).fill(seed)))
}

async function getBatchTransactionAddress(multisigAddress: string, batchIndex: number, transactionIndex: number) {
  const [pdaBytes] = await getBatchTransactionPda(multisigAddress, batchIndex, transactionIndex)

  return encodeBase58(pdaBytes)
}

async function getProposalAddress(multisigAddress: string, index: number) {
  const [pdaBytes] = await getProposalPda(multisigAddress, index)

  return encodeBase58(pdaBytes)
}

async function getTransactionAddress(multisigAddress: string, index: number) {
  const [pdaBytes] = await getTransactionPda(multisigAddress, index)

  return encodeBase58(pdaBytes)
}

function base64ForBytes(bytes: Uint8Array): string {
  return BASE64_DECODER.decode(bytes)
}

function blockhashForSeed(seed: number): Blockhash {
  return encodeBase58(new Uint8Array(32).fill(seed)) as Blockhash
}

function createRpcReadClient(
  config: {
    accounts?: Record<string, Uint8Array>
    balance?: bigint
    blockhash?: Blockhash
    lastValidBlockHeight?: bigint
    lookupTables?: Record<string, readonly Address[]>
  } = {},
) {
  const calls: RpcReadCall[] = []
  const rpc = {
    getAccountInfo(accountAddress: Address, rpcConfig?: unknown) {
      return {
        async send(options?: { abortSignal?: AbortSignal }) {
          const data = config.accounts?.[accountAddress]

          calls.push({
            abortSignal: options?.abortSignal,
            address: accountAddress,
            config: rpcConfig,
            method: 'getAccountInfo',
          })

          return {
            context: { slot: 1n },
            value: data ? encodedAccount(data) : null,
          }
        },
      }
    },
    getBalance(accountAddress: Address, rpcConfig?: unknown) {
      return {
        async send(options?: { abortSignal?: AbortSignal }) {
          calls.push({
            abortSignal: options?.abortSignal,
            address: accountAddress,
            config: rpcConfig,
            method: 'getBalance',
          })

          return {
            context: { slot: 1n },
            value: config.balance ?? 0n,
          }
        },
      }
    },
    getLatestBlockhash(rpcConfig?: unknown) {
      return {
        async send(options?: { abortSignal?: AbortSignal }) {
          calls.push({
            abortSignal: options?.abortSignal,
            config: rpcConfig,
            method: 'getLatestBlockhash',
          })

          return {
            context: { slot: 1n },
            value: {
              blockhash: config.blockhash ?? blockhashForSeed(88),
              lastValidBlockHeight: config.lastValidBlockHeight ?? 1n,
            },
          }
        },
      }
    },
    getMultipleAccounts(accountAddresses: readonly Address[], rpcConfig?: unknown) {
      return {
        async send(options?: { abortSignal?: AbortSignal }) {
          const accountData = accountAddresses.map((accountAddress) => config.accounts?.[accountAddress] ?? null)
          const isJsonParsedLookupTableRequest =
            typeof rpcConfig === 'object' &&
            rpcConfig !== null &&
            'encoding' in rpcConfig &&
            rpcConfig.encoding === 'jsonParsed'

          calls.push({
            abortSignal: options?.abortSignal,
            addresses: accountAddresses,
            config: rpcConfig,
            method: 'getMultipleAccounts',
          })

          return {
            context: { slot: 1n },
            value: isJsonParsedLookupTableRequest
              ? accountAddresses.map((lookupTableAddress) =>
                  parsedLookupTable(config.lookupTables?.[lookupTableAddress] ?? []),
                )
              : accountData.map((data) => (data ? encodedAccount(data) : null)),
          }
        },
      }
    },
    simulateTransaction(transaction: string, rpcConfig?: unknown) {
      return {
        async send(options?: { abortSignal?: AbortSignal }) {
          calls.push({
            abortSignal: options?.abortSignal,
            config: rpcConfig,
            method: 'simulateTransaction',
            transaction,
          })

          return {
            context: { slot: 1n },
            value: {
              accounts: null,
              err: null,
              logs: ['ok'],
              replacementBlockhash: {
                blockhash: config.blockhash ?? blockhashForSeed(88),
                lastValidBlockHeight: config.lastValidBlockHeight ?? 1n,
              },
              returnData: null,
            },
          }
        },
      }
    },
  } as unknown as Rpc<
    GetAccountInfoApi & GetBalanceApi & GetLatestBlockhashApi & GetMultipleAccountsApi & SimulateTransactionApi
  >

  return { calls, rpc }
}

function createLookupTableRpc(lookupTables: Record<string, readonly Address[]>) {
  const calls: GetMultipleAccountsCall[] = []
  const rpc = {
    getMultipleAccounts(addresses: readonly Address[], config?: unknown) {
      return {
        async send(options?: { abortSignal?: AbortSignal }) {
          calls.push({ abortSignal: options?.abortSignal, addresses, config })

          return {
            context: { slot: 1n },
            value: addresses.map((lookupTableAddress) => ({
              data: {
                parsed: {
                  info: {
                    addresses: lookupTables[lookupTableAddress] ?? [],
                  },
                  type: 'lookupTable',
                },
                program: 'address-lookup-table',
              },
              executable: false,
              lamports: 0n,
              owner: addressForSeed(99),
              space: 0n,
            })),
          }
        },
      }
    },
  } as unknown as Rpc<GetMultipleAccountsApi>

  return { calls, rpc }
}

function encodedAccount(data: Uint8Array) {
  return {
    data: [base64ForBytes(data), 'base64'],
    executable: false,
    lamports: 0n,
    owner: addressForSeed(99),
    space: BigInt(data.length),
  }
}

function buildBatchAccount({ size }: { size: number }): Uint8Array {
  return new BorshWriter()
    .writeBytes(BATCH_DISCRIMINATOR)
    .writePubkeyAddress(STATIC_ACCOUNT)
    .writePubkey(41)
    .writeU64(5n)
    .writeU8(1)
    .writeU8(2)
    .writeU8(3)
    .writeU32(size)
    .writeU32(0)
    .toBytes()
}

function buildMultisigAccount(): Uint8Array {
  return new BorshWriter()
    .writeBytes(MULTISIG_DISCRIMINATOR)
    .writePubkey(30)
    .writePubkey(31)
    .writeU16(2)
    .writeU32(0)
    .writeU64(3n)
    .writeU64(0n)
    .writeU8(0)
    .writeU8(8)
    .writeVec<number>([], (item, writer) => writer.writeU8(item))
    .toBytes()
}

function buildProposalAccount(transactionIndex: bigint): Uint8Array {
  return new BorshWriter()
    .writeBytes(PROPOSAL_DISCRIMINATOR)
    .writePubkeyAddress(STATIC_ACCOUNT)
    .writeU64(transactionIndex)
    .writeU8(1)
    .writeI64(100n)
    .writeU8(9)
    .writeVec<number>([], (item, writer) => writer.writeU8(item))
    .writeVec<number>([], (item, writer) => writer.writeU8(item))
    .writeVec<number>([], (item, writer) => writer.writeU8(item))
    .toBytes()
}

function buildTransactionMessage({
  accountKeys = [],
  lookupAddress,
}: {
  accountKeys?: readonly string[]
  lookupAddress?: string
} = {}): BorshWriter {
  const writer = new BorshWriter()
    .writeU8(1)
    .writeU8(0)
    .writeU8(0)
    .writeVec(accountKeys, (accountKey, nestedWriter) => nestedWriter.writePubkeyAddress(accountKey))
    .writeVec<number>([], (item, nestedWriter) => nestedWriter.writeU8(item))

  if (!lookupAddress) {
    return writer.writeVec<number>([], (item, nestedWriter) => nestedWriter.writeU8(item))
  }

  return writer.writeVec([lookupAddress], (accountKey, nestedWriter) => {
    nestedWriter.writePubkeyAddress(accountKey).writeVecU8([1]).writeVecU8([0])
  })
}

function buildVaultBatchTransactionAccount(): Uint8Array {
  return new BorshWriter()
    .writeBytes(VAULT_BATCH_TX_DISC)
    .writeU8(12)
    .writeVecU8([])
    .writeBytes(buildTransactionMessage().toBytes())
    .toBytes()
}

function buildVaultTransactionAccount({
  lookupAddress,
  multisigAddress,
}: {
  lookupAddress: string
  multisigAddress: string
}): Uint8Array {
  return new BorshWriter()
    .writeBytes(VAULT_TX_DISCRIMINATOR)
    .writePubkeyAddress(multisigAddress)
    .writePubkey(40)
    .writeU64(1n)
    .writeU8(2)
    .writeU8(3)
    .writeU8(4)
    .writeVecU8([])
    .writeBytes(buildTransactionMessage({ accountKeys: [multisigAddress], lookupAddress }).toBytes())
    .toBytes()
}

function decodeAddress(accountAddress: string): Uint8Array {
  return new Uint8Array(ADDRESS_ENCODER.encode(address(accountAddress)))
}

function parsedLookupTable(addresses: readonly Address[]) {
  return {
    data: {
      parsed: {
        info: { addresses },
        type: 'lookupTable',
      },
      program: 'address-lookup-table',
    },
    executable: false,
    lamports: 0n,
    owner: addressForSeed(99),
    space: 0n,
  }
}

function pubkeyBytes(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed)
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      rejectAbort()
      return
    }

    signal.addEventListener('abort', rejectAbort, { once: true })

    function rejectAbort() {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }
  })
}
