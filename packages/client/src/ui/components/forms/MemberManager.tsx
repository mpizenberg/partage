import { Component, For, createSignal, Show } from 'solid-js';
import { useI18n } from '../../../i18n';
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
  const { t } = useI18n();
  const [newMemberName, setNewMemberName] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  const handleAddMember = () => {
    const name = newMemberName().trim();

    if (!name) {
      setError(t('members.memberNameRequired'));
      return;
    }

    // Check for duplicate names
    const duplicate = props.members.some((m) => m.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      setError(t('members.duplicateName'));
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
      <h3 class="text-base font-semibold mb-sm">{t('members.title')}</h3>

      {/* Member list */}
      <div class="member-list mb-md">
        <For each={props.members}>
          {(member) => (
            <div class="member-item">
              <div class="member-info">
                <div class="member-row">
                  <span class="member-name">{member.name}</span>
                  <Show when={member.isVirtual}>
                    <span class="member-badge-virtual">{t('members.virtual')}</span>
                  </Show>
                </div>
              </div>
              <Show when={member.id !== props.currentUserId}>
                <button
                  type="button"
                  class="member-remove"
                  onClick={() => props.onRemoveMember(member.id)}
                  aria-label={`${t('members.remove')} ${member.name}`}
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
          {t('members.addMember')}
        </label>
        <div class="flex gap-sm">
          <Input
            id="new-member-name"
            type="text"
            value={newMemberName()}
            placeholder={t('members.memberNamePlaceholder')}
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
            {t('members.addButton')}
          </Button>
        </div>
        <Show when={error()}>
          <p class="form-error">{error()}</p>
        </Show>
        <p class="form-hint">{t('members.virtualMemberDescription')}</p>
      </div>
    </div>
  );
};
