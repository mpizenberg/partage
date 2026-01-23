/**
 * Group State Management
 *
 * This module provides event creation utilities for group metadata.
 *
 * Note: Group metadata is encrypted. To get the current metadata state,
 * use LoroEntryStore.getGroupMetadata() which directly retrieves
 * and decrypts the stored metadata. The full history is preserved
 * in Loro's oplog on the server, but locally we only keep the latest.
 */

import type { GroupMetadataUpdatedEvent, GroupLink } from '@partage/shared';

/**
 * Create a group metadata updated event
 *
 * @param groupId The group to update
 * @param updates The metadata fields to update (only provided fields will be changed)
 * @param actorId Who is making this change
 * @returns The new event
 */
export function createGroupMetadataUpdatedEvent(
  groupId: string,
  updates: {
    subtitle?: string;
    description?: string;
    links?: GroupLink[];
  },
  actorId: string
): GroupMetadataUpdatedEvent {
  return {
    id: crypto.randomUUID(),
    type: 'group_metadata_updated',
    groupId,
    timestamp: Date.now(),
    actorId,
    ...updates,
  };
}
