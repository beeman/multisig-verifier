import {
  type Address,
  address,
  type Base64EncodedWireTransaction,
  type FetchAccountsConfig,
  fetchAddressesForLookupTables,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  type GetAccountInfoApi,
  type GetBalanceApi,
  type GetLatestBlockhashApi,
  type GetMultipleAccountsApi,
  type Rpc,
  type SimulateTransactionApi,
} from '@solana/kit'
import {
  deserializeMultisig,
  deserializeProposal,
  deserializeTransaction,
  deserializeVaultBatchTransaction,
  encodeBase58,
  getBatchTransactionPda,
  getProposalPda,
  getTransactionPda,
} from './squads.ts'

export const RPC_TIMEOUT = 10_000

export type AddressTableLookup = {
  accountKey: string
  readonlyIndexes: number[]
  writableIndexes: number[]
}

export type TransactionMessageWithAddressTableLookups = {
  accountKeys: string[]
  addressTableLookups?: AddressTableLookup[] | null
}

export type RpcReadConfig = FetchAccountsConfig & {
  timeoutMs?: number
}

type SquadsRpc = Rpc<GetAccountInfoApi & GetMultipleAccountsApi>

export async function fetchAccountData(
  rpc: Rpc<GetAccountInfoApi>,
  accountAddress: string,
  config: RpcReadConfig = {},
): Promise<Uint8Array> {
  const { abortSignal, timeoutMs, ...fetchConfig } = config
  const account = await sendRpcRequest(
    (signal) => fetchEncodedAccount(rpc, address(accountAddress), { ...fetchConfig, abortSignal: signal }),
    { abortSignal, timeoutMs },
  )

  if (!account.exists) {
    throw new Error(`Account not found on-chain: ${accountAddress}`)
  }

  if (account.data.length === 0) {
    throw new Error(
      `Account ${accountAddress} exists but has no data (owner: ${account.programAddress}, space: ${account.space}). Expected an initialized account with data. If this is a Squads vault or treasury address, pass the Squads multisig account address instead.`,
    )
  }

  return new Uint8Array(account.data)
}

export async function fetchMultipleAccountData(
  rpc: Rpc<GetMultipleAccountsApi>,
  accountAddresses: string[],
  config: RpcReadConfig = {},
): Promise<(Uint8Array | null)[]> {
  if (accountAddresses.length === 0) {
    return []
  }

  const { abortSignal, timeoutMs, ...fetchConfig } = config
  const accounts = await sendRpcRequest(
    (signal) =>
      fetchEncodedAccounts(
        rpc,
        accountAddresses.map((accountAddress) => address(accountAddress)),
        { ...fetchConfig, abortSignal: signal },
      ),
    { abortSignal, timeoutMs },
  )

  return accounts.map((account) => (account.exists ? new Uint8Array(account.data) : null))
}

export async function fetchBalance(
  rpc: Rpc<GetBalanceApi>,
  accountAddress: string,
  config: RpcReadConfig = {},
): Promise<bigint> {
  const { abortSignal, timeoutMs, ...rpcConfig } = config
  const result = await sendRpcRequest(
    (signal) => rpc.getBalance(address(accountAddress), rpcConfig).send({ abortSignal: signal }),
    { abortSignal, timeoutMs },
  )

  return result.value
}

export async function fetchLatestBlockhash(rpc: Rpc<GetLatestBlockhashApi>, config: RpcReadConfig = {}) {
  const { abortSignal, timeoutMs, ...rpcConfig } = config
  const result = await sendRpcRequest((signal) => rpc.getLatestBlockhash(rpcConfig).send({ abortSignal: signal }), {
    abortSignal,
    timeoutMs,
  })

  return result.value
}

export async function fetchMultisig(rpc: Rpc<GetAccountInfoApi>, multisigAddress: string, config: RpcReadConfig = {}) {
  const data = await fetchAccountData(rpc, multisigAddress, config)

  if (data.length < 8) {
    throw new Error(`Account data too short (${data.length} bytes). Expected a Squads multisig account.`)
  }

  return deserializeMultisig(data)
}

export async function fetchProposalBatch(
  rpc: Rpc<GetMultipleAccountsApi>,
  multisigAddress: string,
  fromIndex: number,
  toIndex: number,
  config: RpcReadConfig = {},
) {
  const proposalPdas = await Promise.all(
    rangeDescending(fromIndex, toIndex).map(async (index) => {
      const [pdaBytes] = await getProposalPda(multisigAddress, index)

      return { index, pda: encodeBase58(pdaBytes) }
    }),
  )
  const proposals = []

  for (let index = 0; index < proposalPdas.length; index += 100) {
    const batch = proposalPdas.slice(index, index + 100)
    const accountData = await fetchMultipleAccountData(
      rpc,
      batch.map((item) => item.pda),
      config,
    )

    for (let batchIndex = 0; batchIndex < accountData.length; batchIndex++) {
      const data = accountData[batchIndex]
      const proposal = batch[batchIndex]

      if (!data || !proposal) {
        continue
      }

      try {
        proposals.push({ index: proposal.index, ...deserializeProposal(data) })
      } catch {
        // Source behavior: skip unparseable proposal accounts.
      }
    }
  }

  return proposals
}

