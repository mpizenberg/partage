/**
 * Incremental State Manager
 *
 * Manages incrementally-updated derived state following the CQRS pattern.
 * The key insight is that balance calculations are COMMUTATIVE - entry order
 * doesn't matter for final sums, enabling incremental updates for both
 * local changes and remote sync without rollback mechanisms.
 *
 * Architecture:
 * ```
 * Loro Event Log (Source of Truth)
 *          │
 *     ┌────┼────┐
 *     ↓    ↓    ↓
 * Balance  Activity  Member
 *  Cache    Cache    Cache
 * (incremental updates via commutative deltas)
 * ```
 */

import type {
  Entry,
  ExpenseEntry,
  TransferEntry,
  Balance,
  Activity,
  Member,
  MemberEvent,
  MemberState,
} from '@partage/shared';
import { computeAllMemberStates, buildCanonicalIdMap } from '../members/member-state.js';
import {
  generateActivityForNewEntry,
  generateActivityForModifiedEntry,
  generateActivityForDeletedEntry,
  generateActivityForUndeletedEntry,
  insertActivitySorted,
  generateActivitiesFromMemberEvents,
  generateAllActivities as generateAllActivitiesFromModule,
} from '../calculations/activity-generator.js';
import { calculateBalances } from '../calculations/balance-calculator.js';
import type { LoroEntryStore } from '../../core/crdt/loro-wrapper.js';

/**
 * Derived state maintained incrementally
 */
export interface DerivedState {
  // Track what's processed (IDs, not timestamps)
  processedEntryIds: Set<string>;
  processedMemberEventIds: Set<string>;

  // Cached decrypted entries
  entriesById: Map<string, Entry>;
  activeEntryIds: Set<string>;
  supersededEntryIds: Set<string>;

  // Materialized views
  balances: Map<string, Balance>;
  activities: Activity[];

  // Member caches
  memberStates: Map<string, MemberState>;
  canonicalIdMap: Map<string, string>;
  memberEventsVersion: number;
}

/**
 * Result of a state update operation
 */
export interface StateUpdateResult {
  balancesChanged: boolean;
  activitiesChanged: boolean;
  membersChanged: boolean;
  newEntryCount: number;
  newMemberEventCount: number;
}

/**
 * Manages incrementally-updated derived state for a group.
 *
 * This class implements the CQRS pattern with materialized views:
 * - Balance View: Updated incrementally via commutative deltas
 * - Activity View: Updated via sorted insertion
 * - Member View: Recomputed on member event changes (rare)
 */
export class IncrementalStateManager {
  private state: DerivedState | null = null;
  private currentGroupId: string | null = null;

  /**
   * Initialize state on group selection.
   * Performs full computation from scratch.
   */
  async initialize(
    store: LoroEntryStore,
    groupKey: CryptoKey,
    groupId: string,
    members: Member[]
  ): Promise<DerivedState> {
    // Get all data from Loro
    const allEntries = await store.getAllEntries(groupId, groupKey);
    const memberEvents = store.getMemberEvents();

    // Build member state caches
    const memberStates = computeAllMemberStates(memberEvents);
    const canonicalIdMap = buildCanonicalIdMap(memberEvents);

    // Build entry caches
    const entriesById = new Map<string, Entry>();
    const supersededEntryIds = new Set<string>();

    for (const entry of allEntries) {
      entriesById.set(entry.id, entry);
      if (entry.previousVersionId) {
        supersededEntryIds.add(entry.previousVersionId);
      }
    }

    // Compute active entry IDs (not superseded, status=active)
    const activeEntryIds = new Set<string>();
    for (const entry of allEntries) {
      if (entry.status === 'active' && !supersededEntryIds.has(entry.id)) {
        activeEntryIds.add(entry.id);
      }
    }

    // Get active entries for balance calculation
    const activeEntries = Array.from(activeEntryIds)
      .map((id) => entriesById.get(id)!)
      .filter(Boolean);

    // Calculate balances with pre-computed canonical ID map
    const balances = calculateBalances(activeEntries, canonicalIdMap);

    // Generate activities from entries and member events
    const activities = this.generateAllActivities(
      allEntries,
      memberEvents,
      members,
      groupId,
      canonicalIdMap
    );

    // Create initial state
    this.state = {
      processedEntryIds: new Set(allEntries.map((e) => e.id)),
      processedMemberEventIds: new Set(memberEvents.map((e) => e.id)),
      entriesById,
      activeEntryIds,
      supersededEntryIds,
      balances,
      activities,
      memberStates,
      canonicalIdMap,
      memberEventsVersion: memberEvents.length,
    };

    this.currentGroupId = groupId;
    return this.state;
  }

