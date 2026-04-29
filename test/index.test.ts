import { describe, expect, test } from 'bun:test'
import {
  buildVoteTransaction,
  createSolanaClient,
  decodeInstruction,
  deserializeTransaction,
  fetchMultisig,
  getExplorerUrl,
  getWsUrl,
  serializeTransactionMessage,
} from '../src/index.ts'

describe('action exports', () => {
  test('exports vote transaction building', () => {
    expect(buildVoteTransaction).toBeFunction()
  })
})

describe('getWsUrl', () => {
  test('converts https:// to wss://', () => {
    expect(getWsUrl('https://api.devnet.solana.com')).toBe('wss://api.devnet.solana.com')
  })

  test('converts http:// to ws://', () => {
    expect(getWsUrl('http://localhost:8899')).toBe('ws://localhost:8900')
  })

  test('maps port 8899 to 8900', () => {
    expect(getWsUrl('http://127.0.0.1:8899')).toBe('ws://127.0.0.1:8900')
  })

  test('leaves non-8899 ports unchanged', () => {
    expect(getWsUrl('https://custom-rpc.example.com:443')).toBe('wss://custom-rpc.example.com:443')
  })
})

describe('createSolanaClient', () => {
  test('returns a client with rpc and rpcSubscriptions', () => {
    const client = createSolanaClient({ url: 'https://api.devnet.solana.com' })
    expect(client.rpc).toBeDefined()
    expect(client.rpcSubscriptions).toBeDefined()
  })
})

describe('getExplorerUrl', () => {
  test('returns correct URL for devnet', () => {
    expect(getExplorerUrl('tx/abc123', 'devnet')).toBe('https://explorer.solana.com/tx/abc123?cluster=devnet')
  })

  test('returns correct URL for mainnet-beta (no cluster param)', () => {
    expect(getExplorerUrl('account/abc123', 'mainnet-beta')).toBe('https://explorer.solana.com/account/abc123')
  })
})

describe('squads exports', () => {
  test('exports transaction account deserialization', () => {
    expect(deserializeTransaction).toBeFunction()
  })
})

describe('decode exports', () => {
  test('exports instruction decoding', () => {
    expect(decodeInstruction).toBeFunction()
  })
})

describe('rpc exports', () => {
  test('exports account fetching', () => {
    expect(fetchMultisig).toBeFunction()
  })
})

describe('transaction exports', () => {
  test('exports transaction message serialization', () => {
    expect(serializeTransactionMessage).toBeFunction()
  })
})
