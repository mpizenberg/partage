# Performance Analysis: Event Traversal in Partage

## Executive Summary

The codebase has **38+ functions** that traverse events/entries. The current architecture performs **full traversals on every operation**, leading to O(n) or worse complexity for each user action. There are significant opportunities for caching and incremental computation.

**Key findings:**

- Redundant `buildCanonicalIdMap()` calls: 2-3× per refresh
- Full entry decryption on every action: O(n) crypto operations
- Member state recomputation: O(m²) where m = member count
- No caching of derived state between operations

**Critical insight:** Balance calculations are **commutative**—the order of entry processing doesn't affect final results. This means incremental updates work for both local changes AND remote sync, without needing rollback mechanisms.

---

## 1. Inventory of Event Traversal Functions

### 1.1 Loro CRDT Wrapper (`loro-wrapper.ts`)

| Function                     | Lines   | Complexity | What It Traverses                        |
| ---------------------------- | ------- | ---------- | ---------------------------------------- |
| `getAllEntries()`            | 378-399 | O(n)       | All entry IDs, parallel decryption       |
| `getCurrentEntries()`        | 405-418 | O(n)       | All entries, filter superseded           |
| `getActiveEntries()`         | 424-437 | O(n)       | All entries, filter deleted + superseded |
| `getMemberEvents()`          | 597-647 | O(m)       | All member event IDs                     |
| `getMembers()`               | 461-482 | O(k)       | All member IDs                           |
| `getMemberAliases()`         | 520-533 | O(a)       | All alias entries                        |
| `getSettlementPreferences()` | 835-855 | O(p)       | All preference entries                   |
| `isMemberKnown()`            | 696-707 | O(m)       | Member events (early exit)               |
| `getCanonicalIdMap()`        | 684-687 | O(m²)      | Delegates to member-state.ts             |
| `getActiveMemberStates()`    | 668-670 | O(m²)      | Delegates to member-state.ts             |
| `getRetiredMemberStates()`   | 676-679 | O(m²)      | Delegates to member-state.ts             |

### 1.2 Balance Calculator (`balance-calculator.ts`)

| Function                   | Lines   | Complexity | What It Traverses                  |
| -------------------------- | ------- | ---------- | ---------------------------------- |
| `calculateBalances()`      | 25-81   | O(n × b)   | All entries, payers, beneficiaries |
| `processExpense()`         | 86-111  | O(p + b)   | Payers and beneficiaries arrays    |
| `calculatePayerSplits()`   | 124-166 | O(p log p) | Payers with sorting                |
| `calculateSplits()`        | 174-231 | O(b log b) | Beneficiaries with sorting         |
| `buildDebtGraph()`         | 262-357 | O(d × c)   | Debtors × creditors (nested loop)  |
| `generateSettlementPlan()` | 364-374 | O(d × c)   | Delegates to buildDebtGraph        |

### 1.3 Activity Generator (`activity-generator.ts`)

| Function                               | Lines   | Complexity        | What It Traverses          |
| -------------------------------------- | ------- | ----------------- | -------------------------- |
| `generateActivitiesFromEntries()`      | 179-280 | O(n)              | All entries                |
| `generateActivitiesFromMemberEvents()` | 291-428 | O(m log m)        | Member events with sorting |
| `generateAllActivities()`              | 437-461 | O((n+m) log(n+m)) | Combined with sort         |
| `filterActivities()`                   | 466-497 | O(a)              | Activities array           |
| `insertActivitySorted()`               | 638-654 | O(log a + a)      | Binary search + array copy |

### 1.4 Member State (`member-state.ts`)

| Function                     | Lines   | Complexity   | What It Traverses                 |
| ---------------------------- | ------- | ------------ | --------------------------------- |
| `computeMemberState()`       | 58-102  | O(e log e)   | Events for one member             |
| `computeAllMemberStates()`   | 110-129 | O(m × e)     | All events per member             |
| `getActiveMembers()`         | 137-140 | O(m × e)     | All states, filter active         |
| `getRetiredMembers()`        | 148-151 | O(m × e)     | All states, filter retired        |
| `getReplacedMembers()`       | 159-162 | O(m × e)     | All states, filter replaced       |
| `buildCanonicalIdMap()`      | 206-215 | O(m² × e)    | All states + recursive resolution |
| `findAllAliasesFor()`        | 227-238 | O(m² × e)    | Canonical map iteration           |
| `resolveCanonicalMemberId()` | 175-198 | O(depth × e) | Recursive state computation       |

### 1.5 Entry Filter (`entry-filter.ts`)

