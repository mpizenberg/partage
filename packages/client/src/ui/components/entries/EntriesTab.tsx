import { Component, Show, createSignal, createMemo } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { EntryList } from './EntryList'
import { EntriesFilter } from './EntriesFilter'
import { filterEntries, getUniqueCurrencies, getUniqueCategories } from '../../../domain/calculations/entry-filter'

export const EntriesTab: Component = () => {
  const { entries, showDeleted, setShowDeleted, entryFilter, setEntryFilter } = useAppContext()
  const [showFilters, setShowFilters] = createSignal(false)

  const handleToggleDeleted = () => {
    setShowDeleted(!showDeleted())
  }

  // Filter entries based on current filter
  const filteredEntries = createMemo(() => {
    const currentEntries = entries()
    const currentFilter = entryFilter()

    // If no filters are applied, return all entries
    if (
      !currentFilter.personIds?.length &&
      !currentFilter.categories?.length &&
      !currentFilter.dateRanges?.length &&
      !currentFilter.currencies?.length
    ) {
      return currentEntries
    }

    return filterEntries(currentEntries, currentFilter)
  })

  // Get available categories and currencies from all entries
  const availableCategories = createMemo(() => getUniqueCategories(entries()))
  const availableCurrencies = createMemo(() => getUniqueCurrencies(entries()))

  // Check if any filters are active
  const hasActiveFilters = createMemo(() => {
    const filter = entryFilter()
    return Boolean(
      (filter.personIds && filter.personIds.length > 0) ||
      (filter.categories && filter.categories.length > 0) ||
      (filter.dateRanges && filter.dateRanges.length > 0) ||
      (filter.currencies && filter.currencies.length > 0)
    )
  })

  const clearFilters = () => {
    setEntryFilter({})
  }

  return (
    <div class="entries-tab">
      <div class="entries-header">
        <div class="entries-controls">
          <label class="show-deleted-toggle">
            <input
              type="checkbox"
              checked={showDeleted()}
              onChange={handleToggleDeleted}
            />
            <span>Show deleted entries</span>
          </label>

          <button
            class="filter-toggle-btn"
            onClick={() => setShowFilters(!showFilters())}
            title="Filter entries"
          >
            🔍 Filter
            {hasActiveFilters() && <span class="filter-badge"> •</span>}
          </button>

          <Show when={hasActiveFilters()}>
            <button class="clear-filter-btn" onClick={clearFilters} title="Clear filters">
              Clear
            </button>
          </Show>
        </div>
      </div>

      {/* Filters Panel */}
      <Show when={showFilters()}>
        <EntriesFilter
          filter={entryFilter()}
          onFilterChange={setEntryFilter}
          availableCategories={availableCategories()}
          availableCurrencies={availableCurrencies()}
        />
      </Show>

      <Show
        when={filteredEntries().length > 0}
        fallback={
          <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <h2 class="empty-state-title">
              {hasActiveFilters() ? 'No matching entries' : 'No entries yet'}
            </h2>
            <p class="empty-state-message">
              {hasActiveFilters()
                ? 'No entries match your current filters'
                : 'Tap the + button below to add your first expense or transfer'}
            </p>
          </div>
        }
      >
        <EntryList entries={filteredEntries()} />
      </Show>
    </div>
  )
}
