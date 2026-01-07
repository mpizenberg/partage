import { Component, Show, createSignal } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { MemberList } from './MemberList'
import { PendingRequestsList } from '../invites/PendingRequestsList'
import { InviteModal } from '../invites/InviteModal'

export const MembersTab: Component = () => {
  const { members, pendingJoinRequests, activeGroup, createInvitation, approveJoinRequest } = useAppContext()
  const [showInviteModal, setShowInviteModal] = createSignal(false)
  const [inviteLink, setInviteLink] = createSignal<string | null>(null)

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

  return (
    <div class="members-tab">
      {/* Invite Button */}
      <div class="members-section">
        <button class="btn btn-primary btn-full-width" onClick={handleInvite}>
          Invite Members
        </button>
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
        <h2 class="members-section-title">Members ({members().length})</h2>
        <MemberList members={members()} />
      </div>

      {/* Invite Modal */}
      <InviteModal
        isOpen={showInviteModal()}
        onClose={() => setShowInviteModal(false)}
        groupName={activeGroup()?.name || ''}
        inviteLink={inviteLink()}
        onGenerateLink={handleGenerateLink}
      />
    </div>
  )
}