| Function                | Lines   | Complexity | What It Traverses         |
| ----------------------- | ------- | ---------- | ------------------------- |
| `filterEntries()`       | 114-153 | O(n × f)   | Entries × filter criteria |
| `getUniqueCurrencies()` | 158-164 | O(n)       | All entries               |
| `getUniqueCategories()` | 169-175 | O(n)       | All entries               |

### 1.6 App Context (`AppContext.tsx`)

| Function                      | Lines   | Complexity | What It Traverses                |
| ----------------------------- | ------- | ---------- | -------------------------------- |
| `refreshEntries()`            | 743-792 | O(n + m²)  | Orchestrates multiple traversals |
| `refreshEntriesIncremental()` | 796-875 | O(n + m²)  | Still needs full balance recalc  |
| `members` (createMemo)        | 290-330 | O(m × e)   | Member states                    |
| `activities` (createMemo)     | 346-353 | O(a)       | Filtered activities              |

---

## 2. Call Graph Analysis

When a user adds/modifies/deletes an entry, here's the traversal cascade:

```
User Action (add/modify/delete entry)
    │
    ▼
refreshEntries() or refreshEntriesIncremental()
    │
    ├─► store.getCurrentEntries() or getActiveEntries()
    │       │
    │       ├─► getAllEntries()           ← O(n) full traversal + decryption
    │       │
    │       └─► filter for superseded     ← O(n) second pass
    │
    ├─► store.getMemberEvents()           ← O(m) member events traversal
    │
    ├─► calculateBalances()               ← O(n) entries + O(m²) canonical map
    │       │
    │       └─► buildCanonicalIdMap()
    │               │
    │               └─► computeAllMemberStates()  ← O(m² × e) nested traversal
    │                       │
    │                       └─► computeMemberState() per member
    │
    ├─► generateAllActivities()           ← O(n log n) with sorting
    │       │
    │       ├─► generateActivitiesFromEntries()
    │       │
    │       └─► generateActivitiesFromMemberEvents()
    │               │
    │               └─► [implicitly uses canonical ID resolution]
    │
    └─► store.getCanonicalIdMap()         ← ANOTHER O(m²) call (REDUNDANT!)
```

**Total per action**: ~3-4 full entry traversals + 2-3 canonical map builds

---

## 3. Loro's DAG vs Our Linear State Computation

### Understanding Loro's Internal Model

Loro uses a **DAG (Directed Acyclic Graph)** internally for CRDT conflict resolution. When two peers make concurrent changes, Loro uses version vectors to track causality:

```typescript
// Loro's version is a Map<PeerId, Counter>
const version = store.getVersion();
// Example: { "peer-abc": 15, "peer-xyz": 8 }
```

This means events don't form a linear chain—they form a DAG:

```
        Peer A                    Peer B
           │                         │
     ┌─────┴─────┐             ┌─────┴─────┐
     │ Event A1  │             │ Event B1  │
     └─────┬─────┘             └─────┬─────┘
           │                         │
     ┌─────┴─────┐             ┌─────┴─────┐
     │ Event A2  │             │ Event B2  │  ← Concurrent!
     └─────┬─────┘             └─────┬─────┘
           │                         │
           └───────────┬─────────────┘
                       │
                 ┌─────┴─────┐
                 │   Merge   │
                 └───────────┘
```

### Our Derived State Is Computed Linearly

However, **our derived state computation is linear**. When we compute balances, activities, or member states, we process a flat list:

```typescript
// We get a flat list from Loro and process it sequentially
const entries = await store.getAllEntries(groupId, groupKey);
const memberEvents = store.getMemberEvents();

// Balances: iterate entries linearly
for (const entry of entries) {
  processEntry(entry, balances);
}

// Member states: sort by timestamp, process linearly
const sortedEvents = events.sort((a, b) => a.timestamp - b.timestamp);
for (const event of sortedEvents) {
  applyEvent(state, event);
}
```

### Key Insight: Commutativity

The critical realization is that **balance calculations are commutative**:

```typescript
// Entry A: Alice paid $30, Bob owes $30
// Entry B: Bob paid $20, Carol owes $20

// Processing order A→B:
// Alice: +30 paid, Bob: -30+20 = -10, Carol: -20

// Processing order B→A:
// Bob: +20 paid, Carol: -20, Alice: +30, Bob: -30
// Final: Alice: +30, Bob: -10, Carol: -20  ← Same result!
```

Each entry's contribution to balances is **independent**. This means:

| Derived State     | Commutative?         | Implications                                                        |
| ----------------- | -------------------- | ------------------------------------------------------------------- |
| **Balances**      | ✅ Yes               | Can apply events in any order. No rollback needed.                  |
| **Activities**    | ⚠️ Order for display | Use sorted insertion. No rollback needed.                           |
| **Member States** | ❌ Causal order      | Events must be processed in causal order, but Loro guarantees this. |

