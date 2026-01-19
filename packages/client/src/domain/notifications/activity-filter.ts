/**
 * Activity filtering logic for notifications
 * Determines which activities are relevant to the current user
 */

import type { Activity } from '@partage/shared/types/activity';
import type { LoroEntryStore } from '../../core/crdt/loro-wrapper';

/**
 * Check if an activity is relevant to the current user
 *
 * @param activity - The activity to check
 * @param currentUserId - The current user's public key hash
 * @param store - The Loro store for resolving canonical member IDs
 * @returns true if the activity should trigger a notification
 */
export function isActivityRelevantToUser(
  activity: Activity,
  currentUserId: string,
  store: LoroEntryStore
): boolean {
  // Don't notify about own actions
  if (activity.actorId === currentUserId) {
    return false;
  }

  // Helper to resolve canonical IDs (handles member aliases/linking)
  const resolveId = (id: string): string => {
    return store.resolveCanonicalMemberId(id);
  };

  const canonicalCurrentUserId = resolveId(currentUserId);

  // Entry activities: check if user is involved
  if (
    activity.type === 'entry_added' ||
    activity.type === 'entry_modified' ||
    activity.type === 'entry_deleted' ||
    activity.type === 'entry_undeleted'
  ) {
    // For expenses: check if user is payer or beneficiary
    if (activity.payers && activity.payers.length > 0) {
      const isInvolved = activity.payers.some(
        (payerId) => resolveId(payerId) === canonicalCurrentUserId
      );
      if (isInvolved) return true;
    }

    if (activity.beneficiaries && activity.beneficiaries.length > 0) {
      const isInvolved = activity.beneficiaries.some(
        (beneficiaryId) => resolveId(beneficiaryId) === canonicalCurrentUserId
      );
      if (isInvolved) return true;
    }

    // For transfers: check if user is sender or receiver
    if (activity.from && resolveId(activity.from) === canonicalCurrentUserId) {
      return true;
    }
    if (activity.to && resolveId(activity.to) === canonicalCurrentUserId) {
      return true;
    }

    return false;
  }

  // Member activities: always show (group awareness)
  // Note: This notifies all members when someone joins or links
  if (activity.type === 'member_joined' || activity.type === 'member_linked') {
    return true;
  }

  return false;
}

/**
 * Get a list of activities relevant to the current user
 *
 * @param activities - All activities
 * @param currentUserId - The current user's public key hash
 * @param store - The Loro store for resolving canonical member IDs
 * @returns Filtered list of relevant activities
 */
export function getRelevantActivities(
  activities: Activity[],
  currentUserId: string,
  store: LoroEntryStore
): Activity[] {
  return activities.filter((activity) => isActivityRelevantToUser(activity, currentUserId, store));
}

/**
 * Get new activities since a timestamp
 *
 * @param activities - All activities
 * @param sinceTimestamp - Only return activities after this timestamp
 * @param currentUserId - The current user's public key hash
 * @param store - The Loro store for resolving canonical member IDs
 * @returns Filtered list of new relevant activities
 */
export function getNewRelevantActivities(
  activities: Activity[],
  sinceTimestamp: number,
  currentUserId: string,
  store: LoroEntryStore
): Activity[] {
  return activities
    .filter((activity) => activity.timestamp > sinceTimestamp)
    .filter((activity) => isActivityRelevantToUser(activity, currentUserId, store));
}
