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
        };
        activities.push(activity);
      } else if (entry.modifiedAt && entry.modifiedBy) {
        // Modification activity (normal edit)
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
 * Format relative time for display
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return 'Just now';
  } else if (minutes < 60) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else if (hours < 24) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return `${days} days ago`;
  } else {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: now - timestamp > 365 * 24 * 60 * 60 * 1000 ? 'numeric' : undefined,
    });
  }
}
