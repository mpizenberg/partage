import { Component, For, Show, createSignal } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
import type { EntryFilter, EntryCategory, DatePreset, DateRange } from '@partage/shared';
import { datePresetToRange } from '../../../domain/calculations/entry-filter';

export interface EntriesFilterProps {
  filter: EntryFilter;
  onFilterChange: (filter: EntryFilter) => void;
  availableCategories: string[];
  availableCurrencies: string[];
}

const EXPENSE_CATEGORIES: EntryCategory[] = [
  'food',
  'transport',
  'accommodation',
  'entertainment',
  'shopping',
  'groceries',
  'utilities',
  'healthcare',
  'other',
];

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'last30days', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
];

export const EntriesFilter: Component<EntriesFilterProps> = (props) => {
  const { members } = useAppContext();
  const [showCustomDateRange, setShowCustomDateRange] = createSignal(false);
  const [customStartDate, setCustomStartDate] = createSignal('');
  const [customEndDate, setCustomEndDate] = createSignal('');

  // Toggle person filter
  const togglePerson = (personId: string) => {
    const currentPersons = props.filter.personIds || [];
    let newPersons: string[];

    if (currentPersons.includes(personId)) {
      newPersons = currentPersons.filter((id) => id !== personId);
    } else {
      newPersons = [...currentPersons, personId];
    }

    props.onFilterChange({
      ...props.filter,
      personIds: newPersons.length > 0 ? newPersons : undefined,
    });
  };

  // Toggle category filter
  const toggleCategory = (category: EntryCategory) => {
    const currentCategories = props.filter.categories || [];
    let newCategories: EntryCategory[];

    if (currentCategories.includes(category)) {
      newCategories = currentCategories.filter((c) => c !== category);
    } else {
      newCategories = [...currentCategories, category];
    }

    props.onFilterChange({
      ...props.filter,
      categories: newCategories.length > 0 ? newCategories : undefined,
    });
  };

  // Toggle date preset filter
  const toggleDatePreset = (preset: DatePreset) => {
    const currentRanges = props.filter.dateRanges || [];
    const range = datePresetToRange(preset);

    // Check if this range already exists
    const rangeIndex = currentRanges.findIndex(
      (r) => r.startDate === range.startDate && r.endDate === range.endDate
    );

    let newRanges: DateRange[];
    if (rangeIndex >= 0) {
      // Remove this range
      newRanges = currentRanges.filter((_, i) => i !== rangeIndex);
    } else {
      // Add this range
      newRanges = [...currentRanges, range];
    }

    props.onFilterChange({
      ...props.filter,
      dateRanges: newRanges.length > 0 ? newRanges : undefined,
    });
  };

  // Apply custom date range
  const applyCustomDateRange = () => {
    if (!customStartDate() || !customEndDate()) {
      return;
    }

    const startDate = new Date(customStartDate()).getTime();
    const endDate = new Date(customEndDate()).setHours(23, 59, 59, 999);

    const currentRanges = props.filter.dateRanges || [];
    const newRange: DateRange = { startDate, endDate };

    props.onFilterChange({
      ...props.filter,
      dateRanges: [...currentRanges, newRange],
    });

    setCustomStartDate('');
    setCustomEndDate('');
    setShowCustomDateRange(false);
  };

  // Clear custom date ranges
  const clearCustomDateRanges = () => {
    const presetRanges = DATE_PRESETS.map((preset) => datePresetToRange(preset.value));
    const currentRanges = props.filter.dateRanges || [];

    // Keep only preset ranges
    const newRanges = currentRanges.filter((range) =>
      presetRanges.some((pr) => pr.startDate === range.startDate && pr.endDate === range.endDate)
    );

    props.onFilterChange({
      ...props.filter,
      dateRanges: newRanges.length > 0 ? newRanges : undefined,
    });
  };

  // Toggle currency filter
  const toggleCurrency = (currency: string) => {
    const currentCurrencies = props.filter.currencies || [];
    let newCurrencies: string[];

    if (currentCurrencies.includes(currency)) {
      newCurrencies = currentCurrencies.filter((c) => c !== currency);
    } else {
      newCurrencies = [...currentCurrencies, currency];
    }

    props.onFilterChange({
      ...props.filter,
      currencies: newCurrencies.length > 0 ? newCurrencies : undefined,
    });
  };

  // Check if filter is selected
  const isPersonSelected = (personId: string): boolean => {
    return props.filter.personIds?.includes(personId) || false;
  };

  const isCategorySelected = (category: EntryCategory): boolean => {
    return props.filter.categories?.includes(category) || false;
  };

  const isDatePresetSelected = (preset: DatePreset): boolean => {
    const range = datePresetToRange(preset);
    return (
      props.filter.dateRanges?.some(
        (r) => r.startDate === range.startDate && r.endDate === range.endDate
      ) || false
    );
  };

  const isCurrencySelected = (currency: string): boolean => {
    return props.filter.currencies?.includes(currency) || false;
  };

  // Get category label with icon
  const getCategoryLabel = (category: string): string => {
    const icons: Record<string, string> = {
      transfer: '💸',
      food: '🍽️',
      transport: '🚗',
      accommodation: '🏨',
      entertainment: '🎉',
      shopping: '🛍️',
      groceries: '🛒',
      utilities: '⚡',
      healthcare: '🏥',
      other: '📦',
    };
    const icon = icons[category] || '📦';
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    return `${icon} ${label}`;
  };

  return (
    <div class="entries-filter card">
      <h3 class="filters-title">Filter Entries</h3>

      {/* Person Filter */}
      <div class="filter-section">
        <h4 class="filter-section-title">
          People <span class="filter-logic">(ALL selected)</span>
        </h4>
        <div class="filter-checkboxes">
          <For each={members()}>
            {(member) => (
              <label class="filter-checkbox">
                <input
                  type="checkbox"
                  checked={isPersonSelected(member.id)}
                  onChange={() => togglePerson(member.id)}
                />
                <span>{member.name}</span>
              </label>
            )}
          </For>
        </div>
      </div>

      {/* Category Filter */}
      <div class="filter-section">
        <h4 class="filter-section-title">
          Category <span class="filter-logic">(ANY selected)</span>
        </h4>
        <div class="filter-checkboxes">
          <Show when={props.availableCategories.includes('transfer')}>
            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isCategorySelected('transfer')}
                onChange={() => toggleCategory('transfer')}
              />
              <span>{getCategoryLabel('transfer')}</span>
            </label>
          </Show>
          <For each={EXPENSE_CATEGORIES}>
            {(category) => (
              <Show when={props.availableCategories.includes(category)}>
                <label class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={isCategorySelected(category)}
                    onChange={() => toggleCategory(category)}
                  />
                  <span>{getCategoryLabel(category)}</span>
                </label>
              </Show>
            )}
          </For>
        </div>
      </div>

      {/* Date Filter */}
      <div class="filter-section">
        <h4 class="filter-section-title">
          Date <span class="filter-logic">(ANY selected)</span>
        </h4>
        <div class="filter-checkboxes">
          <For each={DATE_PRESETS}>
            {(preset) => (
              <label class="filter-checkbox">
                <input
                  type="checkbox"
                  checked={isDatePresetSelected(preset.value)}
                  onChange={() => toggleDatePreset(preset.value)}
                />
                <span>{preset.label}</span>
              </label>
            )}
          </For>
        </div>

        {/* Custom Date Range */}
        <Show when={!showCustomDateRange()}>
          <button
            class="custom-date-btn"
            onClick={() => setShowCustomDateRange(true)}
            title="Add custom date range"
          >
            + Custom Range
          </button>
        </Show>

        <Show when={showCustomDateRange()}>
          <div class="custom-date-range">
            <input
              type="date"
              class="date-input"
              value={customStartDate()}
              onInput={(e) => setCustomStartDate(e.currentTarget.value)}
              placeholder="Start date"
            />
            <input
              type="date"
              class="date-input"
              value={customEndDate()}
              onInput={(e) => setCustomEndDate(e.currentTarget.value)}
              placeholder="End date"
            />
            <div class="custom-date-actions">
              <button
                class="apply-btn"
                onClick={applyCustomDateRange}
                disabled={!customStartDate() || !customEndDate()}
              >
                Apply
              </button>
              <button class="cancel-btn" onClick={() => setShowCustomDateRange(false)}>
                Cancel
              </button>
            </div>
          </div>
        </Show>

        <Show when={(props.filter.dateRanges?.length || 0) > DATE_PRESETS.length}>
          <button class="clear-custom-btn" onClick={clearCustomDateRanges}>
            Clear Custom Ranges
          </button>
        </Show>
      </div>

      {/* Currency Filter */}
      <Show when={props.availableCurrencies.length > 1}>
        <div class="filter-section">
          <h4 class="filter-section-title">
            Currency <span class="filter-logic">(ANY selected)</span>
          </h4>
          <div class="filter-checkboxes">
            <For each={props.availableCurrencies}>
              {(currency) => (
                <label class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={isCurrencySelected(currency)}
                    onChange={() => toggleCurrency(currency)}
                  />
                  <span>{currency}</span>
                </label>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};
