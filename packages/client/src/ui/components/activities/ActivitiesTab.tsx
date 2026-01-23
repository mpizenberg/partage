import { Component, Show, For, createSignal, createResource } from 'solid-js';
import { useI18n } from '../../../i18n';
import { useAppContext } from '../../context/AppContext';
import { ActivityList } from './ActivityList';
import { NtfySubscribe } from '../common/NtfySubscribe';
import type { ActivityType } from '@partage/shared';

export const ActivitiesTab: Component = () => {
  const { t } = useI18n();
  const {
    activities,
    activityFilter,
    setActivityFilter,
    activeGroup,
    getActiveGroupKey,
    members,
    groupMetadata,
  } = useAppContext();
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

  const toggleMember = (memberId: string) => {
    const currentFilter = activityFilter();
    const currentMembers = currentFilter.memberIds || [];

    let newMembers: string[];
    if (currentMembers.includes(memberId)) {
      // Remove member
      newMembers = currentMembers.filter((id) => id !== memberId);
    } else {
      // Add member
      newMembers = [...currentMembers, memberId];
    }

    setActivityFilter({
      ...currentFilter,
      memberIds: newMembers.length > 0 ? newMembers : undefined,
    });
  };

  const isMemberSelected = (memberId: string): boolean => {
    const memberIds = activityFilter().memberIds;
    return !memberIds || memberIds.includes(memberId);
  };

  const hasActiveFilters = (): boolean => {
    const filter = activityFilter();
    return Boolean(
      (filter.types && filter.types.length > 0) || (filter.memberIds && filter.memberIds.length > 0)
    );
  };

  return (
    <div class="activities-tab">
      {/* Background Notifications */}
      <Show when={activeGroup() && groupKey()}>
        <div class="activities-section" style="margin-bottom: var(--space-md);">
          <NtfySubscribe
            groupId={activeGroup()!.id}
            groupName={groupMetadata().name}
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

          <h3 class="filters-title" style="margin-top: var(--space-md);">
            {t('activity.filterByMember')}
          </h3>
          <div class="filter-checkboxes">
            <For each={members()}>
              {(member) => (
                <label class="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={isMemberSelected(member.id)}
                    onChange={() => toggleMember(member.id)}
                  />
                  <span>{member.name}</span>
                </label>
              )}
            </For>
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
