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

### Current Phase: Phase 1 - Foundation

**Completed**:
- ✅ Monorepo structure with pnpm workspaces
- ✅ TypeScript configuration
- ✅ Vitest test setup
- ✅ Vite build configuration
- ✅ PWA plugin setup

**Next Steps**:
1. Implement crypto module (keypair, symmetric encryption, signatures)
2. Implement storage module (IndexedDB wrapper)
3. Write comprehensive unit tests

## Documentation

- [DESIGN.md](./DESIGN.md) - Complete product specification
- [PLAN.md](./PLAN.md) - Detailed implementation plan
- [packages/server/README.md](./packages/server/README.md) - Server setup guide

## License

Private - Not open source
