import { Component } from 'solid-js'

export const BalanceTab: Component = () => {
  return (
    <div class="balance-tab">
      <div class="empty-state">
        <div class="empty-state-icon">💰</div>
        <h2 class="empty-state-title">Balance Overview</h2>
        <p class="empty-state-message">
          Balance calculations will appear here after adding expenses
        </p>
      </div>
    </div>
  )
}
