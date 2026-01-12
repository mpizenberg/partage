import { Component, Match, Switch, Show, For } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
import { formatRelativeTime } from '../../../domain/calculations/activity-generator';
import type {
  Activity,
  EntryModifiedActivity,
  EntryAddedActivity,
  EntryDeletedActivity,
  EntryUndeletedActivity,
} from '@partage/shared';

export interface ActivityCardProps {
  activity: Activity;
}

export const ActivityCard: Component<ActivityCardProps> = (props) => {
  const { members, identity, loroStore } = useAppContext();

  const formatCurrency = (amount: number, currency: string): string => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  const getMemberName = (memberId: string): string => {
    const userId = identity()?.publicKeyHash;
    if (!userId) return 'Unknown';

    // Check if this is the current user (considering aliases)
    if (memberId === userId) return 'You';
    const store = loroStore();
    if (store) {
      const canonicalUserId = store.resolveCanonicalMemberId(userId);
      if (memberId === canonicalUserId) return 'You';

      // Check if this is a canonical ID (old virtual member) that has been claimed
      const aliases = store.getMemberAliases();
      const alias = aliases.find((a) => a.existingMemberId === memberId);
      if (alias) {
        // This is a claimed virtual member - show the NEW member's name
        const newMember = members().find((m) => m.id === alias.newMemberId);
        if (newMember) return newMember.name;

        // Fallback to full Loro member list
        const allMembers = store.getMembers();
        const newMemberFull = allMembers.find((m) => m.id === alias.newMemberId);
        if (newMemberFull) return newMemberFull.name;
      }
    }

    // Try filtered members list first
    let member = members().find((m) => m.id === memberId);

    // If not found, check full Loro member list (includes replaced virtual members)
    if (!member && store) {
      const allMembers = store.getMembers();
      member = allMembers.find((m) => m.id === memberId);
    }

    return member?.name || 'Unknown';
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatParticipants = (memberIds: string[] | undefined): string => {
    if (!memberIds || memberIds.length === 0) return '';
    const validIds = memberIds.filter((id): id is string => id != null);
    if (validIds.length === 0) return '';
    if (validIds.length === 1) return getMemberName(validIds[0]!);
    if (validIds.length === 2)
      return `${getMemberName(validIds[0]!)} and ${getMemberName(validIds[1]!)}`;
    return `${getMemberName(validIds[0]!)} and ${validIds.length - 1} others`;
  };

  const formatChangeValue = (value: any, field: string, currency?: string): string => {
    // Handle null/undefined
    if (value == null) return 'none';

    // Handle numbers (amount)
    if (typeof value === 'number') {
      if (field === 'amount' && currency) {
        return formatCurrency(value, currency);
      }
      if (field === 'date') {
        return formatDate(value);
      }
      return String(value);
    }

    // Handle arrays (payers, beneficiaries)
    if (Array.isArray(value)) {
      if (value.length === 0) return 'none';
      // Check if it's an array of payer/beneficiary objects
      if (value[0] && typeof value[0] === 'object' && 'memberId' in value[0]) {
        const memberIds = value.map((item: any) => item.memberId);
        return formatParticipants(memberIds);
      }
      // Otherwise, assume it's an array of strings (member IDs)
      return formatParticipants(value);
    }

    // Handle strings
    if (typeof value === 'string') {
      return value;
    }

    // Handle other objects
    return JSON.stringify(value);
  };

  const getActivityIcon = (): string => {
    switch (props.activity.type) {
      case 'entry_added':
        return '➕';
      case 'entry_modified':
        return '✏️';
      case 'entry_deleted':
        return '🗑️';
      case 'entry_undeleted':
        return '↶';
      case 'member_joined':
        return '👋';
      default:
        return '📝';
    }
  };

  const getActivityColor = (): string => {
    switch (props.activity.type) {
      case 'entry_added':
        return 'var(--color-success)';
      case 'entry_modified':
        return 'var(--color-primary)';
      case 'entry_deleted':
        return 'var(--color-danger)';
      case 'entry_undeleted':
        return 'var(--color-success)';
      case 'member_joined':
        return 'var(--color-primary)';
      default:
        return 'var(--color-text)';
    }
  };

  return (
    <div class="activity-card card">
      <div class="activity-header">
        <div class="activity-icon" style={{ color: getActivityColor() }}>
          {getActivityIcon()}
        </div>
        <div class="activity-main">
          <Switch>
            {/* Entry Added */}
            <Match when={props.activity.type === 'entry_added'}>
              {(() => {
                const activity = props.activity as EntryAddedActivity;
                return (
                  <>
                    <div class="activity-description">
                      <strong>{getMemberName(activity.actorId)}</strong> added{' '}
                      <span class="activity-highlight">"{activity.description}"</span>
                    </div>
                    <div class="activity-details">
                      <div>
                        {formatCurrency(activity.amount, activity.currency)}
                        {' • '}
                        {formatDate(activity.entryDate)}
                      </div>
                      <Show when={activity.payers}>
                        <div
                          class="activity-participants"
                          style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                        >
                          Paid by {formatParticipants(activity.payers)} • For{' '}
                          {formatParticipants(activity.beneficiaries)}
                        </div>
                      </Show>
                      <Show when={activity.from}>
                        <div
                          class="activity-participants"
                          style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                        >
                          {getMemberName(activity.from!)} → {getMemberName(activity.to!)}
                        </div>
                      </Show>
                    </div>
                  </>
                );
              })()}
            </Match>

            {/* Entry Modified */}
            <Match when={props.activity.type === 'entry_modified'}>
              {(() => {
                const activity = props.activity as EntryModifiedActivity;
                return (
                  <>
                    <div class="activity-description">
                      <strong>{getMemberName(activity.actorId)}</strong> modified{' '}
                      <span class="activity-highlight">"{activity.description}"</span>
                    </div>
                    <div class="activity-details">
                      <div>
                        {formatCurrency(activity.amount, activity.currency)}
                        {' • '}
                        {formatDate(activity.entryDate)}
                      </div>
                      <Show when={activity.payers}>
                        <div
                          class="activity-participants"
                          style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                        >
                          Paid by {formatParticipants(activity.payers)} • For{' '}
                          {formatParticipants(activity.beneficiaries)}
                        </div>
                      </Show>
                      <Show when={activity.from}>
                        <div
                          class="activity-participants"
                          style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                        >
                          {getMemberName(activity.from!)} → {getMemberName(activity.to!)}
                        </div>
                      </Show>
                      <Show when={activity.changes && Object.keys(activity.changes).length > 0}>
                        <div
                          class="activity-changes"
                          style="margin-top: var(--space-sm); padding: var(--space-sm); background: var(--color-bg-secondary); border-radius: var(--border-radius); font-size: var(--font-size-sm);"
                        >
                          <div style="font-weight: var(--font-weight-semibold); margin-bottom: var(--space-xs); color: var(--color-text-light);">
                            Changes:
                          </div>
                          <For each={Object.entries(activity.changes || {})}>
                            {([field, change]) => (
                              <div style="margin-bottom: var(--space-xs);">
                                <span style="color: var(--color-text-light);">{field}:</span>{' '}
                                <span style="text-decoration: line-through; color: var(--color-danger);">
                                  {formatChangeValue(change.from, field, activity.currency)}
                                </span>
                                {' → '}
                                <span style="color: var(--color-success);">
                                  {formatChangeValue(change.to, field, activity.currency)}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </>
                );
              })()}
            </Match>

            {/* Entry Deleted */}
            <Match when={props.activity.type === 'entry_deleted'}>
              {(() => {
                const activity = props.activity as EntryDeletedActivity;
                return (
                  <>
                    <div class="activity-description">
                      <strong>{getMemberName(activity.actorId)}</strong> deleted{' '}
                      <span class="activity-highlight">"{activity.description}"</span>
                    </div>
                    <div class="activity-details">
                      <div>
                        {formatCurrency(activity.amount, activity.currency)}
                        {' • '}
                        {formatDate(activity.entryDate)}
                        {activity.reason && (
                          <span class="activity-reason"> • {activity.reason}</span>
                        )}
                      </div>
                      <Show when={activity.payers}>
                        <div
                          class="activity-participants"
                          style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                        >
                          Paid by {formatParticipants(activity.payers)} • For{' '}
                          {formatParticipants(activity.beneficiaries)}
                        </div>
                      </Show>
                      <Show when={activity.from}>
                        <div
                          class="activity-participants"
                          style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                        >
                          {getMemberName(activity.from!)} → {getMemberName(activity.to!)}
                        </div>
                      </Show>
                    </div>
                  </>
                );
              })()}
            </Match>

            {/* Entry Undeleted */}
            <Match when={props.activity.type === 'entry_undeleted'}>
              {(() => {
                const activity = props.activity as EntryUndeletedActivity;
                return (
                  <>
                    <div class="activity-description">
                      <strong>{getMemberName(activity.actorId)}</strong> restored{' '}
                      <span class="activity-highlight">"{activity.description}"</span>
                    </div>
                    <div class="activity-details">
                      <div>
                        {formatCurrency(activity.amount, activity.currency)}
                        {' • '}
                        {formatDate(activity.entryDate)}
                      </div>
                      <Show when={activity.payers}>
                        <div
                          class="activity-participants"
                          style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                        >
                          Paid by {formatParticipants(activity.payers)} • For{' '}
                          {formatParticipants(activity.beneficiaries)}
                        </div>
                      </Show>
                      <Show when={activity.from}>
                        <div
                          class="activity-participants"
                          style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                        >
                          {getMemberName(activity.from!)} → {getMemberName(activity.to!)}
                        </div>
                      </Show>
                    </div>
                  </>
                );
              })()}
            </Match>

            {/* Member Joined */}
            <Match when={props.activity.type === 'member_joined'}>
              <div class="activity-description">
                <strong>{'memberName' in props.activity && props.activity.memberName}</strong>{' '}
                joined the group
                {'isVirtual' in props.activity && props.activity.isVirtual && (
                  <span class="activity-virtual"> (virtual member)</span>
                )}
              </div>
            </Match>
          </Switch>
        </div>
      </div>

      <div class="activity-footer">
        <span class="activity-time">{formatRelativeTime(props.activity.timestamp)}</span>
      </div>
    </div>
  );
};
