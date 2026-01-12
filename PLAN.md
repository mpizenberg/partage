# Implementation Plan: Partage Bill-Splitting Application

## Overview
Set up a monorepo structure for a fully encrypted, local-first bill-splitting PWA using SolidJS, Loro CRDTs, and PocketBase.

## User Preferences
- **Monorepo**: pnpm workspaces with both client and server
- **UI**: Minimalist raw CSS (no component library), mobile-first
- **Testing**: Vitest for unit tests
- **Tech Stack**: TypeScript, SolidJS, Vite, PocketBase

## Implementation Status

**Current Phase**: Phase 6 - Advanced Features
**Last Updated**: January 7, 2026

### Completed
- ✅ **Phase 5**: Multi-User Features (100% complete)
  - Invite link generation and joining flow
  - Public key exchange protocol (ECDH + ECDSA)
  - Group key versioning and rotation on member join
  - Real-time subscriptions for join requests and key packages
  - Multi-device sync with proper Loro CRDT merging
  - Fixed subscription management (callback-based routing)
  - Fixed Loro map handle refresh after remote updates
  - Fixed causal dependencies for cross-peer sync
  - 140 tests passing, 0 TypeScript errors

- ✅ **Phase 4**: Server & Sync (100% complete)
  - PocketBase server setup with encrypted operations collection
  - API client with real-time subscriptions
  - Sync manager with online/offline detection
  - Multi-device synchronization via Loro CRDTs
  - Operation queue for offline support
  - Conflict resolution through CRDT merge

- ✅ **Phase 3**: Basic UI (100% complete)
  - SolidJS PWA application with Vite
  - Mobile-first CSS design system
  - Complete screen implementations (Setup, Groups, Entries, Balance)
  - Form components with validation (Expense/Transfer)
  - Real-time balance calculations and settlement plans
  - Virtual member support (name-only for MVP)
  - Production build: 73.82 KB JS, 23.82 KB CSS (gzipped)
  - 0 TypeScript errors

- ✅ **Phase 2**: Local CRDT & Data Models (100% complete)
  - Loro CRDT wrapper with two-layer encryption (17 tests)
  - Balance calculation engine (21 tests)
  - Entry operations: create, modify, delete
  - Total: 129 tests passing

- ✅ **Phase 1**: Foundation & Infrastructure (100% complete)
  - Monorepo setup with pnpm workspaces
  - Full cryptography module with 58 tests
  - IndexedDB storage layer with 33 tests
  - Shared TypeScript types (crypto, group, member, entry, balance)
  - All dependencies updated to latest versions

### In Progress
- 🔄 **Phase 6**: Advanced Features

### Upcoming
- ⏳ Phase 7: Polish & Production

## Project Structure

```
/partage
├── pnpm-workspace.yaml
├── package.json
├── /packages
│   ├── /client                    # SolidJS PWA
│   │   ├── /src
│   │   │   ├── main.tsx           # App bootstrap ✅
│   │   │   ├── App.tsx            # Root component with routing ✅
│   │   │   ├── /core              # Core business logic
│   │   │   │   ├── /crypto        # WebCrypto operations ✅
│   │   │   │   ├── /crdt          # Loro CRDT wrapper ✅
│   │   │   │   ├── /sync          # Sync engine
│   │   │   │   └── /storage       # IndexedDB wrapper ✅
│   │   │   ├── /domain            # Domain models & calculations ✅
│   │   │   ├── /api               # PocketBase client
│   │   │   └── /ui                # Components & screens ✅
│   │   │       ├── /context       # AppContext ✅
│   │   │       ├── /screens       # Screen components ✅
│   │   │       ├── /components    # UI components ✅
│   │   │       │   ├── /common    # Button, Input, Modal, etc. ✅
│   │   │       │   ├── /forms     # Entry forms ✅
│   │   │       │   ├── /balance   # Balance display ✅
│   │   │       │   └── /entries   # Entry display ✅
│   │   │       └── /styles        # CSS files ✅
│   │   ├── /tests                 # Test files ✅
│   │   └── vite.config.ts         # Vite + PWA config ✅
│   ├── /shared                    # Shared TypeScript types ✅
│   └── /server                    # PocketBase setup
```

## Implementation Phases

### Phase 1: Foundation ✅ COMPLETED
**Goal**: Core cryptography and storage infrastructure

