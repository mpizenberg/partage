import { Component, Show, Match, Switch, createEffect } from 'solid-js'
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

const App: Component = () => {
  return (
    <I18nProvider>
      <ToastProvider>
        <AppProvider>
          <HashRouter>
            <Route path="/join/:groupId/:groupKey" component={JoinGroupScreen} />
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
  const { addToast } = useToast()
  const { t } = useI18n()

  const pushManager = getPushManager()

  // Initialize push manager on mount
  createEffect(() => {
    pushManager.initialize()
  })

  // Track last seen activity timestamp
  const LAST_SEEN_KEY = 'partage-last-activity-seen'

  // Load last seen timestamp from localStorage
  const getLastSeenTimestamp = (): number => {
    const stored = localStorage.getItem(LAST_SEEN_KEY)
    return stored ? parseInt(stored, 10) : Date.now()
  }

  // Save last seen timestamp
  const updateLastSeenTimestamp = (timestamp: number): void => {
    localStorage.setItem(LAST_SEEN_KEY, timestamp.toString())
  }

  // Track if we should use push notifications (app is backgrounded)
  let isAppBackgrounded = document.visibilityState === 'hidden'

  // Listen for visibility changes
  const handleVisibilityChange = () => {
    const wasBackgrounded = isAppBackgrounded
    isAppBackgrounded = document.visibilityState === 'hidden'

    console.log('Visibility changed:', {
      state: document.visibilityState,
      wasBackgrounded,
      isAppBackgrounded,
      pushEnabled: pushManager.isEnabled()
    })
  }

  // Set up visibility change listener on mount
  createEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  // Monitor activities and show notifications
  createEffect(() => {
    const allActivities = activities()
    const currentIdentity = identity()
    const store = loroStore()
    const group = activeGroup()

    // Need all dependencies to work
    if (!allActivities || !currentIdentity || !store) {
      return
    }

    const currentUserId = currentIdentity.publicKeyHash
    const lastSeen = getLastSeenTimestamp()

    // Import the filtering function
    import('./domain/notifications/activity-filter').then(({ isActivityRelevantToUser }) => {
      // Get new relevant activities since last seen
      const newActivities = allActivities
        .filter((activity) => activity.timestamp > lastSeen)
        .filter((activity) => isActivityRelevantToUser(activity, currentUserId, store))

      // Show notification for each new relevant activity
      newActivities.forEach((activity) => {
        const message = formatActivityMessage(activity, t)

        console.log('New activity detected:', {
          type: activity.type,
          isAppBackgrounded,
          pushEnabled: pushManager.isEnabled(),
          visibilityState: document.visibilityState
        })

        if (isAppBackgrounded) {
          // App is in background - show push notification if enabled
          if (pushManager.isEnabled()) {
            console.log('Showing push notification for activity:', activity.id)
            pushManager.showNotification(activity, message, group?.name)
          }
        } else {
          // App is active - show toast notification
          console.log('Showing toast notification for activity:', activity.id)
          addToast({
            type: activity.type,
            message,
          })
        }
      })

      // Update last seen timestamp if there are new activities
      if (allActivities.length > 0) {
        const latestTimestamp = Math.max(...allActivities.map((a) => a.timestamp))
        updateLastSeenTimestamp(latestTimestamp)
      }
    })
  })

  // Render the toast container
  const { toasts, removeToast } = useToast()

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
