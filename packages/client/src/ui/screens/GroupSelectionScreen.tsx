import { Component, Show, For, createSignal } from 'solid-js'
import { useAppContext } from '../context/AppContext'
import { Button } from '../components/common/Button'
import { CreateGroupScreen } from './CreateGroupScreen'

export const GroupSelectionScreen: Component = () => {
  const { groups, selectGroup, identity } = useAppContext()
  const [showCreateGroup, setShowCreateGroup] = createSignal(false)

  const handleSelectGroup = async (groupId: string) => {
    try {
      await selectGroup(groupId)
      // Group selected - App will navigate to GroupViewScreen
    } catch (err) {
      console.error('Failed to select group:', err)
    }
  }

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const truncateId = (id: string): string => {
    return id.substring(0, 8) + '...'
  }

  return (
    <Show
      when={!showCreateGroup()}
      fallback={<CreateGroupScreen onCancel={() => setShowCreateGroup(false)} />}
    >
      <div class="container">
        <div class="group-selection-screen" style="max-width: 600px; margin: 0 auto; padding-top: var(--space-xl);">
          {/* Header */}
          <div class="mb-xl">
            <h1 class="text-2xl font-bold mb-sm">Your Groups</h1>
            <p class="text-base text-muted">
              Select a group or create a new one
            </p>
            <Show when={identity()}>
              <p class="text-sm text-muted mt-sm">
                Your ID: {truncateId(identity()!.publicKeyHash)}
              </p>
            </Show>
          </div>

          {/* Group list */}
          <Show
            when={groups().length > 0}
            fallback={
              <div class="empty-state mb-xl">
                <div class="empty-state-icon">👥</div>
                <h2 class="empty-state-title">No groups yet</h2>
                <p class="empty-state-message">
                  Create your first group to start tracking expenses
                </p>
              </div>
            }
          >
            <div class="group-list mb-xl">
              <For each={groups()}>
                {(group) => (
                  <div
                    class="card clickable group-card"
                    onClick={() => handleSelectGroup(group.id)}
                  >
                    <div class="flex-between mb-sm">
                      <h3 class="text-lg font-semibold">{group.name}</h3>
                      <span class="currency-badge">{group.defaultCurrency}</span>
                    </div>
                    <div class="group-meta">
                      <p class="text-sm text-muted">
                        {group.members?.length || 0} member{(group.members?.length || 0) !== 1 ? 's' : ''}
                      </p>
                      <p class="text-sm text-muted">
                        Created {formatDate(group.createdAt)}
                      </p>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Create group button */}
          <Button
            variant="primary"
            size="large"
            onClick={() => setShowCreateGroup(true)}
            class="w-full"
          >
            + Create New Group
          </Button>
        </div>
      </div>
    </Show>
  )
}
