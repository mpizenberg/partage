/**
 * Simplified Invite Manager for Trusted Groups
 *
 * This simplified approach embeds the group key directly in the URL fragment.
 * The fragment (#) portion is never sent to the server, ensuring the key remains client-side only.
 *
 * URL format: https://app.example/#/join/{groupId}/{base64url-group-key}
 *
 * Security model:
 * - Anyone with the link can join without approval
 * - The link should only be shared via trusted channels (WhatsApp, Signal, in person)
 * - Server never sees the group key
 * - All data remains end-to-end encrypted
 */

/**
 * Convert Base64 to Base64URL (URL-safe encoding)
 * Replaces + with -, / with _, and removes = padding
 */
function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Convert Base64URL back to Base64
 * Replaces - with +, _ with /, and adds back = padding
 */
function base64UrlToBase64(base64Url: string): string {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return base64;
}

/**
 * Generate an invite link with embedded group key
 *
 * @param groupId - ID of the group
 * @param groupKeyBase64 - Base64-encoded group symmetric key
 * @param groupName - Name of the group (optional, for display)
 * @returns Shareable invite link with key in fragment
 */
export function generateInviteLink(
  groupId: string,
  groupKeyBase64: string,
  groupName?: string
): string {
  const keyBase64Url = base64ToBase64Url(groupKeyBase64);
  const baseUrl = `${window.location.origin}/#/join/${groupId}/${keyBase64Url}`;

  // Optionally append group name as query parameter (not in fragment)
  if (groupName) {
    return `${baseUrl}?name=${encodeURIComponent(groupName)}`;
  }

  return baseUrl;
}

/**
 * Parse an invite link to extract group ID and key
 *
 * @param fragment - URL fragment (portion after #)
 * @returns Object with groupId and groupKey, or null if invalid
 */
export function parseInviteLink(fragment: string): { groupId: string; groupKey: string } | null {
  // Expected format: /join/{groupId}/{base64url-key}
  const match = fragment.match(/^\/join\/([^/]+)\/(.+)$/);
  if (!match) {
    return null;
  }

  const groupId = match[1];
  const keyBase64Url = match[2];

  if (!groupId || !keyBase64Url) {
    return null;
  }

  // Remove any query parameters from the key if present
  const keyWithoutQuery = keyBase64Url.split('?')[0];

  if (!keyWithoutQuery) {
    return null;
  }

  try {
    const groupKey = base64UrlToBase64(keyWithoutQuery);
    return { groupId, groupKey };
  } catch (error) {
    console.error('Failed to parse invite link:', error);
    return null;
  }
}

/**
 * Extract group name from invite URL query parameters (if present)
 *
 * @param fullUrl - Complete URL including query parameters
 * @returns Group name or null if not present
 */
export function extractGroupNameFromUrl(fullUrl: string): string | null {
  try {
    const url = new URL(fullUrl);
    return url.searchParams.get('name');
  } catch {
    return null;
  }
}
