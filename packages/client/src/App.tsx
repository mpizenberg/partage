import { Component, Show, createEffect, onCleanup } from 'solid-js';
import { Router, Route, Navigate, useNavigate } from '@solidjs/router';
import { I18nProvider, useI18n } from './i18n';
import { AppProvider, useAppContext } from './ui/context/AppContext';
import { SetupScreen } from './ui/screens/SetupScreen';
import { GroupSelectionScreen } from './ui/screens/GroupSelectionScreen';
import { CreateGroupScreen } from './ui/screens/CreateGroupScreen';
import { GroupViewScreen } from './ui/screens/GroupViewScreen';
import { JoinGroupScreen } from './ui/screens/JoinGroupScreen';
import { AboutScreen } from './ui/screens/AboutScreen';
import { LoadingSpinner } from './ui/components/common/LoadingSpinner';
import { OfflineBanner } from './ui/components/common/OfflineBanner';
import { Footer } from './ui/components/common/Footer';
import { ToastProvider, useToast } from './ui/context/ToastContext';
import { ToastContainer } from './ui/components/common/ToastContainer';
import { NotificationPermissionBanner } from './ui/components/common/NotificationPermissionBanner';
import { InstallPrompt } from './ui/components/common/InstallPrompt';
import type { Activity } from '@partage/shared/types/activity';
import { getPushManager } from './domain/notifications/push-manager';
import { isActivityRelevantToUser } from './domain/notifications/activity-filter';

/**
 * Loading screen shown while AppContext is initializing
 */
const LoadingScreen: Component = () => (
  <div class="container flex-center" style="min-height: 100vh;">
    <LoadingSpinner size="large" />
  </div>
);

/**
 * Guard that requires identity to be present
 * Redirects to /setup if no identity exists
 */
const RequireIdentity: Component<{ children: any }> = (props) => {
  const { identity, isLoading } = useAppContext();
  const navigate = useNavigate();

  createEffect(() => {
    if (!isLoading() && !identity()) {
      navigate('/setup', { replace: true });
    }
  });

  return (
    <Show when={!isLoading() && identity()} fallback={<LoadingScreen />}>
      {props.children}
    </Show>
  );
};

/**
 * Guard that redirects away from setup if identity already exists
 */
const SetupGuard: Component = () => {
  const { identity, isLoading } = useAppContext();
  const navigate = useNavigate();

  createEffect(() => {
    if (!isLoading() && identity()) {
      navigate('/', { replace: true });
    }
  });

  return (
    <Show when={!isLoading()} fallback={<LoadingScreen />}>
      <Show when={!identity()} fallback={<Navigate href="/" />}>
        <SetupScreen />
      </Show>
    </Show>
  );
};

/**
 * Guard for JoinGroupScreen that waits for AppContext initialization
 */
const JoinGroupGuard: Component = () => {
  const { isLoading } = useAppContext();

  return (
    <Show when={!isLoading()} fallback={<LoadingScreen />}>
      <JoinGroupScreen />
    </Show>
  );
};

/**
 * Wrapper for CreateGroupScreen as a standalone page
 */
const CreateGroupPage: Component = () => {
  const navigate = useNavigate();
  return <CreateGroupScreen onCancel={() => navigate('/')} />;
};

const App: Component = () => {
  return (
    <I18nProvider>
      <ToastProvider>
        <AppProvider>
          <Router>
            {/* Setup route - redirects to / if identity exists */}
            <Route path="/setup" component={SetupGuard} />

            {/* About page */}
            <Route path="/about" component={AboutScreen} />

            {/* Join group route - key is in URL fragment (#) */}
            <Route path="/join/:groupId" component={JoinGroupGuard} />

            {/* Create group route */}
            <Route
              path="/groups/new"
              component={() => (
                <RequireIdentity>
                  <CreateGroupPage />
                </RequireIdentity>
              )}
            />

            {/* Group view route with optional tab */}
            <Route
              path="/groups/:groupId/:tab?"
              component={() => (
                <RequireIdentity>
                  <GroupViewScreen />
                </RequireIdentity>
              )}
            />

            {/* Home route - group selection */}
            <Route
              path="/"
              component={() => (
                <RequireIdentity>
                  <GroupSelectionScreen />
                </RequireIdentity>
              )}
            />

            {/* Catch-all redirect to home */}
            <Route path="*" component={() => <Navigate href="/" />} />
          </Router>
          <ActivityNotifications />
          <NotificationPermissionBanner />
          <InstallPrompt />
          <OfflineBanner />
          <Footer />
        </AppProvider>
      </ToastProvider>
    </I18nProvider>
  );
};

