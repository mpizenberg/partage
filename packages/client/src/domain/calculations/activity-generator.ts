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
  ActivityFilter,
  ExpenseEntry,
  TransferEntry,
} from '@partage/shared';

/**
 * Generate activities from entries (all versions)
 */
export function generateActivitiesFromEntries(
  entries: Entry[],
  members: Member[]
): Activity[] {
  const activities: Activity[] = [];

  // Create a map for quick member lookup
  const memberMap = new Map(members.map((m) => [m.id, m]));

  // Create a map for quick entry lookup (to check previous versions)
  const entryMap = new Map(entries.map((e) => [e.id, e]));

  // Helper to get member name
  const getMemberName = (memberId: string): string => {
    return memberMap.get(memberId)?.name || 'Unknown';
  };

  // Helper to get entry description
  const getEntryDescription = (entry: Entry): string => {
    if (entry.type === 'expense') {
      return (entry as ExpenseEntry).description;
    }
    return 'Transfer';
  };

  // Helper to get participants for expenses
  const getExpenseParticipants = (entry: ExpenseEntry) => {
    return {
      payers: entry.payers.map(p => p.memberId),
      beneficiaries: entry.beneficiaries.map(b => b.memberId),
    };
  };

  // Helper to get participants for transfers
  const getTransferParticipants = (entry: TransferEntry) => {
    return {
      from: entry.from,
      to: entry.to,
    };
  };

  // Helper to calculate changes between two entries
  const calculateChanges = (oldEntry: Entry, newEntry: Entry): Record<string, { from: any; to: any }> => {
    const changes: Record<string, { from: any; to: any }> = {};

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
    // Track defaultCurrencyAmount changes for multi-currency entries
    if (oldEntry.defaultCurrencyAmount !== newEntry.defaultCurrencyAmount) {
      changes.defaultCurrencyAmount = { from: oldEntry.defaultCurrencyAmount, to: newEntry.defaultCurrencyAmount };
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
        const samePayer = isSinglePayer && oldExpense.payers[0]?.memberId === newExpense.payers[0]?.memberId;
        const onlyAmountChanged = samePayer && oldExpense.payers[0]?.amount !== newExpense.payers[0]?.amount;

        // Only track payer change if it's not just an amount update on a single payer
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
  };

  // Process each entry
  for (const entry of entries) {
    const actorName = getMemberName(entry.createdBy);
    const description = getEntryDescription(entry);

    // Determine activity type based on entry properties
    if (!entry.previousVersionId) {
      // This is a new entry (version 1)
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
        ...(entry.type === 'expense' ? getExpenseParticipants(entry as ExpenseEntry) : {}),
        ...(entry.type === 'transfer' ? getTransferParticipants(entry as TransferEntry) : {}),
      };
      activities.push(activity);
    } else {
      // This is a versioned entry - check what type of change it represents
      const previousEntry = entryMap.get(entry.previousVersionId);

      if (entry.status === 'deleted') {
        // Deletion activity
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
          ...(entry.type === 'expense' ? getExpenseParticipants(entry as ExpenseEntry) : {}),
          ...(entry.type === 'transfer' ? getTransferParticipants(entry as TransferEntry) : {}),
          reason: entry.deletionReason,
        };
        activities.push(activity);
      } else if (previousEntry && previousEntry.status === 'deleted') {
        // Undeletion activity (previous version was deleted, current is active)
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
          ...(entry.type === 'expense' ? getExpenseParticipants(entry as ExpenseEntry) : {}),
          ...(entry.type === 'transfer' ? getTransferParticipants(entry as TransferEntry) : {}),
        };
        activities.push(activity);
      } else if (entry.modifiedAt && entry.modifiedBy) {
        // Modification activity (normal edit)
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
          ...(entry.type === 'expense' ? getExpenseParticipants(entry as ExpenseEntry) : {}),
          ...(entry.type === 'transfer' ? getTransferParticipants(entry as TransferEntry) : {}),
          changes,
        };
        activities.push(activity);
      }
    }
  }

  return activities;
}

/**
 * Generate activities from members
 */
export function generateActivitiesFromMembers(members: Member[]): Activity[] {
  const activities: Activity[] = [];

  for (const member of members) {
    // Skip the first member (group creator) as they don't have a "join" event
    // We can identify them by having the earliest joinedAt time
    const activity: MemberJoinedActivity = {
      id: `activity-member-${member.id}`,
      type: 'member_joined',
      timestamp: member.joinedAt,
      actorId: member.id,
      actorName: member.name,
      groupId: '', // Will be filled by caller
      memberId: member.id,
      memberName: member.name,
      isVirtual: member.isVirtual ?? false,
    };
    activities.push(activity);
  }

  return activities;
}

