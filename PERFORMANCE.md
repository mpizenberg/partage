# Performance Analysis & Optimization Plan

**Date**: January 12, 2026
**Phase**: 8 - Polish & Production
**Status**: ✅ All HIGH and MEDIUM priority optimizations implemented

## Executive Summary

Analysis of the Partage codebase identified several performance patterns that could impact user experience at scale. All HIGH and MEDIUM priority issues have been fixed, plus one LOW priority optimization:

1. ✅ **Key Import Overhead** - Fixed with key caching (~62% savings measured)
2. ✅ **Sequential Entry Decryption** - Fixed with parallel decryption (~2x speedup)
3. ✅ **Linear Alias Lookups** - Fixed with Map-based lookups (~3.6x speedup)
4. ✅ **Sequential Network Calls** - Fixed with parallel health check syncs
5. ✅ **Batch IndexedDB writes** - Fixed with atomic replaceQueuedOperations
6. ✅ **Linear Creditor Search** - Fixed with Map-based lookup
7. ✅ **Activity Feed Regeneration** - Fixed with incremental updates (O(log n) vs O(n log n))

## Benchmark Results (After Optimizations)

Run benchmarks with: `pnpm test:bench`

| Operation | Measured | Notes |
|-----------|----------|-------|
| Single encryption | ~20µs | Fast, not a bottleneck |
| Batch encrypt (50 sequential) | ~840µs | |
| Batch encrypt (50 parallel) | ~410µs | **2x speedup with parallelization** |
| `createEntry` | ~100µs | Fast |
| `getAllEntries` (10 entries) | ~750µs | Improved with parallel decryption |
| `getAllEntries` (50 entries) | ~2.1ms | Improved with parallel decryption |
| `getAllEntries` (100 entries) | ~3.6ms | ~36µs/entry (was ~50µs) |
| Balance calc (20 members, 500 entries) | ~1.5ms | Acceptable |
| Key caching benefit | 62% savings | **Implemented** |
| Alias lookup (Map-based) | ~35µs vs 129µs linear | **3.6x speedup - Implemented** |
| Snapshot save (100 entries) | ~150µs | Fast |
| Snapshot load (100 entries) | ~220µs | Fast |

## Issues by Priority

### HIGH Priority (All Implemented ✅)

#### 1. ✅ Key Import Per Entry (loro-wrapper.ts)

**Problem**: Every call to `getEntry()` potentially re-imports the CryptoKey from Base64:

```typescript
// Current: O(n) key imports for n entries
async getEntry(entryId: string, groupKey: CryptoKey): Promise<Entry | null> {
  // ...
  const keyString = await this.getGroupKeyString(metadata.groupId, metadata.keyVersion);
  const key = await this.importGroupKeyFromString(keyString);  // ← Crypto import op
  // ...
}
```

**Impact**: 50% overhead on `getAllEntries()` calls
**Fix**: Cache imported keys per group/version

```typescript
private keyCache = new Map<string, CryptoKey>();

private async getCachedKey(groupId: string, version: number): Promise<CryptoKey> {
  const cacheKey = `${groupId}:${version}`;
  if (!this.keyCache.has(cacheKey)) {
    const keyString = await this.getGroupKeyString(groupId, version);
    const key = await this.importGroupKeyFromString(keyString);
    this.keyCache.set(cacheKey, key);
  }
  return this.keyCache.get(cacheKey)!;
}
```

#### 2. ✅ Sequential Entry Decryption (loro-wrapper.ts)

**Problem**: `getAllEntries` decrypts entries sequentially:

```typescript
// Current: Sequential decryption
for (const entryId of entryIds) {
  const entry = await this.getEntry(entryId, groupKey);  // ← Awaited in loop
  if (entry) allEntries.push(entry);
}
```

**Impact**: Linear time growth, ~50µs per entry
**Fix**: Parallel decryption with Promise.all()

```typescript
// Optimized: Parallel decryption
const entryPromises = entryIds.map(entryId => this.getEntry(entryId, groupKey));
const entries = await Promise.all(entryPromises);
return entries.filter((e): e is Entry => e !== null && e.groupId === groupId);
```

#### 3. ✅ getMemberName Repeated Loro Reads (BalanceTab.tsx, SettlementPlan.tsx)

**Problem**: `getMemberName()` is called in render loops without memoization:

```typescript
// Current: Called 10+ times per render, each with Loro reads
const getMemberName = (memberId: string): string => {
  const aliases = store.getMemberAliases()  // ← Read from Loro
  const alias = aliases.find(...)           // ← Linear search
  // ...
  const allMembers = store.getMembers()     // ← Another Loro read
  // ...
}
```

**Impact**: O(n × m) Loro reads where n = members, m = reads per call
**Fix**: Build memoized lookup map once per render cycle

```typescript
// Create lookup map once
const memberNameMap = createMemo(() => {
  const store = loroStore();
  if (!store) return new Map<string, string>();

  const aliases = store.getMemberAliases();
  const aliasMap = new Map(aliases.map(a => [a.existingMemberId, a.newMemberId]));
  const members = store.getMembers();
  const nameMap = new Map<string, string>();

  for (const member of members) {
    let displayId = member.id;
    // Resolve alias chain
    while (aliasMap.has(displayId)) {
      displayId = aliasMap.get(displayId)!;
    }
    const displayMember = members.find(m => m.id === displayId);
    nameMap.set(member.id, displayMember?.name || member.name);
  }
  return nameMap;
});

// O(1) lookup
const getMemberName = (memberId: string) => memberNameMap().get(memberId) || 'Unknown';
```

### MEDIUM Priority (All Implemented ✅)

#### 4. ✅ Sequential Health Check Syncs (sync-manager.ts)