  /**
   * Handle updates (works for local AND remote changes - commutative!).
   *
   * The key insight: because balance calculations are commutative, we don't
   * need to distinguish between local and remote events. New entries can
   * be applied incrementally in any order.
   */
  async handleUpdate(
    store: LoroEntryStore,
    groupKey: CryptoKey,
    groupId: string,
    members: Member[]
  ): Promise<{ state: DerivedState; result: StateUpdateResult }> {
    // If no cached state or group changed, initialize from scratch
    if (!this.state || this.currentGroupId !== groupId) {
      const state = await this.initialize(store, groupKey, groupId, members);
      return {
        state,
        result: {
          balancesChanged: true,
          activitiesChanged: true,
          membersChanged: true,
          newEntryCount: state.processedEntryIds.size,
          newMemberEventCount: state.processedMemberEventIds.size,
        },
      };
    }

    // Get member events
    const memberEvents = store.getMemberEvents();
    const newMemberEvents = memberEvents.filter(
      (e) => !this.state!.processedMemberEventIds.has(e.id)
    );

    // OPTIMIZATION: Only decrypt new entries, not all entries
    // Get all entry IDs without decrypting
    const allEntryIds = store.getEntryIds();

    // Find which entry IDs are new (not yet processed)
    const newEntryIds = allEntryIds.filter((id) => !this.state!.processedEntryIds.has(id));

    // Only decrypt the new entries (O(k) instead of O(n))
    const newEntries = await store.getEntriesByIds(newEntryIds, groupId, groupKey);

    let balancesChanged = false;
    let activitiesChanged = false;
    let membersChanged = false;

    // Handle member events first (may affect canonical ID resolution)
    if (newMemberEvents.length > 0) {
      const aliasChanged = this.handleMemberEventsChanged(memberEvents, members, groupId);
      membersChanged = true;
      // New member events generate activities (joins, renames, retirements, etc.)
      activitiesChanged = true;
      if (aliasChanged) {
        // Aliases changed - must recompute balances from all active entries
        const activeEntries = Array.from(this.state.activeEntryIds)
          .map((id) => this.state!.entriesById.get(id)!)
          .filter(Boolean);
        this.state.balances = calculateBalances(activeEntries, this.state.canonicalIdMap);
        balancesChanged = true;
      }
    }

    // Apply new entries incrementally
    // Order doesn't matter for balances - they're commutative!
    for (const entry of newEntries) {
      const { balanceChanged, activityAdded } = this.applyEntry(entry, members, groupId);
      if (balanceChanged) balancesChanged = true;
      if (activityAdded) activitiesChanged = true;
    }

    return {
      state: this.state,
      result: {
        balancesChanged,
        activitiesChanged,
        membersChanged,
        newEntryCount: newEntries.length,
        newMemberEventCount: newMemberEvents.length,
      },
    };
  }

