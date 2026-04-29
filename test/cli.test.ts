import { describe, expect, test } from 'bun:test'
import { runCli } from '../src/cli.ts'

describe('CLI', () => {
  test('prints help by default', async () => {
    const output = createOutput()
    let createdClient = false

    await runCli([], {
      createSolanaClient() {
        createdClient = true

        return { rpc: {} } as never
      },
      env: { SOLANA_ENDPOINT: 'https://rpc.example.com' },
      stderr: output.stderr,
      stdout: output.stdout,
    })

    expect(createdClient).toBe(false)
    expect(output.text()).toContain('Usage: multisig-verifier [options] [command]')
    expect(output.text()).toContain('Commands:')
    expect(output.text()).toContain('health')
  })

  test('prints multisig summaries as JSON', async () => {
    const output = createOutput()

    await runCli(['--json', 'multisig', 'multisig-address'], {
      createSolanaClient: createMockClient,
      async fetchMultisig(_rpc, multisigAddress, config) {
        expect(multisigAddress).toBe('multisig-address')
        expect(config).toMatchObject({ commitment: 'confirmed' })

        return {
          members: [{ key: 'member-a', permissions: ['Vote'], permissionsMask: 2 }],
          staleTransactionIndex: 2n,
          threshold: 1,
          transactionIndex: 3n,
        } as never
      },
      stderr: output.stderr,
      stdout: output.stdout,
    })

    expect(JSON.parse(output.text())).toEqual({
      address: 'multisig-address',
      multisig: {
        members: [{ key: 'member-a', permissions: ['Vote'], permissionsMask: 2 }],
        staleTransactionIndex: '2',
        threshold: 1,
        transactionIndex: '3',
      },
    })
  })

  test('uses mainnet-beta as the default RPC URL', async () => {
    const output = createOutput()
    let rpcUrl = ''

    await runCli(['health'], {
      createSolanaClient({ url }) {
        rpcUrl = url

        return {
          rpc: {
            getSlot() {
              return {
                async send() {
                  return 123n
                },
              }
            },
          },
        } as never
      },
      env: {},
      stderr: output.stderr,
      stdout: output.stdout,
    })

    expect(rpcUrl).toBe('https://api.mainnet-beta.solana.com')
    expect(output.text()).toBe('Connected to https://api.mainnet-beta.solana.com\nCurrent slot: 123\n')
  })

  test('fetches recent proposals using the requested limit', async () => {
    const output = createOutput()

    await runCli(['proposals', 'multisig-address', '--limit', '2'], {
      createSolanaClient: createMockClient,
      async fetchMultisig() {
        return { transactionIndex: 5n } as never
      },
      async fetchProposalBatch(_rpc, multisigAddress, fromIndex, toIndex) {
        expect(multisigAddress).toBe('multisig-address')
        expect(fromIndex).toBe(4)
        expect(toIndex).toBe(5)

        return [
          {
            approved: ['member-a'],
            cancelled: [],
            index: 5,
            rejected: [],
            status: { name: 'Active', tag: 1, timestamp: 10n },
          },
        ] as never
      },
      stderr: output.stderr,
      stdout: output.stdout,
    })

    expect(output.text()).toContain('Proposals for multisig-address')
    expect(output.text()).toContain('#5 Active approvals=1 rejections=0 cancellations=0')
  })

  test('prints decoded transaction instruction summaries', async () => {
    const output = createOutput()

    await runCli(['transaction', 'multisig-address', '9'], {
      createSolanaClient: createMockClient,
      decodeInstruction(programId, data, accountKeys, accountIndexes) {
        expect(programId).toBe('program-address')
        expect(data).toEqual(new Uint8Array([1, 2]))
        expect(accountKeys).toEqual(['account-address', 'program-address'])
        expect(accountIndexes).toEqual([0])

        return {
          action: 'Transfer',
          description: 'Transfer funds',
          details: {},
          program: 'System Program',
          rawHex: '01 02',
          type: 'decoded',
        }
      },
      async fetchTransaction(_rpc, multisigAddress, index) {
        expect(multisigAddress).toBe('multisig-address')
        expect(index).toBe(9n)

        return {
          message: {
            accountKeys: ['account-address', 'program-address'],
            addressTableLookups: [],
            instructions: [{ accountIndexes: [0], data: new Uint8Array([1, 2]), programIdIndex: 1 }],
            numSigners: 1,
            numWritableNonSigners: 0,
            numWritableSigners: 1,
          },
          type: 'vault',
        } as never
      },
      stderr: output.stderr,
      stdout: output.stdout,
    })

    expect(output.text()).toContain('Transaction #9')
    expect(output.text()).toContain('Instruction 1: System Program Transfer')
  })
})

function createMockClient() {
  return { rpc: {} } as never
}

function createOutput() {
  let value = ''
  const output = {
    write(chunk: string) {
      value += chunk

      return true
    },
  }

  return {
    stderr: output,
    stdout: output,
    text() {
      return value
    },
  }
}