**Status**: ✅ **100% Complete** (January 4, 2026)

**Completed Tasks**:
1. ✅ Set up pnpm monorepo structure with workspaces
2. ✅ Configure TypeScript (v5.7.3), Vitest (v2.1.8), ESLint (v9)
3. ✅ Install and update all dependencies to latest versions
4. ✅ Implement crypto module (`/packages/client/src/core/crypto/`):
   - ✅ `keypair.ts`: ECDH P-256 keypair generation/export/import (14 tests)
   - ✅ `symmetric.ts`: AES-256-GCM encryption/decryption (20 tests)
   - ✅ `signatures.ts`: ECDSA digital signatures (24 tests)
5. ✅ Implement storage module (`/packages/client/src/core/storage/indexeddb.ts`):
   - ✅ User keypair storage
   - ✅ Group metadata management
   - ✅ Versioned group keys storage
   - ✅ Loro snapshot persistence
   - ✅ Pending operations queue for offline support
   - ✅ Full test coverage (33 tests)
6. ✅ Define shared types (`/packages/shared/src/types/`):
   - ✅ `crypto.ts`: Encryption interfaces
   - ✅ `group.ts`: Group data models
   - ✅ `member.ts`: Member types
   - ✅ `entry.ts`: Expense and transfer entries
   - ✅ `balance.ts`: Balance calculation types

**Test Results**:
- ✅ 91 tests passing (4 test files)
- ✅ 100% type safety (0 TypeScript errors)
- ✅ Crypto module: 58 tests
- ✅ Storage module: 33 tests

**Critical Files Implemented**:
- ✅ `/packages/client/src/core/crypto/symmetric.ts`
- ✅ `/packages/client/src/core/crypto/keypair.ts`
- ✅ `/packages/client/src/core/crypto/signatures.ts`
- ✅ `/packages/client/src/core/storage/indexeddb.ts`
- ✅ `/packages/shared/src/types/*.ts` (all type definitions)

**Deliverables Achieved**:
- ✅ Can generate user keypairs automatically
- ✅ Can encrypt/decrypt sensitive data with AES-256-GCM
- ✅ Can sign and verify operations with ECDSA
- ✅ Can store encrypted data persistently in IndexedDB
- ✅ Supports offline-first operation with pending queue
- ✅ Full TypeScript type safety across all modules
- ✅ Production-ready cryptography foundation

### Phase 2: Local CRDT & Data Models ✅ COMPLETED
**Goal**: Loro integration and local data operations

**Status**: ✅ **100% Complete** (January 4, 2026)

**Completed Tasks**:
1. ✅ Shared types already defined in Phase 1 (`/packages/shared/src/types/`):
   - `group.ts`, `member.ts`, `entry.ts`, `balance.ts`
2. ✅ Implemented Loro wrapper (`/packages/client/src/core/crdt/loro-wrapper.ts`):
   - Two-layer encryption: Loro stores metadata (id, version, status), encrypted payloads for sensitive data
   - Entry operations: create, modify (with versioning), soft delete
   - Snapshot export/import for persistence
   - Incremental sync support with version vectors
3. ✅ Implemented balance calculator (`/packages/client/src/domain/calculations/balance-calculator.ts`):
   - Calculate balances from entries (expenses and transfers)
   - Support for shares and exact split types
   - Multi-currency with conversion support
   - Debt graph computation (greedy algorithm minimizes transactions)
   - Settlement plan optimization with constraints
4. ✅ Comprehensive unit tests (38 tests total):
   - 17 tests for CRDT wrapper (entry creation, modification, deletion, sync)
   - 21 tests for balance calculator (splits, debt graphs, settlements)

**Test Results**:
- ✅ 129 tests passing (6 test files)
- ✅ 100% type safety (0 TypeScript errors)
- ✅ CRDT module: 17 tests
- ✅ Balance calculations: 21 tests

**Critical Files Implemented**:
- ✅ `/packages/client/src/core/crdt/loro-wrapper.ts`
- ✅ `/packages/client/src/core/crdt/loro-wrapper.test.ts`
- ✅ `/packages/client/src/domain/calculations/balance-calculator.ts`
- ✅ `/packages/client/src/domain/calculations/balance-calculator.test.ts`

