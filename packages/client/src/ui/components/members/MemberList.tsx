/**
 * Member List - Displays all group members with their status
 * Shows real members (with public keys) vs virtual members (name only)
 */

import { Component, For, Show } from 'solid-js';
import type { Member } from '@partage/shared';

export interface MemberListProps {
  members: Member[];
  currentUserPublicKeyHash?: string;
  showStatus?: boolean;
}

export const MemberList: Component<MemberListProps> = (props) => {
  const getMemberBadges = (member: Member) => {
    const badges: string[] = [];

    // Current user badge
    if (props.currentUserPublicKeyHash && member.id === props.currentUserPublicKeyHash) {
      badges.push('You');
    }

    // Virtual member badge
    if (member.isVirtual) {
      badges.push('Virtual');
    }

    // Status badge (if member has left)
    if (props.showStatus && member.status === 'departed') {
      badges.push('Left');
    }

    return badges;
  };

  const formatJoinedDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div class="member-list">
      <For each={props.members}>
        {(member) => (
          <div
            class="member-item"
            classList={{
              'member-current': member.id === props.currentUserPublicKeyHash,
              'member-departed': member.status === 'departed',
            }}
          >
            <div class="member-avatar">
              <div class="avatar-circle">
                {member.name.charAt(0).toUpperCase()}
              </div>
            </div>

            <div class="member-info">
              <div class="member-name-row">
                <span class="member-name">{member.name}</span>
                <Show when={getMemberBadges(member).length > 0}>
                  <div class="member-badges">
                    <For each={getMemberBadges(member)}>
                      {(badge) => (
                        <span
                          class="badge"
                          classList={{
                            'badge-primary': badge === 'You',
                            'badge-secondary': badge === 'Virtual',
                            'badge-danger': badge === 'Left',
                          }}
                        >
                          {badge}
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="member-details">
                <p class="text-secondary text-small">
                  Joined {formatJoinedDate(member.joinedAt)}
                </p>

                <Show when={member.leftAt}>
                  <p class="text-secondary text-small">
                    Left {formatJoinedDate(member.leftAt!)}
                  </p>
                </Show>

                <Show when={!member.isVirtual && member.publicKey}>
                  <p class="text-secondary text-small">
                    ID: <code class="member-id">{member.id.slice(0, 12)}...</code>
                  </p>
                </Show>

                <Show when={member.isVirtual && member.addedBy}>
                  <p class="text-secondary text-small">
                    Added by: <code class="member-id">{member.addedBy!.slice(0, 12)}...</code>
                  </p>
                </Show>
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
