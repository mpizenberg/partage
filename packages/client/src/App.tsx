import { Component, Show, Match, Switch, createEffect, onCleanup } from 'solid-js'
import { HashRouter, Route } from '@solidjs/router'
import { I18nProvider, useI18n } from './i18n'
import { AppProvider, useAppContext } from './ui/context/AppContext'
import { SetupScreen } from './ui/screens/SetupScreen'
import { GroupSelectionScreen } from './ui/screens/GroupSelectionScreen'
import { GroupViewScreen } from './ui/screens/GroupViewScreen'
import { JoinGroupScreen } from './ui/screens/JoinGroupScreen'
import { LoadingSpinner } from './ui/components/common/LoadingSpinner'
import { OfflineBanner } from './ui/components/common/OfflineBanner'
import { Footer } from './ui/components/common/Footer'
import { ToastProvider, useToast } from './ui/context/ToastContext'
import { ToastContainer } from './ui/components/common/ToastContainer'
import { NotificationPermissionBanner } from './ui/components/common/NotificationPermissionBanner'
import type { Activity } from '@partage/shared/types/activity'
import { getPushManager } from './domain/notifications/push-manager'
import { isActivityRelevantToUser } from './domain/notifications/activity-filter'

const MainApp: Component = () => {
  const { identity, activeGroup, isLoading } = useAppContext()

  return (
    <Show
      when={!isLoading()}
      fallback={
        <div class="container flex-center" style="min-height: 100vh;">
          <LoadingSpinner size="large" />
        </div>
      }
    >
      <Switch>
        {/* No identity - show setup screen */}
        <Match when={!identity()}>
          <SetupScreen />
        </Match>

        {/* Has identity, no active group - show group selection */}
        <Match when={identity() && !activeGroup()}>
          <GroupSelectionScreen />
        </Match>

        {/* Has active group - show group view */}
        <Match when={identity() && activeGroup()}>
          <GroupViewScreen />
        </Match>
      </Switch>
    </Show>
  )
}

/**
 * Wrapper for JoinGroupScreen that waits for AppContext initialization
 */
const JoinGroupGuard: Component = () => {
  const { isLoading } = useAppContext()

  return (
    <Show
      when={!isLoading()}
      fallback={
        <div class="container flex-center" style="min-height: 100vh;">
          <LoadingSpinner size="large" />
        </div>
      }
    >
      <JoinGroupScreen />
    </Show>
  )
}

const App: Component = () => {
  return (
    <I18nProvider>
      <ToastProvider>
        <AppProvider>
          <HashRouter>
            <Route path="/join/:groupId/:groupKey" component={JoinGroupGuard} />
            <Route path="/*" component={MainApp} />
          </HashRouter>
          <ActivityNotifications />
          <NotificationPermissionBanner />
          <OfflineBanner />
          <Footer />
        </AppProvider>
      </ToastProvider>
    </I18nProvider>
  )
}

/**
 * Component that monitors activities and shows toast notifications
 */
const ActivityNotifications: Component = () => {
  const { activities, identity, loroStore, activeGroup } = useAppContext()
  const { addToast, toasts, removeToast } = useToast()
  const { t } = useI18n()

  const pushManager = getPushManager()

  // Track last seen activity timestamp
  const LAST_SEEN_KEY = 'partage-last-activity-seen'

  // Track processed activity IDs to prevent duplicates
  const processedActivityIds = new Set<string>()

  // Load last seen timestamp from localStorage
  const getLastSeenTimestamp = (): number => {
    const stored = localStorage.getItem(LAST_SEEN_KEY)
    return stored ? parseInt(stored, 10) : Date.now()
  }

  // Save last seen timestamp
  const updateLastSeenTimestamp = (timestamp: number): void => {
    localStorage.setItem(LAST_SEEN_KEY, timestamp.toString())
  }

  // Track if app is backgrounded for push vs toast decision
  let isAppBackgrounded = document.visibilityState === 'hidden'

  const handleVisibilityChange = () => {
    isAppBackgrounded = document.visibilityState === 'hidden'
  }

  // Initialize push manager and visibility listener on mount
  createEffect(() => {
    pushManager.initialize()
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onCleanup(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  // Monitor activities and show notifications - with deduplication
  createEffect(() => {
    const allActivities = activities()
    const currentIdentity = identity()
    const store = loroStore()
    const group = activeGroup()

    // Need all dependencies to work
    if (!allActivities || !currentIdentity || !store || allActivities.length === 0) {
      return
    }

    const currentUserId = currentIdentity.publicKeyHash
    const lastSeen = getLastSeenTimestamp()

    // Filter to new activities that haven't been processed yet
    const newActivities = allActivities
      .filter((activity) =>
        activity.timestamp > lastSeen &&
        !processedActivityIds.has(activity.id) &&
        isActivityRelevantToUser(activity, currentUserId, store)
      )

    // Only log and process if there are actually new activities
    if (newActivities.length > 0) {
      console.log('[Notifications] New relevant activities:', newActivities.length)

      newActivities.forEach((activity) => {
        // Mark as processed immediately to prevent duplicates
        processedActivityIds.add(activity.id)

        const message = formatActivityMessage(activity, t)

        if (isAppBackgrounded && pushManager.isEnabled()) {
          pushManager.showNotification(activity, message, group?.name)
        } else if (!isAppBackgrounded) {
          addToast({ type: activity.type, message })
        }
      })
    }

    // Update last seen timestamp
    if (allActivities.length > 0) {
      const latestTimestamp = Math.max(...allActivities.map((a) => a.timestamp))
      updateLastSeenTimestamp(latestTimestamp)
    }
  })

  return <ToastContainer toasts={toasts()} onDismiss={removeToast} />
}

/**
 * Format activity message for toast notification
 */
function formatActivityMessage(
  activity: Activity,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  switch (activity.type) {
    case 'entry_added':
      return t('notifications.entryAdded', {
        actor: activity.actorName,
        description: activity.description,
      })
    case 'entry_modified':
      return t('notifications.entryModified', {
        actor: activity.actorName,
        description: activity.description,
      })
    case 'entry_deleted':
      return t('notifications.entryDeleted', {
        actor: activity.actorName,
        description: activity.description,
      })
    case 'entry_undeleted':
      return t('notifications.entryUndeleted', {
        actor: activity.actorName,
        description: activity.description,
      })
    case 'member_joined':
      return t('notifications.memberJoined', {
        name: activity.memberName,
      })
    case 'member_linked':
      return t('notifications.memberLinked', {
        name: activity.newMemberName,
      })
    default:
      return 'New activity'
  }
}

export default App
