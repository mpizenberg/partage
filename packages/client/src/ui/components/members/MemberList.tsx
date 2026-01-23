/**
 * Member List - Displays all group members with their status
 * Shows real members (with public keys) vs virtual members (name only)
 */

import { Component, For, Show, createSignal, createMemo } from 'solid-js';
import type { Member, Balance, MemberPaymentInfo } from '@partage/shared';
import type { LoroEntryStore } from '../../../core/crdt/loro-wrapper';
import { useI18n } from '../../../i18n';

export interface MemberListProps {
  members: Member[];
  currentUserPublicKeyHash?: string;
  showStatus?: boolean;
  balances?: Map<string, Balance>;
  loroStore?: LoroEntryStore | null;
  memberMetadataMap?: Map<string, { phone?: string; payment?: MemberPaymentInfo; info?: string }>;
  onMemberClick?: (member: Member) => void;
  onRemoveMember?: (memberId: string) => Promise<void>;
}

type SortMode = 'name' | 'date';

export const MemberList: Component<MemberListProps> = (props) => {
  const { t, locale } = useI18n();
  const [sortMode, setSortMode] = createSignal<SortMode>('name');
  const [memberToRemove, setMemberToRemove] = createSignal<Member | null>(null);
  const [showDeparted, setShowDeparted] = createSignal(false);

  // Get member metadata for indicators
  const getMemberMetadata = (memberId: string) => {
    return props.memberMetadataMap?.get(memberId);
  };

  const hasPaymentInfo = (memberId: string): boolean => {
    const metadata = getMemberMetadata(memberId);
    if (!metadata?.payment) return false;
    return Object.values(metadata.payment).some((v) => !!v);
  };

  const sortedMembers = createMemo(() => {
    // Filter by status first
    let membersList = showDeparted()
      ? props.members.filter((m) => m.status === 'departed')
      : props.members.filter((m) => m.status === 'active');

    // Then sort
    if (sortMode() === 'name') {
      return membersList.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Sort by date joined (newer first)
      return membersList.sort((a, b) => b.joinedAt - a.joinedAt);
    }
  });

  const formatJoinedDate = (timestamp: number) => {
    const localeCode = locale() === 'fr' ? 'fr-FR' : 'en-US';
    const date = new Date(timestamp);
    return date.toLocaleDateString(localeCode, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const truncateId = (id: string): string => {
    return id.length > 16 ? id.substring(0, 16) + '...' : id;
  };

  const getAddedByName = (addedById: string | undefined): string => {
    if (!addedById) return t('common.unknown');
    const member = props.members.find((m) => m.id === addedById);
    return member?.name || t('common.unknown');
  };

  const startRemove = (member: Member, e: Event) => {
    e.stopPropagation(); // Prevent triggering member click
    setMemberToRemove(member);
  };

  const handleMemberClick = (member: Member) => {
    if (props.onMemberClick) {
      props.onMemberClick(member);
    }
  };

  const cancelRemove = () => {
    setMemberToRemove(null);
  };

  const confirmRemove = async () => {
    const member = memberToRemove();
    if (!member || !props.onRemoveMember) return;

    try {
      await props.onRemoveMember(member.id);
      setMemberToRemove(null);
    } catch (error) {
      console.error('Failed to remove member:', error);
      alert(t('members.removeFailed'));
    }
  };

  const canRemoveMember = (memberId: string): boolean => {
    if (!props.balances) return true;

    // Resolve canonical member ID (for aliased members, this returns the old virtual member ID)
    let lookupId = memberId;
    if (props.loroStore) {
      lookupId = props.loroStore.resolveCanonicalMemberId(memberId);
    }

    const balance = props.balances.get(lookupId);
    if (!balance) return true;
    // Allow removal only if balance is essentially zero (within 0.01 tolerance)
    return Math.abs(balance.netBalance) < 0.01;
  };

  return (
    <div>
      {/* Controls */}
      <div class="member-list-controls" style="margin-bottom: var(--space-md);">
        {/* Sorting buttons */}
        <div style="display: flex; align-items: center; gap: var(--space-xs); margin-bottom: var(--space-sm);">
          <span class="sort-icon" style="font-size: var(--font-size-lg);">
            ⇅
          </span>
          <div class="sort-toggle">
            <button
              class={`sort-toggle-btn ${sortMode() === 'name' ? 'active' : ''}`}
              onClick={() => setSortMode('name')}
            >
              {t('members.byName')}
            </button>
            <button
              class={`sort-toggle-btn ${sortMode() === 'date' ? 'active' : ''}`}
              onClick={() => setSortMode('date')}
            >
              {t('members.byDateJoined')}
            </button>
          </div>
        </div>
        {/* Show past members checkbox - on separate line */}
        <label style="display: flex; align-items: center; gap: var(--space-xs); cursor: pointer;">
          <input
            type="checkbox"
            checked={showDeparted()}
            onChange={(e) => setShowDeparted(e.currentTarget.checked)}
          />
          <span>{t('members.showPastMembersOnly')}</span>
        </label>
      </div>

      <div class="member-list">
        <For each={sortedMembers()}>
          {(member) => (
            <div
              class="member-item"
              classList={{
                'member-current': member.id === props.currentUserPublicKeyHash,
                'member-departed': member.status === 'departed',
                'member-item--clickable': !!props.onMemberClick,
              }}
              onClick={() => handleMemberClick(member)}
              role={props.onMemberClick ? 'button' : undefined}
              tabIndex={props.onMemberClick ? 0 : undefined}
              onKeyPress={(e) => e.key === 'Enter' && handleMemberClick(member)}
            >
              <div class="member-info">
                <div class="member-row-1">
                  <div class="member-name-wrapper">
                    <span class="member-name">{member.name}</span>
                    <Show when={member.id === props.currentUserPublicKeyHash}>
                      <span class="member-badge">{t('common.you')}</span>
                    </Show>
                    <Show when={member.isVirtual}>
                      <span class="member-badge-virtual-small">{t('members.virtual')}</span>
                    </Show>
                    {/* Metadata indicators */}
                    <Show when={getMemberMetadata(member.id)?.phone}>
                      <span class="member-metadata-indicator" title={t('memberDetail.hasPhone')}>
                        📞
                      </span>
                    </Show>
                    <Show when={hasPaymentInfo(member.id)}>
                      <span class="member-metadata-indicator" title={t('memberDetail.hasPayment')}>
                        💳
                      </span>
                    </Show>
                  </div>
                  <span class="member-joined-date">{formatJoinedDate(member.joinedAt)}</span>
                </div>

                <div class="member-row-2">
                  <Show
                    when={!member.isVirtual && member.id}
                    fallback={
                      <span class="member-id-text">
                        {t('members.addedBy')}: {getAddedByName(member.addedBy)} (
                        {member.addedBy ? truncateId(member.addedBy) : t('common.unknown')})
                      </span>
                    }
                  >
                    <span class="member-id-text">ID: {member.id}</span>
                  </Show>
                </div>

                {/* Remove button - only show for active members when handler is provided */}
                <Show when={member.status === 'active' && props.onRemoveMember}>
                  <div
                    class="member-actions"
                    style="margin-top: var(--space-sm); display: flex; gap: var(--space-sm);"
                  >
                    <button
                      class="btn btn-sm btn-danger"
                      onClick={(e) => startRemove(member, e)}
                      disabled={!canRemoveMember(member.id)}
                      title={!canRemoveMember(member.id) ? t('members.cannotRemove') : ''}
                      style="font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);"
                    >
                      🗑️ {t('members.remove')}
                    </button>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Remove Member Confirmation Modal */}
      <Show when={memberToRemove()}>
        <div class="modal-overlay" onClick={cancelRemove}>
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <div class="modal-body">
              <h2 class="text-xl font-bold mb-md">{t('members.removeMemberQuestion')}</h2>
              <p class="mb-lg">
                {t('members.removeConfirm', { name: memberToRemove()?.name || '' })}
              </p>
              <div class="modal-actions">
                <button
                  class="btn btn-secondary"
                  onClick={cancelRemove}
                  style="padding: var(--space-sm) var(--space-md);"
                >
                  {t('common.cancel')}
                </button>
                <button
                  class="btn btn-danger"
                  onClick={confirmRemove}
                  style="padding: var(--space-sm) var(--space-md);"
                >
                  {t('members.removeMember')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