**Deliverables Achieved**:
- ✅ Can create encrypted entries in Loro with two-layer encryption
- ✅ Can modify entries with version tracking
- ✅ Can soft delete entries with optional reasons
- ✅ Can calculate accurate balances from complex entry scenarios
- ✅ Can generate optimized settlement plans
- ✅ Supports multi-currency with exchange rate tracking
- ✅ Full snapshot and incremental sync capabilities

### Phase 3: Basic UI ✅ COMPLETED
**Goal**: Local-only MVP with working UI

**Status**: ✅ **100% Complete** (January 5, 2026)

**Completed Tasks**:
1. ✅ Set up SolidJS PWA with Vite and VitePWA plugin
2. ✅ Created comprehensive CSS design system:
   - `reset.css`: Browser normalization
   - `variables.css`: Design tokens (colors, spacing, typography)
   - `layout.css`: Grid, flexbox, spacing utilities
   - `components.css`: Component styles (940+ lines)
3. ✅ Implemented all screens:
   - `SetupScreen.tsx`: First-time keypair generation
   - `GroupSelectionScreen.tsx`: List and select groups
   - `CreateGroupScreen.tsx`: Group creation with virtual members
   - `GroupViewScreen.tsx`: Tab navigation (Balance/Entries), FAB
4. ✅ Built entry components:
   - `EntryList.tsx`: Date grouping (Today, Yesterday, This Week, Month/Year)
   - `EntryCard.tsx`: Category emojis, payer/beneficiary display, user share
   - `EntriesTab.tsx`: Entry list container with empty state
5. ✅ Built balance components:
   - `BalanceCard.tsx`: Color-coded net balances (green/red)
   - `SettlementPlan.tsx`: Optimized transfers with one-click settlement
   - `BalanceTab.tsx`: Complete balance overview
6. ✅ Implemented form components:
   - `AddEntryModal.tsx`: Modal with Expense/Transfer tabs
   - `ExpenseForm.tsx`: Multi-member splits (shares/exact), advanced options
   - `TransferForm.tsx`: Direct member-to-member payments
   - Real-time validation and amount calculations
7. ✅ Created reusable UI components:
   - `Button.tsx`: Primary/secondary/danger variants
   - `Input.tsx`: Text/number/date inputs with error states
   - `Select.tsx`: Dropdown with children support
   - `Modal.tsx`: Overlay with slide-up animation
   - `LoadingSpinner.tsx`: Animated loading indicator
   - `MemberManager.tsx`: Add/remove virtual members
8. ✅ Implemented AppContext:
   - Global state management with SolidJS signals/stores
   - Integration with crypto, storage, CRDT, and balance modules
   - Reactive balance calculations and settlement plans
9. ✅ Virtual member system for MVP (name-only, no keypairs)
10. ✅ PWA configuration with 5 MB cache limit for Loro WASM

**Test Results**:
- ✅ 0 TypeScript errors
- ✅ Production build successful
- ✅ Bundle sizes: 73.82 KB JS, 23.82 KB CSS (gzipped)

**Critical Files Implemented**:
- ✅ `/packages/client/src/main.tsx`
- ✅ `/packages/client/src/App.tsx`
- ✅ `/packages/client/src/ui/context/AppContext.tsx`
- ✅ `/packages/client/src/ui/screens/*.tsx` (4 screen components)
- ✅ `/packages/client/src/ui/components/balance/*.tsx` (3 components)
- ✅ `/packages/client/src/ui/components/entries/*.tsx` (3 components)
- ✅ `/packages/client/src/ui/components/forms/*.tsx` (5 components)
- ✅ `/packages/client/src/ui/components/common/*.tsx` (6 components)
- ✅ `/packages/client/src/ui/styles/*.css` (4 CSS files)
- ✅ `/packages/client/vite.config.ts` (updated for WASM)

**Deliverables Achieved**:
- ✅ Working MVP for single user, local-only
- ✅ Can generate keypair on first launch
- ✅ Can create groups with virtual members
- ✅ Can add expenses with complex splits (shares/exact)
- ✅ Can add transfers between members
- ✅ Can view real-time balance calculations
- ✅ Can see optimized settlement suggestions
- ✅ Can settle up with one click
- ✅ All data persisted locally in IndexedDB
- ✅ Responsive mobile-first design
- ✅ Full type safety across UI layer

