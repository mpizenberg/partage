/**
 * Member List - Displays all group members with their status
 * Shows real members (with public keys) vs virtual members (name only)
 */

import { Component, For, Show, createSignal, createMemo } from 'solid-js';
import type { Member, Balance } from '@partage/shared';
import type { LoroEntryStore } from '../../../core/crdt/loro-wrapper';

export interface MemberListProps {
  members: Member[];
  currentUserPublicKeyHash?: string;
  showStatus?: boolean;
  balances?: Map<string, Balance>;
  loroStore?: LoroEntryStore | null;
  onRenameMember?: (memberId: string, newName: string) => Promise<void>;
  onRemoveMember?: (memberId: string) => Promise<void>;
}

type SortMode = 'name' | 'date';

export const MemberList: Component<MemberListProps> = (props) => {
  const [sortMode, setSortMode] = createSignal<SortMode>('name');
  const [editingMemberId, setEditingMemberId] = createSignal<string | null>(null);
  const [newName, setNewName] = createSignal('');
  const [memberToRemove, setMemberToRemove] = createSignal<Member | null>(null);
  const [showDeparted, setShowDeparted] = createSignal(false);

  const sortedMembers = createMemo(() => {
    // Filter by status first
    let membersList = showDeparted()
      ? props.members.filter(m => m.status === 'departed')
      : props.members.filter(m => m.status === 'active');

    // Then sort
    if (sortMode() === 'name') {
      return membersList.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Sort by date joined (newer first)
      return membersList.sort((a, b) => b.joinedAt - a.joinedAt);
    }
  });

  const formatJoinedDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const truncateId = (id: string): string => {
    return id.length > 16 ? id.substring(0, 16) + '...' : id;
  };

  const getAddedByName = (addedById: string | undefined): string => {
    if (!addedById) return 'Unknown';
    const member = props.members.find(m => m.id === addedById);
    return member?.name || 'Unknown';
  };

  const startRename = (member: Member) => {
    setEditingMemberId(member.id);
    setNewName(member.name);
  };

  const cancelRename = () => {
    setEditingMemberId(null);
    setNewName('');
  };

  const confirmRename = async (memberId: string) => {
    if (!props.onRenameMember) return;

    const trimmedName = newName().trim();
    if (!trimmedName) return;

    try {
      await props.onRenameMember(memberId, trimmedName);
      setEditingMemberId(null);
      setNewName('');
    } catch (error) {
      console.error('Failed to rename member:', error);
      alert('Failed to rename member');
    }
  };

  const startRemove = (member: Member) => {
    setMemberToRemove(member);
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
      alert('Failed to remove member');
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
      <div class="member-list-controls" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-md);">
        <div class="sort-toggle">
          <button
            class={`sort-toggle-btn ${sortMode() === 'name' ? 'active' : ''}`}
            onClick={() => setSortMode('name')}
          >
            By Name
          </button>
          <button
            class={`sort-toggle-btn ${sortMode() === 'date' ? 'active' : ''}`}
            onClick={() => setSortMode('date')}
          >
            By Date Joined
          </button>
        </div>
        <label style="display: flex; align-items: center; gap: var(--space-xs); cursor: pointer;">
          <input
            type="checkbox"
            checked={showDeparted()}
            onChange={(e) => setShowDeparted(e.currentTarget.checked)}
          />
          <span>Show past members only</span>
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
              }}
            >
              <div class="member-info">
                <Show
                  when={editingMemberId() === member.id}
                  fallback={
                    <>
                      <div class="member-row-1">
                        <div class="member-name-wrapper">
                          <span class="member-name">{member.name}</span>
                          <Show when={member.id === props.currentUserPublicKeyHash}>
                            <span class="member-badge">You</span>
                          </Show>
                          <Show when={member.isVirtual}>
                            <span class="member-badge-virtual-small">Virtual</span>
                          </Show>
                        </div>
                        <span class="member-joined-date">{formatJoinedDate(member.joinedAt)}</span>
                      </div>

                      <div class="member-row-2">
                        <Show
                          when={!member.isVirtual && member.id}
                          fallback={
                            <span class="member-id-text">
                              Added by: {getAddedByName(member.addedBy)} ({member.addedBy ? truncateId(member.addedBy) : 'Unknown'})
                            </span>
                          }
                        >
                          <span class="member-id-text">ID: {member.id}</span>
                        </Show>
                      </div>

                      {/* Action buttons - only show for active members when handlers are provided */}
                      <Show when={member.status === 'active' && (props.onRenameMember || props.onRemoveMember)}>
                        <div class="member-actions" style="margin-top: var(--space-sm); display: flex; gap: var(--space-sm);">
                          <Show when={props.onRenameMember}>
                            <button
                              class="btn btn-sm btn-secondary"
                              onClick={() => startRename(member)}
                              style="font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);"
                            >
                              ✏️ Rename
                            </button>
                          </Show>
                          <Show when={props.onRemoveMember}>
                            <button
                              class="btn btn-sm btn-danger"
                              onClick={() => startRemove(member)}
                              disabled={!canRemoveMember(member.id)}
                              title={!canRemoveMember(member.id) ? 'Cannot remove member with non-zero balance' : ''}
                              style="font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);"
                            >
                              🗑️ Remove
                            </button>
                          </Show>
                        </div>
                      </Show>
                    </>
                  }
                >
                  {/* Editing state */}
                  <div style="width: 100%;">
                    <div style="margin-bottom: var(--space-sm);">
                      <input
                        type="text"
                        class="input"
                        value={newName()}
                        onInput={(e) => setNewName(e.currentTarget.value)}
                        placeholder="New name"
                        style="width: 100%;"
                      />
                    </div>
                    <div style="display: flex; gap: var(--space-sm);">
                      <button
                        class="btn btn-sm btn-primary"
                        onClick={() => confirmRename(member.id)}
                        style="font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);"
                      >
                        ✓ Save
                      </button>
                      <button
                        class="btn btn-sm btn-secondary"
                        onClick={cancelRename}
                        style="font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);"
                      >
                        ✕ Cancel
                      </button>
                    </div>
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
              <h2 class="text-xl font-bold mb-md">Remove Member?</h2>
              <p class="mb-lg">
                Are you sure you want to remove <strong>{memberToRemove()?.name}</strong> from the group? They will be marked as departed but will remain in the audit history.
              </p>
              <div class="modal-actions">
                <button class="btn btn-secondary" onClick={cancelRemove} style="padding: var(--space-sm) var(--space-md);">
                  Cancel
                </button>
                <button class="btn btn-danger" onClick={confirmRemove} style="padding: var(--space-sm) var(--space-md);">
                  Remove Member
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
