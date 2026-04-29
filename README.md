# multisig-verifier

TypeScript library and CLI for inspecting [Squads Protocol v4](https://squads.so) multisigs on Solana.

It reads Squads v4 accounts directly from Solana RPC using [`@solana/kit`](https://github.com/anza-xyz/kit), deserializes the on-chain account data, decodes common proposal instructions, and builds unsigned approve or reject transactions for a host application to sign.

This package is intended to be used as a library. It does not include browser UI, persistent app state, or Wallet Standard integration; those responsibilities belong to the integrating application.

## What Is Here

- **Account decoding**: Squads v4 multisig, proposal, batch, config transaction, vault transaction, and vault batch transaction deserializers.
- **Address helpers**: base58 helpers, display formatting, Squads program constants, and PDA derivation for vaults, proposals, transactions, and batch transactions.
- **CLI**: Commander-based inspection commands for health checks, multisig summaries, proposal lists, and transaction summaries.
- **Instruction decoding**: built-in decoders for common System Program and SPL Token instructions, plus a registry for custom decoders.
- **RPC helpers**: Solana Kit account reads, proposal batching, transaction lookup, Address Lookup Table resolution, blockhash lookup, balance reads, simulation, and timeout handling.
- **Transaction assembly**: unsigned Squads approve and reject vote transaction construction, plus v0 message serialization helpers.

## What Is Not Here

- Browser UI or rendering components.
- Squads backend integration for member-to-multisig discovery.
- Vault-to-multisig resolution through the Squads API.
- Wallet discovery, wallet connection, signing, or transaction submission UI.

## Where It Comes From

This package is a TypeScript migration of the core library logic from [`Solana-Multisig-Tools/multisig-verifier`](https://github.com/Solana-Multisig-Tools/multisig-verifier).

The original project was a static browser verifier for Squads v4 multisigs. This package keeps the reusable pieces that are useful for integrating apps:

- account layouts and discriminators;
- approval and rejection instruction data;
- instruction decoding patterns;
- proposal and transaction loading flows;
- Squads PDA derivation;
- transaction message serialization behavior.

The browser application layer from the source project was intentionally left out. Host apps should provide their own UI, wallet adapter, persistence, and backend integrations.

## Installation

```bash
bun add multisig-verifier
```

```bash
npm install multisig-verifier
```

```bash
pnpm add multisig-verifier
```

## Library Usage

Create or reuse a Solana Kit RPC client:

```typescript
import { createSolanaClient } from 'multisig-verifier'

const client = createSolanaClient({
  url: 'https://api.mainnet-beta.solana.com',
})
```

Fetch a multisig and recent proposals:

```typescript
import { fetchMultisig, fetchProposalBatch } from 'multisig-verifier'

const multisigAddress = '4BguL6FeZcQa6aTJ1exomoBMDh5uUV6NfiXaYb8H1uuT'
const multisig = await fetchMultisig(client.rpc, multisigAddress)
const latestIndex = Number(multisig.transactionIndex)
const proposals = await fetchProposalBatch(client.rpc, multisigAddress, Math.max(1, latestIndex - 19), latestIndex)
```

Fetch and inspect a transaction account:

```typescript
import { decodeInstruction, fetchTransaction } from 'multisig-verifier'

const transaction = await fetchTransaction(client.rpc, multisigAddress, 6)

if (transaction.type === 'vault') {
  for (const instruction of transaction.message.instructions) {
    const programId = transaction.message.accountKeys[instruction.programIdIndex]
    const decoded = decodeInstruction(
      programId,
      instruction.data,
      transaction.message.accountKeys,
      instruction.accountIndexes,
    )

    console.log(decoded)
  }
}
```

Build an unsigned vote transaction for the host wallet to sign:

```typescript
import { buildVoteTransaction } from 'multisig-verifier'

const approve = true
const memberAddress = '...'
const proposalIndex = 6
const transactionBytes = await buildVoteTransaction(multisigAddress, memberAddress, proposalIndex, approve, client.rpc)
```

## CLI

The CLI defaults to `https://api.mainnet-beta.solana.com`. Override it with `--rpc` or `SOLANA_ENDPOINT`.

```bash
multisig-verifier
```

```bash
multisig-verifier health
```

```bash
multisig-verifier multisig 4BguL6FeZcQa6aTJ1exomoBMDh5uUV6NfiXaYb8H1uuT
```

```bash
multisig-verifier proposals 4BguL6FeZcQa6aTJ1exomoBMDh5uUV6NfiXaYb8H1uuT --limit 20
```

```bash
multisig-verifier transaction 4BguL6FeZcQa6aTJ1exomoBMDh5uUV6NfiXaYb8H1uuT 6 --json
```

During local development, run the source entrypoint directly:

```bash
bun run ./src/cli.ts
```

## Exports

- `buildVoteTransaction`
- `createSolanaClient`
- `decodeInstruction`
- `fetchAccountData`
- `fetchBalance`
- `fetchLatestBlockhash`
- `fetchMultisig`
- `fetchMultipleAccountData`
- `fetchProposalBatch`
- `fetchTransaction`
- `getBatchTransactionPda`
- `getExplorerUrl`
- `getMultisigVaultPda`
- `getProposalPda`
- `getTransactionPda`
- `getWsUrl`
- `registerDecoder`
- `resolveAddressTableLookups`
- `serializeTransactionMessage`
- `simulateTransaction`
- Squads constants, discriminators, address helpers, and transaction serialization helpers

## Development

```bash
bun install
bun run build
bun run check-types
bun run lint
bun run test
```

E2E tests use [Surfpool](https://github.com/txtx/surfpool) through [`@beeman/testcontainers`](https://github.com/beeman/testcontainers), so Docker must be running:

```bash
bun run test:e2e
```

## License

MIT - see [LICENSE](./LICENSE).

This package ports code and behavior from [`Solana-Multisig-Tools/multisig-verifier`](https://github.com/Solana-Multisig-Tools/multisig-verifier), whose source is also available under the MIT license. The original source repository also includes an Apache-2.0 license option.
