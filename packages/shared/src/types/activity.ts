/**
 * Activity Feed Types
 * Represents all trackable actions in the application
 */

export type ActivityType =
  | 'entry_added'
  | 'entry_modified'
  | 'entry_deleted'
  | 'entry_undeleted'
  | 'member_joined'
  | 'member_linked';

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
  entryDate: number; // Transaction date (not creation date)
  // For expenses
  payers?: string[]; // Member IDs who paid
  beneficiaries?: string[]; // Member IDs who benefited
  // For transfers
  from?: string; // Member ID
  to?: string; // Member ID
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
  entryDate: number;
  // For expenses
  payers?: string[];
  beneficiaries?: string[];
  // For transfers
  from?: string;
  to?: string;
  // Modification metadata
  changes?: Record<string, { from: any; to: any }>; // Field name -> before/after values
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
  entryDate: number;
  // For expenses
  payers?: string[];
  beneficiaries?: string[];
  // For transfers
  from?: string;
  to?: string;
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
  entryDate: number;
  // For expenses
  payers?: string[];
  beneficiaries?: string[];
  // For transfers
  from?: string;
  to?: string;
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
 * Member linked activity
 * When a new member claims an existing virtual member identity
 */
export interface MemberLinkedActivity extends BaseActivity {
  type: 'member_linked';
  newMemberId: string;
  newMemberName: string;
  existingMemberId: string;
  existingMemberName: string;
}

/**
 * Union type of all activities
 */
export type Activity =
  | EntryAddedActivity
  | EntryModifiedActivity
  | EntryDeletedActivity
  | EntryUndeletedActivity
  | MemberJoinedActivity
  | MemberLinkedActivity;

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
