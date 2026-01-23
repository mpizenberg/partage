/**
 * Activity Feed Generator
 * Derives activities from entries and members to create an audit trail
 */

import type {
  Activity,
  Entry,
  Member,
  EntryAddedActivity,
  EntryModifiedActivity,
  EntryDeletedActivity,
  EntryUndeletedActivity,
  MemberJoinedActivity,
  MemberLinkedActivity,
  MemberRenamedActivity,
  MemberRetiredActivity,
  GroupMetadataUpdatedActivity,
  ActivityFilter,
  ExpenseEntry,
  TransferEntry,
  MemberEvent,
  MemberCreatedEvent,
  MemberRenamedEvent,
  MemberReplacedEvent,
  GroupMetadataUpdatedEvent,
} from '@partage/shared';

// =============================================================================
// Shared Helper Functions
// =============================================================================

/**
 * Create a member lookup map and name resolver with alias resolution
 */
function createMemberHelpers(members: Member[], canonicalIdMap?: Map<string, string>) {
  const memberMap = new Map(members.map((m) => [m.id, m]));

  const getMemberName = (memberId: string): string => {
    // First resolve to canonical ID if we have alias info
    const canonicalId = canonicalIdMap?.get(memberId) ?? memberId;
    return memberMap.get(canonicalId)?.name || memberMap.get(memberId)?.name || 'Unknown';
  };

  return { memberMap, getMemberName };
}

/**
 * Get entry description
 */
function getEntryDescription(entry: Entry): string {
  if (entry.type === 'expense') {
    return (entry as ExpenseEntry).description;
  }
  return 'Transfer';
}

/**
 * Build participant data with names for an entry
 */
function getParticipantData(
  entry: Entry,
  getMemberName: (id: string) => string
): Record<string, unknown> {
  if (entry.type === 'expense') {
    const expense = entry as ExpenseEntry;
    const payerIds = expense.payers.map((p) => p.memberId);
    const beneficiaryIds = expense.beneficiaries.map((b) => b.memberId);

    const payerNames: Record<string, string> = {};
    for (const id of payerIds) {
      payerNames[id] = getMemberName(id);
    }

    const beneficiaryNames: Record<string, string> = {};
    for (const id of beneficiaryIds) {
      beneficiaryNames[id] = getMemberName(id);
    }

    return {
      payers: payerIds,
      payerNames,
      beneficiaries: beneficiaryIds,
      beneficiaryNames,
    };
  } else if (entry.type === 'transfer') {
    const transfer = entry as TransferEntry;
    return {
      from: transfer.from,
      fromName: getMemberName(transfer.from),
      to: transfer.to,
      toName: getMemberName(transfer.to),
    };
  }
  return {};
}

/**
 * Calculate changes between two entries
 */
