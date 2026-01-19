import { Component, Show, createSignal, createResource } from 'solid-js';
import { useI18n } from '../../../i18n';
import { useAppContext } from '../../context/AppContext';
import { ActivityList } from './ActivityList';
import { NtfySubscribe } from '../common/NtfySubscribe';
import type { ActivityType } from '@partage/shared';

export const ActivitiesTab: Component = () => {
  const { t } = useI18n();
  const { activities, activityFilter, setActivityFilter, activeGroup, getActiveGroupKey } =
    useAppContext();
  const [showFilters, setShowFilters] = createSignal(false);

  // Load group key for NTFY subscription
  const [groupKey] = createResource(activeGroup, async (group) => {
    if (!group) return null;
    return getActiveGroupKey();
  });

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
      {/* Background Notifications */}
      <Show when={activeGroup() && groupKey()}>
        <div class="activities-section" style="margin-bottom: var(--space-md);">
          <NtfySubscribe
            groupId={activeGroup()!.id}
            groupName={activeGroup()!.name}
            groupKey={groupKey()!}
          />
        </div>
      </Show>

      {/* Filter Toggle */}
      <div class="activities-header">
        <button
          class="filter-toggle-btn"
          onClick={() => setShowFilters(!showFilters())}
          title={t('activity.filterActivities')}
        >
          🔍 {t('entries.filter')}
          {hasActiveFilters() && <span class="filter-badge"> •</span>}
        </button>

        <Show when={hasActiveFilters()}>
          <button class="clear-filter-btn" onClick={clearFilters} title={t('entries.clearFilters')}>
            {t('entries.clearFilters')}
          </button>
        </Show>
      </div>

      {/* Filters Panel */}
      <Show when={showFilters()}>
        <div class="activities-filters card">
          <h3 class="filters-title">{t('activity.filterByType')}</h3>
          <div class="filter-checkboxes">
            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('entry_added')}
                onChange={() => toggleActivityType('entry_added')}
              />
              <span>➕ {t('activity.entryAddedLabel')}</span>
            </label>

            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('entry_modified')}
                onChange={() => toggleActivityType('entry_modified')}
              />
              <span>✏️ {t('activity.entryModifiedLabel')}</span>
            </label>

            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('entry_deleted')}
                onChange={() => toggleActivityType('entry_deleted')}
              />
              <span>🗑️ {t('activity.entryDeletedLabel')}</span>
            </label>

            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('entry_undeleted')}
                onChange={() => toggleActivityType('entry_undeleted')}
              />
              <span>↶ {t('activity.entryRestoredLabel')}</span>
            </label>

            <label class="filter-checkbox">
              <input
                type="checkbox"
                checked={isTypeSelected('member_joined')}
                onChange={() => toggleActivityType('member_joined')}
              />
              <span>👋 {t('activity.memberJoinedLabel')}</span>
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
            <h2 class="empty-state-title">{t('activity.noActivity')}</h2>
            <p class="empty-state-message">
              {hasActiveFilters()
                ? t('activity.noActivityFiltered')
                : t('activity.noActivityMessage')}
            </p>
          </div>
        }
      >
        <ActivityList activities={activities()} />
      </Show>
    </div>
  );
};
