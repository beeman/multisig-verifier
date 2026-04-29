import { describe, expect, test } from 'bun:test'
import { decodeInstruction, KNOWN_PROGRAMS, registerDecoder } from '../src/decode.ts'

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

describe('KNOWN_PROGRAMS', () => {
  test('maps known Solana programs to display names', () => {
    expect(KNOWN_PROGRAMS.get(SYSTEM_PROGRAM_ID)).toBe('System Program')
    expect(KNOWN_PROGRAMS.get(TOKEN_PROGRAM_ID)).toBe('SPL Token')
    expect(KNOWN_PROGRAMS.get('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf')).toBe('Squads v4')
  })
})

describe('decodeInstruction', () => {
  test('uses registered custom decoders', () => {
    const programId = 'CustomProgram111111111111111111111111111111'

    registerDecoder(programId, () => ({
      action: 'CustomAction',
      description: 'Custom description',
      details: { custom: true },
    }))

    expect(decodeInstruction(programId, new Uint8Array([1, 2, 3]), [], [])).toEqual({
      action: 'CustomAction',
      description: 'Custom description',
      details: { custom: true },
      program: programId,
      rawHex: '01 02 03',
      type: 'decoded',
    })
  })

  test('falls back to raw display when a decoder rejects', () => {
    const programId = 'RejectProgram111111111111111111111111111111'

    registerDecoder(programId, () => {
      throw new Error('nope')
    })

    expect(decodeInstruction(programId, new Uint8Array([4, 5, 6]), [], [])).toEqual({
      isKnown: false,
      program: programId,
      rawHex: '04 05 06',
      type: 'unknown',
    })
  })

  test('falls back to raw display for known programs with unsupported instructions', () => {
    expect(decodeInstruction(TOKEN_PROGRAM_ID, new Uint8Array([99]), [], [])).toEqual({
      isKnown: true,
      program: 'SPL Token',
      rawHex: '63',
      type: 'unknown',
    })
  })
})

describe('SPL Token decoder', () => {
  test('decodes transfer instructions', () => {
    expect(
      decodeInstruction(
        TOKEN_PROGRAM_ID,
        tokenTransferData(123n),
        ['source-account', 'destination-account', 'authority-account'],
        [0, 1, 2],
      ),
    ).toEqual({
      action: 'Transfer',
      description: 'Transfer 123 tokens',
      details: {
        amount: '123',
        authority: 'authority-account',
        destination: 'destination-account',
        source: 'source-account',
      },
      program: 'SPL Token',
      rawHex: '03 7b 00 00 00 00 00 00 00',
      type: 'decoded',
    })
  })

  test('decodes transfer checked instructions without losing integer precision', () => {
    expect(
      decodeInstruction(
        TOKEN_PROGRAM_ID,
        tokenTransferCheckedData(1_234_567_890_123_456_789n, 9),
        ['source-account', 'mint-account', 'destination-account'],
        [0, 1, 2],
      ),
    ).toEqual({
      action: 'TransferChecked',
      description: 'Transfer 1234567890.123456789 tokens',
      details: {
        amount: '1234567890123456789',
        amountFormatted: '1234567890.123456789',
        decimals: 9,
        destination: 'destination-account',
        mint: 'mint-account',
        source: 'source-account',
      },
      program: 'SPL Token',
      rawHex: '0c 15 81 e9 7d f4 10 22 11 09',
      type: 'decoded',
    })
  })
})

describe('System Program decoder', () => {
  test('decodes create account instructions', () => {
    expect(
      decodeInstruction(
        SYSTEM_PROGRAM_ID,
        systemCreateAccountData({
          lamports: 2_500_000_000n,
          space: 165n,
        }),
        ['funding-account'],
        [0],
      ),
    ).toEqual({
      action: 'CreateAccount',
      description: 'Create account with 2.5000 SOL',
      details: {
        lamports: '2500000000',
        owner: 'cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN',
        space: '165',
      },
      program: 'System Program',
      rawHex:
        '00 00 00 00 00 f9 02 95 00 00 00 00 a5 00 00 00 00 00 00 00 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09',
      type: 'decoded',
    })
  })

  test('decodes transfer instructions', () => {
    expect(
      decodeInstruction(SYSTEM_PROGRAM_ID, systemTransferData(1_500_000_000n), ['from-account', 'to-account'], [0, 1]),
    ).toEqual({
      action: 'Transfer',
      description: 'Transfer 1.5000 SOL',
      details: {
        from: 'from-account',
        lamports: '1500000000',
        solAmount: 1.5,
        to: 'to-account',
      },
      program: 'System Program',
      rawHex: '02 00 00 00 00 2f 68 59 00 00 00 00',
      type: 'decoded',
    })
  })
})

function systemCreateAccountData({ lamports, space }: { lamports: bigint; space: bigint }): Uint8Array {
  const bytes = new Uint8Array(52)
  const view = new DataView(bytes.buffer)

  view.setUint32(0, 0, true)
  view.setBigUint64(4, lamports, true)
  view.setBigUint64(12, space, true)
  bytes.set(new Uint8Array(32).fill(9), 20)

  return bytes
}

function systemTransferData(lamports: bigint): Uint8Array {
  const bytes = new Uint8Array(12)
  const view = new DataView(bytes.buffer)

  view.setUint32(0, 2, true)
  view.setBigUint64(4, lamports, true)

  return bytes
}

function tokenTransferCheckedData(amount: bigint, decimals: number): Uint8Array {
  const bytes = tokenTransferData(amount, 10)

  bytes[0] = 12
  bytes[9] = decimals

  return bytes
}

function tokenTransferData(amount: bigint, length = 9): Uint8Array {
  const bytes = new Uint8Array(length)

  bytes[0] = 3
  new DataView(bytes.buffer).setBigUint64(1, amount, true)

  return bytes
}
