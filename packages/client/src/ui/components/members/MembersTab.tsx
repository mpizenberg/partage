import { Component, Show, createSignal, createMemo, createResource } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { useI18n } from '../../../i18n'
import { MemberList } from './MemberList'
import { InviteModal } from '../invites/InviteModal'
import { Button } from '../common/Button'
import { NtfySubscribe } from '../common/NtfySubscribe'

export const MembersTab: Component = () => {
  const { members, activeGroup, createInvitation, addVirtualMember, renameMember, removeMember, identity, balances, loroStore, getActiveGroupKey } = useAppContext()
  const { t } = useI18n()
  const [showInviteModal, setShowInviteModal] = createSignal(false)
  const [inviteLink, setInviteLink] = createSignal<string | null>(null)
  const [showAddMemberModal, setShowAddMemberModal] = createSignal(false)
  const [newMemberName, setNewMemberName] = createSignal('')

  const activeMembersCount = createMemo(() => members().filter(m => m.status === 'active').length)

  // Load group key for NTFY subscription
  const [groupKey] = createResource(activeGroup, async (group) => {
    if (!group) return null
    return getActiveGroupKey()
  })

  const handleInvite = async () => {
    setInviteLink(null)
    setShowInviteModal(true)

    // Auto-generate the link immediately
    const group = activeGroup()
    if (!group) return

    const result = await createInvitation(group.id, group.name)
    setInviteLink(result.inviteLink)
  }

  const handleAddVirtualMember = async () => {
    const name = newMemberName().trim()
    if (!name) {
      alert(t('members.memberNameRequired'))
      return
    }

    try {
      await addVirtualMember(name)
      setShowAddMemberModal(false)
      setNewMemberName('')
    } catch (error) {
      console.error('Failed to add member:', error)
      alert(t('members.addMemberFailed'))
    }
  }

  return (
    <div class="members-tab">
      {/* Invite and Add Member Buttons */}
      <div class="members-section" style="text-align: center;">
        <div style="display: flex; gap: var(--space-sm); justify-content: center; flex-wrap: wrap;">
          <Button variant="primary" onClick={handleInvite}>
            📤 {t('members.inviteMembers')}
          </Button>
          <Button variant="secondary" onClick={() => setShowAddMemberModal(true)}>
            ➕ {t('members.addVirtualMember')}
          </Button>
        </div>
      </div>

      {/* Push Notifications */}
      <Show when={activeGroup() && groupKey()}>
        <div class="members-section">
          <NtfySubscribe
            groupId={activeGroup()!.id}
            groupName={activeGroup()!.name}
            groupKey={groupKey()!}
          />
        </div>
      </Show>

      {/* Member List */}
      <div class="members-section">
        <h2 class="members-section-title">{t('members.title')} ({activeMembersCount()})</h2>
        <MemberList
          members={members()}
          currentUserPublicKeyHash={identity()?.publicKeyHash}
          balances={balances()}
          loroStore={loroStore()}
          onRenameMember={renameMember}
          onRemoveMember={removeMember}
        />
      </div>

      {/* Invite Modal */}
      <InviteModal
        isOpen={showInviteModal()}
        onClose={() => setShowInviteModal(false)}
        groupName={activeGroup()?.name || ''}
        inviteLink={inviteLink()}
      />

      {/* Add Virtual Member Modal */}
      <Show when={showAddMemberModal()}>
        <div class="modal-overlay" onClick={() => setShowAddMemberModal(false)}>
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <div class="modal-body">
              <h2 class="text-xl font-bold mb-md">{t('members.addVirtualMember')}</h2>
              <p class="mb-md text-muted">
                {t('members.virtualMemberDescription')}
              </p>
              <div class="form-group">
                <label class="form-label">{t('members.memberName')}</label>
                <input
                  type="text"
                  class="input"
                  value={newMemberName()}
                  onInput={(e) => setNewMemberName(e.currentTarget.value)}
                  placeholder={t('members.memberNamePlaceholder')}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddVirtualMember()}
                />
              </div>
              <div class="modal-actions">
                <Button variant="secondary" onClick={() => setShowAddMemberModal(false)}>
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" onClick={handleAddVirtualMember}>
                  {t('members.addMember')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