export async function fetchTransaction(
  rpc: SquadsRpc,
  multisigAddress: string,
  index: bigint | number,
  config: RpcReadConfig = {},
) {
  const [pdaBytes] = await getTransactionPda(multisigAddress, index)
  const data = await fetchAccountData(rpc, encodeBase58(pdaBytes), config)
  const transaction = deserializeTransaction(data)

  if (transaction.type === 'vault' && transaction.message?.addressTableLookups?.length) {
    await resolveAddressTableLookups(rpc, transaction.message, config)
  }

  if (transaction.type === 'batch' && transaction.size > 0) {
    const innerTransactions = await fetchInnerBatchTransactions(rpc, multisigAddress, index, transaction.size, config)

    return {
      ...transaction,
      innerTransactions,
    }
  }

  return transaction
}

/**
 * Resolve Address Lookup Table accounts and append the looked-up keys to message.accountKeys so
 * instruction account indices match Solana MessageV0 order.
 */
export async function resolveAddressTableLookups(
  rpc: Rpc<GetMultipleAccountsApi>,
  message: TransactionMessageWithAddressTableLookups,
  config: RpcReadConfig = {},
): Promise<void> {
  const lookups = message.addressTableLookups ?? []

  if (lookups.length === 0) {
    return
  }

  const { abortSignal, timeoutMs, ...fetchConfig } = config
  const lookupTableAddresses = lookups.map((lookup) => address(lookup.accountKey))
  const addressesByLookupTableAddress = await sendRpcRequest(
    (signal) => fetchAddressesForLookupTables(lookupTableAddresses, rpc, { ...fetchConfig, abortSignal: signal }),
    { abortSignal, timeoutMs },
  )

  for (const lookup of lookups) {
    const tableAddresses = addressesByLookupTableAddress[lookup.accountKey as Address]

    appendLookedUpKeys(message.accountKeys, tableAddresses, lookup.writableIndexes)
    appendLookedUpKeys(message.accountKeys, tableAddresses, lookup.readonlyIndexes)
  }
}

export async function sendRpcRequest<T>(
  send: (abortSignal: AbortSignal) => Promise<T>,
  config: { abortSignal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = config.timeoutMs ?? RPC_TIMEOUT
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const abort = () => controller.abort()

  if (config.abortSignal?.aborted) {
    controller.abort()
  } else {
    config.abortSignal?.addEventListener('abort', abort, { once: true })
  }

  try {
    return await send(controller.signal)
  } catch (error) {
    if (timedOut && isAbortError(error)) {
      throw new Error(`RPC request timed out (${formatTimeout(timeoutMs)})`)
    }

    throw error
  } finally {
    clearTimeout(timeout)
    config.abortSignal?.removeEventListener('abort', abort)
  }
}

export async function simulateTransaction(
  rpc: Rpc<SimulateTransactionApi>,
  base64Tx: string,
  config: RpcReadConfig = {},
) {
  const { abortSignal, timeoutMs, ...rpcConfig } = config
  const result = await sendRpcRequest(
    (signal) =>
      rpc
        .simulateTransaction(base64Tx as Base64EncodedWireTransaction, {
          ...rpcConfig,
          encoding: 'base64',
          replaceRecentBlockhash: true,
        })
        .send({ abortSignal: signal }),
    { abortSignal, timeoutMs },
  )

  return result.value
}

async function fetchInnerBatchTransactions(
  rpc: SquadsRpc,
  multisigAddress: string,
  batchIndex: bigint | number,
  size: number,
  config: RpcReadConfig,
) {
  const innerPdas = await Promise.all(
    Array.from({ length: size }, async (_value, index) => {
      const innerIndex = index + 1
      const [pdaBytes] = await getBatchTransactionPda(multisigAddress, batchIndex, innerIndex)

      return { innerIndex, pda: encodeBase58(pdaBytes) }
    }),
  )
  const accountData = await fetchMultipleAccountData(
    rpc,
    innerPdas.map((item) => item.pda),
    config,
  )
  const innerTransactions = []

  for (let index = 0; index < accountData.length; index++) {
    const data = accountData[index]
    const innerPda = innerPdas[index]

    if (!data || !innerPda) {
      continue
    }

    try {
      const innerTransaction = deserializeVaultBatchTransaction(data)

      if (innerTransaction.message?.addressTableLookups?.length) {
        await resolveAddressTableLookups(rpc, innerTransaction.message, config)
      }

      innerTransactions.push({ innerIndex: innerPda.innerIndex, ...innerTransaction })
    } catch {
      // Source behavior: skip unparseable inner batch transactions.
    }
  }

  return innerTransactions
}

function appendLookedUpKeys(
  accountKeys: string[],
  tableAddresses: Address[] | undefined,
  indexes: readonly number[],
): void {
  for (const index of indexes) {
    accountKeys.push(tableAddresses?.[index] ?? '?')
  }
}

function formatTimeout(timeoutMs: number): string {
  if (timeoutMs % 1000 === 0) {
    return `${timeoutMs / 1000}s`
  }

  return `${timeoutMs}ms`
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function rangeDescending(fromIndex: number, toIndex: number): number[] {
  const result = []

  for (let index = toIndex; index >= fromIndex; index--) {
    result.push(index)
  }

  return result
}
