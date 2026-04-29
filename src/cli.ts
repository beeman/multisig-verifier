#!/usr/bin/env bun

import { Command, CommanderError } from 'commander'
import { decodeInstruction } from './decode.ts'
import { createSolanaClient } from './lib/create-solana-client.ts'
import { fetchMultisig, fetchProposalBatch, fetchTransaction, type RpcReadConfig } from './rpc.ts'

const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com'

type CliServices = {
  createSolanaClient: typeof createSolanaClient
  decodeInstruction: typeof decodeInstruction
  env: Record<string, string | undefined>
  fetchMultisig: typeof fetchMultisig
  fetchProposalBatch: typeof fetchProposalBatch
  fetchTransaction: typeof fetchTransaction
  stderr: Pick<typeof process.stderr, 'write'>
  stdout: Pick<typeof process.stdout, 'write'>
}

type GlobalOptions = {
  commitment: RpcReadConfig['commitment']
  json?: boolean
  rpc: string
  timeout?: number
}

const DEFAULT_SERVICES: CliServices = {
  createSolanaClient,
  decodeInstruction,
  env: process.env,
  fetchMultisig,
  fetchProposalBatch,
  fetchTransaction,
  stderr: process.stderr,
  stdout: process.stdout,
}

export function createCli(overrides: Partial<CliServices> = {}): Command {
  const services = { ...DEFAULT_SERVICES, ...overrides }
  const program = new Command()

  program
    .name('multisig-verifier')
    .description('Inspect Squads v4 multisig accounts and proposals')
    .option('--rpc <url>', 'Solana RPC URL', services.env.SOLANA_ENDPOINT ?? DEFAULT_RPC_URL)
    .option('--commitment <level>', 'RPC commitment level', 'confirmed')
    .option('--timeout <ms>', 'RPC timeout in milliseconds', parsePositiveInteger)
    .option('--json', 'Print JSON output')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeErr: (value) => services.stderr.write(value),
      writeOut: (value) => services.stdout.write(value),
    })

  program
    .command('health')
    .description('Check RPC connectivity')
    .action(async function (this: Command) {
      const options = getGlobalOptions(this)
      const client = services.createSolanaClient({ url: options.rpc })
      const slot = await client.rpc.getSlot().send()

      writeOutput(services, options, { rpcUrl: options.rpc, slot }, [
        `Connected to ${options.rpc}`,
        `Current slot: ${slot}`,
      ])
    })

  program
    .command('multisig')
    .description('Fetch and summarize a Squads multisig account')
    .argument('<address>', 'Squads multisig address')
    .action(async function (this: Command, multisigAddress: string) {
      const options = getGlobalOptions(this)
      const client = services.createSolanaClient({ url: options.rpc })
      const multisig = await services.fetchMultisig(client.rpc, multisigAddress, getRpcReadConfig(options))

      writeOutput(services, options, { address: multisigAddress, multisig }, [
        `Multisig ${multisigAddress}`,
        `Threshold: ${multisig.threshold}`,
        `Members: ${multisig.members.length}`,
        `Transaction index: ${multisig.transactionIndex}`,
        `Stale transaction index: ${multisig.staleTransactionIndex}`,
      ])
    })

  program
    .command('proposals')
    .description('Fetch recent proposals for a Squads multisig')
    .argument('<multisig>', 'Squads multisig address')
    .option('--limit <n>', 'Maximum proposals to fetch', parsePositiveInteger, 20)
    .action(async function (this: Command, multisigAddress: string) {
      const commandOptions = this.opts<{ limit: number }>()
      const options = getGlobalOptions(this)
      const client = services.createSolanaClient({ url: options.rpc })
      const config = getRpcReadConfig(options)
      const multisig = await services.fetchMultisig(client.rpc, multisigAddress, config)
      const latestIndex = Number(multisig.transactionIndex)
      const limit = commandOptions.limit
      const proposals =
        latestIndex > 0
          ? await services.fetchProposalBatch(
              client.rpc,
              multisigAddress,
              Math.max(1, latestIndex - limit + 1),
              latestIndex,
              config,
            )
          : []

      writeOutput(services, options, { address: multisigAddress, latestIndex, proposals }, [
        `Proposals for ${multisigAddress}`,
        proposals.length === 0
          ? 'No proposals found.'
          : proposals
              .map(
                (proposal) =>
                  `#${proposal.index} ${proposal.status.name} approvals=${proposal.approved.length} rejections=${proposal.rejected.length} cancellations=${proposal.cancelled.length}`,
              )
              .join('\n'),
      ])
    })

  program
    .command('transaction')
    .description('Fetch and summarize a Squads transaction account')
    .argument('<multisig>', 'Squads multisig address')
    .argument('<index>', 'Transaction index')
    .action(async function (this: Command, multisigAddress: string, index: string) {
      const options = getGlobalOptions(this)
      const client = services.createSolanaClient({ url: options.rpc })
      const transactionIndex = parseTransactionIndex(index)
      const transaction = await services.fetchTransaction(
        client.rpc,
        multisigAddress,
        transactionIndex,
        getRpcReadConfig(options),
      )

      writeOutput(services, options, { index: transactionIndex, multisigAddress, transaction }, [
        `Transaction #${transactionIndex.toString()}`,
        ...summarizeTransaction(transaction, services),
      ])
    })

  return program
}

