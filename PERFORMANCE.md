# Performance Analysis & Optimization Plan

**Date**: January 12, 2026
**Phase**: 8 - Polish & Production

## Executive Summary

Analysis of the Partage codebase identified several performance patterns that could impact user experience at scale. The most significant issues are:

1. **Key Import Overhead** - ~50% overhead from repeated CryptoKey imports
2. **Sequential Entry Decryption** - O(n) decryptions without parallelization
3. **Linear Alias Lookups** - 3x slower than Map-based lookups
4. **Sequential Network Calls** - Health checks and pagination run serially

## Benchmark Results

Run benchmarks with: `pnpm test:bench`

| Operation | Measured | Notes |
|-----------|----------|-------|
| Single encryption | ~20µs | Fast, not a bottleneck |
| Batch encrypt (50 sequential) | ~1ms | |
| Batch encrypt (50 parallel) | ~420µs | **2.4x speedup with parallelization** |
| `createEntry` | ~100µs | Fast |
| `getAllEntries` (10 entries) | ~1ms | |
| `getAllEntries` (50 entries) | ~3ms | |
| `getAllEntries` (100 entries) | ~5ms | ~50µs/entry |
| Balance calc (20 members, 500 entries) | ~1.5ms | Acceptable |
| Key import (100x repeated) | +50% overhead | **50% savings with caching** |
| Alias lookup (linear vs Map) | 131µs vs 44µs | **3x speedup with Map** |
| Snapshot save (100 entries) | ~170µs | Fast |
| Snapshot load (100 entries) | ~230µs | Fast |

## Issues by Priority

### HIGH Priority

#### 1. Key Import Per Entry (loro-wrapper.ts:326-336)

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

#### 2. Sequential Entry Decryption (loro-wrapper.ts:357-383)

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

#### 3. getMemberName Repeated Loro Reads (BalanceTab.tsx:27-58, SettlementPlan.tsx:23-59)

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

### MEDIUM Priority

#### 4. Sequential Health Check Syncs (sync-manager.ts:356-370)

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

#### 5. Offline Queue Clear + Loop (sync-manager.ts:677-696)

**Problem**: Saving offline queue clears table then writes items one-by-one:

```typescript
await this.storage.clearQueuedOperations();  // ← Clear all
for (const operation of this.offlineQueue) {
  await this.storage.queueOperation(...);     // ← Write each
}
```

**Impact**: 51 IndexedDB transactions for 50 operations
**Fix**: Batch write in single transaction (requires IndexedDB API change)

#### 6. Linear Creditor Search in buildDebtGraph (balance-calculator.ts:263-354)

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

#### 8. Activity Feed Full Regeneration (activity-generator.ts)

**Problem**: Regenerates all activities on every entry change
**Impact**: O(entries) sorting per update
**Fix**: Incremental activity updates (future optimization)

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

## Implementation Order

1. **Key caching** (HIGH) - Immediate 50% improvement, low risk
2. **Member name memoization** (HIGH) - Reduces re-renders, low risk
3. **Parallel entry decryption** (HIGH) - ~2x improvement, low risk
4. **Parallel health check** (MEDIUM) - Improves multi-group UX
5. **Creditor Map lookup** (MEDIUM) - Clean optimization
6. **Batch offline queue** (MEDIUM) - Requires API change

## Files to Modify

| File | Changes |
|------|---------|
| `loro-wrapper.ts` | Add key cache, parallel decryption |
| `BalanceTab.tsx` | Add memoized member name map |
| `SettlementPlan.tsx` | Add memoized member name map |
| `sync-manager.ts` | Parallel health check |
| `balance-calculator.ts` | Creditor Map lookup |
| `indexeddb.ts` | Batch offline queue write (future) |

## Validation

After each optimization:

1. Run `pnpm test:bench` to measure improvement
2. Run `pnpm test` to ensure no regressions
3. Test in browser with 100+ entries
4. Check memory usage doesn't grow unexpectedly