  /**
   * Apply a single entry incrementally.
   * Works regardless of entry's timestamp due to commutativity.
   */
  private applyEntry(
    entry: Entry,
    members: Member[],
    groupId: string
  ): { balanceChanged: boolean; activityAdded: boolean } {
    const state = this.state!;

    // Track as processed
    state.processedEntryIds.add(entry.id);
    state.entriesById.set(entry.id, entry);

    let balanceChanged = false;
    let activityAdded = false;

    // Track superseded entries
    if (entry.previousVersionId) {
      state.supersededEntryIds.add(entry.previousVersionId);
    }

    // Handle entry lifecycle
    if (entry.status === 'active' && !entry.previousVersionId) {
      // New entry (not a modification)
      state.activeEntryIds.add(entry.id);
      this.applyBalanceDelta(entry, +1);
      balanceChanged = true;

      // Insert activity
      const activity = generateActivityForNewEntry(entry, members, groupId, state.canonicalIdMap);
      state.activities = insertActivitySorted(state.activities, activity);
      activityAdded = true;
    } else if (entry.status === 'active' && entry.previousVersionId) {
      // Check if this is an undelete operation
      const oldEntry = state.entriesById.get(entry.previousVersionId);
      const isUndelete = oldEntry && oldEntry.status === 'deleted';

      if (oldEntry && state.activeEntryIds.has(entry.previousVersionId)) {
        // Reverse old entry if it was active
        this.applyBalanceDelta(oldEntry, -1);
        state.activeEntryIds.delete(entry.previousVersionId);
      }
      state.activeEntryIds.add(entry.id);
      this.applyBalanceDelta(entry, +1);
      balanceChanged = true;

      // Insert appropriate activity (undeleted or modified)
      const activity = isUndelete
        ? generateActivityForUndeletedEntry(entry, members, groupId, state.canonicalIdMap)
        : generateActivityForModifiedEntry(
            entry,
            oldEntry || null,
            members,
            groupId,
            state.canonicalIdMap
          );
      state.activities = insertActivitySorted(state.activities, activity);
      activityAdded = true;
    } else if (entry.status === 'deleted' && entry.previousVersionId) {
      // Deleted entry: reverse the contribution
      const oldEntry = state.entriesById.get(entry.previousVersionId);
      if (oldEntry && state.activeEntryIds.has(entry.previousVersionId)) {
        this.applyBalanceDelta(oldEntry, -1);
        state.activeEntryIds.delete(entry.previousVersionId);
        balanceChanged = true;
      }

      // Insert deletion activity
      const activity = generateActivityForDeletedEntry(
        entry,
        members,
        groupId,
        state.canonicalIdMap
      );
      state.activities = insertActivitySorted(state.activities, activity);
      activityAdded = true;
    }

    return { balanceChanged, activityAdded };
  }

