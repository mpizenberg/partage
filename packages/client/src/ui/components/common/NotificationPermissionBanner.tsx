import { Component, createSignal, onMount, Show } from 'solid-js'
import { useI18n } from '../../../i18n'
import { getPushManager } from '../../../domain/notifications/push-manager'

/**
 * Banner that prompts user to enable push notifications
 * Shows only if:
 * - Notifications are supported
 * - Permission is in "default" (prompt) state
 * - User hasn't dismissed it in this session
 */
export const NotificationPermissionBanner: Component = () => {
  const { t } = useI18n()
  const [show, setShow] = createSignal(false)
  const [isRequesting, setIsRequesting] = createSignal(false)

  const pushManager = getPushManager()

  onMount(async () => {
    console.log('NotificationPermissionBanner mounted')

    // Check basic browser support first
    const hasNotificationAPI = 'Notification' in window
    const hasServiceWorker = 'serviceWorker' in navigator

    // Check if running as PWA (standalone mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         (window.navigator as any).standalone ||
                         document.referrer.includes('android-app://')

    // Detect iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream

    console.log('Browser capabilities:', {
      hasNotificationAPI,
      hasServiceWorker,
      isStandalone,
      isIOS,
      userAgent: navigator.userAgent,
      displayMode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
      currentPermission: hasNotificationAPI ? Notification.permission : 'not-supported'
    })

    if (!hasNotificationAPI || !hasServiceWorker) {
      console.log('Notifications or Service Worker not supported in this browser')
      return
    }

    // iOS requires PWA to be installed (standalone mode) for notifications
    if (isIOS && !isStandalone) {
      console.log('iOS detected - PWA must be installed (added to home screen) for notifications')
      return
    }

    // Initialize the push manager (wait for service worker)
    await pushManager.initialize()

    // Check if we should show the banner
    const permission = pushManager.getPermissionState()
    console.log('Permission state:', permission)

    if (permission.prompt) {
      // Check if user dismissed it in this session
      const dismissed = sessionStorage.getItem('notification-permission-dismissed')
      console.log('Banner dismissed in session?', dismissed)

      if (!dismissed) {
        console.log('Showing notification permission banner')
        setShow(true)
      }
    } else {
      console.log('Not showing banner - permission is:', Notification.permission)
    }
  })

  const handleEnable = async () => {
    setIsRequesting(true)

    try {
      await pushManager.initialize()
      const granted = await pushManager.requestPermission()

      if (granted) {
        setShow(false)
      } else {
        // Permission denied - hide banner
        setShow(false)
      }
    } catch (error) {
      console.error('Failed to request notification permission:', error)
    } finally {
      setIsRequesting(false)
    }
  }

  const handleDismiss = () => {
    setShow(false)
    // Remember dismissal for this session
    sessionStorage.setItem('notification-permission-dismissed', 'true')
  }

  return (
    <Show when={show()}>
      <div class="notification-permission-banner">
        <div class="notification-permission-content">
          <div class="notification-permission-icon">🔔</div>
          <div class="notification-permission-text">
            <div class="notification-permission-title">
              {t('notifications.enableTitle')}
            </div>
            <div class="notification-permission-description">
              {t('notifications.enableDescription')}
            </div>
          </div>
        </div>
        <div class="notification-permission-actions">
          <button
            class="btn btn-small btn-primary"
            onClick={handleEnable}
            disabled={isRequesting()}
          >
            {isRequesting() ? t('common.loading') : t('notifications.enable')}
          </button>
          <button
            class="btn btn-small btn-secondary"
            onClick={handleDismiss}
            disabled={isRequesting()}
          >
            {t('notifications.notNow')}
          </button>
        </div>
      </div>
    </Show>
  )
}
