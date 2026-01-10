import { Component, Match, Switch } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
import { formatRelativeTime } from '../../../domain/calculations/activity-generator';
import type { Activity } from '@partage/shared';

export interface ActivityCardProps {
  activity: Activity;
}

export const ActivityCard: Component<ActivityCardProps> = (props) => {
  const { members, identity } = useAppContext();

  const formatCurrency = (amount: number, currency: string): string => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  const getMemberName = (memberId: string): string => {
    if (memberId === identity()?.publicKeyHash) return 'You';
    const member = members().find((m) => m.id === memberId);
    return member?.name || 'Unknown';
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
              <div class="activity-description">
                <strong>{getMemberName(props.activity.actorId)}</strong> added{' '}
                <span class="activity-highlight">
                  "{'description' in props.activity && props.activity.description}"
                </span>
              </div>
              <div class="activity-details">
                {'amount' in props.activity &&
                  formatCurrency(props.activity.amount, props.activity.currency)}
              </div>
            </Match>

            {/* Entry Modified */}
            <Match when={props.activity.type === 'entry_modified'}>
              <div class="activity-description">
                <strong>{getMemberName(props.activity.actorId)}</strong> modified{' '}
                <span class="activity-highlight">
                  "{'description' in props.activity && props.activity.description}"
                </span>
              </div>
              <div class="activity-details">
                {'amount' in props.activity &&
                  formatCurrency(props.activity.amount, props.activity.currency)}
              </div>
            </Match>

            {/* Entry Deleted */}
            <Match when={props.activity.type === 'entry_deleted'}>
              <div class="activity-description">
                <strong>{getMemberName(props.activity.actorId)}</strong> deleted{' '}
                <span class="activity-highlight">
                  "{'description' in props.activity && props.activity.description}"
                </span>
              </div>
              <div class="activity-details">
                {'amount' in props.activity &&
                  formatCurrency(props.activity.amount, props.activity.currency)}
                {'reason' in props.activity && props.activity.reason && (
                  <span class="activity-reason"> • {props.activity.reason}</span>
                )}
              </div>
            </Match>

            {/* Entry Undeleted */}
            <Match when={props.activity.type === 'entry_undeleted'}>
              <div class="activity-description">
                <strong>{getMemberName(props.activity.actorId)}</strong> restored{' '}
                <span class="activity-highlight">
                  "{'description' in props.activity && props.activity.description}"
                </span>
              </div>
              <div class="activity-details">
                {'amount' in props.activity &&
                  formatCurrency(props.activity.amount, props.activity.currency)}
              </div>
            </Match>

            {/* Member Joined */}
            <Match when={props.activity.type === 'member_joined'}>
              <div class="activity-description">
                <strong>
                  {'memberName' in props.activity && props.activity.memberName}
                </strong>{' '}
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