/**
 * Component that monitors activities and shows toast notifications
 */
const ActivityNotifications: Component = () => {
  const { activities, identity, loroStore, activeGroup } = useAppContext();
  const { addToast, toasts, removeToast } = useToast();
  const { t } = useI18n();

  const pushManager = getPushManager();

  // Track last seen activity timestamp
  const LAST_SEEN_KEY = 'partage-last-activity-seen';

  // Track processed activity IDs to prevent duplicates
  const processedActivityIds = new Set<string>();

  // Load last seen timestamp from localStorage
  const getLastSeenTimestamp = (): number => {
    const stored = localStorage.getItem(LAST_SEEN_KEY);
    return stored ? parseInt(stored, 10) : Date.now();
  };

  // Save last seen timestamp
  const updateLastSeenTimestamp = (timestamp: number): void => {
    localStorage.setItem(LAST_SEEN_KEY, timestamp.toString());
  };

  // Track if app is backgrounded for push vs toast decision
  let isAppBackgrounded = document.visibilityState === 'hidden';

  const handleVisibilityChange = () => {
    isAppBackgrounded = document.visibilityState === 'hidden';
  };

  // Initialize push manager and visibility listener on mount
  createEffect(() => {
    pushManager.initialize();
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onCleanup(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  // Monitor activities and show notifications - with deduplication
  createEffect(() => {
    const allActivities = activities();
    const currentIdentity = identity();
    const store = loroStore();
    const group = activeGroup();

    // Need all dependencies to work
    if (!allActivities || !currentIdentity || !store || allActivities.length === 0) {
      return;
    }

    const currentUserId = currentIdentity.publicKeyHash;
    const lastSeen = getLastSeenTimestamp();

    // Filter to new activities that haven't been processed yet
    const newActivities = allActivities.filter(
      (activity) =>
        activity.timestamp > lastSeen &&
        !processedActivityIds.has(activity.id) &&
        isActivityRelevantToUser(activity, currentUserId, store)
    );

    // Only log and process if there are actually new activities
    if (newActivities.length > 0) {
      console.log('[Notifications] New relevant activities:', newActivities.length);

      newActivities.forEach((activity) => {
        // Mark as processed immediately to prevent duplicates
        processedActivityIds.add(activity.id);

        const message = formatActivityMessage(activity, t);

        if (isAppBackgrounded && pushManager.isEnabled()) {
          pushManager.showNotification(activity, message, group?.name);
        } else if (!isAppBackgrounded) {
          addToast({ type: activity.type, message });
        }
      });
    }

    // Update last seen timestamp
    if (allActivities.length > 0) {
      const latestTimestamp = Math.max(...allActivities.map((a) => a.timestamp));
      updateLastSeenTimestamp(latestTimestamp);
    }
  });

  return <ToastContainer toasts={toasts()} onDismiss={removeToast} />;
};

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
      });
    case 'entry_modified':
      return t('notifications.entryModified', {
        actor: activity.actorName,
        description: activity.description,
      });
    case 'entry_deleted':
      return t('notifications.entryDeleted', {
        actor: activity.actorName,
        description: activity.description,
      });
    case 'entry_undeleted':
      return t('notifications.entryUndeleted', {
        actor: activity.actorName,
        description: activity.description,
      });
    case 'member_joined':
      return t('notifications.memberJoined', {
        name: activity.memberName,
      });
    case 'member_linked':
      return t('notifications.memberLinked', {
        name: activity.newMemberName,
      });
    default:
      return 'New activity';
  }
}

export default App;
