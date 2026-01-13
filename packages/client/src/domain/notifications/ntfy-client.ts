/**
 * NTFY Client for Partage Push Notifications
 *
 * NTFY is a simple pub-sub notification service.
 * We use it to send push notifications when activities happen.
 *
 * Flow:
 * 1. When user adds/modifies/deletes an entry, we POST to NTFY
 * 2. Other users subscribed to the group topic receive the notification
 * 3. Notification is shown via browser's native notification system
 *
 * Security:
 * - Topic name is derived from HMAC(groupKey, groupId)
 * - Only group members who have the key can compute the topic name
 * - Message content is minimal: just "New activity" + actor ID
 */

// NTFY server URL - can be configured via environment variable
const NTFY_SERVER = import.meta.env.VITE_NTFY_URL || 'https://ntfy.sh';

// Cache for computed topic hashes (groupId -> topicHash)
const topicCache = new Map<string, string>();

export interface NtfyNotification {
  groupId: string;
  groupName: string;
  groupKey: CryptoKey;
  actorId: string;
}

/**
 * Compute a deterministic topic hash from groupId and groupKey
 * Uses HMAC-SHA256 to create a secure, deterministic topic name
 * Only group members with the key can compute this
 */
async function computeTopicHash(groupId: string, groupKey: CryptoKey): Promise<string> {
  // Check cache first
  const cacheKey = groupId;
  if (topicCache.has(cacheKey)) {
    return topicCache.get(cacheKey)!;
  }

  // Export the key to use as HMAC key
  const keyData = await crypto.subtle.exportKey('raw', groupKey);

  // Import as HMAC key
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Compute HMAC of the groupId
  const encoder = new TextEncoder();
  const data = encoder.encode(groupId);
  const signature = await crypto.subtle.sign('HMAC', hmacKey, data);

  // Convert to URL-safe base64 (first 16 bytes = 128 bits, plenty secure)
  const hashBytes = new Uint8Array(signature).slice(0, 16);
  const hashBase64 = btoa(String.fromCharCode(...hashBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const topicHash = `p-${hashBase64}`;

  // Cache the result
  topicCache.set(cacheKey, topicHash);

  return topicHash;
}

/**
 * Get the NTFY topic for a group (async because it requires crypto)
 */
export async function getGroupTopic(groupId: string, groupKey: CryptoKey): Promise<string> {
  return computeTopicHash(groupId, groupKey);
}

/**
 * Get the full NTFY topic URL for a group
 */
export async function getGroupTopicUrl(groupId: string, groupKey: CryptoKey): Promise<string> {
  const topic = await getGroupTopic(groupId, groupKey);
  return `${NTFY_SERVER}/${topic}`;
}

/**
 * Publish a notification to NTFY
 * Called after successful activity (add/modify/delete entry, member join, etc.)
 *
 * Message is minimal: just "New activity" with actor ID header
 * The receiving app will fetch actual details via sync
 */
export async function publishNotification(notification: NtfyNotification): Promise<boolean> {
  const topic = await getGroupTopic(notification.groupId, notification.groupKey);
  const url = `${NTFY_SERVER}/${topic}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Title: notification.groupName,
        Priority: 'default',
        Tags: 'partage',
        // Actor ID for self-notification filtering
        'X-Actor-Id': notification.actorId,
      },
      body: 'New activity',
    });

    if (!response.ok) {
      console.error(
        '[NTFY] Failed to publish notification:',
        response.status,
        await response.text()
      );
      return false;
    }

    console.log('[NTFY] Notification published successfully:', { topic });
    return true;
  } catch (error) {
    console.error('[NTFY] Error publishing notification:', error);
    return false;
  }
}

/**
 * Get the Web Push subscription URL for a group
 * Users can use this to subscribe via the NTFY web app or native app
 */
export async function getWebSubscriptionUrl(groupId: string, groupKey: CryptoKey): Promise<string> {
  const topic = await getGroupTopic(groupId, groupKey);
  return `${NTFY_SERVER}/${topic}`;
}

/**
 * Check if NTFY server is reachable
 */
export async function checkNtfyHealth(): Promise<boolean> {
  try {
    const response = await fetch(NTFY_SERVER, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get NTFY server URL
 */
export function getNtfyServerUrl(): string {
  return NTFY_SERVER;
}
