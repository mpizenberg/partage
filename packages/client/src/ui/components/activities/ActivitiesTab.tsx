import { Component, Show, createSignal } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
import { ActivityList } from './ActivityList';
import type { ActivityType } from '@partage/shared';

export const ActivitiesTab: Component = () => {
  const { activities, activityFilter, setActivityFilter } = useAppContext();
  const [showFilters, setShowFilters] = createSignal(false);

  const toggleActivityType = (type: ActivityType) => {
    const currentFilter = activityFilter();
    const currentTypes = currentFilter.types || [];

    let newTypes: ActivityType[];
    if (currentTypes.includes(type)) {
      // Remove type
      newTypes = currentTypes.filter((t) => t !== type);
    } else {
      // Add type
      newTypes = [...currentTypes, type];
    }

    setActivityFilter({
      ...currentFilter,
      types: newTypes.length > 0 ? newTypes : undefined,
    });
  };

  const clearFilters = () => {
    setActivityFilter({});
  };

  const isTypeSelected = (type: ActivityType): boolean => {
    const types = activityFilter().types;
    return !types || types.includes(type);
  };

  const hasActiveFilters = (): boolean => {
    const filter = activityFilter();
    return Boolean(filter.types && filter.types.length > 0);
  };

  return (
    <div class="activities-tab">
      {/* Filter Toggle */}
      <div class="activities-header">
        <button
          class="filter-toggle-btn"
          onClick={() => setShowFilters(!showFilters())}
          title="Filter activities"
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

      {/* Filters Panel */}
      <Show when={showFilters()}>
        <div class="activities-filters card">
          <h3 class="filters-title">Filter by Type</h3>
          <div class="filter-checkboxes">
            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('entry_added')}
                onChange={() => toggleActivityType('entry_added')}
              />
              <span>➕ Entry Added</span>
            </label>

            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('entry_modified')}
                onChange={() => toggleActivityType('entry_modified')}
              />
              <span>✏️ Entry Modified</span>
            </label>

            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('entry_deleted')}
                onChange={() => toggleActivityType('entry_deleted')}
              />
              <span>🗑️ Entry Deleted</span>
            </label>

            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('entry_undeleted')}
                onChange={() => toggleActivityType('entry_undeleted')}
              />
              <span>↶ Entry Restored</span>
            </label>

            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('member_joined')}
                onChange={() => toggleActivityType('member_joined')}
              />
              <span>👋 Member Joined</span>
            </label>
          </div>
        </div>
      </Show>

      {/* Activity List */}
      <Show
        when={activities().length > 0}
        fallback={
          <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <h2 class="empty-state-title">No activities yet</h2>
            <p class="empty-state-message">
              {hasActiveFilters()
                ? 'No activities match your filters'
                : 'Activities will appear here as you use the app'}
            </p>
          </div>
        }
      >
        <ActivityList activities={activities()} />
      </Show>
    </div>
  );
};
