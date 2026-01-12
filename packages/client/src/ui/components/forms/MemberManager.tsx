import { Component, For, createSignal, Show } from 'solid-js';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import type { Member } from '@partage/shared';

export interface MemberManagerProps {
  currentUserName: string;
  currentUserId: string;
  members: Member[];
  onAddMember: (name: string) => void;
  onRemoveMember: (id: string) => void;
}

export const MemberManager: Component<MemberManagerProps> = (props) => {
  const [newMemberName, setNewMemberName] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  const handleAddMember = () => {
    const name = newMemberName().trim();

    if (!name) {
      setError('Member name cannot be empty');
      return;
    }

    // Check for duplicate names
    const duplicate = props.members.some((m) => m.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      setError('A member with this name already exists');
      return;
    }

    props.onAddMember(name);
    setNewMemberName('');
    setError(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddMember();
    }
  };

  return (
    <div class="member-manager">
      <h3 class="text-base font-semibold mb-sm">Members</h3>

      {/* Member list */}
      <div class="member-list mb-md">
        <For each={props.members}>
          {(member) => (
            <div class="member-item">
              <div class="member-info">
                <div class="member-row">
                  <span class="member-name">{member.name}</span>
                  <Show when={member.isVirtual}>
                    <span class="member-badge-virtual">Virtual</span>
                  </Show>
                </div>
              </div>
              {/*<div class="member-info">
                <span class="member-name">{member.name}</span>
                <Show when={member.id === props.currentUserId}>
                  <span class="member-badge">You</span>
                </Show>
                <Show when={member.isVirtual}>
                  <span class="member-badge-virtual">Virtual</span>
                </Show>
              </div>*/}
              <Show when={member.id !== props.currentUserId}>
                <button
                  type="button"
                  class="member-remove"
                  onClick={() => props.onRemoveMember(member.id)}
                  aria-label={`Remove ${member.name}`}
                >
                  ×
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* Add member form */}
      <div class="add-member-form">
        <label class="form-label" for="new-member-name">
          Add Member
        </label>
        <div class="flex gap-sm">
          <Input
            id="new-member-name"
            type="text"
            value={newMemberName()}
            placeholder="Enter name..."
            onInput={(e) => {
              setNewMemberName(e.currentTarget.value);
              setError(null);
            }}
            onKeyPress={handleKeyDown}
            error={!!error()}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={handleAddMember}
            disabled={!newMemberName().trim()}
          >
            Add
          </Button>
        </div>
        <Show when={error()}>
          <p class="form-error">{error()}</p>
        </Show>
        <p class="form-hint">
          Members can be added for expense tracking (they don't need the app yet)
        </p>
      </div>
    </div>
  );
};
