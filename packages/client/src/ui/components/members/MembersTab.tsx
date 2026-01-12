import { Component, Show, createSignal, createMemo } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { MemberList } from './MemberList'
import { PendingRequestsList } from '../invites/PendingRequestsList'
import { InviteModal } from '../invites/InviteModal'
import { Button } from '../common/Button'

export const MembersTab: Component = () => {
  const { members, pendingJoinRequests, activeGroup, createInvitation, approveJoinRequest, addVirtualMember, renameMember, removeMember, identity, balances } = useAppContext()
  const [showInviteModal, setShowInviteModal] = createSignal(false)
  const [inviteLink, setInviteLink] = createSignal<string | null>(null)
  const [showAddMemberModal, setShowAddMemberModal] = createSignal(false)
  const [newMemberName, setNewMemberName] = createSignal('')

  const activeMembersCount = createMemo(() => members().filter(m => m.status === 'active').length)

  const handleInvite = () => {
    setInviteLink(null)
    setShowInviteModal(true)
  }

  const handleGenerateLink = async () => {
    const group = activeGroup()
    if (!group) return

    const result = await createInvitation(group.id, group.name)
    setInviteLink(result.inviteLink)
  }

  const handleApproveRequest = async (requestId: string) => {
    await approveJoinRequest(requestId)
  }

  const handleRejectRequest = async (requestId: string, reason?: string) => {
    // TODO: Implement reject functionality in AppContext
    console.log('Rejecting request:', requestId, reason)
  }

  const handleAddVirtualMember = async () => {
    const name = newMemberName().trim()
    if (!name) {
      alert('Please enter a name')
      return
    }

    try {
      await addVirtualMember(name)
      setShowAddMemberModal(false)
      setNewMemberName('')
    } catch (error) {
      console.error('Failed to add member:', error)
      alert('Failed to add member')
    }
  }

  return (
    <div class="members-tab">
      {/* Invite and Add Member Buttons */}
      <div class="members-section" style="text-align: center;">
        <div style="display: flex; gap: var(--space-sm); justify-content: center; flex-wrap: wrap;">
          <Button variant="primary" onClick={handleInvite}>
            📤 Invite Members
          </Button>
          <Button variant="secondary" onClick={() => setShowAddMemberModal(true)}>
            ➕ Add Virtual Member
          </Button>
        </div>
      </div>

      {/* Pending Join Requests */}
      <Show when={pendingJoinRequests().length > 0}>
        <div class="members-section">
          <h2 class="members-section-title">Pending Requests</h2>
          <PendingRequestsList
            requests={pendingJoinRequests()}
            onApprove={handleApproveRequest}
            onReject={handleRejectRequest}
          />
        </div>
      </Show>

      {/* Member List */}
      <div class="members-section">
        <h2 class="members-section-title">Members ({activeMembersCount()})</h2>
        <MemberList
          members={members()}
          currentUserPublicKeyHash={identity()?.publicKeyHash}
          balances={balances()}
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
        onGenerateLink={handleGenerateLink}
      />

      {/* Add Virtual Member Modal */}
      <Show when={showAddMemberModal()}>
        <div class="modal-overlay" onClick={() => setShowAddMemberModal(false)}>
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <div class="modal-body">
              <h2 class="text-xl font-bold mb-md">Add Virtual Member</h2>
              <p class="mb-md text-muted">
                Add a virtual member for tracking expenses without them joining the group directly.
              </p>
              <div class="form-group">
                <label class="form-label">Member Name</label>
                <input
                  type="text"
                  class="input"
                  value={newMemberName()}
                  onInput={(e) => setNewMemberName(e.currentTarget.value)}
                  placeholder="Enter member name"
                  onKeyPress={(e) => e.key === 'Enter' && handleAddVirtualMember()}
                />
              </div>
              <div class="modal-actions">
                <Button variant="secondary" onClick={() => setShowAddMemberModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleAddVirtualMember}>
                  Add Member
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
