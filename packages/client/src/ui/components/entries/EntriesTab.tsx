import { Component, Show } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { EntryList } from './EntryList'

export const EntriesTab: Component = () => {
  const { entries, showDeleted, setShowDeleted } = useAppContext()

  const handleToggleDeleted = () => {
    setShowDeleted(!showDeleted())
  }

  return (
    <div class="entries-tab">
      <div class="entries-header">
        <label class="show-deleted-toggle">
          <input
            type="checkbox"
            checked={showDeleted()}
            onChange={handleToggleDeleted}
          />
          <span>Show deleted entries</span>
        </label>
      </div>

      <Show
        when={entries().length > 0}
        fallback={
          <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <h2 class="empty-state-title">No entries yet</h2>
            <p class="empty-state-message">
              Tap the + button below to add your first expense or transfer
            </p>
          </div>
        }
      >
        <EntryList entries={entries()} />
      </Show>
    </div>
  )
}
