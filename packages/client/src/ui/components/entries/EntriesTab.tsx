import { Component } from 'solid-js'

export const EntriesTab: Component = () => {
  return (
    <div class="entries-tab">
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <h2 class="empty-state-title">No entries yet</h2>
        <p class="empty-state-message">
          Tap the + button below to add your first expense or transfer
        </p>
      </div>
    </div>
  )
}
