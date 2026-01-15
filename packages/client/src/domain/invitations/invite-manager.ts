/**
 * Simplified Invite Manager for Trusted Groups
 *
 * This simplified approach embeds the group key directly in the URL fragment.
 * The fragment (#) portion is never sent to the server, ensuring the key remains client-side only.
 *
 * URL format: https://app.example/join/{groupId}#{base64url-group-key}
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
  // Key is in fragment (#) so it's never sent to the server
  const baseUrl = `${window.location.origin}/join/${groupId}#${keyBase64Url}`;

  // Group name can be appended as query parameter (before fragment)
  if (groupName) {
    return `${window.location.origin}/join/${groupId}?name=${encodeURIComponent(groupName)}#${keyBase64Url}`;
  }

  return baseUrl;
}

/**
 * Parse an invite link to extract group ID and key
 *
 * @param url - Full URL or pathname+fragment (e.g., /join/groupId#key)
 * @returns Object with groupId and groupKey, or null if invalid
 */
export function parseInviteLink(url: string): { groupId: string; groupKey: string } | null {
  try {
    // Handle full URL or just pathname
    let pathname: string;
    let fragment: string;

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const parsedUrl = new URL(url);
      pathname = parsedUrl.pathname;
      fragment = parsedUrl.hash.substring(1); // Remove leading #
    } else {
      // Assume it's pathname#fragment format
      const parts = url.split('#');
      pathname = parts[0] || '';
      fragment = parts[1] || '';
    }

    // Expected pathname format: /join/{groupId}
    const match = pathname.match(/^\/join\/([^/?]+)/);
    if (!match) {
      return null;
    }

    const groupId = match[1];
    if (!groupId || !fragment) {
      return null;
    }

    // Fragment is the Base64URL-encoded key
    const groupKey = base64UrlToBase64(fragment);
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
