/**
 * Activity Feed Types
 * Represents all trackable actions in the application
 */

export type ActivityType =
  | 'entry_added'
  | 'entry_modified'
  | 'entry_deleted'
  | 'entry_undeleted'
  | 'member_joined';

/**
 * Base activity interface
 */
export interface BaseActivity {
  id: string;
  type: ActivityType;
  timestamp: number;
  actorId: string;
  actorName: string;
  groupId: string;
}

/**
 * Entry added activity
 */
export interface EntryAddedActivity extends BaseActivity {
  type: 'entry_added';
  entryId: string;
  entryType: 'expense' | 'transfer';
  description: string;
  amount: number;
  currency: string;
}

/**
 * Entry modified activity
 */
export interface EntryModifiedActivity extends BaseActivity {
  type: 'entry_modified';
  entryId: string;
  originalEntryId: string;
  entryType: 'expense' | 'transfer';
  description: string;
  amount: number;
  currency: string;
  changes?: string[]; // Array of changed field names
}

/**
 * Entry deleted activity
 */
export interface EntryDeletedActivity extends BaseActivity {
  type: 'entry_deleted';
  entryId: string;
  originalEntryId: string;
  entryType: 'expense' | 'transfer';
  description: string;
  amount: number;
  currency: string;
  reason?: string;
}

/**
 * Entry undeleted activity
 */
export interface EntryUndeletedActivity extends BaseActivity {
  type: 'entry_undeleted';
  entryId: string;
  originalEntryId: string;
  entryType: 'expense' | 'transfer';
  description: string;
  amount: number;
  currency: string;
}

/**
 * Member joined activity
 */
export interface MemberJoinedActivity extends BaseActivity {
  type: 'member_joined';
  memberId: string;
  memberName: string;
  isVirtual: boolean;
}

/**
 * Union type of all activities
 */
export type Activity =
  | EntryAddedActivity
  | EntryModifiedActivity
  | EntryDeletedActivity
  | EntryUndeletedActivity
  | MemberJoinedActivity;

/**
 * Activity filter options
 */
export interface ActivityFilter {
  types?: ActivityType[];
  actorIds?: string[];
  startDate?: number;
  endDate?: number;
  entryId?: string;
}
