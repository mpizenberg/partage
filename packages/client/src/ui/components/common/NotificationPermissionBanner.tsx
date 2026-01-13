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

  onMount(() => {
    // Check if we should show the banner
    if (!pushManager.isSupported()) {
      return
    }

    const permission = pushManager.getPermissionState()
    if (permission.prompt) {
      // Check if user dismissed it in this session
      const dismissed = sessionStorage.getItem('notification-permission-dismissed')
      if (!dismissed) {
        setShow(true)
      }
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
