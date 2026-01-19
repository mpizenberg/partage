/**
 * Entry filtering logic
 * Implements the filter combining rules:
 * - Different filter types (person, category, date, currency) are combined with AND
 * - Person filters are combined with AND
 * - Category filters are combined with OR
 * - Date filters are combined with OR
 * - Currency filters are combined with OR
 */

import type {
  Entry,
  ExpenseEntry,
  TransferEntry,
  EntryFilter,
  DateRange,
  DatePreset,
} from '@partage/shared';

/**
 * Check if an entry involves a specific person (member ID)
 */
function entryInvolvesPerson(entry: Entry, personId: string): boolean {
  if (entry.type === 'expense') {
    const expenseEntry = entry as ExpenseEntry;
    // Check payers
    if (expenseEntry.payers.some((p) => p.memberId === personId)) {
      return true;
    }
    // Check beneficiaries
    if (expenseEntry.beneficiaries.some((b) => b.memberId === personId)) {
      return true;
    }
    return false;
  } else {
    const transferEntry = entry as TransferEntry;
    return transferEntry.from === personId || transferEntry.to === personId;
  }
}

/**
 * Get the category of an entry
 */
function getEntryCategory(entry: Entry): string {
  if (entry.type === 'transfer') {
    return 'transfer';
  }
  const expenseEntry = entry as ExpenseEntry;
  return expenseEntry.category || 'other';
}

/**
 * Check if a timestamp falls within a date range
 */
function isInDateRange(timestamp: number, range: DateRange): boolean {
  return timestamp >= range.startDate && timestamp <= range.endDate;
}

/**
 * Convert a date preset to a DateRange
 */
export function datePresetToRange(preset: DatePreset, customRange?: DateRange): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStart = today.getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1;

  switch (preset) {
    case 'today':
      return { startDate: todayStart, endDate: todayEnd };

    case 'yesterday': {
      const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
      const yesterdayEnd = yesterdayStart + 24 * 60 * 60 * 1000 - 1;
      return { startDate: yesterdayStart, endDate: yesterdayEnd };
    }

    case 'last7days': {
      const last7DaysStart = todayStart - 7 * 24 * 60 * 60 * 1000;
      return { startDate: last7DaysStart, endDate: todayEnd };
    }

    case 'last30days': {
      const last30DaysStart = todayStart - 30 * 24 * 60 * 60 * 1000;
      return { startDate: last30DaysStart, endDate: todayEnd };
    }

    case 'thisMonth': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { startDate: monthStart.getTime(), endDate: monthEnd.getTime() };
    }

    case 'lastMonth': {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { startDate: lastMonthStart.getTime(), endDate: lastMonthEnd.getTime() };
    }

    case 'custom':
      if (!customRange) {
        throw new Error('Custom date range requires customRange parameter');
      }
      return customRange;

    default:
      throw new Error(`Unknown date preset: ${preset}`);
  }
}

/**
 * Filter entries based on filter criteria
 */
export function filterEntries(entries: Entry[], filter: EntryFilter): Entry[] {
  return entries.filter((entry) => {
    // Filter by persons (AND logic - entry must involve ALL specified persons)
    if (filter.personIds && filter.personIds.length > 0) {
      const involvesAllPersons = filter.personIds.every((personId) =>
        entryInvolvesPerson(entry, personId)
      );
      if (!involvesAllPersons) {
        return false;
      }
    }

    // Filter by categories (OR logic - entry must match ANY specified category)
    if (filter.categories && filter.categories.length > 0) {
      const entryCategory = getEntryCategory(entry);
      const matchesCategory = filter.categories.includes(entryCategory as any);
      if (!matchesCategory) {
        return false;
      }
    }

    // Filter by date ranges (OR logic - entry must fall within ANY specified range)
    if (filter.dateRanges && filter.dateRanges.length > 0) {
      const matchesDateRange = filter.dateRanges.some((range) => isInDateRange(entry.date, range));
      if (!matchesDateRange) {
        return false;
      }
    }

    // Filter by currencies (OR logic - entry must match ANY specified currency)
    if (filter.currencies && filter.currencies.length > 0) {
      const matchesCurrency = filter.currencies.includes(entry.currency);
      if (!matchesCurrency) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Get all unique currencies from entries
 */
export function getUniqueCurrencies(entries: Entry[]): string[] {
  const currencies = new Set<string>();
  entries.forEach((entry) => {
    currencies.add(entry.currency);
  });
  return Array.from(currencies).sort();
}

/**
 * Get all unique categories from entries
 */
export function getUniqueCategories(entries: Entry[]): string[] {
  const categories = new Set<string>();
  entries.forEach((entry) => {
    categories.add(getEntryCategory(entry));
  });
  return Array.from(categories).sort();
}
