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
- **CRDT**: Loro for conflict-free sync
- **Storage**: IndexedDB (client), PocketBase (server)
- **Crypto**: WebCrypto API
- **Testing**: Vitest

## Implementation Status

See [PLAN.md](./PLAN.md) for the complete implementation roadmap.

### Current Phase: Phase 2 - Local CRDT & Data Models

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
- ✅ 91 total tests passing, 100% type safety

**Next Steps (Phase 2)**:
1. Implement Loro CRDT wrapper with two-layer encryption
2. Implement balance calculation engine
3. Create entry operation handlers (create, modify, delete)

## Documentation

- [DESIGN.md](./DESIGN.md) - Complete product specification
- [PLAN.md](./PLAN.md) - Detailed implementation plan
- [packages/server/README.md](./packages/server/README.md) - Server setup guide

## License

Private - Not open source