### What This Means for Sync

When we receive remote events during sync, they might have timestamps "in the middle" of our timeline:

```
Our local: E1(t=100) → E2(t=200) → E3(t=300)
Remote:    E_r(t=150)  ← "belongs" between E1 and E2
```

**But we don't need to rollback!** Because:

1. **Balances**: Just apply E_r's delta. Order doesn't matter.
2. **Activities**: Just insert E_r at the correct sorted position.
3. **Member states**: Recompute if needed (rare, fast with few members).

### Practical Implications

Instead of tracking "processed up to timestamp T" and maintaining rollback capability, we can simply track **"processed entry IDs"**:

```typescript
interface DerivedState {
  processedEntryIds: Set<string>; // Track what we've seen
  processedMemberEventIds: Set<string>;
  balances: Map<string, Balance>;
  activities: Activity[]; // Sorted by timestamp
  // ...
}

// On sync: find new events and apply them (any order works for balances)
const newEntries = allEntries.filter((e) => !state.processedEntryIds.has(e.id));
for (const entry of newEntries) {
  applyEntryDelta(state.balances, entry, +1);
  insertActivitySorted(state.activities, createActivity(entry));
  state.processedEntryIds.add(entry.id);
}
```

---

## 4. Critical Performance Issues

### Issue 1: Redundant `buildCanonicalIdMap()` Calls

**Locations:**

- `balance-calculator.ts:32`
- `activity-generator.ts:443-449` (passed as parameter but rebuilt internally)
- `AppContext.tsx:779`

**Problem:** `buildCanonicalIdMap()` is called **2-3 times per refresh**:

1. Once in `calculateBalances()`
2. Once explicitly in `refreshEntries()` to pass to `generateAllActivities()`
3. Potentially again in member name resolution

**Cost:** Each call is O(m² × e) where m = members, e = average events per member.

**Example:** 10 members × 3 events each = 30 events

- `computeAllMemberStates()`: 10 × 30 = 300 filter operations
- `resolveCanonicalMemberId()` per member: 10 × (recursive depth × 30)
- Total per `buildCanonicalIdMap()`: ~900+ operations
- Called 3×: **~2700 operations per refresh**

### Issue 2: Full Entry Decryption Every Time

**Location:** `loro-wrapper.ts:378-399`

**Problem:** `getAllEntries()` performs:

1. `Object.keys(entriesObj)` - O(n)
2. `Promise.all(entryIds.map(getEntry))` - O(n) decryptions (crypto-heavy)
3. `.filter()` - O(n)

This happens even for `refreshEntriesIncremental()` which calls `getActiveEntries()` at line 822.

**Cost:** For 100 entries:

- 100 AES-GCM decryptions (~1-5ms each on mobile)
- 200+ array iterations
- **Total: 100-500ms per action on mobile devices**

### Issue 3: Member State Recomputation

**Location:** `member-state.ts:110-129`

**Problem:** `computeAllMemberStates()` calls `computeMemberState()` for each member:

```typescript
for (const memberId of memberIds) {
  const state = computeMemberState(memberId, events);
  // ...
}
```

Each `computeMemberState()` does:

```typescript
const memberEvents = events
  .filter((e) => e.memberId === memberId) // O(E) where E = total events
  .sort((a, b) => a.timestamp - b.timestamp); // O(k log k) where k = member's events
```

**Cost:** For m members with total E events:

- Filter: m × E = O(m × E)
- Sort: m × (E/m) × log(E/m) ≈ O(E × log(E/m))
- **Total: O(m × E) = O(m² × avgEventsPerMember)**

### Issue 4: Activity Generation Always Full Rebuild

**Location:** `activity-generator.ts:437-461`

**Problem:** Even though `insertActivitySorted()` exists for O(log n) insertion, the balance calculation path still triggers:

1. `getActiveEntries()` - full traversal
2. `calculateBalances()` - full traversal

The "incremental" path in `refreshEntriesIncremental()` is only incremental for activities, not balances.

### Issue 5: Settlement Plan Recalculation

**Location:** `AppContext.tsx:333-343`

**Problem:** `settlementPlan` is a `createMemo()` depending on `balances()`:

```typescript
const settlementPlan = createMemo(() => {
  const currentBalances = balances();
  // ...
  return generateSettlementPlan(currentBalances, preferences);
});
```

Every balance change triggers full `buildDebtGraph()`:

- Separate creditors/debtors: O(m)
- Match with preferences: O(d × p)
- Greedy matching: O(d × c) where d = debtors, c = creditors

**Cost:** For 10 members with half owing/owed: ~25 matching iterations per refresh

---

## 5. Caching Opportunities

