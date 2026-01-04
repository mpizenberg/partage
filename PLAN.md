# Implementation Plan: Partage Bill-Splitting Application

## Overview
Set up a monorepo structure for a fully encrypted, local-first bill-splitting PWA using SolidJS, Loro CRDTs, and PocketBase.

## User Preferences
- **Monorepo**: pnpm workspaces with both client and server
- **UI**: Minimalist raw CSS (no component library), mobile-first
- **Testing**: Vitest for unit tests
- **Tech Stack**: TypeScript, SolidJS, Vite, PocketBase

## Project Structure

```
/partage
├── pnpm-workspace.yaml
├── package.json
├── /packages
│   ├── /client                    # SolidJS PWA
│   │   ├── /src
│   │   │   ├── /core              # Core business logic
│   │   │   │   ├── /crypto        # WebCrypto operations
│   │   │   │   ├── /crdt          # Loro CRDT wrapper
│   │   │   │   ├── /sync          # Sync engine
│   │   │   │   └── /storage       # IndexedDB wrapper
│   │   │   ├── /domain            # Domain models & calculations
│   │   │   ├── /api               # PocketBase client
│   │   │   └── /ui                # Components & screens
│   │   └── /tests
│   ├── /shared                    # Shared TypeScript types
│   └── /server                    # PocketBase setup
```

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
**Goal**: Core cryptography and storage infrastructure

**Tasks**:
1. Set up pnpm monorepo structure
2. Configure TypeScript, Vitest
3. Install dependencies: Loro, SolidJS, Vite, PocketBase client
4. Implement crypto module (`/packages/client/src/core/crypto/`):
   - `keypair.ts`: User identity (ECDH keypair generation/export/import)
   - `symmetric.ts`: AES-256-GCM encryption/decryption
   - `signatures.ts`: Digital signatures (ECDSA)
5. Implement storage module (`/packages/client/src/core/storage/indexeddb.ts`):
   - User keypair storage
   - Group metadata
   - Group keys (versioned)
   - Loro snapshots
   - Pending operations queue
6. Write comprehensive unit tests (100% coverage for crypto)

**Critical Files**:
- `/packages/client/src/core/crypto/symmetric.ts`
- `/packages/client/src/core/storage/indexeddb.ts`

**Deliverable**: Can generate keys, encrypt/decrypt, store in IndexedDB

### Phase 2: Local CRDT & Data Models (Weeks 3-4)
**Goal**: Loro integration and local data operations

**Tasks**:
1. Define shared types (`/packages/shared/src/types/`):
   - `group.ts`, `member.ts`, `entry.ts`, `balance.ts`
2. Implement Loro wrapper (`/packages/client/src/core/crdt/loro-wrapper.ts`):
   - Two-layer approach: Loro for metadata, encrypted payloads for sensitive data
   - Entry operations: create, modify, delete
   - Versioning system for modifications
3. Implement balance calculator (`/packages/client/src/domain/calculations/`):
   - Calculate balances from entries
   - Debt graph computation
   - Settlement plan optimization
4. Write unit tests for CRDT and calculations

**Critical Files**:
- `/packages/client/src/core/crdt/loro-wrapper.ts`
- `/packages/shared/src/types/entry.ts`
- `/packages/client/src/domain/calculations/balance-calculator.ts`

**Deliverable**: Can create encrypted entries in Loro, calculate balances locally

### Phase 3: Basic UI (Weeks 5-6)
**Goal**: Local-only MVP with working UI

**Tasks**:
1. Set up SolidJS app with Vite
2. Create base CSS structure (mobile-first)
3. Implement screens:
   - Group creation
   - Entry creation form (expense & transfer)
   - Entry list view
   - Balance overview
4. Wire up UI to local CRDT operations
5. Test single-user flows end-to-end

**Deliverable**: Working MVP for single user, no sync

### Phase 4: Server & Sync (Weeks 7-10)
**Goal**: Multi-device synchronization

**Tasks**:
1. Set up PocketBase server (`/packages/server/`):
   - Collections schema for encrypted operations
   - Real-time subscriptions
2. Implement API client (`/packages/client/src/api/pocketbase-client.ts`)
3. Implement sync manager (`/packages/client/src/core/sync/sync-manager.ts`):
   - Push local operations to server
   - Pull and apply remote operations
   - Online/offline detection
   - Operation queue for offline support
   - Conflict resolution via Loro CRDTs
4. Test multi-client sync (multiple browser tabs)

