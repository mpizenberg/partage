import { Component, For, Show } from 'solid-js';
import { useI18n } from '../../../i18n';
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

const DATE_PRESETS: { value: DatePreset; labelKey: string }[] = [
  { value: 'today', labelKey: 'filter.today' },
  { value: 'yesterday', labelKey: 'filter.yesterday' },
  { value: 'last7days', labelKey: 'filter.last7days' },
  { value: 'last30days', labelKey: 'filter.last30days' },
  { value: 'thisMonth', labelKey: 'filter.thisMonth' },
  { value: 'lastMonth', labelKey: 'filter.lastMonth' },
];

export const EntriesFilter: Component<EntriesFilterProps> = (props) => {
  const { t } = useI18n();
  const { members } = useAppContext();

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

  // Check if a range is a preset range
  const isPresetRange = (range: DateRange): boolean => {
    return DATE_PRESETS.some((preset) => {
      const presetRange = datePresetToRange(preset.value);
      return presetRange.startDate === range.startDate && presetRange.endDate === range.endDate;
    });
  };

  // Get custom range if it exists
  const getCustomRange = (): DateRange | null => {
    const currentRanges = props.filter.dateRanges || [];
    const customRange = currentRanges.find((range) => !isPresetRange(range));
    return customRange || null;
  };

  // Check if custom range is enabled
  const isCustomRangeEnabled = (): boolean => {
    return getCustomRange() !== null;
  };

  // Toggle custom range on/off
  const toggleCustomRange = () => {
    const currentRanges = props.filter.dateRanges || [];

    if (isCustomRangeEnabled()) {
      // Remove custom range
      const newRanges = currentRanges.filter((range) => isPresetRange(range));
      props.onFilterChange({
        ...props.filter,
        dateRanges: newRanges.length > 0 ? newRanges : undefined,
      });
    } else {
      // Add default custom range (yesterday to today - a range that doesn't match any preset)
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const startDate = startOfToday - 24 * 60 * 60 * 1000; // Yesterday at 00:00:00
      const endDate = startOfToday + 24 * 60 * 60 * 1000 - 1; // Today at 23:59:59

      const newRange: DateRange = { startDate, endDate };
      props.onFilterChange({
        ...props.filter,
        dateRanges: [...currentRanges, newRange],
      });
    }
  };

  // Update custom range dates
  const updateCustomRangeStart = (dateString: string) => {
    if (!dateString) return;

    const currentRanges = props.filter.dateRanges || [];
    const customRange = getCustomRange();
    if (!customRange) return;

    const startDate = new Date(dateString).getTime();
    const newRange: DateRange = { startDate, endDate: customRange.endDate };

    const newRanges = currentRanges.map((range) =>
      isPresetRange(range) ? range : newRange
    );

    props.onFilterChange({
      ...props.filter,
      dateRanges: newRanges,
    });
  };

  const updateCustomRangeEnd = (dateString: string) => {
    if (!dateString) return;

    const currentRanges = props.filter.dateRanges || [];
    const customRange = getCustomRange();
    if (!customRange) return;

    // End date is inclusive - set to end of day
    const endDate = new Date(dateString).setHours(23, 59, 59, 999);
    const newRange: DateRange = { startDate: customRange.startDate, endDate };

    const newRanges = currentRanges.map((range) =>
      isPresetRange(range) ? range : newRange
    );

    props.onFilterChange({
      ...props.filter,
      dateRanges: newRanges,
    });
  };

  // Get custom range dates as strings for inputs
  const getCustomStartDateString = (): string => {
    const customRange = getCustomRange();
    if (!customRange) return '';

    const date = new Date(customRange.startDate);
    return date.toISOString().split('T')[0] || '';
  };

  const getCustomEndDateString = (): string => {
    const customRange = getCustomRange();
    if (!customRange) return '';

    const date = new Date(customRange.endDate);
    return date.toISOString().split('T')[0] || '';
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
    const label = category === 'transfer' ? t('entries.transfer') : t(`categories.${category}`);
    return `${icon} ${label}`;
  };

  return (
    <div class="entries-filter card">
      <h3 class="filters-title">{t('filter.title')}</h3>

      {/* Person Filter */}
      <div class="filter-section">
        <h4 class="filter-section-title">
          {t('filter.people')} <span class="filter-logic">({t('filter.allSelected')})</span>
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
          {t('filter.category')} <span class="filter-logic">({t('filter.anySelected')})</span>
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
          {t('filter.date')} <span class="filter-logic">({t('filter.anySelected')})</span>
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
                <span>{t(preset.labelKey)}</span>
              </label>
            )}
          </For>

          {/* Custom Date Range */}
          <label class="filter-checkbox">
            <input
              type="checkbox"
              checked={isCustomRangeEnabled()}
              onChange={toggleCustomRange}
            />
            <span>{t('filter.customRange')}</span>
          </label>
        </div>

        <Show when={isCustomRangeEnabled()}>
          <div class="custom-date-range">
            <div class="custom-date-field">
              <label class="custom-date-label">{t('filter.start')}</label>
              <input
                type="date"
                class="date-input"
                value={getCustomStartDateString()}
                onInput={(e) => updateCustomRangeStart(e.currentTarget.value)}
              />
            </div>
            <div class="custom-date-field">
              <label class="custom-date-label">{t('filter.end')}</label>
              <input
                type="date"
                class="date-input"
                value={getCustomEndDateString()}
                onInput={(e) => updateCustomRangeEnd(e.currentTarget.value)}
              />
            </div>
          </div>
        </Show>
      </div>

      {/* Currency Filter */}
      <Show when={props.availableCurrencies.length > 1}>
        <div class="filter-section">
          <h4 class="filter-section-title">
            {t('filter.currency')} <span class="filter-logic">({t('filter.anySelected')})</span>
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
