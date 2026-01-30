import { Component, Show, createSignal, createMemo, createEffect, on } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
import { useI18n } from '../../../i18n';
import { MemberList } from './MemberList';
import { MemberDetailModal } from './MemberDetailModal';
import { InviteModal } from '../invites/InviteModal';
import { Button } from '../common/Button';
import { GroupInfoSection } from '../groups/GroupInfoSection';
import { GroupMetadataModal } from '../groups/GroupMetadataModal';
import type { Member, MemberState, GroupLink, MemberPaymentInfo } from '@partage/shared';

export interface MembersTabProps {
  disabled?: boolean;
}

export const MembersTab: Component<MembersTabProps> = (props) => {
  const {
    members,
    activeGroup,
    createInvitation,
    addVirtualMember,
    renameMember,
    removeMember,
    identity,
    balances,
    loroStore,
    groupMetadata,
    getMemberMetadata,
    updateGroupMetadata,
    updateMemberMetadata,
  } = useAppContext();
  const { t } = useI18n();
  const [showInviteModal, setShowInviteModal] = createSignal(false);
  const [inviteLink, setInviteLink] = createSignal<string | null>(null);
  const [showAddMemberModal, setShowAddMemberModal] = createSignal(false);
  const [newMemberName, setNewMemberName] = createSignal('');
  const [showGroupMetadataModal, setShowGroupMetadataModal] = createSignal(false);
  const [selectedMember, setSelectedMember] = createSignal<Member | null>(null);
  const [selectedMemberMetadata, setSelectedMemberMetadata] = createSignal<{
    phone?: string;
    payment?: MemberPaymentInfo;
    info?: string;
  } | null>(null);

  // Cache of member metadata for list indicators (loaded in background)
  const [memberMetadataMap, setMemberMetadataMap] = createSignal<
    Map<string, { phone?: string; payment?: MemberPaymentInfo; info?: string }>
  >(new Map());

  // Load all member metadata when members change (for list indicators)
  createEffect(
    on([members, loroStore], async ([memberList, store]) => {
      if (!store || memberList.length === 0) return;

      const metadataMap = new Map<
        string,
        { phone?: string; payment?: MemberPaymentInfo; info?: string }
      >();

      // Load metadata for all members in parallel
      await Promise.all(
        memberList.map(async (member) => {
          const metadata = await getMemberMetadata(member.id);
          if (metadata) {
            metadataMap.set(member.id, metadata);
          }
        })
      );

      setMemberMetadataMap(metadataMap);
    })
  );

  // Get basic member state for selected member (without encrypted metadata)
  const selectedMemberState = createMemo((): MemberState | null => {
    const member = selectedMember();
    const store = loroStore();
    if (!member || !store) return null;
    const state = store.getMemberState(member.id);
    // Merge in decrypted metadata if available
    if (state && selectedMemberMetadata()) {
      return { ...state, ...selectedMemberMetadata() };
    }
    return state;
  });

  const handleSaveGroupMetadata = async (metadata: {
    name: string; // MANDATORY
    subtitle?: string;
    description?: string;
    links?: GroupLink[];
  }) => {
    await updateGroupMetadata(metadata);
  };

  const handleSaveMemberDetails = async (updates: {
    name?: string;
    phone?: string;
    payment?: MemberPaymentInfo;
    info?: string;
  }) => {
    const member = selectedMember();
    if (!member) return;

    // If name changed, rename member
    if (updates.name && updates.name !== member.name) {
      await renameMember(member.id, updates.name);
    }

    // Update metadata
    await updateMemberMetadata(member.id, {
      phone: updates.phone,
      payment: updates.payment,
      info: updates.info,
    });

    // Update the metadata map for list indicators
    const newMetadata = { phone: updates.phone, payment: updates.payment, info: updates.info };
    const hasAnyMetadata =
      updates.phone ||
      updates.info ||
      (updates.payment && Object.values(updates.payment).some((v) => !!v));
    setMemberMetadataMap((prev) => {
      const updated = new Map(prev);
      if (hasAnyMetadata) {
        updated.set(member.id, newMetadata);
      } else {
        updated.delete(member.id);
      }
      return updated;
    });
  };

  const handleMemberClick = async (member: Member) => {
    setSelectedMember(member);
    setSelectedMemberMetadata(null); // Clear previous metadata
    // Load decrypted metadata asynchronously
    const metadata = await getMemberMetadata(member.id);
    setSelectedMemberMetadata(metadata);
  };

  const activeMembersCount = createMemo(
    () => members().filter((m) => m.status === 'active').length
  );

  const handleInvite = async () => {
    setInviteLink(null);
    setShowInviteModal(true);

    // Auto-generate the link immediately
    const group = activeGroup();
    if (!group) return;

    const result = await createInvitation(group.id);
    setInviteLink(result.inviteLink);
  };

  const handleAddVirtualMember = async () => {
    const name = newMemberName().trim();
    if (!name) {
      alert(t('members.memberNameRequired'));
      return;
    }

    try {
      await addVirtualMember(name);
      setShowAddMemberModal(false);
      setNewMemberName('');
    } catch (error) {
      console.error('Failed to add member:', error);
      alert(t('members.addMemberFailed'));
    }
  };

  return (
    <div class="members-tab">
      {/* Invite and Add Member Buttons - hide when disabled */}
      <Show when={!props.disabled}>
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
      </Show>

      {/* Group Info Section */}
      <div class="members-section">
        <h2 class="members-section-title">{t('groupInfo.title')}</h2>
        <GroupInfoSection
          description={groupMetadata().description}
          links={groupMetadata().links}
          onEdit={() => setShowGroupMetadataModal(true)}
          disabled={props.disabled}
        />
      </div>

      {/* Member List */}
      <div class="members-section">
        <h2 class="members-section-title">
          {t('members.title')} ({activeMembersCount()})
        </h2>
        <MemberList
          members={members()}
          currentUserPublicKeyHash={identity()?.publicKeyHash}
          balances={balances()}
          loroStore={loroStore()}
          memberMetadataMap={memberMetadataMap()}
          onMemberClick={handleMemberClick}
          onRemoveMember={props.disabled ? undefined : removeMember}
        />
      </div>

      {/* Invite Modal */}
      <InviteModal
        isOpen={showInviteModal()}
        onClose={() => setShowInviteModal(false)}
        groupName={groupMetadata().name}
        inviteLink={inviteLink()}
      />

      {/* Add Virtual Member Modal */}
      <Show when={showAddMemberModal()}>
        <div class="modal-overlay" onClick={() => setShowAddMemberModal(false)}>
          <div class="modal-content modal-content-mobile-keyboard" onClick={(e) => e.stopPropagation()}>
            <div class="modal-body">
              <h2 class="text-xl font-bold mb-md">{t('members.addVirtualMember')}</h2>
              <p class="mb-md text-muted">{t('members.virtualMemberDescription')}</p>
              <div class="form-group">
                <label class="form-label">{t('members.memberName')}</label>
                <input
                  type="text"
                  class="input"
                  value={newMemberName()}
                  onInput={(e) => setNewMemberName(e.currentTarget.value)}
                  placeholder={t('members.memberNamePlaceholder')}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddVirtualMember()}
                  onFocus={(e) => {
                    // Scroll the modal actions into view when keyboard opens on mobile
                    setTimeout(() => {
                      const actions = e.currentTarget.closest('.modal-body')?.querySelector('.modal-actions');
                      actions?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, 300);
                  }}
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

      {/* Group Metadata Modal */}
      <GroupMetadataModal
        isOpen={showGroupMetadataModal()}
        onClose={() => setShowGroupMetadataModal(false)}
        currentMetadata={groupMetadata()}
        onSave={handleSaveGroupMetadata}
      />

      {/* Member Detail Modal */}
      <MemberDetailModal
        isOpen={selectedMember() !== null}
        onClose={() => setSelectedMember(null)}
        member={selectedMember()}
        memberState={selectedMemberState()}
        onSave={handleSaveMemberDetails}
        canEdit={!props.disabled}
      />
    </div>
  );
};
