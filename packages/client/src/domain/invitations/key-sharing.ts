/**
 * Key sharing utilities for Phase 5
 * Handles building key payloads and managing group key history
 */

import type { GroupKeysPayload } from '@partage/shared';
import { PartageDB } from '../../core/storage/indexeddb.js';

/**
 * Build a complete key payload for sharing with a new member
 * Retrieves all historical group keys from storage
 *
 * @param groupId - ID of the group
 * @param currentKeyVersion - Current active key version
 * @param creatorPublicKeyHash - Public key hash of group creator
 * @returns Complete key payload with all historical keys
 */
export async function buildGroupKeysPayload(
  groupId: string,
  currentKeyVersion: number,
  creatorPublicKeyHash: string
): Promise<GroupKeysPayload> {
  const db = new PartageDB();
  await db.open();

  // Retrieve all group keys from storage
  const keyMap = await db.getAllGroupKeys(groupId);

  // Convert to array format for payload
  const keys = Array.from(keyMap.entries())
    .map(([version, key]) => ({
      version,
      key, // Already Base64 encoded in storage
      rotatedAt: Date.now(), // TODO: Store rotation timestamps in Phase 5
      rotatedBy: creatorPublicKeyHash, // TODO: Track who rotated each key
    }))
    .sort((a, b) => a.version - b.version); // Sort by version

  return {
    groupId,
    keys,
    currentKeyVersion,
  };
}

/**
 * Import received group keys into local storage
 * Called by new members after receiving encrypted key package
 *
 * @param payload - Decrypted group keys payload
 * @returns Number of keys imported
 */
export async function importGroupKeys(payload: GroupKeysPayload): Promise<number> {
  const db = new PartageDB();
  await db.open();

  let imported = 0;

  for (const keyData of payload.keys) {
    await db.saveGroupKey(payload.groupId, keyData.version, keyData.key);
    imported++;
  }

  return imported;
}

/**
 * Rotate group key (create new version)
 * Called when a member joins or leaves the group
 *
 * @param groupId - ID of the group
 * @param currentVersion - Current key version
 * @param rotatedBy - Public key hash of member rotating the key
 * @returns New key version number and Base64 encoded key
 */
export async function rotateGroupKey(
  groupId: string,
  currentVersion: number,
  rotatedBy: string
): Promise<{ version: number; key: string; rotatedAt: number; rotatedBy: string }> {
  const db = new PartageDB();
  await db.open();

  // Generate new symmetric key
  const newKey = await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );

  // Export and encode key
  const exported = await crypto.subtle.exportKey('raw', newKey);
  const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(exported)));

  // Calculate new version
  const newVersion = currentVersion + 1;

  // Save to storage
  await db.saveGroupKey(groupId, newVersion, keyBase64);

  return {
    version: newVersion,
    key: keyBase64,
    rotatedAt: Date.now(),
    rotatedBy,
  };
}

/**
 * Check if a user has access to a specific group key version
 * Useful for verifying if a member can decrypt old entries
 *
 * @param groupId - ID of the group
 * @param version - Key version to check
 * @returns true if key is available in storage
 */
export async function hasGroupKeyVersion(groupId: string, version: number): Promise<boolean> {
  const db = new PartageDB();
  await db.open();

  const key = await db.getGroupKey(groupId, version);
  return key !== null;
}