  /**
   * Apply balance delta - this is COMMUTATIVE.
   * sign: +1 for add, -1 for remove
   */
  private applyBalanceDelta(entry: Entry, sign: 1 | -1): void {
    const state = this.state!;
    const resolve = (id: string) => state.canonicalIdMap.get(id) ?? id;
    const amount = entry.defaultCurrencyAmount ?? entry.amount;

    if (entry.type === 'expense') {
      const expense = entry as ExpenseEntry;

      // Calculate total paid in default currency
      const totalOriginalAmount = expense.payers.reduce((sum, p) => sum + p.amount, 0);

      // Update payer balances (proportional conversion to default currency)
      for (const payer of expense.payers) {
        const canonicalId = resolve(payer.memberId);
        const balance = this.getOrCreateBalance(canonicalId);
        // Proportional conversion: payer's share of defaultCurrencyAmount
        const payerDefaultAmount =
          totalOriginalAmount > 0 ? (payer.amount / totalOriginalAmount) * amount : 0;
        balance.totalPaid += sign * payerDefaultAmount;
        balance.netBalance = balance.totalPaid - balance.totalOwed;
      }

      // Update beneficiary balances
      const splits = this.calculateSplits(expense.beneficiaries, amount, resolve);
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
   * Calculate split amounts based on beneficiaries.
   * Uses integer arithmetic (cents) to avoid rounding errors.
   */
  private calculateSplits(
    beneficiaries: ExpenseEntry['beneficiaries'],
    totalAmount: number,
    resolve: (id: string) => string
  ): Map<string, number> {
    const splits = new Map<string, number>();

    // Separate by split type
    const sharesBeneficiaries = beneficiaries.filter((b) => b.splitType === 'shares');
    const exactBeneficiaries = beneficiaries.filter((b) => b.splitType === 'exact');

    // Calculate exact amounts first
    let exactTotal = 0;
    for (const beneficiary of exactBeneficiaries) {
      const amount = beneficiary.amount ?? 0;
      const canonicalId = resolve(beneficiary.memberId);
      splits.set(canonicalId, (splits.get(canonicalId) ?? 0) + amount);
      exactTotal += amount;
    }

    // Calculate shares from remaining amount
    if (sharesBeneficiaries.length > 0) {
      const remainingAmount = totalAmount - exactTotal;
      const totalShares = sharesBeneficiaries.reduce((sum, b) => sum + (b.shares ?? 1), 0);

      // Convert to cents for integer arithmetic
      const remainingCents = Math.round(remainingAmount * 100);
      const centsPerShare = Math.floor(remainingCents / totalShares);
      let remainderCents = remainingCents - centsPerShare * totalShares;

      // Sort beneficiaries for deterministic distribution
      const sortedBeneficiaries = [...sharesBeneficiaries].sort((a, b) =>
        resolve(a.memberId).localeCompare(resolve(b.memberId))
      );

      for (const beneficiary of sortedBeneficiaries) {
        const shares = beneficiary.shares ?? 1;
        let amountCents = centsPerShare * shares;

        // Distribute remainder
        if (remainderCents > 0 && shares > 0) {
          const extraCents = Math.min(remainderCents, shares);
          amountCents += extraCents;
          remainderCents -= extraCents;
        }

        const canonicalId = resolve(beneficiary.memberId);
        splits.set(canonicalId, (splits.get(canonicalId) ?? 0) + amountCents / 100);
      }
    }

    return splits;
  }

  /**
   * Get or create a balance entry for a member.
   */
  private getOrCreateBalance(memberId: string): Balance {
    const state = this.state!;
    let balance = state.balances.get(memberId);
    if (!balance) {
      balance = {
        memberId,
        totalPaid: 0,
        totalOwed: 0,
        netBalance: 0,
      };
      state.balances.set(memberId, balance);
    }
    return balance;
  }

  /**
   * Handle member event changes.
   * Returns true if canonical ID mappings changed (requiring balance recomputation).
   */
  private handleMemberEventsChanged(
    allMemberEvents: MemberEvent[],
    members: Member[],
    groupId: string
  ): boolean {
    const state = this.state!;

    // IMPORTANT: Find new events BEFORE marking them as processed
    const newMemberEvents = allMemberEvents.filter((e) => !state.processedMemberEventIds.has(e.id));

    const newMemberStates = computeAllMemberStates(allMemberEvents);
    const newCanonicalIdMap = buildCanonicalIdMap(allMemberEvents);

    // Check if aliases changed (requires balance recomputation)
    const aliasesChanged = !this.mapsEqual(state.canonicalIdMap, newCanonicalIdMap);

    // Update member state caches
    state.memberStates = newMemberStates;
    state.canonicalIdMap = newCanonicalIdMap;
    state.memberEventsVersion = allMemberEvents.length;

    // Track all member events as processed (after filtering for new ones)
    for (const event of allMemberEvents) {
      state.processedMemberEventIds.add(event.id);
    }

    // Generate activities for new member events
    if (newMemberEvents.length > 0) {
      const memberActivities = generateActivitiesFromMemberEvents(
        newMemberEvents,
        members,
        state.canonicalIdMap
      );
      // Set groupId for member activities (function returns them with empty groupId)
      for (const activity of memberActivities) {
        activity.groupId = groupId;
        state.activities = insertActivitySorted(state.activities, activity);
      }
    }

    return aliasesChanged;
  }

  /**
   * Generate all activities from entries and member events.
   */
  private generateAllActivities(
    allEntries: Entry[],
    memberEvents: MemberEvent[],
    members: Member[],
    groupId: string,
    canonicalIdMap: Map<string, string>
  ): Activity[] {
    return generateAllActivitiesFromModule(
      allEntries,
      members,
      groupId,
      memberEvents,
      canonicalIdMap
    );
  }

  /**
   * Compare two maps for equality.
   */
  private mapsEqual(map1: Map<string, string>, map2: Map<string, string>): boolean {
    if (map1.size !== map2.size) return false;
    for (const [key, value] of map1) {
      if (map2.get(key) !== value) return false;
    }
    return true;
  }

  /**
   * Clear state on group switch.
   */
  clear(): void {
    this.state = null;
    this.currentGroupId = null;
  }

  /**
   * Force full recompute (for key rotation, alias changes).
   */
  invalidate(): void {
    this.state = null;
  }

  /**
   * Get current state (for read-only access).
   */
  getState(): DerivedState | null {
    return this.state;
  }

  /**
   * Check if state is initialized.
   */
  isInitialized(): boolean {
    return this.state !== null;
  }

  /**
   * Get the current group ID.
   */
  getCurrentGroupId(): string | null {
    return this.currentGroupId;
  }
}
