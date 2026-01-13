/**
 * Custom Service Worker Code for Partage
 * Handles notification clicks and background messaging
 *
 * This file is injected into the generated service worker by vite-plugin-pwa
 */

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.notification.data)

  event.notification.close()

  // Get notification data
  const data = event.notification.data || {}
  const { groupId, activityId } = data

  // Determine the URL to open
  let urlToOpen = '/'
  if (groupId) {
    urlToOpen = `/#/group/${groupId}`
    if (activityId) {
      urlToOpen += `?activity=${activityId}`
    }
  }

  // Focus or open the app
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            return client.focus().then((client) => {
              // Navigate to the activity
              if (client.navigate) {
                return client.navigate(urlToOpen)
              }
              return client
            })
          }
        }

        // No window open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen)
        }
      })
  )
})

// Handle push events (for future use with actual push server)
self.addEventListener('push', (event) => {
  console.log('Push received:', event.data?.text())

  // For now, we're using local notifications only
  // This handler is here for future extension
})

// Handle messages from the app
self.addEventListener('message', (event) => {
  console.log('Service worker received message:', event.data)

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

console.log('Partage custom service worker code loaded')
