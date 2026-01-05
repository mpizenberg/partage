# Partage - Bill Splitting Application

Fully encrypted, local-first bill-splitting PWA using SolidJS, Loro CRDTs, and PocketBase.

## Project Structure

This is a pnpm monorepo with three packages:

```
partage/
├── packages/
│   ├── client/          # SolidJS PWA (main application)
│   ├── shared/          # Shared TypeScript types and constants
│   └── server/          # PocketBase server setup
├── DESIGN.md            # Product specification
└── PLAN.md             # Implementation plan
```

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0

### Installation

```bash
# Install dependencies for all packages
pnpm install
```

### Development

```bash
# Run the client dev server
pnpm dev

# Run tests across all packages
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type checking
pnpm typecheck

# Lint all packages
pnpm lint

# Format code
pnpm format
```

### Building

```bash
# Build all packages
pnpm build
```

## Architecture

### Security & Privacy
- **End-to-end encryption**: All data encrypted with AES-256-GCM
- **Zero-knowledge server**: Server only relays encrypted CRDT operations
- **Local-first**: Offline-capable with IndexedDB storage
- **Cryptographic identity**: No passwords, keypair-based authentication

### Tech Stack
- **Frontend**: SolidJS, Vite, TypeScript
- **CRDT**: Loro for conflict-free sync (https://loro.dev/llms.txt)
- **Storage**: IndexedDB (client), PocketBase (server)
- **Crypto**: WebCrypto API
- **Testing**: Vitest

## Implementation Status

See [PLAN.md](./PLAN.md) for the complete implementation roadmap.

### Current Phase: Phase 3 - Basic UI

**Phase 2 - Local CRDT & Data Models: ✅ COMPLETED** (January 4, 2026)
- ✅ Loro CRDT wrapper with two-layer encryption: 17 tests passing
  - Metadata stored in Loro (unencrypted): id, timestamp, actor, version, status
  - Sensitive data encrypted with AES-256-GCM: amounts, descriptions, member details
  - Entry operations: create, modify (versioning), soft delete
  - Snapshot export/import for persistence
  - Incremental sync support via version vectors
- ✅ Balance calculation engine: 21 tests passing
  - Calculate member balances from entries
  - Support for shares and exact split types
  - Multi-currency with conversion support
  - Debt graph generation (minimizes transactions)
  - Settlement plan optimization
- ✅ 129 total tests passing, 100% type safety

**Phase 1 - Foundation: ✅ COMPLETED** (January 4, 2026)
- ✅ Monorepo structure with pnpm workspaces
- ✅ TypeScript (v5.7.3), Vitest (v2.1.8), ESLint (v9)
- ✅ All dependencies updated to latest versions
- ✅ Cryptography module: 58 tests passing
  - AES-256-GCM symmetric encryption
  - ECDH P-256 keypair management
  - ECDSA digital signatures
- ✅ IndexedDB storage layer: 33 tests passing
  - User keypair persistence
  - Group metadata & versioned keys
  - Loro snapshot storage
  - Offline operation queue
- ✅ Shared TypeScript types (crypto, group, member, entry, balance)

**Next Steps (Phase 3)**:
1. Set up SolidJS app with Vite
2. Create base CSS structure (mobile-first)
3. Implement screens: group creation, entry forms, balance overview
4. Wire up UI to local CRDT operations

## Documentation

- [DESIGN.md](./DESIGN.md) - Complete product specification
- [PLAN.md](./PLAN.md) - Detailed implementation plan
- [packages/server/README.md](./packages/server/README.md) - Server setup guide

## License

Private - Not open source