function calculateChanges(
  oldEntry: Entry,
  newEntry: Entry
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  // Check common fields
  if (oldEntry.amount !== newEntry.amount) {
    changes.amount = { from: oldEntry.amount, to: newEntry.amount };
  }
  if (oldEntry.currency !== newEntry.currency) {
    changes.currency = { from: oldEntry.currency, to: newEntry.currency };
  }
  if (oldEntry.date !== newEntry.date) {
    changes.date = { from: oldEntry.date, to: newEntry.date };
  }
  if (oldEntry.notes !== newEntry.notes) {
    changes.notes = { from: oldEntry.notes, to: newEntry.notes };
  }
  if (oldEntry.defaultCurrencyAmount !== newEntry.defaultCurrencyAmount) {
    changes.defaultCurrencyAmount = {
      from: oldEntry.defaultCurrencyAmount,
      to: newEntry.defaultCurrencyAmount,
    };
  }

  // Check expense-specific fields
  if (oldEntry.type === 'expense' && newEntry.type === 'expense') {
    const oldExpense = oldEntry as ExpenseEntry;
    const newExpense = newEntry as ExpenseEntry;

    if (oldExpense.description !== newExpense.description) {
      changes.description = { from: oldExpense.description, to: newExpense.description };
    }
    if (oldExpense.category !== newExpense.category) {
      changes.category = { from: oldExpense.category, to: newExpense.category };
    }

    // Check payer changes - but filter out if it's a single payer and only the amount changed
    const payersChanged = JSON.stringify(oldExpense.payers) !== JSON.stringify(newExpense.payers);
    if (payersChanged) {
      const isSinglePayer = oldExpense.payers.length === 1 && newExpense.payers.length === 1;
      const samePayer =
        isSinglePayer && oldExpense.payers[0]?.memberId === newExpense.payers[0]?.memberId;
      const onlyAmountChanged =
        samePayer && oldExpense.payers[0]?.amount !== newExpense.payers[0]?.amount;

      if (!onlyAmountChanged) {
        changes.payers = { from: oldExpense.payers, to: newExpense.payers };
      }
    }

    if (JSON.stringify(oldExpense.beneficiaries) !== JSON.stringify(newExpense.beneficiaries)) {
      changes.beneficiaries = { from: oldExpense.beneficiaries, to: newExpense.beneficiaries };
    }
  }

  // Check transfer-specific fields
  if (oldEntry.type === 'transfer' && newEntry.type === 'transfer') {
    const oldTransfer = oldEntry as TransferEntry;
    const newTransfer = newEntry as TransferEntry;

    if (oldTransfer.from !== newTransfer.from) {
      changes.from = { from: oldTransfer.from, to: newTransfer.from };
    }
    if (oldTransfer.to !== newTransfer.to) {
      changes.to = { from: oldTransfer.to, to: newTransfer.to };
    }
  }

  return changes;
}

// =============================================================================
// Entry Activity Generation
// =============================================================================

/**
 * Generate activities from entries (all versions)
 */
export function generateActivitiesFromEntries(
  entries: Entry[],
  members: Member[],
  canonicalIdMap?: Map<string, string>
): Activity[] {
  const activities: Activity[] = [];
  const { getMemberName } = createMemberHelpers(members, canonicalIdMap);
  const entryMap = new Map(entries.map((e) => [e.id, e]));

  for (const entry of entries) {
    const actorName = getMemberName(entry.createdBy);
    const description = getEntryDescription(entry);
    const participantData = getParticipantData(entry, getMemberName);

    if (!entry.previousVersionId) {
      // New entry (version 1)
      const activity: EntryAddedActivity = {
        id: `activity-${entry.id}`,
        type: 'entry_added',
        timestamp: entry.createdAt,
        actorId: entry.createdBy,
        actorName,
        groupId: entry.groupId,
        entryId: entry.id,
        entryType: entry.type,
        description,
        amount: entry.amount,
        currency: entry.currency || 'USD',
        defaultCurrencyAmount: entry.defaultCurrencyAmount,
        entryDate: entry.date,
        ...participantData,
      };
      activities.push(activity);
    } else {
      const previousEntry = entryMap.get(entry.previousVersionId);

      if (entry.status === 'deleted') {
        const activity: EntryDeletedActivity = {
          id: `activity-${entry.id}`,
          type: 'entry_deleted',
          timestamp: entry.deletedAt || entry.createdAt,
          actorId: entry.deletedBy || entry.createdBy,
          actorName: getMemberName(entry.deletedBy || entry.createdBy),
          groupId: entry.groupId,
          entryId: entry.id,
          originalEntryId: entry.previousVersionId,
          entryType: entry.type,
          description,
          amount: entry.amount,
          currency: entry.currency || 'USD',
          defaultCurrencyAmount: entry.defaultCurrencyAmount,
          entryDate: entry.date,
          ...participantData,
          reason: entry.deletionReason,
        };
        activities.push(activity);
      } else if (previousEntry && previousEntry.status === 'deleted') {
        const activity: EntryUndeletedActivity = {
          id: `activity-${entry.id}`,
          type: 'entry_undeleted',
          timestamp: entry.modifiedAt || entry.createdAt,
          actorId: entry.modifiedBy || entry.createdBy,
          actorName: getMemberName(entry.modifiedBy || entry.createdBy),
          groupId: entry.groupId,
          entryId: entry.id,
          originalEntryId: entry.previousVersionId,
          entryType: entry.type,
          description,
          amount: entry.amount,
          currency: entry.currency || 'USD',
          defaultCurrencyAmount: entry.defaultCurrencyAmount,
          entryDate: entry.date,
          ...participantData,
        };
        activities.push(activity);
      } else if (entry.modifiedAt && entry.modifiedBy) {
        const changes = previousEntry ? calculateChanges(previousEntry, entry) : {};
        const activity: EntryModifiedActivity = {
          id: `activity-${entry.id}`,
          type: 'entry_modified',
          timestamp: entry.modifiedAt,
          actorId: entry.modifiedBy,
          actorName: getMemberName(entry.modifiedBy),
          groupId: entry.groupId,
          entryId: entry.id,
          originalEntryId: entry.previousVersionId,
          entryType: entry.type,
          description,
          amount: entry.amount,
          currency: entry.currency || 'USD',
          defaultCurrencyAmount: entry.defaultCurrencyAmount,
          entryDate: entry.date,
          ...participantData,
          changes,
        };
        activities.push(activity);
      }
    }
  }

  return activities;
}