export async function runCli(argv = process.argv.slice(2), overrides: Partial<CliServices> = {}): Promise<void> {
  const services = { ...DEFAULT_SERVICES, ...overrides }
  const program = createCli(services)

  try {
    if (argv.length === 0) {
      program.outputHelp()

      return
    }

    await program.parseAsync(argv, { from: 'user' })
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code !== 'commander.helpDisplayed') {
        process.exitCode = error.exitCode
      }
      return
    }

    process.exitCode = 1
    services.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  }
}

function getGlobalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>()
}

function getRpcReadConfig(options: GlobalOptions): RpcReadConfig {
  return {
    commitment: options.commitment,
    timeoutMs: options.timeout,
  }
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CommanderError(1, 'commander.invalidArgument', `Expected a positive integer, received "${value}"`)
  }

  return parsed
}

function parseTransactionIndex(value: string): bigint {
  try {
    const parsed = BigInt(value)

    if (parsed < 0n) {
      throw new Error('negative')
    }

    return parsed
  } catch {
    throw new CommanderError(1, 'commander.invalidArgument', `Expected a non-negative integer, received "${value}"`)
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue) => {
      if (typeof nestedValue === 'bigint') {
        return nestedValue.toString()
      }

      if (nestedValue instanceof Uint8Array) {
        return Array.from(nestedValue)
      }

      return nestedValue
    },
    2,
  )
}

function summarizeTransaction(
  transaction: Awaited<ReturnType<typeof fetchTransaction>>,
  services: CliServices,
): string[] {
  if (transaction.type === 'vault') {
    const instructionLines = transaction.message.instructions.map((instruction, index) => {
      const programId = transaction.message.accountKeys[instruction.programIdIndex] ?? '?'
      const decoded = services.decodeInstruction(
        programId,
        instruction.data,
        transaction.message.accountKeys,
        instruction.accountIndexes,
      )

      return decoded.type === 'decoded'
        ? `Instruction ${index + 1}: ${decoded.program} ${decoded.action}`
        : `Instruction ${index + 1}: ${decoded.program} unknown`
    })

    return [
      `Type: ${'subtype' in transaction && transaction.subtype === 'batch' ? 'vault batch transaction' : 'vault transaction'}`,
      `Accounts: ${transaction.message.accountKeys.length}`,
      `Instructions: ${transaction.message.instructions.length}`,
      ...instructionLines,
    ]
  }

  if (transaction.type === 'batch') {
    return [
      'Type: batch',
      `Size: ${transaction.size}`,
      `Inner transactions: ${'innerTransactions' in transaction ? transaction.innerTransactions.length : 0}`,
    ]
  }

  if (transaction.type === 'config') {
    return ['Type: config transaction', `Actions: ${transaction.actions.length}`]
  }

  return [`Type: ${transaction.type}`]
}

function writeOutput(
  services: CliServices,
  options: GlobalOptions,
  jsonValue: unknown,
  humanLines: readonly string[],
): void {
  services.stdout.write(`${options.json ? stringifyJson(jsonValue) : humanLines.join('\n')}\n`)
}

if (isDirectCliExecution()) {
  runCli().catch((error) => {
    process.exitCode = 1
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  })
}

function isDirectCliExecution(): boolean {
  return /(^|[/\\])(cli\.(cjs|mjs|ts)|multisig-verifier)$/.test(process.argv[1] ?? '')
}
