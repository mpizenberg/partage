import { Component, Match, Switch, Show, For, createMemo, createSignal } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
import { useI18n, formatCurrency, formatRelativeTime } from '../../../i18n';
import { EntryDetailsModal } from './EntryDetailsModal';
import type {
  Activity,
  EntryModifiedActivity,
  EntryAddedActivity,
  EntryDeletedActivity,
  EntryUndeletedActivity,
  Entry,
} from '@partage/shared';

export interface ActivityCardProps {
  activity: Activity;
}

export const ActivityCard: Component<ActivityCardProps> = (props) => {
  const { members, loroStore, getActiveGroupKey, activeGroup, identity } = useAppContext();
  const { t, locale } = useI18n();

  // Modal state
  const [showModal, setShowModal] = createSignal(false);
  const [selectedEntry, setSelectedEntry] = createSignal<Entry | null>(null);
  const [isLoadingEntry, setIsLoadingEntry] = createSignal(false);

  const defaultCurrency = () => activeGroup()?.defaultCurrency;

  const formatAmount = (amount: number, currency: string): string => {
    return formatCurrency(amount, currency, locale());
  };

  // Get translated description for entries (handles transfer translation)
  const getTranslatedDescription = (activity: any): string => {
    if (activity.entryType === 'transfer') {
      return t('entries.transfer');
    }
    return activity.description || '';
  };

  // Memoized member name lookup map - uses member's own name (not canonical)
  const memberNameMap = createMemo(() => {
    const nameMap = new Map<string, string>();
    const store = loroStore();
    if (!store) {
      for (const member of members()) {
        nameMap.set(member.id, member.name);
      }
      return nameMap;
    }

    // Use event-based system: get each member's own name (not canonical resolution)
    const allStates = store.getAllMemberStates();

    for (const [memberId, state] of allStates) {
      nameMap.set(memberId, state.name);
    }
    return nameMap;
  });

  const getMemberName = (memberId: string): string => {
    return memberNameMap().get(memberId) || t('common.unknown');
  };

  const formatDate = (timestamp: number): string => {
    const localeCode = locale() === 'fr' ? 'fr-FR' : 'en-US';
    return new Date(timestamp).toLocaleDateString(localeCode, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatParticipants = (
    memberIds: string[] | undefined,
    nameMap?: Record<string, string>
  ): string => {
    if (!memberIds || memberIds.length === 0) return '';
    const validIds = memberIds.filter((id): id is string => id != null);
    if (validIds.length === 0) return '';

    const getName = (id: string) => nameMap?.[id] ?? getMemberName(id);

    if (validIds.length === 1) return getName(validIds[0]!);
    if (validIds.length === 2)
      return `${getName(validIds[0]!)} ${t('common.and')} ${getName(validIds[1]!)}`;
    return `${getName(validIds[0]!)} ${t('common.and')} ${validIds.length - 1} ${t('common.others')}`;
  };

  const formatChangeValue = (
    value: any,
    field: string,
    currency?: string,
    defaultCurrency?: string
  ): string => {
    // Handle null/undefined
    if (value == null) return t('activity.none');

    // Handle numbers (amount)
    if (typeof value === 'number') {
      if (field === 'amount' && currency) {
        return formatAmount(value, currency);
      }
      if (field === 'defaultCurrencyAmount' && defaultCurrency) {
        return formatAmount(value, defaultCurrency);
      }
      if (field === 'date') {
        return formatDate(value);
      }
      return String(value);
    }

    // Handle arrays (payers, beneficiaries)
    if (Array.isArray(value)) {
      if (value.length === 0) return t('activity.none');
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
      case 'group_metadata_updated':
        return '✏️';
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
      case 'group_metadata_updated':
        return 'var(--color-primary)';
      case 'entry_undeleted':
        return 'var(--color-success)';
      case 'member_joined':
        return 'var(--color-primary)';
      default:
        return 'var(--color-text)';
    }
  };

  const isEntryActivity = (): boolean => {
    return (
      props.activity.type === 'entry_added' ||
      props.activity.type === 'entry_modified' ||
      props.activity.type === 'entry_deleted' ||
      props.activity.type === 'entry_undeleted'
    );
  };

  const getEntryId = (): string | null => {
    const activity = props.activity as any;
    return activity.entryId || null;
  };

  const getChanges = (): Record<string, { from: any; to: any }> | undefined => {
    if (props.activity.type === 'entry_modified') {
      return (props.activity as EntryModifiedActivity).changes;
    }
    return undefined;
  };

  const getDeletionReason = (): string | undefined => {
    if (props.activity.type === 'entry_deleted') {
      return (props.activity as EntryDeletedActivity).reason;
    }
    return undefined;
  };

  // Helper to format amount with optional default currency in parenthesis
  const showAmount = (
    amount: number,
    defaultCurrencyAmount: number | undefined,
    currency: string
  ): string => {
    const defCurrency = defaultCurrency();
    let result = formatAmount(amount, currency);

    // If currency is different from default and we have a defaultCurrencyAmount, show it in parenthesis
    if (
      defCurrency &&
      currency !== defCurrency &&
      defaultCurrencyAmount !== undefined &&
      defaultCurrencyAmount !== amount
    ) {
      result += ` (${formatAmount(defaultCurrencyAmount, defCurrency)})`;
    }

    return result;
  };

  // Helper to check if we should show multi-currency amount display
  const shouldShowMultiCurrencyAmount = (): boolean => {
    if (props.activity.type !== 'entry_modified') return false;
    const activity = props.activity as EntryModifiedActivity;
    const changes = activity.changes;
    if (!changes || !('amount' in changes || 'defaultCurrencyAmount' in changes)) return false;

    // Get old and new currencies
    const oldCurrency = changes.currency?.from ?? activity.currency;
    const newCurrency = changes.currency?.to ?? activity.currency;
    const defCurrency = defaultCurrency();

    // Show multi-currency display if either old or new currency is not default
    return oldCurrency !== defCurrency || newCurrency !== defCurrency;
  };

  const getOldCurrency = (): string => {
    if (props.activity.type !== 'entry_modified') return '';
    const activity = props.activity as EntryModifiedActivity;
    return activity.changes?.currency?.from ?? activity.currency;
  };

  const getNewCurrency = (): string => {
    if (props.activity.type !== 'entry_modified') return '';
    const activity = props.activity as EntryModifiedActivity;
    return activity.changes?.currency?.to ?? activity.currency;
  };

  const handleActivityClick = async () => {
    if (!isEntryActivity()) return;

    const entryId = getEntryId();
    if (!entryId) return;

    try {
      setIsLoadingEntry(true);
      const store = loroStore();
      const groupKey = await getActiveGroupKey();

      if (!store || !groupKey) {
        console.error('Store or group key not available');
        return;
      }

      const entry = await store.getEntry(entryId, groupKey);
      if (entry) {
        setSelectedEntry(entry);
        setShowModal(true);
      }
    } catch (error) {
      console.error('Failed to load entry:', error);
    } finally {
      setIsLoadingEntry(false);
    }
  };

  // Helper to check if user is involved in this activity
  const isUserInvolved = (): boolean => {
    const store = loroStore();
    const userIdentity = identity();
    if (!store || !userIdentity) return false;

    // Get current user's public key hash
    const userPublicKeyHash = userIdentity.publicKeyHash;
    if (!userPublicKeyHash) return false;

    const activity = props.activity;

    // For entry activities, check if user is in payers or beneficiaries
    if (
      activity.type === 'entry_added' ||
      activity.type === 'entry_modified' ||
      activity.type === 'entry_deleted' ||
      activity.type === 'entry_undeleted'
    ) {
      const entryActivity = activity as any;

      // Get canonical user ID
      const canonicalUserId = store.resolveCanonicalMemberId(userPublicKeyHash);

      // Check if user is in payers or beneficiaries (for expenses)
      if (entryActivity.payers) {
        const involved = entryActivity.payers.some((payerId: string) => {
          const canonicalId = store.resolveCanonicalMemberId(payerId);
          return canonicalId === canonicalUserId;
        });
        if (involved) return true;
      }

      if (entryActivity.beneficiaries) {
        const involved = entryActivity.beneficiaries.some((benId: string) => {
          const canonicalId = store.resolveCanonicalMemberId(benId);
          return canonicalId === canonicalUserId;
        });
        if (involved) return true;
      }

      // Check if user is in from/to (for transfers)
      if (entryActivity.from) {
        const canonicalFrom = store.resolveCanonicalMemberId(entryActivity.from);
        if (canonicalFrom === canonicalUserId) return true;
      }

      if (entryActivity.to) {
        const canonicalTo = store.resolveCanonicalMemberId(entryActivity.to);
        if (canonicalTo === canonicalUserId) return true;
      }
    }

    return false;
  };

  // Helper to get member names from activity for modal
  const getPayerNames = () => {
    if (!isEntryActivity()) return undefined;
    const activity = props.activity as any;
    return activity.payerNames;
  };

  const getBeneficiaryNames = () => {
    if (!isEntryActivity()) return undefined;
    const activity = props.activity as any;
    return activity.beneficiaryNames;
  };

  const getFromName = () => {
    if (!isEntryActivity()) return undefined;
    const activity = props.activity as any;
    return activity.fromName;
  };

  const getToName = () => {
    if (!isEntryActivity()) return undefined;
    const activity = props.activity as any;
    return activity.toName;
  };

  return (
    <>
      <div
        class="activity-card card"
        classList={{
          'activity-card-involved': isUserInvolved(),
        }}
        onClick={handleActivityClick}
        style={{
          cursor: isEntryActivity() ? 'pointer' : 'default',
          opacity: isLoadingEntry() ? 0.6 : 1,
        }}
      >
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
                        <strong>{activity.actorName}</strong> {t('activity.added')}{' '}
                        <span class="activity-highlight">"{getTranslatedDescription(activity)}"</span>
                      </div>
                      <div class="activity-details">
                        <div>
                          {formatAmount(activity.amount, activity.currency)}
                          {' • '}
                          {formatDate(activity.entryDate)}
                        </div>
                        <Show when={activity.payers}>
                          <div
                            class="activity-participants"
                            style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                          >
                            {t('activity.paidBy')}{' '}
                            {formatParticipants(activity.payers, activity.payerNames)} •{' '}
                            {t('activity.for')}{' '}
                            {formatParticipants(activity.beneficiaries, activity.beneficiaryNames)}
                          </div>
                        </Show>
                        <Show when={activity.from}>
                          <div
                            class="activity-participants"
                            style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                          >
                            {activity.fromName || getMemberName(activity.from!)} →{' '}
                            {activity.toName || getMemberName(activity.to!)}
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
                        <strong>{activity.actorName}</strong> {t('activity.modified')}{' '}
                        <span class="activity-highlight">"{getTranslatedDescription(activity)}"</span>
                      </div>
                      <div class="activity-details">
                        <div>
                          {formatAmount(activity.amount, activity.currency)}
                          {' • '}
                          {formatDate(activity.entryDate)}
                        </div>
                        <Show when={activity.payers}>
                          <div
                            class="activity-participants"
                            style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                          >
                            {t('activity.paidBy')}{' '}
                            {formatParticipants(activity.payers, activity.payerNames)} •{' '}
                            {t('activity.for')}{' '}
                            {formatParticipants(activity.beneficiaries, activity.beneficiaryNames)}
                          </div>
                        </Show>
                        <Show when={activity.from}>
                          <div
                            class="activity-participants"
                            style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                          >
                            {activity.fromName || getMemberName(activity.from!)} →{' '}
                            {activity.toName || getMemberName(activity.to!)}
                          </div>
                        </Show>
                        <Show when={activity.changes && Object.keys(activity.changes).length > 0}>
                          <div
                            class="activity-changes"
                            style="margin-top: var(--space-sm); padding: var(--space-sm); background: var(--color-bg-secondary); border-radius: var(--border-radius); font-size: var(--font-size-sm);"
                          >
                            <div style="font-weight: var(--font-weight-semibold); margin-bottom: var(--space-xs); color: var(--color-text-light);">
                              {t('activity.changes')}
                            </div>

                            {/* Multi-currency amount display (if needed) */}
                            <Show when={shouldShowMultiCurrencyAmount()}>
                              <div style="margin-bottom: var(--space-xs);">
                                <span style="color: var(--color-text-light);">amount:</span>{' '}
                                <span style="text-decoration: line-through; color: var(--color-danger);">
                                  {showAmount(
                                    activity.changes!.amount?.from ?? activity.amount,
                                    activity.changes!.defaultCurrencyAmount?.from ??
                                      (getOldCurrency() === defaultCurrency()
                                        ? (activity.changes!.amount?.from ?? activity.amount)
                                        : activity.defaultCurrencyAmount),
                                    getOldCurrency()
                                  )}
                                </span>
                                {' → '}
                                <span style="color: var(--color-success);">
                                  {showAmount(
                                    activity.changes!.amount?.to ?? activity.amount,
                                    activity.changes!.defaultCurrencyAmount?.to ??
                                      (getNewCurrency() === defaultCurrency()
                                        ? (activity.changes!.amount?.to ?? activity.amount)
                                        : activity.defaultCurrencyAmount),
                                    getNewCurrency()
                                  )}
                                </span>
                              </div>
                            </Show>

                            {/* Other changes (excluding amount/defaultCurrencyAmount/currency when multi-currency display is shown) */}
                            <For
                              each={Object.entries(activity.changes || {}).filter(([field]) => {
                                // Skip notes and currency (handled separately)
                                if (field === 'notes' || field === 'currency') return false;
                                // If multi-currency display is shown, skip both amount fields
                                if (
                                  shouldShowMultiCurrencyAmount() &&
                                  (field === 'amount' || field === 'defaultCurrencyAmount')
                                )
                                  return false;
                                // If NOT multi-currency but defaultCurrencyAmount changed, skip it (only show amount)
                                if (
                                  !shouldShowMultiCurrencyAmount() &&
                                  field === 'defaultCurrencyAmount'
                                )
                                  return false;
                                return true;
                              })}
                            >
                              {([field, change]) => (
                                <div style="margin-bottom: var(--space-xs);">
                                  <span style="color: var(--color-text-light);">{field}:</span>{' '}
                                  <span style="text-decoration: line-through; color: var(--color-danger);">
                                    {formatChangeValue(
                                      change.from,
                                      field,
                                      activity.currency,
                                      defaultCurrency()
                                    )}
                                  </span>
                                  {' → '}
                                  <span style="color: var(--color-success);">
                                    {formatChangeValue(
                                      change.to,
                                      field,
                                      activity.currency,
                                      defaultCurrency()
                                    )}
                                  </span>
                                </div>
                              )}
                            </For>

                            {/* Show notes changed indicator */}
                            <Show when={activity.changes && 'notes' in activity.changes}>
                              <div style="margin-bottom: var(--space-xs); color: var(--color-text-light); font-style: italic;">
                                • {t('activity.notesChanged')}
                              </div>
                            </Show>
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
                        <strong>{activity.actorName}</strong> {t('activity.deleted')}{' '}
                        <span class="activity-highlight">"{getTranslatedDescription(activity)}"</span>
                      </div>
                      <div class="activity-details">
                        <div>
                          {formatAmount(activity.amount, activity.currency)}
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
                            {t('activity.paidBy')}{' '}
                            {formatParticipants(activity.payers, activity.payerNames)} •{' '}
                            {t('activity.for')}{' '}
                            {formatParticipants(activity.beneficiaries, activity.beneficiaryNames)}
                          </div>
                        </Show>
                        <Show when={activity.from}>
                          <div
                            class="activity-participants"
                            style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                          >
                            {activity.fromName || getMemberName(activity.from!)} →{' '}
                            {activity.toName || getMemberName(activity.to!)}
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
                        <strong>{activity.actorName}</strong> {t('activity.restored')}{' '}
                        <span class="activity-highlight">"{getTranslatedDescription(activity)}"</span>
                      </div>
                      <div class="activity-details">
                        <div>
                          {formatAmount(activity.amount, activity.currency)}
                          {' • '}
                          {formatDate(activity.entryDate)}
                        </div>
                        <Show when={activity.payers}>
                          <div
                            class="activity-participants"
                            style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                          >
                            {t('activity.paidBy')}{' '}
                            {formatParticipants(activity.payers, activity.payerNames)} •{' '}
                            {t('activity.for')}{' '}
                            {formatParticipants(activity.beneficiaries, activity.beneficiaryNames)}
                          </div>
                        </Show>
                        <Show when={activity.from}>
                          <div
                            class="activity-participants"
                            style="font-size: var(--font-size-sm); color: var(--color-text-light); margin-top: var(--space-xs);"
                          >
                            {activity.fromName || getMemberName(activity.from!)} →{' '}
                            {activity.toName || getMemberName(activity.to!)}
                          </div>
                        </Show>
                      </div>
                    </>
                  );
                })()}
              </Match>

              {/* Member Joined */}
              <Match when={props.activity.type === 'member_joined'}>
                {(() => {
                  const activity = props.activity as any;
                  return (
                    <div class="activity-description">
                      <strong>
                        {activity.memberName}
                        {activity.currentName && (
                          <span class="activity-current-name">
                            {' '}
                            ({t('activity.now')} {activity.currentName})
                          </span>
                        )}
                      </strong>{' '}
                      {t('activity.joinedGroup')}
                      {activity.isVirtual && (
                        <span class="activity-virtual"> ({t('activity.virtualMember')})</span>
                      )}
                    </div>
                  );
                })()}
              </Match>

              {/* Member Linked (re-joined) */}
              <Match when={props.activity.type === 'member_linked'}>
                {(() => {
                  const activity = props.activity as any;
                  return (
                    <div class="activity-description">
                      <strong>
                        {activity.newMemberName}
                        {activity.currentName && (
                          <span class="activity-current-name">
                            {' '}
                            ({t('activity.now')} {activity.currentName})
                          </span>
                        )}
                      </strong>{' '}
                      {t('activity.reJoined')}
                    </div>
                  );
                })()}
              </Match>

              {/* Member Renamed */}
              <Match when={props.activity.type === 'member_renamed'}>
                {(() => {
                  const activity = props.activity as any;
                  return (
                    <div class="activity-description">
                      <strong>{activity.oldName}</strong> {t('activity.renamedTo')}{' '}
                      <strong>
                        {activity.newName}
                        {activity.currentName && (
                          <span class="activity-current-name">
                            {' '}
                            ({t('activity.now')} {activity.currentName})
                          </span>
                        )}
                      </strong>
                    </div>
                  );
                })()}
              </Match>

              {/* Member Retired */}
              <Match when={props.activity.type === 'member_retired'}>
                {(() => {
                  const activity = props.activity as any;
                  return (
                    <div class="activity-description">
                      <strong>
                        {activity.memberName}
                        {activity.currentName && (
                          <span class="activity-current-name">
                            {' '}
                            ({t('activity.now')} {activity.currentName})
                          </span>
                        )}
                      </strong>{' '}
                      {t('activity.wasRemovedFromGroup')}
                    </div>
                  );
                })()}
              </Match>

              {/* Group Metadata Updated (Rename) */}
              <Match when={props.activity.type === 'group_metadata_updated'}>
                {(() => {
                  const activity = props.activity as any;
                  return (
                    <div class="activity-description">
                      <strong>{activity.actorName}</strong> {t('activity.renamedGroupTo')}{' '}
                      <span class="activity-highlight">"{activity.newName}"</span>
                      <Show when={activity.previousName}>
                        <div
                          class="activity-details"
                          style="margin-top: var(--space-xs); font-size: var(--font-size-sm); color: var(--color-text-light);"
                        >
                          {t('activity.previouslyNamed')} "{activity.previousName}"
                        </div>
                      </Show>
                    </div>
                  );
                })()}
              </Match>
            </Switch>
          </div>
        </div>

        <div class="activity-footer">
          <span class="activity-time">
            {formatRelativeTime(props.activity.timestamp, locale(), t)}
          </span>
        </div>
      </div>

      {/* Entry Details Modal */}
      <EntryDetailsModal
        isOpen={showModal()}
        onClose={() => setShowModal(false)}
        entry={selectedEntry()}
        changes={getChanges()}
        deletionReason={getDeletionReason()}
        payerNames={getPayerNames()}
        beneficiaryNames={getBeneficiaryNames()}
        fromName={getFromName()}
        toName={getToName()}
      />
    </>
  );
};