// =============================================================================
// Member Activity Generation
// =============================================================================

/**
 * Generate activities from member events (historical)
 * This produces activities with the correct names at the time of each event,
 * plus the current name annotation when it differs from the historical name
 */
export function generateActivitiesFromMemberEvents(
  memberEvents: MemberEvent[],
  members: Member[],
  canonicalIdMap?: Map<string, string>
): Activity[] {
  const activities: Activity[] = [];

  // Build current name lookup from members array
  const currentNameMap = new Map(members.map((m) => [m.id, m.name]));

  // Helper to get current name, returns undefined if same as historical
  // Resolves to canonical ID first to handle replaced members
  const getCurrentNameIfDifferent = (
    memberId: string,
    historicalName: string
  ): string | undefined => {
    const canonicalId = canonicalIdMap?.get(memberId) ?? memberId;
    const current = currentNameMap.get(canonicalId) || currentNameMap.get(memberId);
    return current && current !== historicalName ? current : undefined;
  };

  // Track member names through events
  const memberNameAtEvent = new Map<string, string>();

  // Collect members who are "replacers" - they shouldn't get a "joined" activity
  // because their join is represented by the "linked" activity
  const replacerMemberIds = new Set<string>();
  for (const event of memberEvents) {
    if (event.type === 'member_replaced') {
      const replacedEvent = event as MemberReplacedEvent;
      replacerMemberIds.add(replacedEvent.replacedById);
    }
  }

  // First pass: collect initial names from creation events
  for (const event of memberEvents) {
    if (event.type === 'member_created') {
      const createdEvent = event as MemberCreatedEvent;
      memberNameAtEvent.set(event.memberId, createdEvent.name);
    }
  }

  // Sort events by timestamp
  const sortedEvents = [...memberEvents].sort((a, b) => a.timestamp - b.timestamp);

  // Helper to get actor name
  const getActorName = (actorId: string): string => {
    const tracked = memberNameAtEvent.get(actorId);
    if (tracked) return tracked;
    return currentNameMap.get(actorId) || 'Unknown';
  };

  for (const event of sortedEvents) {
    switch (event.type) {
      case 'member_created': {
        const createdEvent = event as MemberCreatedEvent;
        // Skip "joined" activity for members who are replacers
        // Their joining is represented by the "linked" activity
        if (replacerMemberIds.has(event.memberId)) {
          break;
        }
        const activity: MemberJoinedActivity = {
          id: `activity-event-${event.id}`,
          type: 'member_joined',
          timestamp: event.timestamp,
          actorId: event.actorId,
          actorName: getActorName(event.actorId),
          groupId: '',
          memberId: event.memberId,
          memberName: createdEvent.name,
          isVirtual: createdEvent.isVirtual,
          currentName: getCurrentNameIfDifferent(event.memberId, createdEvent.name),
        };
        activities.push(activity);
        break;
      }

      case 'member_renamed': {
        const renamedEvent = event as MemberRenamedEvent;
        const activity: MemberRenamedActivity = {
          id: `activity-event-${event.id}`,
          type: 'member_renamed',
          timestamp: event.timestamp,
          actorId: event.actorId,
          actorName: getActorName(event.actorId),
          groupId: '',
          memberId: event.memberId,
          oldName: renamedEvent.previousName,
          newName: renamedEvent.newName,
          currentName: getCurrentNameIfDifferent(event.memberId, renamedEvent.newName),
        };
        activities.push(activity);
        memberNameAtEvent.set(event.memberId, renamedEvent.newName);
        break;
      }

      case 'member_retired': {
        const memberName = memberNameAtEvent.get(event.memberId) || 'Unknown';
        const activity: MemberRetiredActivity = {
          id: `activity-event-${event.id}`,
          type: 'member_retired',
          timestamp: event.timestamp,
          actorId: event.actorId,
          actorName: getActorName(event.actorId),
          groupId: '',
          memberId: event.memberId,
          memberName,
          currentName: getCurrentNameIfDifferent(event.memberId, memberName),
        };
        activities.push(activity);
        break;
      }

      case 'member_replaced': {
        const replacedEvent = event as MemberReplacedEvent;
        const existingMemberName = memberNameAtEvent.get(event.memberId) || 'Unknown';
        const newMemberName = memberNameAtEvent.get(replacedEvent.replacedById) || 'Unknown';
        const activity: MemberLinkedActivity = {
          id: `activity-event-${event.id}`,
          type: 'member_linked',
          timestamp: event.timestamp,
          actorId: event.actorId,
          actorName: getActorName(event.actorId),
          groupId: '',
          newMemberId: replacedEvent.replacedById,
          newMemberName,
          existingMemberId: event.memberId,
          existingMemberName,
          currentName: getCurrentNameIfDifferent(replacedEvent.replacedById, newMemberName),
        };
        activities.push(activity);
        break;
      }
    }
  }

  return activities;
}