### Phase 4: Server & Sync ✅ COMPLETED
**Goal**: Multi-device synchronization

**Status**: ✅ **100% Complete** (January 6, 2026)

**Completed Tasks**:
1. ✅ Set up PocketBase server (`/packages/server/`):
   - Collections schema for encrypted operations
   - Real-time subscriptions
2. ✅ Implemented API client (`/packages/client/src/api/pocketbase-client.ts`)
3. ✅ Implemented sync manager (`/packages/client/src/core/sync/sync-manager.ts`):
   - Push local operations to server
   - Pull and apply remote operations
   - Online/offline detection
   - Operation queue for offline support
   - Conflict resolution via Loro CRDTs
4. ✅ Tested multi-client sync (multiple browser tabs)

**Critical Files Implemented**:
- ✅ `/packages/client/src/core/sync/sync-manager.ts`
- ✅ `/packages/client/src/api/pocketbase-client.ts`

**Deliverable Achieved**: Two browser tabs can sync changes in real-time

### Phase 5: Multi-User Features
**Goal**: Enable group collaboration

**Status**: ✅ **100% Complete** (January 7, 2026)

**Completed Tasks**:
1. ✅ Invite link generation and joining flow
2. ✅ Member identification (new vs existing)
3. ✅ Public key exchange protocol (ECDH + ECDSA)
4. ✅ Group key versioning and rotation logic
5. ✅ Member management UI components
6. ✅ Historical key sharing for new members
7. ✅ PocketBase collections (invitations, join_requests, key_packages)
8. ✅ API client methods for all collections
9. ✅ Real-time subscriptions for join requests and key packages
10. ✅ Key exchange tests (9/9 passing)

**Integration Complete**:
- ✅ Added @solidjs/router for invite URLs
- ✅ Integrated invite manager with AppContext
- ✅ Wired up UI components to context methods
- ✅ Signing keypair auto-generated on setup
- ✅ All tests passing (140/140)
- ✅ Build successful (0 TypeScript errors)

**Optional Enhancements** (before production):
- Add Members tab to GroupViewScreen
- Add Invite button to header
- Multi-device testing (2+ devices)

**Critical Files Implemented**:
- ✅ `/packages/client/src/core/crypto/key-exchange.ts` (with tests)
- ✅ `/packages/client/src/domain/invitations/invite-manager.ts`
- ✅ `/packages/client/src/domain/invitations/key-sharing.ts`
- ✅ `/packages/client/src/ui/screens/JoinGroupScreen.tsx`
- ✅ `/packages/client/src/ui/components/members/MemberList.tsx`
- ✅ `/packages/client/src/ui/components/invites/InviteModal.tsx`
- ✅ `/packages/client/src/ui/components/invites/PendingRequestsList.tsx`
- ✅ `/packages/client/src/api/pocketbase-client.ts` (extended)

**Deliverable Achieved**: Users can create invitations, join groups via links, and collaborate with encrypted group keys - fully integrated and working!

### Phase 6: Advanced Features (Weeks 13-16)
**Goal**: Complete feature set

**Tasks**:
1. ✅ Entry modification with versioning
2. ✅ Entry soft deletion
3. ✅ Activity feed
4. ✅ Filtering and search
5. ✅ Multi-currency support with exchange rates
6. ✅ Settlement suggestions (debt optimization)
7. ✅ Export functionality (JSON)
8. ✅ Incremental snapshot storage (performance optimization)
9. PWA service worker for offline

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

### 6. Snapshot Storage Strategy
**Design**: Incremental updates with periodic consolidation
- **Base snapshots**: Full Loro CRDT state stored in IndexedDB per group
- **Incremental updates**: After each mutation, store only the delta (1-10 KB) instead of full snapshot (10 MB)
- **Consolidation triggers**:
  - Every 50 incremental updates (threshold-based)
  - On app load (always, for clean startup)
  - On idle (when user switches tabs)
- **Performance**: ~98% reduction in IndexedDB write volume
- **Rationale**: Encrypted data is incompressible, so delta updates are the only way to reduce writes

**Why not server-side snapshots yet?**
- Phase 6 focuses on local performance optimization
- Server-side snapshots planned for future (reduces initial sync time for large groups)

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

**Week 1-2**: Foundation ✅
- Monorepo setup, crypto module, storage module, tests

