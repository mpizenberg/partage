/**
 * Entry data types (expenses and transfers)
 */

export type EntryType = 'expense' | 'transfer';
export type EntryStatus = 'active' | 'deleted';
export type ExpenseCategory =
  | 'food'
  | 'transport'
  | 'accommodation'
  | 'entertainment'
  | 'shopping'
  | 'groceries'
  | 'utilities'
  | 'healthcare'
  | 'other';

export type SplitType = 'shares' | 'exact';

export interface Payer {
  memberId: string;
  amount: number;
}

export interface Beneficiary {
  memberId: string;
  splitType: SplitType;
  shares?: number; // For 'shares' split type
  amount?: number; // For 'exact' split type
}

export interface BaseEntry {
  id: string;
  groupId: string;
  type: EntryType;
  version: number; // For modification tracking
  previousVersionId?: string; // Reference to prior version
  rootId?: string; // Root entry ID of the modification chain (undefined for new entries)
  createdAt: number; // Unix timestamp
  createdBy: string; // Public key hash
  modifiedAt?: number;
  modifiedBy?: string;
  deletedAt?: number;
  deletedBy?: string;
  deletionReason?: string;
  status: EntryStatus;

  // Common fields
  amount: number;
  currency: string; // ISO 4217 code
  date: number; // Unix timestamp
  notes?: string;

  // Currency conversion
  defaultCurrencyAmount?: number; // Converted to group's default currency
}

export interface ExpenseEntry extends BaseEntry {
  type: 'expense';
  description: string;
  category?: ExpenseCategory;
  location?: string;
  payers: Payer[];
  beneficiaries: Beneficiary[];
}

export interface TransferEntry extends BaseEntry {
  type: 'transfer';
  from: string; // Member ID
  to: string; // Member ID
}

export type Entry = ExpenseEntry | TransferEntry;

/**
 * Entry filtering types
 */

export type EntryCategory = 'transfer' | ExpenseCategory;

export interface DateRange {
  startDate: number; // Unix timestamp
  endDate: number; // Unix timestamp
}

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';

export interface EntryFilter {
  // Entries involving these people (AND logic)
  personIds?: string[];

  // Entries matching these categories (OR logic)
  // Can include 'transfer' or any ExpenseCategory
  categories?: EntryCategory[];

  // Entries within these date ranges (OR logic)
  dateRanges?: DateRange[];

  // Entries with these original currencies (OR logic)
  currencies?: string[];
}
