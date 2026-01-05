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

### Current Phase: Phase 4 - Server & Sync

**Phase 3 - Basic UI: ✅ COMPLETED** (January 5, 2026)
- ✅ SolidJS PWA with Vite and VitePWA plugin
- ✅ Mobile-first CSS design system (variables, layout, components)
- ✅ Application state management with SolidJS Context API
- ✅ Complete screen implementations:
  - SetupScreen: Automatic keypair generation on first launch
  - GroupSelectionScreen & CreateGroupScreen: Group management
  - GroupViewScreen: Tab navigation (Balance/Entries)
  - AddEntryModal: Expense/Transfer forms with validation
- ✅ Entry components:
  - EntryList: Date-grouped chronological display
  - EntryCard: Category emojis, payer/beneficiary info, user share
- ✅ Balance components:
  - BalanceCard: Color-coded net balances
  - SettlementPlan: One-click settlement with optimized transfers
- ✅ Form features:
  - Expense: Multi-member splits (shares/exact), advanced options
  - Transfer: Direct member-to-member payments
  - Real-time validation and amount calculations
- ✅ Virtual members: Name-only tracking for MVP (no keypairs)
- ✅ Production build: 73.82 KB JS, 23.82 KB CSS (gzipped)
- ✅ 0 TypeScript errors, full type safety

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

**Next Steps (Phase 4)**:
1. Set up PocketBase server with collections schema
2. Implement API client for encrypted operations
3. Build sync manager with online/offline detection
4. Test multi-device real-time synchronization

## Documentation

- [DESIGN.md](./DESIGN.md) - Complete product specification
- [PLAN.md](./PLAN.md) - Detailed implementation plan
- [packages/server/README.md](./packages/server/README.md) - Server setup guide

## License

Private - Not open source