**Week 3-4**: Local CRDT ✅
- Data models, Loro wrapper, balance calculations, tests

**Week 5-6**: Basic UI ✅
- SolidJS app, CSS, screens, local-only MVP

**Week 7-10**: Server & Sync ✅
- PocketBase setup, API client, sync manager, multi-client testing

**Week 11-12**: Multi-User ✅
- Invite/join flows, key exchange, member management, multi-device sync

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

**Current Focus**: Simplified Trusted Group Join Flow

See detailed implementation plan below.

---

## Simplified Trusted Group Join Flow

### Overview

Redesign the group joining process for trusted groups (the primary use case). The new approach:
- **Single group key**: Created at group creation, never rotated
- **Key in URL fragment**: Join link contains the group symmetric key (never sent to server)
- **No approval required**: Anyone with the link can join immediately
- **Member linking**: Support claiming existing virtual member identities

### Motivation

The current implementation is designed for high-security scenarios with:
- Key rotation on member join/leave
- ECDH key exchange protocol
- Server-side approval workflow
- Complex subscription management

For trusted groups (friends, family, roommates), this complexity creates friction without proportional benefit. If users share the join link via trusted channels (WhatsApp, Signal, in person), the simpler approach is secure enough.

### Security Model

**Trust assumption**: Group members share the join link only via secure channels. If the link leaks, the group is compromised.