// =============================================================================
// Group Metadata Activity Generation
// =============================================================================

/**
 * Generate activities from group metadata events (historical)
 */
export function generateActivitiesFromGroupMetadataEvents(
  groupMetadataEvents: Array<GroupMetadataUpdatedEvent & { previousName?: string }>,
  members: Member[],
  groupId: string
): Activity[] {
  const activities: Activity[] = [];

  // Build current name lookup from members array
  const currentNameMap = new Map(members.map((m) => [m.id, m.name]));

  // Helper to get actor name
  const getActorName = (actorId: string): string => {
    return currentNameMap.get(actorId) || 'Unknown';
  };

  for (const event of groupMetadataEvents) {
    const activity: GroupMetadataUpdatedActivity = {
      id: `activity-event-${event.id}`,
      type: 'group_metadata_updated',
      timestamp: event.timestamp,
      actorId: event.actorId,
      actorName: getActorName(event.actorId),
      groupId,
      previousName: event.previousName,
      newName: event.name,
    };
    activities.push(activity);
  }

  return activities;
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Generate all activities and sort by timestamp (newest first)
 */
export function generateAllActivities(
  entries: Entry[],
  members: Member[],
  groupId: string,
  memberEvents: MemberEvent[] = [],
  canonicalIdMap?: Map<string, string>,
  groupMetadataEvents: Array<GroupMetadataUpdatedEvent & { previousName?: string }> = []
): Activity[] {
  const entryActivities = generateActivitiesFromEntries(entries, members, canonicalIdMap);
  const memberActivities = generateActivitiesFromMemberEvents(
    memberEvents,
    members,
    canonicalIdMap
  );
  const groupMetadataActivities = generateActivitiesFromGroupMetadataEvents(
    groupMetadataEvents,
    members,
    groupId
  );

  // Set groupId for member activities
  memberActivities.forEach((activity) => {
    activity.groupId = groupId;
  });

  // Combine and sort by timestamp (newest first)
  const allActivities = [...entryActivities, ...memberActivities, ...groupMetadataActivities];
  allActivities.sort((a, b) => b.timestamp - a.timestamp);

  return allActivities;
}

/**
 * Filter activities based on criteria
 */
export function filterActivities(activities: Activity[], filter: ActivityFilter): Activity[] {
  let filtered = activities;

  if (filter.types && filter.types.length > 0) {
    filtered = filtered.filter((activity) => filter.types!.includes(activity.type));
  }

  if (filter.actorIds && filter.actorIds.length > 0) {
    filtered = filtered.filter((activity) => filter.actorIds!.includes(activity.actorId));
  }

  if (filter.memberIds && filter.memberIds.length > 0) {
    filtered = filtered.filter((activity) => {
      // Check if any of the filter member IDs are involved in this activity
      const filterMemberSet = new Set(filter.memberIds);

      // For entry activities, check payers, beneficiaries, from, to
      if (
        activity.type === 'entry_added' ||
        activity.type === 'entry_modified' ||
        activity.type === 'entry_deleted' ||
        activity.type === 'entry_undeleted'
      ) {
        const entryActivity = activity as any;

        // Check payers
        if (entryActivity.payers) {
          for (const payerId of entryActivity.payers) {
            if (filterMemberSet.has(payerId)) return true;
          }
        }

        // Check beneficiaries
        if (entryActivity.beneficiaries) {
          for (const benId of entryActivity.beneficiaries) {
            if (filterMemberSet.has(benId)) return true;
          }
        }

        // Check from/to (for transfers)
        if (entryActivity.from && filterMemberSet.has(entryActivity.from)) return true;
        if (entryActivity.to && filterMemberSet.has(entryActivity.to)) return true;
      }

      // For member activities, check the member ID
      if (
        activity.type === 'member_joined' ||
        activity.type === 'member_renamed' ||
        activity.type === 'member_retired'
      ) {
        const memberActivity = activity as any;
        if (memberActivity.memberId && filterMemberSet.has(memberActivity.memberId)) return true;
      }

      // For member linked activity, check both member IDs
      if (activity.type === 'member_linked') {
        const linkedActivity = activity as any;
        if (linkedActivity.newMemberId && filterMemberSet.has(linkedActivity.newMemberId))
          return true;
        if (linkedActivity.existingMemberId && filterMemberSet.has(linkedActivity.existingMemberId))
          return true;
      }

      return false;
    });
  }

  if (filter.startDate !== undefined) {
    filtered = filtered.filter((activity) => activity.timestamp >= filter.startDate!);
  }
  if (filter.endDate !== undefined) {
    filtered = filtered.filter((activity) => activity.timestamp <= filter.endDate!);
  }

  if (filter.entryId) {
    filtered = filtered.filter((activity) => {
      if ('entryId' in activity) {
        return (
          activity.entryId === filter.entryId ||
          ('originalEntryId' in activity && activity.originalEntryId === filter.entryId)
        );
      }
      return false;
    });
  }

  return filtered;
}

// =============================================================================
// Incremental Activity Generation (for single entry updates)
// =============================================================================

/**
 * Generate a single activity for a newly added entry
 */
export function generateActivityForNewEntry(
  entry: Entry,
  members: Member[],
  groupId: string,
  canonicalIdMap?: Map<string, string>
): Activity {
  const { getMemberName } = createMemberHelpers(members, canonicalIdMap);

  const activity: EntryAddedActivity = {
    id: `activity-${entry.id}`,
    type: 'entry_added',
    timestamp: entry.createdAt,
    actorId: entry.createdBy,
    actorName: getMemberName(entry.createdBy),
    groupId,
    entryId: entry.id,
    entryType: entry.type,
    description: getEntryDescription(entry),
    amount: entry.amount,
    currency: entry.currency || 'USD',
    defaultCurrencyAmount: entry.defaultCurrencyAmount,
    entryDate: entry.date,
    ...getParticipantData(entry, getMemberName),
  };

  return activity;
}

/**
 * Generate a single activity for a modified entry
 */
export function generateActivityForModifiedEntry(
  entry: Entry,
  previousEntry: Entry | null,
  members: Member[],
  groupId: string,
  canonicalIdMap?: Map<string, string>
): Activity {
  const { getMemberName } = createMemberHelpers(members, canonicalIdMap);
  const changes = previousEntry ? calculateChanges(previousEntry, entry) : {};

  const activity: EntryModifiedActivity = {
    id: `activity-${entry.id}`,
    type: 'entry_modified',
    timestamp: entry.modifiedAt || entry.createdAt,
    actorId: entry.modifiedBy || entry.createdBy,
    actorName: getMemberName(entry.modifiedBy || entry.createdBy),
    groupId,
    entryId: entry.id,
    originalEntryId: entry.previousVersionId || '',
    entryType: entry.type,
    description: getEntryDescription(entry),
    amount: entry.amount,
    currency: entry.currency || 'USD',
    defaultCurrencyAmount: entry.defaultCurrencyAmount,
    entryDate: entry.date,
    ...getParticipantData(entry, getMemberName),
    changes,
  };

  return activity;
}

/**
 * Generate a single activity for a deleted entry
 */
export function generateActivityForDeletedEntry(
  entry: Entry,
  members: Member[],
  groupId: string,
  canonicalIdMap?: Map<string, string>
): Activity {
  const { getMemberName } = createMemberHelpers(members, canonicalIdMap);

  const activity: EntryDeletedActivity = {
    id: `activity-${entry.id}`,
    type: 'entry_deleted',
    timestamp: entry.deletedAt || entry.createdAt,
    actorId: entry.deletedBy || entry.createdBy,
    actorName: getMemberName(entry.deletedBy || entry.createdBy),
    groupId,
    entryId: entry.id,
    originalEntryId: entry.previousVersionId || '',
    entryType: entry.type,
    description: getEntryDescription(entry),
    amount: entry.amount,
    currency: entry.currency || 'USD',
    defaultCurrencyAmount: entry.defaultCurrencyAmount,
    entryDate: entry.date,
    ...getParticipantData(entry, getMemberName),
    reason: entry.deletionReason,
  };

  return activity;
}

/**
 * Generate a single activity for an undeleted entry
 */
export function generateActivityForUndeletedEntry(
  entry: Entry,
  members: Member[],
  groupId: string,
  canonicalIdMap?: Map<string, string>
): Activity {
  const { getMemberName } = createMemberHelpers(members, canonicalIdMap);

  const activity: EntryUndeletedActivity = {
    id: `activity-${entry.id}`,
    type: 'entry_undeleted',
    timestamp: entry.modifiedAt || entry.createdAt,
    actorId: entry.modifiedBy || entry.createdBy,
    actorName: getMemberName(entry.modifiedBy || entry.createdBy),
    groupId,
    entryId: entry.id,
    originalEntryId: entry.previousVersionId || '',
    entryType: entry.type,
    description: getEntryDescription(entry),
    amount: entry.amount,
    currency: entry.currency || 'USD',
    defaultCurrencyAmount: entry.defaultCurrencyAmount,
    entryDate: entry.date,
    ...getParticipantData(entry, getMemberName),
  };

  return activity;
}

/**
 * Insert an activity into a sorted list (newest first)
 * Returns a new array with the activity inserted at the correct position
 */
export function insertActivitySorted(activities: Activity[], newActivity: Activity): Activity[] {
  let left = 0;
  let right = activities.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (activities[mid]!.timestamp > newActivity.timestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  const newActivities = [...activities];
  newActivities.splice(left, 0, newActivity);
  return newActivities;
}
