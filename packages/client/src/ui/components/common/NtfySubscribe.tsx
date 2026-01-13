import { Component, createSignal, Show } from 'solid-js'
import { useI18n } from '../../../i18n'
import { getGroupTopicUrl } from '../../../domain/notifications/ntfy-client'

interface NtfySubscribeProps {
  groupId: string
  groupName: string
  groupKey: CryptoKey
}

/**
 * Component to help users subscribe to NTFY push notifications for a group.
 * This is for receiving notifications when the app is CLOSED.
 * When the app is open, notifications work automatically via the sync system.
 */
export const NtfySubscribe: Component<NtfySubscribeProps> = (props) => {
  const { t } = useI18n()
  const [subscribeUrl, setSubscribeUrl] = createSignal<string | null>(null)
  const [isLoading, setIsLoading] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  const handleShowUrl = async () => {
    setIsLoading(true)
    try {
      const url = await getGroupTopicUrl(props.groupId, props.groupKey)
      setSubscribeUrl(url)
    } catch (error) {
      console.error('Failed to generate subscription URL:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async () => {
    const url = subscribeUrl()
    if (url) {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenNtfy = () => {
    const url = subscribeUrl()
    if (url) {
      window.open(url, '_blank')
    }
  }

  return (
    <div class="ntfy-subscribe">
      <Show
        when={subscribeUrl()}
        fallback={
          <button
            class="btn btn-secondary btn-small"
            onClick={handleShowUrl}
            disabled={isLoading()}
          >
            {isLoading() ? t('common.loading') : '🔔 ' + t('notifications.backgroundPush')}
          </button>
        }
      >
        <div class="ntfy-subscribe-info">
          <p class="ntfy-subscribe-description">
            {t('notifications.ntfyDescription')}
          </p>
          <div class="ntfy-subscribe-url">
            <code>{subscribeUrl()}</code>
          </div>
          <div class="ntfy-subscribe-actions">
            <button class="btn btn-primary btn-small" onClick={handleOpenNtfy}>
              {t('notifications.openNtfy')}
            </button>
            <button class="btn btn-secondary btn-small" onClick={handleCopy}>
              {copied() ? t('invite.copied') : t('invite.copyLink')}
            </button>
          </div>
          <p class="ntfy-subscribe-hint">
            {t('notifications.ntfyHint')}
          </p>
        </div>
      </Show>
    </div>
  )
}
