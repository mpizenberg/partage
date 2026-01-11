import { Component, Show, For, createSignal, createEffect } from 'solid-js'
import { useAppContext, type ImportAnalysis } from '../context/AppContext'
import { Button } from '../components/common/Button'
import { CreateGroupScreen } from './CreateGroupScreen'
import { ImportPreviewModal } from '../components/import/ImportPreviewModal'

export const GroupSelectionScreen: Component = () => {
  const { groups, selectGroup, identity, exportGroups, importGroups, confirmImport, deleteGroup } = useAppContext()
  const [showCreateGroup, setShowCreateGroup] = createSignal(false)
  const [importAnalysis, setImportAnalysis] = createSignal<ImportAnalysis | null>(null)
  const [showImportPreview, setShowImportPreview] = createSignal(false)
  const [groupToDelete, setGroupToDelete] = createSignal<string | null>(null)
  const [selectedGroupIds, setSelectedGroupIds] = createSignal<Set<string>>(new Set<string>())
  const [isAnalyzing, setIsAnalyzing] = createSignal(false)

  // Debug: Track modal state changes
  createEffect(() => {
    console.log('[GroupSelection] showImportPreview changed:', showImportPreview())
    console.log('[GroupSelection] importAnalysis:', importAnalysis())
  })

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

  const toggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(groupId)) {
        newSet.delete(groupId)
      } else {
        newSet.add(groupId)
      }
      return newSet
    })
  }

  const selectAllGroups = () => {
    const allIds = groups().map(g => g.id)
    setSelectedGroupIds(new Set<string>(allIds))
  }

  const deselectAllGroups = () => {
    setSelectedGroupIds(new Set<string>())
  }

  const handleExportSelected = async () => {
    const selected = selectedGroupIds()
    if (selected.size === 0) {
      alert('Please select at least one group to export')
      return
    }

    try {
      const groupIdsArray = Array.from(selected)
      const exportData = await exportGroups(groupIdsArray)

      // Download as JSON file
      const blob = new Blob([exportData], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `partage-export-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      console.log('Export completed successfully:', groupIdsArray.length, 'groups')
      deselectAllGroups()
    } catch (err) {
      console.error('Export failed:', err)
      alert('Export failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleImport = async () => {
    // Create file input
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        setIsAnalyzing(true)
        console.log('[Import] Reading file:', file.name)
        const text = await file.text()
        console.log('[Import] File size:', text.length, 'bytes')

        console.log('[Import] Starting analysis...')
        const analysis = await importGroups(text)
        console.log('[Import] Analysis complete:', analysis)

        setImportAnalysis(analysis)
        setShowImportPreview(true)
        console.log('[Import] Modal should now be visible')
        console.log('[Import] showImportPreview():', showImportPreview())
        console.log('[Import] importAnalysis():', importAnalysis())
      } catch (err) {
        console.error('[Import] Import analysis failed:', err)
        alert('Import failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
      } finally {
        setIsAnalyzing(false)
      }
    }

    input.click()
  }

  const handleConfirmImport = async (mergeExisting: boolean) => {
    const analysis = importAnalysis()
    if (!analysis) return

    try {
      await confirmImport(analysis.exportData, mergeExisting)
      setShowImportPreview(false)
      setImportAnalysis(null)
      alert('Import completed successfully!')
    } catch (err) {
      console.error('Import failed:', err)
      alert('Import failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleDeleteGroup = async (groupId: string) => {
    setGroupToDelete(groupId)
  }

  const confirmDelete = async () => {
    const groupId = groupToDelete()
    if (!groupId) return

    try {
      await deleteGroup(groupId)
      setGroupToDelete(null)
      console.log('Group deleted successfully')
    } catch (err) {
      console.error('Delete failed:', err)
      alert('Delete failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const cancelDelete = () => {
    setGroupToDelete(null)
  }

  return (
    <>
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

          {/* Export/Import buttons */}
          <Show when={groups().length > 0}>
            <div class="mb-lg">
              <div class="flex gap-sm mb-sm">
                <Button
                  variant="secondary"
                  onClick={handleImport}
                  class="flex-1"
                  disabled={isAnalyzing()}
                >
                  {isAnalyzing() ? '⏳ Analyzing...' : '📥 Import'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleExportSelected}
                  class="flex-1"
                  disabled={selectedGroupIds().size === 0}
                >
                  📤 Export Selected ({selectedGroupIds().size})
                </Button>
              </div>
              <Show when={groups().length > 1}>
                <div class="flex gap-sm text-sm">
                  <button
                    class="link-button"
                    onClick={selectAllGroups}
                  >
                    Select All
                  </button>
                  <span class="text-muted">•</span>
                  <button
                    class="link-button"
                    onClick={deselectAllGroups}
                  >
                    Deselect All
                  </button>
                </div>
              </Show>
            </div>
          </Show>

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
                <Button
                  variant="secondary"
                  onClick={handleImport}
                  class="mt-md"
                >
                  📥 Import Groups
                </Button>
              </div>
            }
          >
            <div class="group-list mb-xl">
              <For each={groups()}>
                {(group) => (
                  <div class="card group-card">
                    {/* Checkbox for selection */}
                    <div class="flex gap-md mb-sm">
                      <input
                        type="checkbox"
                        checked={selectedGroupIds().has(group.id)}
                        onChange={() => toggleGroupSelection(group.id)}
                        style="width: 20px; height: 20px; cursor: pointer; flex-shrink: 0;"
                      />
                      <div style="flex: 1; min-width: 0;">
                        <div
                          class="clickable"
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
                      </div>
                    </div>
                    <div
                      class="mt-sm"
                      style="border-top: 1px solid var(--border-color); padding-top: var(--space-sm);"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="danger"
                        size="small"
                        onClick={() => handleDeleteGroup(group.id)}
                      >
                        🗑️ Delete
                      </Button>
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

      {/* Import Preview Modal - Outside Show block for proper rendering */}
      <Show when={showImportPreview() && importAnalysis()}>
        <ImportPreviewModal
          isOpen={true}
          onClose={() => {
            console.log('[Import] Closing modal')
            setShowImportPreview(false)
            setImportAnalysis(null)
          }}
          analysis={importAnalysis()!}
          onConfirm={handleConfirmImport}
        />
      </Show>

      {/* Delete Confirmation Modal */}
      <Show when={groupToDelete()}>
        <div class="modal-overlay" onClick={cancelDelete}>
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 class="text-xl font-bold mb-md">Delete Group?</h2>
            <p class="mb-lg">
              Are you sure you want to delete this group? This will remove all local data
              including entries, members, and keys. This action cannot be undone.
            </p>
            <div class="modal-actions">
              <Button variant="secondary" onClick={cancelDelete}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete}>
                Delete Group
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
