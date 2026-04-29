import { describe, expect, test } from 'bun:test'
import {
  AccountRole,
  buildUnsignedTransaction,
  concat,
  encodeCompactU16,
  serializeTransactionMessage,
} from '../src/transaction.ts'

describe('encodeCompactU16', () => {
  test('encodes Solana compact-u16 values', () => {
    expectBytes(encodeCompactU16(0), [0x00])
    expectBytes(encodeCompactU16(127), [0x7f])
    expectBytes(encodeCompactU16(128), [0x80, 0x01])
    expectBytes(encodeCompactU16(16_383), [0xff, 0x7f])
    expectBytes(encodeCompactU16(16_384), [0x80, 0x80, 0x01])
    expectBytes(encodeCompactU16(65_535), [0xff, 0xff, 0x03])
  })

  test('rejects values outside the compact-u16 range', () => {
    expect(() => encodeCompactU16(65_536)).toThrow()
  })
})

describe('concat', () => {
  test('concatenates byte arrays in order', () => {
    expectBytes(concat(new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])), [1, 2, 3])
  })
})

describe('AccountRole', () => {
  test('exports Solana Kit account roles', () => {
    expect(AccountRole).toMatchObject({
      READONLY: 0,
      READONLY_SIGNER: 2,
      WRITABLE: 1,
      WRITABLE_SIGNER: 3,
    })
  })
})

describe('serializeTransactionMessage', () => {
  test('serializes a v0 message with Kit account ordering and no address table lookups', () => {
    const feePayer = pubkey(1)
    const readonlySigner = pubkey(2)
    const writable = pubkey(3)
    const readonly = pubkey(4)
    const recentBlockhash = pubkey(8)
    const programId = pubkey(9)
    const message = serializeTransactionMessage({
      feePayer,
      instructions: [
        {
          accounts: [
            { pubkey: readonly, role: AccountRole.READONLY },
            { pubkey: readonlySigner, role: AccountRole.READONLY_SIGNER },
            { pubkey: writable, role: AccountRole.WRITABLE },
          ],
          data: new Uint8Array([9, 8, 7]),
          programId,
        },
      ],
      recentBlockhash,
    })

    expectBytes(message.slice(0, 4), [0x80, 2, 1, 2])
    expect(message[4]).toBe(5)

    const accountKeys = readPubkeys(message, 5, 5)
    expect(accountKeys).toEqual([feePayer, readonlySigner, writable, programId, readonly])

    let offset = 5 + 5 * 32
    expectBytes(message.slice(offset, offset + 32), Array.from(recentBlockhash))
    offset += 32

    expect(message[offset]).toBe(1)
    offset += 1
    expectBytes(message.slice(offset, offset + 7), [3, 3, 4, 1, 2, 3, 9])
    offset += 7
    expectBytes(message.slice(offset, offset + 2), [8, 7])
    offset += 2
    expect(message[offset]).toBe(0)
    offset += 1
    expect(offset).toBe(message.length)
  })

  test('rejects invalid public key byte lengths', () => {
    expect(() =>
      serializeTransactionMessage({
        feePayer: new Uint8Array(31),
        instructions: [],
        recentBlockhash: pubkey(1),
      }),
    ).toThrow('feePayer must be 32 bytes')
  })
})

describe('buildUnsignedTransaction', () => {
  test('wraps message bytes with zeroed signature slots', () => {
    const messageBytes = new Uint8Array([0x80, 1, 0, 0])
    const transaction = buildUnsignedTransaction(messageBytes, 2)

    expect(transaction).toHaveLength(1 + 64 * 2 + messageBytes.length)
    expect(transaction[0]).toBe(2)
    expect(transaction.slice(1, 129)).toEqual(new Uint8Array(128))
    expect(transaction.slice(129)).toEqual(messageBytes)
  })

  test('uses compact-u16 for the signature count', () => {
    const transaction = buildUnsignedTransaction(new Uint8Array([0x80]), 128)

    expectBytes(transaction.slice(0, 2), [0x80, 0x01])
  })
})

function expectBytes(actual: Uint8Array, expected: number[]): void {
  expect(Array.from(actual)).toEqual(expected)
}

function pubkey(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed)
}

function readPubkeys(bytes: Uint8Array, offset: number, count: number): Uint8Array[] {
  return Array.from({ length: count }, (_value, index) => bytes.slice(offset + index * 32, offset + (index + 1) * 32))
}
