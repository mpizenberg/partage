import { Component, Show, For, createSignal, createMemo } from 'solid-js'
import { useI18n } from '../../../i18n'
import { useAppContext } from '../../context/AppContext'
import { SettlementPlan } from '../balance/SettlementPlan'
import { Button } from '../common/Button'

export interface SettleTabProps {
  disabled?: boolean
}

export const SettleTab: Component<SettleTabProps> = (props) => {
  const { t } = useI18n()
  const {
    settlementPlan,
    activeGroup,
    members,
    entries,
    loroStore,
    updateSettlementPreferences,
    preferencesVersion,
    identity,
  } = useAppContext()

  const [editingMemberId, setEditingMemberId] = createSignal<string | null>(null)
  const [selectedMembers, setSelectedMembers] = createSignal<string[]>([])

  const currency = () => activeGroup()?.defaultCurrency || 'USD'
  const hasEntries = () => entries().length > 0

  // Get all settlement preferences from Loro
  const allPreferences = createMemo(() => {
    const store = loroStore()
    if (!store) return []
    // Read version to ensure recalculation when preferences change
    preferencesVersion()
    return store.getSettlementPreferences()
  })

  // Get preference for a specific user
  const getPreferenceForUser = (userId: string) => {
    return allPreferences().find(p => p.userId === userId)
  }

  // Memoized member name lookup map - uses canonical ID resolution
  const memberNameMap = createMemo(() => {
    const nameMap = new Map<string, string>()
    const store = loroStore()
    if (!store) {
      for (const member of members()) {
        nameMap.set(member.id, member.name)
      }
      return nameMap
    }

    // Use event-based system: resolve each member to their canonical name
    const canonicalIdMap = store.getCanonicalIdMap()
    const allStates = store.getAllMemberStates()

    for (const [memberId, state] of allStates) {
      const canonicalId = canonicalIdMap.get(memberId) ?? memberId
      const canonicalState = allStates.get(canonicalId)
      nameMap.set(memberId, canonicalState?.name ?? state.name)
    }
    return nameMap
  })

  // Get current user's canonical ID
  const currentUserId = () => {
    const userId = identity()?.publicKeyHash
    if (!userId) return ''
    const store = loroStore()
    return store ? store.resolveCanonicalMemberId(userId) : userId
  }

  // Get only active members for preferences UI, sorted alphabetically with "you" first
  const activeMembers = createMemo(() => {
    const userId = currentUserId()
    return members()
      .filter(m => m.status === 'active')
      .sort((a, b) => {
        // Current user always first
        if (a.id === userId) return -1
        if (b.id === userId) return 1
        // Then sort alphabetically (case-insensitive)
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      })
  })

  const getMemberName = (memberId: string): string => {
    return memberNameMap().get(memberId) || t('common.unknown')
  }

  // Get active members who can receive payments (excluding the one being edited)
  const getPayableMembersForUser = (userId: string) => {
    return activeMembers().filter(m => m.id !== userId)
  }

  const hasAnyPreferences = () => {
    return allPreferences().some(p => p.preferredRecipients.length > 0)
  }

  const handleStartEditing = (userId: string) => {
    const preference = getPreferenceForUser(userId)
    setSelectedMembers(preference?.preferredRecipients || [])
    setEditingMemberId(userId)
  }

  const handleCancelEditing = () => {
    setEditingMemberId(null)
    setSelectedMembers([])
  }

  const handleToggleMember = (memberId: string) => {
    const current = selectedMembers()
    if (current.includes(memberId)) {
      setSelectedMembers(current.filter(id => id !== memberId))
    } else {
      setSelectedMembers([...current, memberId])
    }
  }

  const handleMoveUp = (memberId: string) => {
    const current = selectedMembers()
    const index = current.indexOf(memberId)
    if (index > 0) {
      const newOrder = [...current]
      newOrder[index] = current[index - 1]!
      newOrder[index - 1] = memberId
      setSelectedMembers(newOrder)
    }
  }

  const handleMoveDown = (memberId: string) => {
    const current = selectedMembers()
    const index = current.indexOf(memberId)
    if (index < current.length - 1) {
      const newOrder = [...current]
      newOrder[index] = current[index + 1]!
      newOrder[index + 1] = memberId
      setSelectedMembers(newOrder)
    }
  }

  const handleSavePreferences = async () => {
    const userId = editingMemberId()
    if (!userId) return

    await updateSettlementPreferences(userId, selectedMembers())
    setEditingMemberId(null)
    setSelectedMembers([])
  }

  const handleDeletePreferences = async (userId: string) => {
    // Delete by setting empty array
    await updateSettlementPreferences(userId, [])
  }

  return (
    <div class="settle-tab">
      <Show
        when={hasEntries()}
        fallback={
          <div class="empty-state">
            <div class="empty-state-icon">💸</div>
            <h2 class="empty-state-title">{t('settle.noSettlementNeeded')}</h2>
            <p class="empty-state-message">
              {t('settle.noSettlementMessage')}
            </p>
          </div>
        }
      >
        {/* Settlement Plan */}
        <div class="settle-section">
          <h2 class="settle-section-title">{t('settle.suggestions')}</h2>
          <p class="settle-section-description">
            {t('settle.suggestionsDescription')}
            <Show when={hasAnyPreferences()}>
              <span class="text-success"> ✓ {t('settle.usingPreferences')}</span>
            </Show>
          </p>
          <SettlementPlan
            plan={settlementPlan()}
            currency={currency()}
            members={members()}
            disabled={props.disabled}
          />
        </div>

        {/* Settlement Preferences - Per Member */}
        <div class="settle-section">
          <h2 class="settle-section-title">{t('settle.preferences')}</h2>
          <p class="settle-section-description">
            {t('settle.preferencesDescription')}
          </p>

          <div class="member-preferences-list">
            <For each={activeMembers()}>
              {(member) => {
                const isEditing = () => editingMemberId() === member.id
                const memberPreference = () => getPreferenceForUser(member.id)
                const hasPreference = () => {
                  const pref = memberPreference()
                  return pref && pref.preferredRecipients.length > 0
                }

                return (
                  <div class="member-preference-card card">
                    <div class="member-preference-header">
                      <div class="member-preference-title">
                        <span class="member-preference-name">
                          {getMemberName(member.id)}
                        </span>
                        <Show when={member.isVirtual}>
                          <span class="member-badge member-badge-virtual">{t('members.virtual')}</span>
                        </Show>
                      </div>

                      <Show when={!isEditing() && !props.disabled}>
                        <div class="member-preference-actions">
                          <Button
                            variant="secondary"
                            onClick={() => handleStartEditing(member.id)}
                          >
                            {hasPreference() ? t('settle.editPreferences') : t('settle.addPreferences')}
                          </Button>
                          <Show when={hasPreference()}>
                            <Button
                              variant="danger"
                              onClick={() => handleDeletePreferences(member.id)}
                            >
                              {t('common.delete')}
                            </Button>
                          </Show>
                        </div>
                      </Show>
                    </div>

                    <Show when={!isEditing()}>
                      <Show
                        when={hasPreference()}
                        fallback={
                          <div class="member-preference-empty">
                            <p class="text-muted">
                              {t('settle.noPreferencesSet')}
                            </p>
                          </div>
                        }
                      >
                        <div class="member-preference-list">
                          <p class="preferences-label">{t('settle.prefersToSendTo')}</p>
                          <ol class="preferred-members-list">
                            <For each={memberPreference()?.preferredRecipients || []}>
                              {(recipientId, index) => (
                                <li class="preferred-member-item">
                                  <span class="preferred-member-rank">{index() + 1}.</span>
                                  <span class="preferred-member-name">{getMemberName(recipientId)}</span>
                                </li>
                              )}
                            </For>
                          </ol>
                        </div>
                      </Show>
                    </Show>

                    <Show when={isEditing()}>
                      <div class="preferences-editor">
                        <div class="preferences-help">
                          <p class="text-muted">
                            {t('settle.preferencesHelp')}
                          </p>
                        </div>

                        {/* Available members */}
                        <Show when={getPayableMembersForUser(member.id).length > 0}>
                          <div class="member-selection">
                            <h3 class="member-selection-title">{t('settle.availableRecipients')}</h3>
                            <div class="member-selection-list">
                              <For each={getPayableMembersForUser(member.id)}>
                                {(recipient) => {
                                  const isSelected = () => selectedMembers().includes(recipient.id)
                                  return (
                                    <button
                                      class={`member-selection-item ${isSelected() ? 'selected' : ''}`}
                                      onClick={() => handleToggleMember(recipient.id)}
                                    >
                                      <span class="member-selection-checkbox">
                                        {isSelected() ? '☑' : '☐'}
                                      </span>
                                      <span class="member-selection-name">
                                        {getMemberName(recipient.id)}
                                      </span>
                                      <Show when={recipient.isVirtual}>
                                        <span class="member-badge member-badge-virtual-small">{t('members.virtual')}</span>
                                      </Show>
                                    </button>
                                  )
                                }}
                              </For>
                            </div>
                          </div>
                        </Show>

                        {/* Selected members with ordering */}
                        <Show when={selectedMembers().length > 0}>
                          <div class="member-ordering">
                            <h3 class="member-ordering-title">{t('settle.preferredRecipientsOrdered')}</h3>
                            <div class="member-ordering-list">
                              <For each={selectedMembers()}>
                                {(recipientId, index) => (
                                  <div class="member-ordering-item">
                                    <span class="member-ordering-rank">{index() + 1}.</span>
                                    <span class="member-ordering-name">{getMemberName(recipientId)}</span>
                                    <div class="member-ordering-controls">
                                      <button
                                        class="member-ordering-btn"
                                        onClick={() => handleMoveUp(recipientId)}
                                        disabled={index() === 0}
                                        aria-label="Move up"
                                      >
                                        ▲
                                      </button>
                                      <button
                                        class="member-ordering-btn"
                                        onClick={() => handleMoveDown(recipientId)}
                                        disabled={index() === selectedMembers().length - 1}
                                        aria-label="Move down"
                                      >
                                        ▼
                                      </button>
                                      <button
                                        class="member-ordering-btn member-ordering-btn-remove"
                                        onClick={() => handleToggleMember(recipientId)}
                                        aria-label="Remove"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>

                        {/* Actions */}
                        <div class="preferences-actions">
                          <Button variant="secondary" onClick={handleCancelEditing}>
                            {t('common.cancel')}
                          </Button>
                          <Button variant="primary" onClick={handleSavePreferences}>
                            {t('settle.savePreferences')}
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
