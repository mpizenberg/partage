/**
 * Push Notification Manager
 * Handles browser push notifications using the Notifications API
 *
 * Since Partage is local-first with no backend push service,
 * we use the Service Worker's Notifications API to show
 * local notifications when the app is backgrounded/closed.
 */

import type { Activity } from '@partage/shared/types/activity'

export interface NotificationPermissionState {
  granted: boolean
  denied: boolean
  prompt: boolean
}

/**
 * Push Notification Manager
 * Coordinates with service worker for showing notifications
 */
export class PushNotificationManager {
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null

  /**
   * Initialize the push notification manager
   * Must be called after service worker is registered
   */
  async initialize(): Promise<void> {
    console.log('PushNotificationManager.initialize() called')

    if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker not supported in this browser')
      return
    }

    try {
      console.log('Waiting for service worker to be ready...')
      // Wait for service worker to be ready
      this.serviceWorkerRegistration = await navigator.serviceWorker.ready
      console.log('✅ Service worker ready, push notification manager initialized')
      console.log('Service worker registration:', {
        scope: this.serviceWorkerRegistration.scope,
        active: !!this.serviceWorkerRegistration.active,
        waiting: !!this.serviceWorkerRegistration.waiting,
        installing: !!this.serviceWorkerRegistration.installing
      })
    } catch (error) {
      console.error('❌ Failed to initialize push notifications:', error)
    }
  }

  /**
   * Get current notification permission state
   */
  getPermissionState(): NotificationPermissionState {
    if (!('Notification' in window)) {
      return { granted: false, denied: true, prompt: false }
    }

    const permission = Notification.permission

    return {
      granted: permission === 'granted',
      denied: permission === 'denied',
      prompt: permission === 'default',
    }
  }

  /**
   * Request notification permission from the user
   * @returns true if permission granted
   */
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('Notifications not supported')
      return false
    }

    // Already granted
    if (Notification.permission === 'granted') {
      return true
    }

    // Already denied
    if (Notification.permission === 'denied') {
      console.warn('Notification permission denied')
      return false
    }

    try {
      const permission = await Notification.requestPermission()
      return permission === 'granted'
    } catch (error) {
      console.error('Failed to request notification permission:', error)
      return false
    }
  }

  /**
   * Show a notification for an activity
   * Uses service worker to show notification even when app is backgrounded
   */
  async showNotification(
    activity: Activity,
    message: string,
    groupName?: string
  ): Promise<void> {
    console.log('showNotification called:', {
      activityId: activity.id,
      activityType: activity.type,
      hasServiceWorker: !!this.serviceWorkerRegistration,
      permission: Notification.permission,
      visibilityState: document.visibilityState
    })

    if (!this.serviceWorkerRegistration) {
      console.warn('Service worker not registered - cannot show notification')
      return
    }

    const permission = this.getPermissionState()
    if (!permission.granted) {
      console.warn('Notification permission not granted:', permission)
      return
    }

    try {
      const notificationOptions = {
        body: message,
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: `activity-${activity.id}`, // Prevent duplicate notifications
        requireInteraction: false,
        silent: false,
        vibrate: [200, 100, 200],
        data: {
          activityId: activity.id,
          activityType: activity.type,
          groupId: activity.groupId,
          groupName,
          timestamp: activity.timestamp,
        },
      } as NotificationOptions

      console.log('Calling serviceWorkerRegistration.showNotification with:', notificationOptions)

      // Create notification through service worker
      await this.serviceWorkerRegistration.showNotification('Partage', notificationOptions)

      console.log('✅ Push notification shown successfully for activity:', activity.id)
    } catch (error) {
      console.error('❌ Failed to show notification:', error)
    }
  }

  /**
   * Check if notifications are supported and enabled
   */
  isSupported(): boolean {
    return (
      'Notification' in window &&
      'serviceWorker' in navigator &&
      this.serviceWorkerRegistration !== null
    )
  }

  /**
   * Check if notification permission is granted
   */
  isEnabled(): boolean {
    return this.getPermissionState().granted
  }
}

// Singleton instance
let pushManagerInstance: PushNotificationManager | null = null

/**
 * Get the push notification manager instance
 */
export function getPushManager(): PushNotificationManager {
  if (!pushManagerInstance) {
    pushManagerInstance = new PushNotificationManager()
  }
  return pushManagerInstance
}