**What's protected**:
- Server never sees the group key (it's in the URL fragment)
- Server cannot decrypt any group data
- All entries remain end-to-end encrypted

**What's NOT protected** (acceptable for trusted groups):
- Anyone with the link can join without approval
- Historical data is accessible to new members
- No forward secrecy (compromised key = all data accessible)

### URL Structure

**New format**:
```
https://app.example/#/join/{groupId}/{base64url-encoded-group-key}
```

The `#` fragment is never sent to the server. The key is Base64URL encoded (URL-safe characters).

**Example**:
```
https://app.example/#/join/abc123/SGVsbG8gV29ybGQh...
```

### Data Model Changes

#### New: Member Alias Type

Add to `/packages/shared/src/types/member.ts`:

```typescript
/**
 * Links a new member ID to an existing virtual member ID
 * Used when someone joins and claims an existing identity
 */
export interface MemberAlias {
  newMemberId: string;        // The joining member's ID
  existingMemberId: string;   // The virtual member being claimed
  linkedAt: number;           // Unix timestamp
  linkedBy: string;           // Who created the link (same as newMemberId)
}
```

#### New: Activity Type for Member Linked

Add to `/packages/shared/src/types/activity.ts`:

```typescript
export type ActivityType =
  | 'entry_added'
  | 'entry_modified'
  | 'entry_deleted'
  | 'entry_undeleted'
  | 'member_joined'
  | 'member_linked';  // NEW

export interface MemberLinkedActivity extends BaseActivity {
  type: 'member_linked';
  newMemberId: string;
  newMemberName: string;
  existingMemberId: string;
  existingMemberName: string;
}
```

### CRDT Changes

#### LoroEntryStore Updates

Add new Loro map for member aliases in `/packages/client/src/core/crdt/loro-wrapper.ts`:

```typescript
private memberAliases: LoroMap;

constructor(peerId?: string) {
  // ... existing code ...
  this.memberAliases = this.loro.getMap('memberAliases');
}

/**
 * Link a new member to an existing virtual member
 */
addMemberAlias(alias: MemberAlias): void {
  this.transact(() => {
    const aliasMap = this.memberAliases.setContainer(
      alias.newMemberId,
      new LoroMap()
    ) as LoroMap;
    aliasMap.set('newMemberId', alias.newMemberId);
    aliasMap.set('existingMemberId', alias.existingMemberId);
    aliasMap.set('linkedAt', alias.linkedAt);
    aliasMap.set('linkedBy', alias.linkedBy);
  });
}

/**
 * Get all member aliases
 */
getMemberAliases(): MemberAlias[] {
  const aliases: MemberAlias[] = [];
  for (const id of this.memberAliases.keys()) {
    const aliasMap = this.memberAliases.get(id);
    if (!aliasMap || !(aliasMap instanceof LoroMap)) continue;
    aliases.push({
      newMemberId: aliasMap.get('newMemberId') as string,
      existingMemberId: aliasMap.get('existingMemberId') as string,
      linkedAt: aliasMap.get('linkedAt') as number,
      linkedBy: aliasMap.get('linkedBy') as string,
    });
  }
  return aliases;
}

/**
 * Resolve a member ID to its canonical ID (following aliases)
 */
resolveCanonicalMemberId(memberId: string): string {
  const aliases = this.getMemberAliases();
  // Check if this ID is an alias for another
  for (const alias of aliases) {
    if (alias.newMemberId === memberId) {
      return alias.existingMemberId;
    }
  }
  return memberId;
}
```

### Balance Calculator Changes

Update `/packages/client/src/domain/calculations/balance-calculator.ts` to use member aliases:

```typescript
/**
 * Calculate balances with member alias resolution
 */
export function calculateBalances(
  entries: Entry[],
  memberAliases: MemberAlias[] = []
): Map<string, Balance> {
  // Build alias lookup: newId -> existingId
  const aliasMap = new Map<string, string>();
  for (const alias of memberAliases) {
    aliasMap.set(alias.newMemberId, alias.existingMemberId);
  }

  // Resolve member ID to canonical ID
  const resolve = (id: string): string => aliasMap.get(id) ?? id;

  // ... rest of calculation uses resolve() for all member IDs ...
}
```

### Files to Remove/Simplify

**Remove entirely** (not needed for trusted groups):
- `/packages/client/src/core/crypto/key-exchange.ts` - ECDH key exchange
- `/packages/client/src/domain/invitations/key-sharing.ts` - Key payload building

**Simplify significantly**:
- `/packages/client/src/domain/invitations/invite-manager.ts` - Just URL generation
- `/packages/client/src/api/pocketbase-client.ts` - Remove invitation/join_request/key_package methods

**Remove UI components**:
- `/packages/client/src/ui/components/invites/PendingRequestsList.tsx` - No approvals needed

### Files to Modify

#### 1. `/packages/shared/src/types/member.ts`
- Add `MemberAlias` interface

#### 2. `/packages/shared/src/types/activity.ts`
- Add `member_linked` activity type
- Add `MemberLinkedActivity` interface

#### 3. `/packages/client/src/core/crdt/loro-wrapper.ts`
- Add `memberAliases` Loro map
- Add `addMemberAlias()`, `getMemberAliases()`, `resolveCanonicalMemberId()`
- Update `importSnapshot()` and `applyUpdate()` to refresh `memberAliases` handle

#### 4. `/packages/client/src/domain/calculations/balance-calculator.ts`
- Accept `memberAliases` parameter
- Resolve all member IDs through alias lookup

#### 5. `/packages/client/src/domain/invitations/invite-manager.ts`
- Replace with simple URL generation:
  ```typescript
  export function generateInviteLink(groupId: string, groupKeyBase64: string): string {
    const keyBase64Url = base64ToBase64Url(groupKeyBase64);
    return `${window.location.origin}/#/join/${groupId}/${keyBase64Url}`;
  }

  export function parseInviteLink(fragment: string): { groupId: string; groupKey: string } | null {
    const match = fragment.match(/^\/join\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
      groupId: match[1],
      groupKey: base64UrlToBase64(match[2]),
    };
  }
  ```

#### 6. `/packages/client/src/App.tsx`
- Change route from `/join/:inviteData` to use hash-based routing
- Parse fragment for join data

#### 7. `/packages/client/src/ui/screens/JoinGroupScreen.tsx`
- Simplify to:
  1. Parse group key from URL fragment
  2. Import group key, fetch CRDT state from server
  3. Decrypt and display existing members
  4. Let user choose: "I'm new" or "I'm [existing member]"
  5. Add member (with alias if claiming existing)
  6. Show activity feed entry
  7. Navigate to group view

#### 8. `/packages/client/src/ui/components/invites/InviteModal.tsx`
- Simplify to just show link and QR code
- No invitation creation on server

#### 9. `/packages/client/src/ui/context/AppContext.tsx`
- Remove `approveJoinRequest`, `processReceivedKeyPackage`
- Remove pending join request state and subscriptions
- Add `joinGroupWithKey(groupId, groupKeyBase64, memberName, existingMemberId?)`
- Update balance calculations to use member aliases

#### 10. `/packages/client/src/api/pocketbase-client.ts`
- Remove: `createInvitation`, `getInvitation`, `listInvitations`, `updateInvitation`
- Remove: `createJoinRequest`, `getJoinRequest`, `listJoinRequests`, `updateJoinRequest`
- Remove: `createKeyPackage`, `getKeyPackagesForRecipient`, `getKeyPackageForJoinRequest`
- Remove: `subscribeToJoinRequests`, `subscribeToKeyPackages`
- Keep: Operation sync methods (these are still needed)

#### 11. `/packages/client/src/core/storage/indexeddb.ts`
- Remove multiple key version storage (single key per group)
- Simplify `saveGroupKey` / `getGroupKey` to not need version parameter

### Implementation Steps

#### Step 1: Types and Interfaces
1. Add `MemberAlias` to `/packages/shared/src/types/member.ts`
2. Add `member_linked` activity type to `/packages/shared/src/types/activity.ts`
3. Update type exports in `/packages/shared/src/types/index.ts`

#### Step 2: CRDT Layer
1. Add `memberAliases` map to `LoroEntryStore`
2. Implement `addMemberAlias()`, `getMemberAliases()`, `resolveCanonicalMemberId()`
3. Update snapshot import/export to include aliases
4. Add tests for member alias operations

#### Step 3: Balance Calculator
1. Add `memberAliases` parameter to `calculateBalances()`
2. Add alias resolution in all member ID usages
3. Update `computeDebtGraph()` and `computeSettlementPlan()` similarly
4. Add tests for balance calculation with aliases

#### Step 4: Invite URL Generation
1. Rewrite `invite-manager.ts` with simple URL functions
2. Add Base64URL encoding/decoding helpers
3. Add tests for URL parsing

#### Step 5: Remove Complex Key Exchange
1. Delete `/packages/client/src/core/crypto/key-exchange.ts`
2. Delete `/packages/client/src/domain/invitations/key-sharing.ts`
3. Remove related tests
4. Clean up imports

#### Step 6: Simplify Storage
1. Update IndexedDB to store single key per group (no versions)
2. Migration: keep existing key as the single key
3. Update all key retrieval calls

#### Step 7: Simplify PocketBase Client
1. Remove invitation/join_request/key_package methods
2. Remove related subscriptions
3. Keep operation sync methods

#### Step 8: Update App Routing
1. Change to hash-based routing for join links
2. Update `App.tsx` route configuration

#### Step 9: Rewrite JoinGroupScreen
1. Parse group key from URL fragment
2. Fetch and decrypt group data
3. Show member selection UI
4. Handle join flow (new member or claim existing)
5. Create activity feed entry
6. Navigate to group

#### Step 10: Simplify InviteModal
1. Generate link with embedded key
2. Display QR code
3. Share functionality

#### Step 11: Update AppContext
1. Remove approval workflow methods
2. Remove pending request state
3. Add `joinGroupWithKey()` method
4. Update balance calculations to use aliases

#### Step 12: Delete Unused Components
1. Remove `PendingRequestsList.tsx`
2. Clean up any unused imports

#### Step 13: Testing
1. Unit tests for member aliases
2. Unit tests for balance calculation with aliases
3. Integration test for full join flow
4. Test URL generation and parsing

### Migration Notes

**For existing groups**: This is a breaking change. Existing groups using the old key rotation system will need migration or will be incompatible.

**Recommendation**: Since this is pre-production, implement the new system cleanly without backward compatibility concerns.

### Future Work (Out of Scope)

**For less-trusted groups** (future Phase):
- Subgroup encryption: Different keys for different member subsets
- Only members involved in an entry can decrypt it
- More complex but enables privacy within groups

---

## Previous Next Steps (Archived)

**Previously Current Focus**: Phase 6 - Advanced Features

1. ✅ Entry modification with versioning UI
2. ✅ Entry soft deletion with undo
3. ✅ Activity feed showing recent changes
4. ✅ Filtering and search for entries
5. ✅ Multi-currency support with exchange rates
6. ✅ Settlement suggestions (debt optimization)
7. ✅ Export functionality (JSON)
8. ✅ Incremental snapshot storage (performance optimization)
9. ⏳ PWA service worker for full offline support (deferred)

**Goal**: Complete feature set with full entry lifecycle, activity tracking, and offline capabilities
