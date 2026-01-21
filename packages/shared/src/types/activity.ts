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
  | 'member_linked'
  | 'member_renamed'
  | 'member_retired';

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
  defaultCurrencyAmount?: number;
  entryDate: number; // Transaction date (not creation date)
  // For expenses
  payers?: string[]; // Member IDs who paid
  payerNames?: Record<string, string>; // Map of member ID to name at activity time
  beneficiaries?: string[]; // Member IDs who benefited
  beneficiaryNames?: Record<string, string>; // Map of member ID to name at activity time
  // For transfers
  from?: string; // Member ID
  fromName?: string; // Member name at activity time
  to?: string; // Member ID
  toName?: string; // Member name at activity time
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
  defaultCurrencyAmount?: number;
  entryDate: number;
  // For expenses
  payers?: string[];
  payerNames?: Record<string, string>; // Map of member ID to name at activity time
  beneficiaries?: string[];
  beneficiaryNames?: Record<string, string>; // Map of member ID to name at activity time
  // For transfers
  from?: string;
  fromName?: string; // Member name at activity time
  to?: string;
  toName?: string; // Member name at activity time
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
  defaultCurrencyAmount?: number;
  entryDate: number;
  // For expenses
  payers?: string[];
  payerNames?: Record<string, string>; // Map of member ID to name at activity time
  beneficiaries?: string[];
  beneficiaryNames?: Record<string, string>; // Map of member ID to name at activity time
  // For transfers
  from?: string;
  fromName?: string; // Member name at activity time
  to?: string;
  toName?: string; // Member name at activity time
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
  defaultCurrencyAmount?: number;
  entryDate: number;
  // For expenses
  payers?: string[];
  payerNames?: Record<string, string>; // Map of member ID to name at activity time
  beneficiaries?: string[];
  beneficiaryNames?: Record<string, string>; // Map of member ID to name at activity time
  // For transfers
  from?: string;
  fromName?: string; // Member name at activity time
  to?: string;
  toName?: string; // Member name at activity time
}

/**
 * Member joined activity
 */
export interface MemberJoinedActivity extends BaseActivity {
  type: 'member_joined';
  memberId: string;
  memberName: string;
  isVirtual: boolean;
  currentName?: string; // Set when current name differs from memberName
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
  currentName?: string; // Set when current name differs from newMemberName
}

/**
 * Member renamed activity
 * When a member's name is changed
 */
export interface MemberRenamedActivity extends BaseActivity {
  type: 'member_renamed';
  memberId: string;
  oldName: string;
  newName: string;
  currentName?: string; // Set when current name differs from newName
}

/**
 * Member retired activity
 * When a member is marked as retired (soft delete)
 */
export interface MemberRetiredActivity extends BaseActivity {
  type: 'member_retired';
  memberId: string;
  memberName: string;
  currentName?: string; // Set when current name differs from memberName
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
  | MemberLinkedActivity
  | MemberRenamedActivity
  | MemberRetiredActivity;

/**
 * Activity filter options
 */
export interface ActivityFilter {
  types?: ActivityType[];
  actorIds?: string[];
  memberIds?: string[]; // Filter by involved members (payers, beneficiaries, from/to)
  startDate?: number;
  endDate?: number;
  entryId?: string;
}