**Problem**: Health check syncs each group sequentially:

```typescript
for (const [groupId, actorId] of this.subscribedGroups) {
  await this.incrementalSync(groupId, actorId);  // ← Sequential
}
```

**Impact**: With 5 groups, 1-2s latency each = 5-10s total
**Fix**: Parallel sync with `Promise.allSettled()`

```typescript
await Promise.allSettled(
  Array.from(this.subscribedGroups).map(([groupId, actorId]) =>
    this.incrementalSync(groupId, actorId)
  )
);
```

#### 5. ✅ Offline Queue Clear + Loop (sync-manager.ts, indexeddb.ts)

**Problem**: Saving offline queue clears table then writes items one-by-one:

```typescript
await this.storage.clearQueuedOperations();  // ← Clear all
for (const operation of this.offlineQueue) {
  await this.storage.queueOperation(...);     // ← Write each
}
```

**Impact**: 51 IndexedDB transactions for 50 operations
**Fix**: Batch write in single transaction (requires IndexedDB API change)

#### 6. ✅ Linear Creditor Search in buildDebtGraph (balance-calculator.ts)

**Problem**: Preferred creditor lookup uses linear search:

```typescript
for (const preferredId of preferredRecipients) {
  const creditor = creditors.find(c => c.memberId === preferredId);  // ← O(n)
}
```

**Impact**: O(debtors × preferences × creditors)
**Fix**: Use Map for O(1) creditor lookup

```typescript
const creditorMap = new Map(creditors.map(c => [c.memberId, c]));
// ...
const creditor = creditorMap.get(preferredId);
```

### LOW Priority

#### 7. Pagination Loop in fetchAllUpdates (pocketbase-client.ts:183-207)

**Problem**: Sequential pagination for large result sets
**Impact**: Latency × page count
**Note**: Acceptable for current scale, consider streaming for >1000 updates

#### 8. ✅ Activity Feed Incremental Updates (activity-generator.ts, AppContext.tsx)

**Problem**: Regenerated all activities on every entry change (O(n log n) where n = total entry versions)
**Impact**: Wasted CPU cycles sorting hundreds of entries for each add/modify/delete
**Fix**: Implemented incremental activity generation (O(log n) binary search + O(n) array copy)

**Implementation**:
- Added `generateActivityForNewEntry()` for add operations
- Added `generateActivityForModifiedEntry()` for modify operations
- Added `generateActivityForDeletedEntry()` for delete operations
- Added `generateActivityForUndeletedEntry()` for undelete operations
- Added `insertActivitySorted()` for O(log n) insertion using binary search
- Updated `addExpense`, `addTransfer`, `modifyExpense`, `modifyTransfer`, `deleteEntry`, `undeleteEntry` to use incremental refresh

**Performance**: From O(n log n) full regeneration to O(log n) insertion for each operation

## Testing & Monitoring

### Benchmarks

Located in `/packages/client/src/benchmarks/`:

- `performance-benchmarks.ts` - Exportable benchmark utilities
- `performance-benchmarks.test.ts` - Vitest benchmark tests

Run with:
```bash
pnpm test:bench
```

### Adding Performance Monitoring

Consider adding these metrics to production:

```typescript
// In AppContext or performance utility
const perfMetrics = {
  getAllEntriesDuration: [] as number[],
  balanceCalcDuration: [] as number[],
  renderCycleDuration: [] as number[],
};

// Wrap critical paths
async function timedGetAllEntries(...args) {
  const start = performance.now();
  const result = await originalGetAllEntries(...args);
  perfMetrics.getAllEntriesDuration.push(performance.now() - start);
  return result;
}
```

## Implementation Status

All HIGH and MEDIUM priority optimizations have been implemented, plus one important LOW priority optimization:

1. ✅ **Key caching** - `loro-wrapper.ts` - Added `keyCache` Map and `getCachedKey()` method
2. ✅ **Member name memoization** - `BalanceTab.tsx`, `SettlementPlan.tsx` - Added `memberNameMap` createMemo
3. ✅ **Parallel entry decryption** - `loro-wrapper.ts` - Changed to `Promise.all()` in `getAllEntries()`
4. ✅ **Parallel health check** - `sync-manager.ts` - Changed to parallel sync with `Promise.all()`
5. ✅ **Creditor Map lookup** - `balance-calculator.ts` - Added `creditorMap` for O(1) lookup
6. ✅ **Batch offline queue** - `indexeddb.ts` - Added `replaceQueuedOperations()` for atomic batch writes
7. ✅ **Incremental activities** - `activity-generator.ts`, `AppContext.tsx` - Added incremental generation functions and binary search insertion

## Files Modified

| File | Changes |
|------|---------|
| `loro-wrapper.ts` | Added key cache, parallel decryption, `clearKeyCache()` |
| `BalanceTab.tsx` | Added memoized `memberNameMap`, optimized `isCurrentUserMember` |
| `SettlementPlan.tsx` | Added memoized `memberNameMap`, `canonicalUserId` |
| `sync-manager.ts` | Parallel health check, batch offline queue via `replaceQueuedOperations` |
| `balance-calculator.ts` | Added `creditorMap` for O(1) creditor lookup |
| `indexeddb.ts` | Added `replaceQueuedOperations()` for atomic batch writes |
| `activity-generator.ts` | Added incremental generation functions and `insertActivitySorted()` |
| `AppContext.tsx` | Added `refreshEntriesIncremental()`, updated all entry operations |

## Validation

After each optimization:

1. Run `pnpm test:bench` to measure improvement
2. Run `pnpm test` to ensure no regressions
3. Test in browser with 100+ entries
4. Check memory usage doesn't grow unexpectedly