### Cache 1: Canonical ID Map (HIGH IMPACT)

**What to cache:** Result of `buildCanonicalIdMap(memberEvents)`

**Invalidation trigger:** Only when member events change (create, rename, retire, replace)

**Current calls per action:** 2-3 times
**After caching:** 1 time (on member event change only)

**Implementation:**

```typescript
// In LoroEntryStore
private cachedCanonicalIdMap: Map<string, string> | null = null;
private memberEventsHash: string | null = null;

getCanonicalIdMap(): Map<string, string> {
  const currentHash = this.computeMemberEventsHash();
  if (this.cachedCanonicalIdMap && this.memberEventsHash === currentHash) {
    return this.cachedCanonicalIdMap;
  }
  this.cachedCanonicalIdMap = buildCanonicalIdMap(this.getMemberEvents());
  this.memberEventsHash = currentHash;
  return this.cachedCanonicalIdMap;
}

private computeMemberEventsHash(): string {
  // Simple version count or hash of event IDs
  return String(this.memberEvents.size);
}
```

**Expected improvement:** 60-70% reduction in member-related computation

### Cache 2: Member States (HIGH IMPACT)

**What to cache:** `Map<string, MemberState>` from `computeAllMemberStates()`

**Invalidation trigger:** Same as canonical ID map (member events change)

**Implementation:**

```typescript
private cachedMemberStates: Map<string, MemberState> | null = null;

getAllMemberStates(): Map<string, MemberState> {
  const currentHash = this.computeMemberEventsHash();
  if (this.cachedMemberStates && this.memberEventsHash === currentHash) {
    return this.cachedMemberStates;
  }
  this.cachedMemberStates = computeAllMemberStates(this.getMemberEvents());
  // cachedCanonicalIdMap also valid now
  return this.cachedMemberStates;
}
```

### Cache 3: Incremental Balance Updates (MEDIUM-HIGH IMPACT)

**Current:** Full O(n) recalculation on every entry change

**Better approach:** Delta-based updates:

- Entry added: `balance[payer].totalPaid += amount`, `balance[beneficiary].totalOwed += share`
- Entry deleted: Reverse of above
- Entry modified: Apply delta (new - old)

**Implementation sketch:**

```typescript
interface BalanceCache {
  balances: Map<string, Balance>;
  processedEntryIds: Set<string>;
  canonicalIdMap: Map<string, string>;
}

class IncrementalBalanceManager {
  private cache: BalanceCache | null = null;

  applyEntryAdded(entry: Entry): Map<string, Balance> {
    if (!this.cache) throw new Error('Initialize with computeFull first');

    const resolve = (id: string) => this.cache!.canonicalIdMap.get(id) ?? id;
    const amount = entry.defaultCurrencyAmount ?? entry.amount;

    if (entry.type === 'expense') {
      const expense = entry as ExpenseEntry;
      // Update payer balances
      for (const payer of expense.payers) {
        const id = resolve(payer.memberId);
        const bal = this.cache.balances.get(id)!;
        bal.totalPaid += payer.amount;
        bal.netBalance = bal.totalPaid - bal.totalOwed;
      }
      // Update beneficiary balances (simplified - would need proper split calc)
      const splits = calculateSplits(expense.beneficiaries, amount, resolve);
      for (const [memberId, splitAmount] of splits) {
        const bal = this.cache.balances.get(memberId)!;
        bal.totalOwed += splitAmount;
        bal.netBalance = bal.totalPaid - bal.totalOwed;
      }
    } else {
      // Handle transfer...
    }

    this.cache.processedEntryIds.add(entry.id);
    return this.cache.balances;
  }

  invalidateOnMemberChange(memberEvents: MemberEvent[]): void {
    // Member alias changes require full recomputation
    // because historical entries now map to different members
    this.cache = null;
  }
}
```

### Cache 4: Entry Index by ID (LOW-MEDIUM IMPACT)

**What to cache:** `Map<entryId, Entry>` for O(1) lookups

**Current:** Each `getEntry(id)` requires finding entry in Loro map and decrypting

**Implementation:**

```typescript
// In AppContext or LoroEntryStore
private entryCache: Map<string, Entry> = new Map();

async getEntryCached(entryId: string, groupKey: CryptoKey): Promise<Entry | null> {
  if (this.entryCache.has(entryId)) {
    return this.entryCache.get(entryId)!;
  }
  const entry = await this.getEntry(entryId, groupKey);
  if (entry) {
    this.entryCache.set(entryId, entry);
  }
  return entry;
}
```

### Cache 5: Settlement Preferences (LOW IMPACT)

**Current:** Read from Loro on every settlement plan calculation

**Better:** Already tracked via `preferencesVersion` signal - just ensure we're not re-reading unnecessarily

