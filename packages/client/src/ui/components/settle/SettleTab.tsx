import { Component, Show, For, createSignal, createMemo } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { SettlementPlan } from '../balance/SettlementPlan'
import { Button } from '../common/Button'

export const SettleTab: Component = () => {
  const {
    settlementPlan,
    activeGroup,
    members,
    identity,
    entries,
    loroStore,
    updateSettlementPreferences,
    preferencesVersion,
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

  const getMemberName = (memberId: string): string => {
    if (memberId === identity()?.publicKeyHash) return 'You'
    const member = members().find(m => m.id === memberId)
    return member?.name || 'Unknown'
  }

  // Get all members who can receive payments (all members including virtual, excluding the one being edited)
  const getPayableMembersForUser = (userId: string) => {
    return members().filter(m => m.id !== userId)
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
            <h2 class="empty-state-title">No Settlement Needed</h2>
            <p class="empty-state-message">
              Add expenses to see settlement suggestions
            </p>
          </div>
        }
      >
        {/* Settlement Plan */}
        <div class="settle-section">
          <h2 class="settle-section-title">Settlement Suggestions</h2>
          <p class="settle-section-description">
            Optimized plan to settle all balances with minimum transactions
            <Show when={hasAnyPreferences()}>
              <span class="text-success"> ✓ Using preferences</span>
            </Show>
          </p>
          <SettlementPlan
            plan={settlementPlan()}
            currency={currency()}
            members={members()}
          />
        </div>

        {/* Settlement Preferences - Per Member */}
        <div class="settle-section">
          <h2 class="settle-section-title">Settlement Preferences</h2>
          <p class="settle-section-description">
            Configure who each member prefers to send money to when settling up
          </p>

          <div class="member-preferences-list">
            <For each={members()}>
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
                          <span class="member-badge member-badge-virtual">Virtual</span>
                        </Show>
                      </div>

                      <Show when={!isEditing()}>
                        <div class="member-preference-actions">
                          <Button
                            variant="secondary"
                            onClick={() => handleStartEditing(member.id)}
                          >
                            {hasPreference() ? 'Edit' : 'Add'} Preferences
                          </Button>
                          <Show when={hasPreference()}>
                            <Button
                              variant="danger"
                              onClick={() => handleDeletePreferences(member.id)}
                            >
                              Delete
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
                              No preferences set. Settlement will optimize for minimum transactions.
                            </p>
                          </div>
                        }
                      >
                        <div class="member-preference-list">
                          <p class="preferences-label">Prefers to send money to:</p>
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
                            Select members to prefer for sending money. Order matters - members higher in the list will be prioritized.
                          </p>
                        </div>

                        {/* Available members */}
                        <Show when={getPayableMembersForUser(member.id).length > 0}>
                          <div class="member-selection">
                            <h3 class="member-selection-title">Available Recipients</h3>
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
                                        <span class="member-badge member-badge-virtual-small">Virtual</span>
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
                            <h3 class="member-ordering-title">Preferred Recipients (in order)</h3>
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
                            Cancel
                          </Button>
                          <Button variant="primary" onClick={handleSavePreferences}>
                            Save Preferences
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