/**
 * Generate all activities and sort by timestamp (newest first)
 */
export function generateAllActivities(
  entries: Entry[],
  members: Member[],
  groupId: string
): Activity[] {
  const entryActivities = generateActivitiesFromEntries(entries, members);
  const memberActivities = generateActivitiesFromMembers(members);

  // Set groupId for member activities
  memberActivities.forEach((activity) => {
    activity.groupId = groupId;
  });

  // Combine and sort by timestamp (newest first)
  const allActivities = [...entryActivities, ...memberActivities];
  allActivities.sort((a, b) => b.timestamp - a.timestamp);

  return allActivities;
}

/**
 * Filter activities based on criteria
 */
export function filterActivities(
  activities: Activity[],
  filter: ActivityFilter
): Activity[] {
  let filtered = activities;

  // Filter by types
  if (filter.types && filter.types.length > 0) {
    filtered = filtered.filter((activity) => filter.types!.includes(activity.type));
  }

  // Filter by actors
  if (filter.actorIds && filter.actorIds.length > 0) {
    filtered = filtered.filter((activity) => filter.actorIds!.includes(activity.actorId));
  }

  // Filter by date range
  if (filter.startDate !== undefined) {
    filtered = filtered.filter((activity) => activity.timestamp >= filter.startDate!);
  }
  if (filter.endDate !== undefined) {
    filtered = filtered.filter((activity) => activity.timestamp <= filter.endDate!);
  }

  // Filter by entry ID
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

/**
 * Generate a single activity for a newly added entry
 * Used for incremental activity updates
 */
export function generateActivityForNewEntry(
  entry: Entry,
  members: Member[],
  groupId: string
): Activity {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const actorName = memberMap.get(entry.createdBy)?.name || 'Unknown';
  const description = entry.type === 'expense' ? (entry as ExpenseEntry).description : 'Transfer';

  const activity: EntryAddedActivity = {
    id: `activity-${entry.id}`,
    type: 'entry_added',
    timestamp: entry.createdAt,
    actorId: entry.createdBy,
    actorName,
    groupId,
    entryId: entry.id,
    entryType: entry.type,
    description,
    amount: entry.amount,
    currency: entry.currency || 'USD',
    defaultCurrencyAmount: entry.defaultCurrencyAmount,
    entryDate: entry.date,
    ...(entry.type === 'expense' ? {
      payers: (entry as ExpenseEntry).payers.map(p => p.memberId),
      beneficiaries: (entry as ExpenseEntry).beneficiaries.map(b => b.memberId),
    } : {}),
    ...(entry.type === 'transfer' ? {
      from: (entry as TransferEntry).from,
      to: (entry as TransferEntry).to,
    } : {}),
  };

  return activity;
}

/**
 * Generate a single activity for a modified entry
 * Used for incremental activity updates
 */
export function generateActivityForModifiedEntry(
  entry: Entry,
  previousEntry: Entry | null,
  members: Member[],
  groupId: string
): Activity {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const actorName = memberMap.get(entry.modifiedBy || entry.createdBy)?.name || 'Unknown';
  const description = entry.type === 'expense' ? (entry as ExpenseEntry).description : 'Transfer';

  // Calculate changes
  const changes: Record<string, { from: any; to: any }> = {};
  if (previousEntry) {
    if (previousEntry.amount !== entry.amount) {
      changes.amount = { from: previousEntry.amount, to: entry.amount };
    }
    if (previousEntry.currency !== entry.currency) {
      changes.currency = { from: previousEntry.currency, to: entry.currency };
    }
    if (previousEntry.date !== entry.date) {
      changes.date = { from: previousEntry.date, to: entry.date };
    }

    if (previousEntry.type === 'expense' && entry.type === 'expense') {
      const oldExpense = previousEntry as ExpenseEntry;
      const newExpense = entry as ExpenseEntry;

      if (oldExpense.description !== newExpense.description) {
        changes.description = { from: oldExpense.description, to: newExpense.description };
      }
      if (oldExpense.category !== newExpense.category) {
        changes.category = { from: oldExpense.category, to: newExpense.category };
      }
      if (JSON.stringify(oldExpense.payers) !== JSON.stringify(newExpense.payers)) {
        changes.payers = { from: oldExpense.payers, to: newExpense.payers };
      }
      if (JSON.stringify(oldExpense.beneficiaries) !== JSON.stringify(newExpense.beneficiaries)) {
        changes.beneficiaries = { from: oldExpense.beneficiaries, to: newExpense.beneficiaries };
      }
    }

    if (previousEntry.type === 'transfer' && entry.type === 'transfer') {
      const oldTransfer = previousEntry as TransferEntry;
      const newTransfer = entry as TransferEntry;

      if (oldTransfer.from !== newTransfer.from) {
        changes.from = { from: oldTransfer.from, to: newTransfer.from };
      }
      if (oldTransfer.to !== newTransfer.to) {
        changes.to = { from: oldTransfer.to, to: newTransfer.to };
      }
    }
  }

  const activity: EntryModifiedActivity = {
    id: `activity-${entry.id}`,
    type: 'entry_modified',
    timestamp: entry.modifiedAt || entry.createdAt,
    actorId: entry.modifiedBy || entry.createdBy,
    actorName,
    groupId,
    entryId: entry.id,
    originalEntryId: entry.previousVersionId || '',
    entryType: entry.type,
    description,
    amount: entry.amount,
    currency: entry.currency || 'USD',
    defaultCurrencyAmount: entry.defaultCurrencyAmount,
    entryDate: entry.date,
    ...(entry.type === 'expense' ? {
      payers: (entry as ExpenseEntry).payers.map(p => p.memberId),
      beneficiaries: (entry as ExpenseEntry).beneficiaries.map(b => b.memberId),
    } : {}),
    ...(entry.type === 'transfer' ? {
      from: (entry as TransferEntry).from,
      to: (entry as TransferEntry).to,
    } : {}),
    changes,
  };

  return activity;
}

/**
 * Generate a single activity for a deleted entry
 * Used for incremental activity updates
 */
export function generateActivityForDeletedEntry(
  entry: Entry,
  members: Member[],
  groupId: string
): Activity {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const actorName = memberMap.get(entry.deletedBy || entry.createdBy)?.name || 'Unknown';
  const description = entry.type === 'expense' ? (entry as ExpenseEntry).description : 'Transfer';

  const activity: EntryDeletedActivity = {
    id: `activity-${entry.id}`,
    type: 'entry_deleted',
    timestamp: entry.deletedAt || entry.createdAt,
    actorId: entry.deletedBy || entry.createdBy,
    actorName,
    groupId,
    entryId: entry.id,
    originalEntryId: entry.previousVersionId || '',
    entryType: entry.type,
    description,
    amount: entry.amount,
    currency: entry.currency || 'USD',
    defaultCurrencyAmount: entry.defaultCurrencyAmount,
    entryDate: entry.date,
    ...(entry.type === 'expense' ? {
      payers: (entry as ExpenseEntry).payers.map(p => p.memberId),
      beneficiaries: (entry as ExpenseEntry).beneficiaries.map(b => b.memberId),
    } : {}),
    ...(entry.type === 'transfer' ? {
      from: (entry as TransferEntry).from,
      to: (entry as TransferEntry).to,
    } : {}),
    reason: entry.deletionReason,
  };

  return activity;
}

/**
 * Generate a single activity for an undeleted entry
 * Used for incremental activity updates
 */
export function generateActivityForUndeletedEntry(
  entry: Entry,
  members: Member[],
  groupId: string
): Activity {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const actorName = memberMap.get(entry.modifiedBy || entry.createdBy)?.name || 'Unknown';
  const description = entry.type === 'expense' ? (entry as ExpenseEntry).description : 'Transfer';

  const activity: EntryUndeletedActivity = {
    id: `activity-${entry.id}`,
    type: 'entry_undeleted',
    timestamp: entry.modifiedAt || entry.createdAt,
    actorId: entry.modifiedBy || entry.createdBy,
    actorName,
    groupId,
    entryId: entry.id,
    originalEntryId: entry.previousVersionId || '',
    entryType: entry.type,
    description,
    amount: entry.amount,
    currency: entry.currency || 'USD',
    defaultCurrencyAmount: entry.defaultCurrencyAmount,
    entryDate: entry.date,
    ...(entry.type === 'expense' ? {
      payers: (entry as ExpenseEntry).payers.map(p => p.memberId),
      beneficiaries: (entry as ExpenseEntry).beneficiaries.map(b => b.memberId),
    } : {}),
    ...(entry.type === 'transfer' ? {
      from: (entry as TransferEntry).from,
      to: (entry as TransferEntry).to,
    } : {}),
  };

  return activity;
}

/**
 * Insert an activity into a sorted list (newest first)
 * Returns a new array with the activity inserted at the correct position
 */
export function insertActivitySorted(activities: Activity[], newActivity: Activity): Activity[] {
  // Find insertion point using binary search for O(log n) performance
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

  // Insert at the found position
  const newActivities = [...activities];
  newActivities.splice(left, 0, newActivity);
  return newActivities;
}
