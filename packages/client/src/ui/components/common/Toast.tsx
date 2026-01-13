import { Component, onMount, onCleanup } from 'solid-js'
import type { ActivityType } from '@partage/shared/types/activity'

export interface ToastProps {
  id: string
  type: ActivityType
  message: string
  onDismiss: (id: string) => void
  autoDismissMs?: number
}

export const Toast: Component<ToastProps> = (props) => {
  let timeoutId: number | undefined

  onMount(() => {
    // Auto-dismiss after specified time (default: 5000ms)
    const dismissTime = props.autoDismissMs ?? 5000
    timeoutId = window.setTimeout(() => {
      props.onDismiss(props.id)
    }, dismissTime)
  })

  onCleanup(() => {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
    }
  })

  // Get CSS class based on activity type
  const getToastClass = (type: ActivityType): string => {
    switch (type) {
      case 'entry_added':
        return 'toast-entry-added'
      case 'entry_modified':
        return 'toast-entry-modified'
      case 'entry_deleted':
        return 'toast-entry-deleted'
      case 'entry_undeleted':
        return 'toast-entry-added'
      case 'member_joined':
        return 'toast-member-joined'
      case 'member_linked':
        return 'toast-member-joined'
      default:
        return ''
    }
  }

  return (
    <div class={`toast ${getToastClass(props.type)}`} role="alert">
      <div class="toast-content">
        <p class="toast-message">{props.message}</p>
      </div>
      <button
        class="toast-close"
        onClick={() => props.onDismiss(props.id)}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  )
}
