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
├── docs/
│   ├── DESIGN.md            # Product specification
│   └── PLAN.md             # Implementation plan
```

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 10.0.0

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

This creates production-ready static files in `packages/client/dist/`.

### Deployment

For production deployment instructions, see [DEPLOYMENT.md](./docs/DEPLOYMENT.md).

**Quick summary:**

- Deploy PocketBase server separately (port 8090)
- Build the client with `VITE_POCKETBASE_URL` environment variable
- Deploy static files from `packages/client/dist/`

**Dokploy/Railpack:** Set environment variables:

```bash
VITE_POCKETBASE_URL=https://your-pocketbase-url
RAILPACK_SPA_OUTPUT_DIR=packages/client/dist
```

## Architecture

### Security & Privacy

- **End-to-end encryption**: All data encrypted with AES-256-GCM
- **Zero-knowledge server**: Server only relays encrypted CRDT operations
- **Local-first**: Offline-capable with IndexedDB storage
- **Cryptographic identity**: No passwords, keypair-based authentication
- **Anti-spam protection**: Proof-of-Work challenge required for group creation

### Tech Stack

- **Frontend**: SolidJS, Vite, TypeScript
- **CRDT**: Loro for conflict-free sync (https://loro.dev/llms.txt)
- **Storage**: IndexedDB (client), PocketBase (server)
- **Crypto**: WebCrypto API
- **Testing**: Vitest

### Performance Optimizations

The application implements a **CQRS (Command Query Responsibility Segregation)** pattern with incremental updates for optimal performance:

- **Incremental balance updates**: Balance calculations are commutative, enabling O(k) updates for k new entries instead of O(n) full recalculation
- **Entry caching**: Decrypted entries are cached; only new entries are decrypted on updates
- **Member state caching**: Canonical ID maps and member states are cached and invalidated only when member events change
- **Sorted activity insertion**: Activities are inserted in O(log n) time instead of regenerating the full list

See [docs/PERFORMANCE-ANALYSIS.md](./docs/PERFORMANCE-ANALYSIS.md) for detailed analysis and implementation.

## Implementation Status

See [PLAN.md](./docs/PLAN.md) for the complete implementation roadmap.

### Current Phase: Phase 8 - Polish & Production 🔄

**Recent Updates** (January 18, 2026):

- ✅ Proof-of-Work anti-spam protection for group creation
  - Server-side challenge/response with HMAC-signed challenges
  - Client-side SHA-256 computation (~2-4 seconds to solve)
  - One PoW = one group (unique constraint prevents reuse)
  - PocketBase hooks validate PoW before group creation
- ✅ Simplified authentication model
  - Removed user accounts (no login/registration required)
  - Group users created automatically with derived passwords
  - Password derived from group key for seamless authentication

**Previous Updates** (January 13, 2026):

- ✅ Spanish language support (full translation)
- ✅ Language selector with flags
- ✅ Global footer with GitHub repository link
- ✅ Toast notifications for relevant activities

**Phase 7 - Simplified Trusted Group Join: ✅ COMPLETED** (January 12, 2026)

- ✅ Single group key (no rotation) embedded in URL fragment
- ✅ Member alias system for claiming virtual member identities
- ✅ Balance calculations with alias resolution
- ✅ Simplified invite flow with instant join
- ✅ QR code support for invite links
- ✅ Activity feed for join events
- ✅ Export/import functionality for groups
- ✅ Fixed member display across all UI components

**Phase 6 - Advanced Features: ✅ COMPLETED** (January 7, 2026)

- ✅ Entry modification with versioning UI
- ✅ Entry soft deletion with undo
- ✅ Activity feed showing recent changes
- ✅ Filtering and search for entries
- ✅ Multi-currency support with exchange rates
- ✅ Settlement suggestions with debt optimization
- ✅ Export/import functionality (JSON)
- ✅ Incremental snapshot storage (performance optimization)

**Phase 5 - Multi-User Features: ✅ COMPLETED** (January 7, 2026)

- ✅ Invitation link generation and sharing
- ✅ Secure public key exchange (ECDH + ECDSA)
- ✅ Join group via invite link flow
- ✅ Real-time join request approvals
- ✅ Encrypted group key distribution
- ✅ Historical key sharing for new members
- ✅ PocketBase collections (invitations, join_requests, key_packages)
- ✅ AppContext integration complete
- ✅ Router integration (@solidjs/router)
- ✅ Signing keypair auto-generation
- ✅ Build successful

**Phase 4 - Server & Sync: ✅ COMPLETED** (January 6, 2026)

- ✅ PocketBase server setup with encrypted operations collection
- ✅ API client with real-time subscriptions
- ✅ Sync manager with online/offline detection
- ✅ Multi-device synchronization via Loro CRDTs
- ✅ Operation queue for offline support
- ✅ Conflict resolution through CRDT merge
- ✅ Tested multi-client sync (multiple browser tabs)

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
- ✅ Production build: 82.32 KB JS, 6.26 KB CSS (gzipped)
- ✅ 0 TypeScript errors, full type safety
- ✅ Internationalization: English, French, Spanish

**Phase 2 - Local CRDT & Data Models: ✅ COMPLETED** (January 4, 2026)

- ✅ Loro CRDT wrapper with two-layer encryption
  - Metadata stored in Loro (unencrypted): id, timestamp, actor, version, status
  - Sensitive data encrypted with AES-256-GCM: amounts, descriptions, member details
  - Entry operations: create, modify (versioning), soft delete
  - Snapshot export/import for persistence
  - Incremental sync support via version vectors
- ✅ Balance calculation engine
  - Calculate member balances from entries
  - Support for shares and exact split types
  - Multi-currency with conversion support
  - Debt graph generation (minimizes transactions)
  - Settlement plan optimization
- ✅ Full type safety

**Phase 1 - Foundation: ✅ COMPLETED** (January 4, 2026)

- ✅ Monorepo structure with pnpm workspaces
- ✅ TypeScript (v5.7.3), Vitest (v2.1.8), ESLint (v9)
- ✅ All dependencies updated to latest versions
- ✅ Cryptography module
  - AES-256-GCM symmetric encryption
  - ECDH P-256 keypair management
  - ECDSA digital signatures
- ✅ IndexedDB storage layer
  - User keypair persistence
  - Group metadata & versioned keys
  - Loro snapshot storage
  - Offline operation queue
- ✅ Shared TypeScript types (crypto, group, member, entry, balance)

**Next Steps (Phase 8)**:

1. PWA push notifications for background activity alerts
2. Recursive member linking (link real members, not only virtual)
3. Error handling and loading states
4. Security audit

## Documentation

- [DESIGN.md](./docs/DESIGN.md) - Complete product specification
- [PLAN.md](./docs/PLAN.md) - Detailed implementation plan
- [DEPLOYMENT.md](./docs/DEPLOYMENT.md) - Production deployment guide
- [PERFORMANCE-ANALYSIS.md](./docs/PERFORMANCE-ANALYSIS.md) - Performance analysis and optimizations
- [packages/server/README.md](./packages/server/README.md) - Server setup guide

## License

Apache 2.0 - See [LICENSE](./LICENSE) file for details