**Critical Files**:
- `/packages/client/src/core/sync/sync-manager.ts`
- `/packages/client/src/api/pocketbase-client.ts`

**Deliverable**: Two browser tabs can sync changes in real-time

### Phase 5: Multi-User Features (Weeks 11-12)
**Goal**: Enable group collaboration

**Tasks**:
1. Invite link generation and joining flow
2. Member identification (new vs existing)
3. Public key exchange
4. Group key versioning and rotation
5. Member management UI
6. Historical key sharing for recovery

**Deliverable**: Multiple users can join groups and collaborate

### Phase 6: Advanced Features (Weeks 13-16)
**Goal**: Complete feature set

**Tasks**:
1. Entry modification with versioning
2. Entry soft deletion
3. Activity feed
4. Filtering and search
5. Multi-currency support with exchange rates
6. Settlement suggestions (debt optimization)
7. Export functionality (JSON)
8. PWA service worker for offline

**Deliverable**: Full-featured application

### Phase 7: Polish (Weeks 17-20)
**Goal**: Production readiness

**Tasks**:
1. Error handling and loading states
2. Mobile UX refinement
3. User onboarding flow
4. Security audit
5. Performance optimization
6. Deployment setup

## Critical Technical Decisions

### 1. Encrypted Data in Loro
**Approach**: Two-layer structure
- Loro stores metadata (id, timestamp, actor, version) - unencrypted
- Sensitive data stored as encrypted payload (Base64 string) - encrypted with AES-256-GCM
- Signatures verify authenticity
- Server relays Loro updates without seeing content

### 2. Versioning System
**Pattern**: Immutable entries with version references
- Each modification creates new version
- `previousVersionId` links to prior version
- All versions retained for audit trail
- UI shows latest version, can view history

### 3. Currency Handling
**Strategy**: Store both original and converted amounts
- Capture exchange rate at transaction time
- Store: `amount` (original), `currency`, `defaultCurrencyAmount`, `exchangeRate`
- Balance calculations use `defaultCurrencyAmount`
- Historical accuracy preserved

### 4. Key Management
**Flow**:
- User keypair: Generated on first launch, stored in IndexedDB
- Group keys: Versioned, rotated on member join/leave
- Historical keys: Retained for decrypting old data
- Key sharing: Encrypted with recipient's public key

### 5. Sync Protocol
**Design**:
- Server: Append-only log of encrypted operations
- Client: Subscribe to real-time updates via PocketBase
- Offline: Queue operations locally, sync on reconnect
- Conflicts: Loro CRDT handles automatically

## Testing Strategy

### Unit Tests (Vitest)
- **Crypto**: 100% coverage, test vectors, tampering detection
- **Storage**: IndexedDB operations, key persistence
- **CRDT**: Concurrent operations, convergence
- **Calculations**: Balance computation, edge cases

### Integration Tests
- Entry creation flow (UI → crypto → CRDT → storage)
- Multi-client sync scenarios
- Offline/online transitions
- Key rotation flows

### Mock Strategy
- Mock PocketBase for sync testing
- Mock IndexedDB for storage testing
- Test data generators for large datasets

## Development Sequence

**Week 1-2**: Foundation
- Monorepo setup, crypto module, storage module, tests

**Week 3-4**: Local CRDT
- Data models, Loro wrapper, balance calculations, tests

**Week 5-6**: Basic UI
- SolidJS app, CSS, screens, local-only MVP

**Week 7-10**: Server & Sync
- PocketBase setup, API client, sync manager, multi-client testing

**Week 11-12**: Multi-User
- Invite/join flows, key exchange, member management

**Week 13-16**: Advanced Features
- Entry lifecycle, activity feed, multi-currency, settlement, PWA

**Week 17-20**: Polish & Launch
- Error handling, UX refinement, security audit, deployment

## Critical Files to Implement First

1. `/packages/client/src/core/crypto/symmetric.ts` - Foundation for all security
2. `/packages/client/src/core/crdt/loro-wrapper.ts` - Core data synchronization
3. `/packages/client/src/core/storage/indexeddb.ts` - Local persistence
4. `/packages/client/src/core/sync/sync-manager.ts` - Multi-device coordination
5. `/packages/shared/src/types/entry.ts` - Core data model

## Next Steps

1. Create monorepo structure with pnpm workspaces
2. Set up package.json files with dependencies
3. Configure TypeScript and Vitest
4. Begin Phase 1: Implement crypto module with tests
