/**
 * Toast notification context
 * Manages toast notification queue and lifecycle
 */

import {
  createContext,
  useContext,
  createSignal,
  type Component,
  type JSX,
  type Accessor,
} from 'solid-js'
import type { ActivityType } from '@partage/shared/types/activity'

// Maximum number of toasts to show simultaneously (especially important on mobile)
const MAX_TOASTS = 3

export interface ToastData {
  id: string
  type: ActivityType
  message: string
  timestamp: number
}

interface ToastContextValue {
  toasts: Accessor<ToastData[]>
  addToast: (toast: Omit<ToastData, 'id' | 'timestamp'>) => void
  removeToast: (id: string) => void
  clearAll: () => void
}

const ToastContext = createContext<ToastContextValue>()

/**
 * Generate a unique toast ID
 */
function generateToastId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Toast Provider Component
 */
export const ToastProvider: Component<{ children: JSX.Element }> = (props) => {
  const [toasts, setToasts] = createSignal<ToastData[]>([])

  /**
   * Add a new toast to the queue
   * If MAX_TOASTS is reached, remove the oldest toast
   */
  function addToast(toast: Omit<ToastData, 'id' | 'timestamp'>): void {
    const newToast: ToastData = {
      ...toast,
      id: generateToastId(),
      timestamp: Date.now(),
    }

    setToasts((prev) => {
      const updated = [newToast, ...prev]
      // Remove oldest toasts if we exceed the maximum
      if (updated.length > MAX_TOASTS) {
        return updated.slice(0, MAX_TOASTS)
      }
      return updated
    })
  }

  /**
   * Remove a toast by ID
   */
  function removeToast(id: string): void {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }

  /**
   * Clear all toasts
   */
  function clearAll(): void {
    setToasts([])
  }

  const contextValue: ToastContextValue = {
    toasts,
    addToast,
    removeToast,
    clearAll,
  }

  return (
    <ToastContext.Provider value={contextValue}>
      {props.children}
    </ToastContext.Provider>
  )
}

/**
 * Hook to access toast context
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
