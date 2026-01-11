/**
 * Member List - Displays all group members with their status
 * Shows real members (with public keys) vs virtual members (name only)
 */

import { Component, For, Show, createSignal, createMemo } from 'solid-js';
import type { Member } from '@partage/shared';

export interface MemberListProps {
  members: Member[];
  currentUserPublicKeyHash?: string;
  showStatus?: boolean;
}

type SortMode = 'name' | 'date';

export const MemberList: Component<MemberListProps> = (props) => {
  const [sortMode, setSortMode] = createSignal<SortMode>('name');

  const sortedMembers = createMemo(() => {
    const membersCopy = [...props.members];
    if (sortMode() === 'name') {
      return membersCopy.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Sort by date joined (newer first)
      return membersCopy.sort((a, b) => b.joinedAt - a.joinedAt);
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

  return (
    <div>
      {/* Sort Toggle */}
      <div class="member-list-controls">
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
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