---

## 6. Incremental State Updates (No Rollback Needed)

### Why Rollback Isn't Necessary

Given the commutativity insight from Section 3, we don't need complex rollback mechanisms:

| Derived State     | Update Strategy                | Rollback Needed?       |
| ----------------- | ------------------------------ | ---------------------- |
| **Balances**      | Apply delta for each new entry | ❌ No - commutative    |
| **Activities**    | Insert at sorted position      | ❌ No - just insertion |
| **Member States** | Recompute from events          | ❌ No - rare & fast    |

### When Full Recomputation Is Necessary

| Scenario            | Why Full Recompute?                             |
| ------------------- | ----------------------------------------------- |
| Initial load        | No cached state exists                          |
| Member alias change | Historical entries resolve to different members |
| Key rotation        | All entries need re-decryption                  |
| Filter change       | Different entry set needed                      |

**Note:** Remote sync does NOT require full recompute for balances (they're commutative).

### When Delta Updates Suffice

| Scenario              | Delta Approach                                    |
| --------------------- | ------------------------------------------------- |
| Local entry added     | Apply balance delta, insert activity sorted       |
| Local entry deleted   | Reverse balance delta, insert deletion activity   |
| Local entry modified  | Delta = (new - old), insert modification activity |
| Remote entry received | Same as local - order doesn't matter for balances |
| Settlement recorded   | Same as entry added                               |

### Implementation: Incremental State Manager

```typescript
interface DerivedState {
  // Track what we've processed (not "up to what timestamp")
  processedEntryIds: Set<string>;
  processedMemberEventIds: Set<string>;

  // Cached data
  entriesById: Map<string, Entry>;
  activeEntryIds: Set<string>;
  balances: Map<string, Balance>;
  activities: Activity[]; // Sorted by timestamp desc
  memberStates: Map<string, MemberState>;
  canonicalIdMap: Map<string, string>;
}

class IncrementalStateManager {
  private state: DerivedState | null = null;

  /**
   * Handle any update - works for both local changes and remote sync.
   * Because balances are commutative, we don't need to distinguish.
   */
  async handleUpdate(
    store: LoroEntryStore,
    groupKey: CryptoKey,
    groupId: string
  ): Promise<DerivedState> {
    if (!this.state) {
      return this.computeFull(store, groupKey, groupId);
    }

    // Find what's new (works regardless of timestamps)
    const allEntries = await store.getAllEntries(groupId, groupKey);
    const allMemberEvents = store.getMemberEvents();

    const newEntries = allEntries.filter((e) => !this.state!.processedEntryIds.has(e.id));
    const newMemberEvents = allMemberEvents.filter(
      (e) => !this.state!.processedMemberEventIds.has(e.id)
    );

    // Handle member events first (may affect canonical ID resolution)
    if (newMemberEvents.length > 0) {
      this.handleMemberEventsChanged(allMemberEvents);
    }

    // Apply new entries incrementally
    // Order doesn't matter for balances - they're commutative!
    for (const entry of newEntries) {
      this.applyEntry(entry);
    }

    return this.state;
  }

  /**
   * Apply a single entry - works regardless of entry's timestamp
   */
  private applyEntry(entry: Entry): void {
    const state = this.state!;

    // Track as processed
    state.processedEntryIds.add(entry.id);
    state.entriesById.set(entry.id, entry);

    // Handle entry lifecycle
    if (entry.status === 'active' && !entry.previousVersionId) {
      // New entry
      state.activeEntryIds.add(entry.id);
      this.applyBalanceDelta(entry, +1);
    } else if (entry.status === 'active' && entry.previousVersionId) {
      // Modified entry: reverse old, apply new
      const oldEntry = state.entriesById.get(entry.previousVersionId);
      if (oldEntry && state.activeEntryIds.has(entry.previousVersionId)) {
        this.applyBalanceDelta(oldEntry, -1);
        state.activeEntryIds.delete(entry.previousVersionId);
      }
      state.activeEntryIds.add(entry.id);
      this.applyBalanceDelta(entry, +1);
    } else if (entry.status === 'deleted' && entry.previousVersionId) {
      // Deleted entry: reverse the contribution
      const oldEntry = state.entriesById.get(entry.previousVersionId);
      if (oldEntry && state.activeEntryIds.has(entry.previousVersionId)) {
        this.applyBalanceDelta(oldEntry, -1);
        state.activeEntryIds.delete(entry.previousVersionId);
      }
    }

    // Insert activity at correct sorted position
    const activity = this.createActivity(entry);
    this.insertActivitySorted(state.activities, activity);
  }

  /**
   * Apply balance delta - this is COMMUTATIVE
   * sign: +1 for add, -1 for remove
   */
  private applyBalanceDelta(entry: Entry, sign: 1 | -1): void {
    const state = this.state!;
    const resolve = (id: string) => state.canonicalIdMap.get(id) ?? id;
    const amount = entry.defaultCurrencyAmount ?? entry.amount;

    if (entry.type === 'expense') {
      const expense = entry as ExpenseEntry;

      // Update payer balances
      for (const payer of expense.payers) {
        const canonicalId = resolve(payer.memberId);
        const balance = this.getOrCreateBalance(canonicalId);
        balance.totalPaid += sign * payer.amount;
        balance.netBalance = balance.totalPaid - balance.totalOwed;
      }

      // Update beneficiary balances
      const splits = calculateSplits(expense.beneficiaries, amount, resolve);
      for (const [memberId, splitAmount] of splits) {
        const balance = this.getOrCreateBalance(memberId);
        balance.totalOwed += sign * splitAmount;
        balance.netBalance = balance.totalPaid - balance.totalOwed;
      }
    } else {
      const transfer = entry as TransferEntry;
      const fromBalance = this.getOrCreateBalance(resolve(transfer.from));
      const toBalance = this.getOrCreateBalance(resolve(transfer.to));

      fromBalance.totalPaid += sign * amount;
      fromBalance.netBalance = fromBalance.totalPaid - fromBalance.totalOwed;

      toBalance.totalOwed += sign * amount;
      toBalance.netBalance = toBalance.totalPaid - toBalance.totalOwed;
    }
  }

  /**
   * When member events change, we need to:
   * 1. Recompute member states (always)
   * 2. Recompute balances only if canonical IDs changed
   */
  private handleMemberEventsChanged(allMemberEvents: MemberEvent[]): void {
    const state = this.state!;
    const newMemberStates = computeAllMemberStates(allMemberEvents);
    const newCanonicalIdMap = buildCanonicalIdMap(allMemberEvents);

    // Check if aliases changed (requires balance recomputation)
    const aliasesChanged = !this.mapsEqual(state.canonicalIdMap, newCanonicalIdMap);

    state.memberStates = newMemberStates;
    state.canonicalIdMap = newCanonicalIdMap;
    state.processedMemberEventIds = new Set(allMemberEvents.map((e) => e.id));

    if (aliasesChanged) {
      // Must recompute balances - historical entries now resolve differently
      state.balances = this.recomputeBalancesFromEntries();
    }
  }

  // ... helper methods
}
```

### Comparison: Old vs New Understanding

| Aspect         | Old Understanding                | New Understanding               |
| -------------- | -------------------------------- | ------------------------------- |
| Sync model     | "Rollback to fork point, replay" | "Apply new events in any order" |
| State tracking | "Processed up to timestamp T"    | "Set of processed entry IDs"    |
| Remote events  | "May need complex rollback"      | "Just apply deltas"             |
| Complexity     | O(n) replay from rollback point  | O(k) where k = new events       |
| Memory         | Historical state snapshots       | Just current state + ID sets    |

---

## 7. Conflict Handling and Edge Cases

### Concurrent Operation Scenarios

In a distributed offline-first system, concurrent operations can create conflicts. Here's how the current architecture handles them:

#### Scenario 1: Concurrent Member Replacements

```
Peer 1 (online):  A replaced by B  (event E1, t=100)
Peer 2 (offline): A replaced by C  (event E2, t=150)
                  ↓ sync
Both events exist in Loro
```

**Current behavior:**

- Both `member_replaced` events are stored in Loro
- When computing member state, events are sorted by timestamp
- The later event (E2, t=150) overwrites the earlier one
- Result: A → C (last-writer-wins)

#### Scenario 2: Entry Referencing "Stale" Member

```
Peer 1: A replaced by B  (t=100)
Peer 2: Entry with payer=A created (t=150, before knowing about replacement)
        ↓ sync
```

**Current behavior:**

- Entry still has `payer.memberId = A`
- Balance calculation resolves `A → B` via canonical ID map
- Balance is correctly attributed to B
- **Works correctly** due to canonical ID resolution

#### Scenario 3: Entry Referencing Replaced-Twice Member

```
Peer 1: A replaced by B  (t=100)
Peer 2: B replaced by C  (t=200)
Peer 3: Entry with payer=A (t=150, created offline)
        ↓ sync
```

**Current behavior:**

- `resolveCanonicalMemberId(A)` follows the chain: A → B → C
- Entry is attributed to C
- **Works correctly** due to recursive resolution

### Timestamp Ordering

There are **two timestamp systems** in the codebase:

| Timestamp                             | Set By                    | Used For                                 |
| ------------------------------------- | ------------------------- | ---------------------------------------- |
| `event.timestamp` / `entry.createdAt` | **Client** (`Date.now()`) | Sorting member events, activity ordering |
| `record.created` / `record.updated`   | **PocketBase server**     | Sync metadata, database ordering         |

The application logic uses **client-side timestamps** for ordering:

```typescript
// member-state.ts - Events sorted by client timestamp
const memberEvents = events
  .filter((e) => e.memberId === memberId)
  .sort((a, b) => a.timestamp - b.timestamp);
```

**Why client timestamps?**

- Preserves "logical" order (when user intended the action)
- An offline action created at 10:00 but synced at 14:00 is ordered by 10:00
- More intuitive for users

**Collision risk:**

- `Date.now()` has millisecond precision
- Two clients would need to create events at the exact same millisecond
- Very low probability in practice for small trusted groups

### Why Commutativity Is Preserved

Despite potential conflicts, balance commutativity holds because:

1. **Canonical ID resolution is deterministic**
   - Same set of member events → same timestamp ordering → same canonical ID map
   - All devices compute the same resolution

2. **Entry contributions are independent**
   - Each entry adds/subtracts from balances independently
   - Order of entry processing doesn't affect final sums

3. **Conflicts resolve deterministically**
   - Last-writer-wins based on timestamp
   - Same timestamps are extremely rare (millisecond precision)

| Scenario                         | Commutativity Preserved? | Reason                           |
| -------------------------------- | ------------------------ | -------------------------------- |
| Concurrent entries               | ✅ Yes                   | Independent contributions        |
| Concurrent member events         | ✅ Yes                   | Deterministic timestamp ordering |
| Entry references replaced member | ✅ Yes                   | Canonical ID resolution          |
| Concurrent replacements          | ✅ Yes                   | Last-writer-wins by timestamp    |

### Edge Case: Circular Replacement

```
Event 1: A replaced by B
Event 2: B replaced by A  (concurrent, doesn't know about Event 1)
```

**Current handling:**

- `resolveCanonicalMemberId()` has a `maxDepth` parameter (default 10)
- Prevents infinite loops but doesn't detect cycles explicitly
- In practice, this is an unlikely user error scenario

**Recommended improvement** (future):

```typescript
function resolveCanonicalMemberId(
  memberId: string,
  events: MemberEvent[],
  visited: Set<string> = new Set()
): string {
  if (visited.has(memberId)) {
    console.warn(`Circular replacement chain detected involving ${memberId}`);
    return memberId; // Break cycle
  }
  visited.add(memberId);
  // ... rest of resolution
}
```

### Risk Assessment

| Risk                          | Probability                      | Impact                     | Mitigation                    |
| ----------------------------- | -------------------------------- | -------------------------- | ----------------------------- |
| Timestamp collision           | Very low (millisecond precision) | Non-deterministic ordering | Accept risk for simplicity    |
| Concurrent replacements       | Low (rare operation)             | Last-writer-wins           | Acceptable for trusted groups |
| Circular replacement          | Very low (user error)            | maxDepth fallback          | Current handling sufficient   |
| Entry references stale member | Medium                           | Resolved via canonical ID  | Already handled correctly     |

**Decision:** Accept the low collision risk (Option A) rather than adding complexity. The probability of two events having identical millisecond timestamps is negligible for a bill-splitting app with small trusted groups and low event frequency.

---

## 8. Traversal Necessity Analysis

| Function                   | Always Necessary?       | Can Be Cached/Incremental?     |
| -------------------------- | ----------------------- | ------------------------------ |
| `getAllEntries()`          | Only on initial load    | ✅ Cache + track processed IDs |
| `getActiveEntries()`       | On filter change        | ✅ Derive from cached list     |
| `getMemberEvents()`        | Only on member change   | ✅ Cache with version          |
| `calculateBalances()`      | ❌ Never full traversal | ✅ Incremental (commutative!)  |
| `buildCanonicalIdMap()`    | On member alias change  | ✅ Cache with invalidation     |
| `computeAllMemberStates()` | On member event change  | ✅ Cache with invalidation     |
| `generateAllActivities()`  | ❌ Never full traversal | ✅ Sorted insertion per entry  |
| `buildDebtGraph()`         | On balance change       | ✅ Cache, lazy compute         |
| `filterEntries()`          | On filter UI change     | ⚠️ User-triggered, acceptable  |
| `filterActivities()`       | On filter UI change     | ⚠️ User-triggered, acceptable  |

**Key change:** `calculateBalances()` and `generateAllActivities()` can now be fully incremental even during remote sync, thanks to the commutativity insight.

---

## 9. Recommended Implementation Phases

### Phase 1: Quick Wins (Estimated: 1-2 days)

**Goal:** Eliminate redundant computations

1. **Cache `canonicalIdMap`** in `LoroEntryStore`
   - Add `cachedCanonicalIdMap` and `memberEventsVersion` fields
   - Return cached value if member events haven't changed
   - Clear cache on `addMemberEvent()`

2. **Cache `memberStates`** alongside canonical ID map
   - Same invalidation trigger as canonical ID map
   - Used by `members` memo in AppContext

3. **Pass canonical ID map** to all functions
   - Avoid rebuilding in `calculateBalances()`
   - Avoid rebuilding in `generateAllActivities()`
   - Single source of truth per refresh cycle

**Expected improvement:** 60-70% reduction in per-action computation

### Phase 2: Incremental Balances (Estimated: 3-5 days)

**Goal:** O(k) balance updates instead of O(n) where k = new entries

1. Create `IncrementalStateManager` class (see Section 6)
2. Track `processedEntryIds` instead of "last processed timestamp"
3. Implement `applyBalanceDelta()` for commutative updates
4. Works for both local changes AND remote sync (no distinction needed!)
5. Fall back to full computation only on:
   - Initial load
   - Member alias change (canonical IDs change)
   - Key rotation (re-decryption needed)

**Key insight:** Because balance calculations are commutative, remote sync doesn't require special handling. New entries can be applied in any order.

**Expected improvement:** Balance updates drop from O(n) to O(k) where k = number of new entries

### Phase 3: Entry Caching (Estimated: 2-3 days)

**Goal:** Avoid repeated decryption

1. Maintain `Map<entryId, Entry>` in `LoroEntryStore` or `StateManager`
2. Populate on `getAllEntries()` call
3. Update incrementally on create/modify/delete
4. Clear on group switch or key rotation

**Expected improvement:** Eliminate O(n) decryptions on local changes

### Phase 4: Settlement Optimization (Estimated: 1 day)

**Goal:** Lazy, cached settlement plans

1. Cache settlement plan result in `createMemo`
2. Only recompute when:
   - Balances actually changed (not just re-set to same values)
   - At least one balance is non-zero
3. Consider lazy computation (only when Settle tab is active)

**Expected improvement:** Avoid O(d×c) computation on unrelated actions

---

## 10. Architectural Recommendation: CQRS Pattern

The app already uses event sourcing (append-only Loro log). The natural evolution is **CQRS (Command Query Responsibility Segregation)** with materialized views:

```
                     ┌────────────────────┐
                     │  Loro Event Log    │
                     │  (Source of Truth) │
                     └─────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
  │ Balance View  │   │ Activity View │   │ Member View   │
  │ (materialized)│   │ (materialized)│   │ (materialized)│
  └───────────────┘   └───────────────┘   └───────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                               ▼
                     ┌────────────────────┐
                     │   UI Components    │
                     │ (read from views)  │
                     └────────────────────┘
```

Each view:

- Is built once on initial load
- Is updated incrementally on local changes
- Is rebuilt on sync (when multiple remote events arrive)
- Is invalidated when dependencies change (e.g., member aliases)

---

## 11. Summary

| Issue                     | Current Cost         | After Optimization              |
| ------------------------- | -------------------- | ------------------------------- |
| Canonical ID map rebuilds | O(m²) × 3 per action | O(m²) × 1 on member change only |
| Entry decryption          | O(n) per action      | O(k) for k new entries          |
| Balance calculation       | O(n) per action      | O(k) for k new entries          |
| Activity generation       | O(n log n)           | O(k log n) sorted insertions    |
| Settlement plan           | O(d × c) per action  | Lazy, cached                    |
| Remote sync               | O(n) full recompute  | O(k) incremental (commutative!) |

### Key Architectural Insight

**Balance calculations are commutative.** This means:

- Order of entry processing doesn't matter for final balances
- Remote sync doesn't require "rollback and replay"
- New entries (local or remote) can be applied incrementally
- Only member alias changes require balance recomputation

This simplifies the implementation significantly compared to a rollback-based approach.

**Bottom line:** The current implementation prioritizes correctness and simplicity. As groups grow (100+ entries, 10+ members), implementing the caching strategy in Phase 1-2 will provide significant performance improvements with minimal architectural changes. The commutativity insight means remote sync is no longer a special case requiring full recomputation.

---

## Appendix: Performance Testing Recommendations

To validate improvements, measure:

1. **Time to add entry** with varying group sizes (10, 50, 100, 500 entries)
2. **Time to initial load** after sync
3. **Memory usage** of cached structures
4. **Battery impact** on mobile (crypto operations are CPU-intensive)

Recommended tools:

- Chrome DevTools Performance tab
- `performance.now()` measurements around critical paths
- React/Solid DevTools for render frequency
