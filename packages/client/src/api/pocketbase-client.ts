/**
 * PocketBase API client for Partage
 *
 * Handles communication with the PocketBase server for:
 * - Group creation with Proof-of-Work anti-spam
 * - Group user authentication
 * - Loro CRDT update distribution
 * - Real-time subscriptions
 */

import PocketBase, { type RecordSubscription, type RecordModel } from 'pocketbase';
import type { PoWChallenge, PoWSolution } from '../core/pow/proof-of-work';

// const POCKETBASE_URL = import.meta.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090';
const POCKETBASE_URL = import.meta.env.VITE_POCKETBASE_URL || '';

/**
 * User record schema (matches PocketBase auth collection)
 * Each user is a "group user" - one user account per group
 */
export interface UserRecord extends RecordModel {
  email?: string;
  username: string;
  groupId: string;
}

/**
 * Group record schema (matches PocketBase collection)
 */
export interface GroupRecord {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
  powChallenge: string; // Stored to prevent challenge reuse
  collectionId?: string;
  collectionName?: string;
  created?: string;
  updated?: string;
}

/**
 * Loro update record schema (matches PocketBase collection)
 */
export interface LoroUpdateRecord {
  id: string;
  groupId: string;
  timestamp: number;
  actorId: string;
  updateData: string; // Base64-encoded Loro update bytes
  version?: any; // Loro version vector (optional, for debugging)
  collectionId?: string;
  collectionName?: string;
  created?: string;
  updated?: string;
}

// Invitation/join request/key package collections removed in simplified trusted group model
// Group keys are now embedded in invite URLs (client-side only)

/**
 * PocketBase API client wrapper
 */
export class PocketBaseClient {
  private pb: PocketBase;
  private subscriptions: Map<string, () => void> = new Map();

  constructor(url: string = POCKETBASE_URL) {
    this.pb = new PocketBase(url);
    // Disable auto-cancellation for long-running operations
    this.pb.autoCancellation(false);
  }

  /**
   * Get the base URL of the PocketBase server
   */
  get baseUrl(): string {
    return this.pb.baseUrl;
  }

  /**
   * Check if the server is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.pb.health.check();
      return true;
    } catch {
      return false;
    }
  }

  // ==================== Proof-of-Work API ====================

  /**
   * Get a PoW challenge from the server
   * The challenge must be solved before creating a group
   */
  async getPoWChallenge(): Promise<PoWChallenge> {
    const response = await fetch(`${this.pb.baseUrl}/api/pow/challenge`);
    if (!response.ok) {
      throw new Error('Failed to get PoW challenge');
    }
    return await response.json();
  }

  // ==================== Groups API ====================

  /**
   * Create a new group
   * Requires a solved PoW challenge to prevent spam
   * @param data - Group data
   * @param powSolution - The solved PoW challenge
   * @returns The group record with PocketBase-generated ID
   */
  async createGroup(
    data: {
      name: string;
      createdAt: number;
      createdBy: string;
    },
    powSolution: PoWSolution
  ): Promise<GroupRecord> {
    // Use raw fetch to include PoW fields that the hook will process
    const response = await fetch(`${this.pb.baseUrl}/api/collections/groups/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        ...powSolution,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create group: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Get a group by ID
   */
  async getGroup(groupId: string): Promise<GroupRecord> {
    return await this.pb.collection('groups').getOne<GroupRecord>(groupId);
  }

  /**
   * List all groups (optionally filtered by creator)
   */
  async listGroups(options?: { createdBy?: string; limit?: number }): Promise<GroupRecord[]> {
    const filter = options?.createdBy ? `createdBy="${options.createdBy}"` : '';
    const result = await this.pb
      .collection('groups')
      .getList<GroupRecord>(1, options?.limit || 50, {
        filter,
        sort: '-createdAt',
      });
    return result.items;
  }

  // ==================== Authentication API ====================

  /**
   * Create a group user account (for group data access)
   * The groupId must reference an existing group (validated by server hook)
   * Password is derived from the group key for deterministic authentication
   * @param groupId - The group ID this account is for
   * @param groupKeyBase64 - The group's symmetric key in Base64 format
   */
  async createGroupUser(groupId: string, groupKeyBase64: string): Promise<void> {
    const password = await this.derivePasswordFromKey(groupKeyBase64);
    const username = `group_${groupId}`;

    await this.pb.collection('users').create({
      username,
      password,
      passwordConfirm: password,
      groupId,
    });
  }

  /**
   * Authenticate as a group account using derived password
   * @param groupId - The group ID to authenticate for
   * @param groupKeyBase64 - The group's symmetric key in Base64 format
   */
  async authenticateAsGroup(groupId: string, groupKeyBase64: string): Promise<void> {
    const password = await this.derivePasswordFromKey(groupKeyBase64);
    const username = `group_${groupId}`;
    await this.pb.collection('users').authWithPassword(username, password);
  }

  /**
   * Check if authenticated as a group account for a specific group
   */
  isAuthenticatedForGroup(groupId: string): boolean {
    return this.pb.authStore.isValid && this.pb.authStore.record?.groupId === groupId;
  }

  /**
   * Logout (clear auth store)
   */
  logout(): void {
    this.pb.authStore.clear();
  }

  /**
   * Refresh the authentication token
   */
  async refreshAuth(): Promise<void> {
    if (this.pb.authStore.isValid) {
      try {
        await this.pb.collection('users').authRefresh();
      } catch (error) {
        // Token refresh failed, clear auth store
        console.warn('[PocketBase] Auth refresh failed:', error);
        this.pb.authStore.clear();
        throw error;
      }
    }
  }

  /**
   * Derive a password deterministically from a group key
   * Uses SHA-256 hash of the key, encoded as base64url
   * @param groupKeyBase64 - The group's symmetric key in Base64 format
   */
  async derivePasswordFromKey(groupKeyBase64: string): Promise<string> {
    // Convert base64 key to bytes
    const keyBytes = Uint8Array.from(atob(groupKeyBase64), (c) => c.charCodeAt(0));

    // Hash the key with SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes);
    const hashArray = new Uint8Array(hashBuffer);

    // Convert to base64url (URL-safe, no padding)
    const base64 = btoa(String.fromCharCode(...hashArray));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Subscribe to auth store changes
   */
  onAuthChange(callback: (token: string, record: UserRecord | null) => void): () => void {
    return this.pb.authStore.onChange((token, model) => {
      callback(token, model as UserRecord | null);
    });
  }

  // ==================== Loro Updates API ====================

  /**
   * Push a Loro update to the server
   */
  async pushUpdate(data: {
    groupId: string;
    timestamp: number;
    actorId: string;
    updateData: string; // Base64-encoded Uint8Array
    version?: any;
  }): Promise<LoroUpdateRecord> {
    return await this.pb.collection('loro_updates').create<LoroUpdateRecord>(data);
  }

  /**
   * Fetch all updates for a group since a given timestamp
   */
  async fetchUpdates(
    groupId: string,
    options?: {
      sinceTimestamp?: number;
      limit?: number;
    }
  ): Promise<LoroUpdateRecord[]> {
    const filter = options?.sinceTimestamp
      ? `groupId="${groupId}" && timestamp > ${options.sinceTimestamp}`
      : `groupId="${groupId}"`;

    const result = await this.pb
      .collection('loro_updates')
      .getList<LoroUpdateRecord>(1, options?.limit || 1000, {
        filter,
        sort: '+timestamp', // Chronological order
      });

    return result.items;
  }

  /**
   * Fetch ALL updates for a group (for initial sync)
   */
  async fetchAllUpdates(groupId: string): Promise<LoroUpdateRecord[]> {
    const allUpdates: LoroUpdateRecord[] = [];
    let page = 1;
    const perPage = 500;

    while (true) {
      const result = await this.pb
        .collection('loro_updates')
        .getList<LoroUpdateRecord>(page, perPage, {
          filter: `groupId="${groupId}"`,
          sort: '+timestamp',
        });

      allUpdates.push(...result.items);

      if (result.items.length < perPage) {
        // No more pages
        break;
      }

      page++;
    }

    return allUpdates;
  }

  /**
   * Get the latest update timestamp for a group
   */
  async getLatestUpdateTimestamp(groupId: string): Promise<number | null> {
    try {
      const result = await this.pb.collection('loro_updates').getList<LoroUpdateRecord>(1, 1, {
        filter: `groupId="${groupId}"`,
        sort: '-timestamp',
      });

      return result.items[0]?.timestamp || null;
    } catch {
      return null;
    }
  }

  // ==================== Real-time Subscriptions ====================

  // Track active subscription callbacks per collection to avoid unsubscribe('*') destroying all subscriptions
  private loroUpdateCallbacks: Map<string, (update: LoroUpdateRecord) => void> = new Map();
  private loroSubscriptionActive: boolean = false;

  /**
   * Subscribe to real-time updates for a group
   *
   * @param groupId - The group ID to subscribe to
   * @param onUpdate - Callback when a new update arrives
   * @returns Unsubscribe function
   */
  async subscribeToUpdates(
    groupId: string,
    onUpdate: (update: LoroUpdateRecord) => void
  ): Promise<() => void> {
    const subscriptionKey = `loro_updates:${groupId}`;

    // Store the callback for this group
    this.loroUpdateCallbacks.set(groupId, onUpdate);

    // Only create the PocketBase subscription once
    if (!this.loroSubscriptionActive) {
      await this.pb
        .collection('loro_updates')
        .subscribe<LoroUpdateRecord>('*', (e: RecordSubscription<LoroUpdateRecord>) => {
          // Route to the appropriate callback based on groupId
          if (e.action === 'create') {
            const callback = this.loroUpdateCallbacks.get(e.record.groupId);
            if (callback) {
              callback(e.record);
            }
          }
        });
      this.loroSubscriptionActive = true;
    }

    // Create unsubscribe function that only removes the callback, not the subscription
    const unsubscribe = async () => {
      this.loroUpdateCallbacks.delete(groupId);
      this.subscriptions.delete(subscriptionKey);

      // Only truly unsubscribe if no more callbacks
      if (this.loroUpdateCallbacks.size === 0 && this.loroSubscriptionActive) {
        try {
          await this.pb.collection('loro_updates').unsubscribe('*');
          this.loroSubscriptionActive = false;
        } catch (error) {
          console.warn('Error unsubscribing from loro_updates:', error);
        }
      }
    };

    this.subscriptions.set(subscriptionKey, unsubscribe);

    return unsubscribe;
  }

  /**
   * Unsubscribe from all active subscriptions
   */
  async unsubscribeAll(): Promise<void> {
    // Clear all callback maps
    this.loroUpdateCallbacks.clear();

    // Unsubscribe from PocketBase collections
    try {
      if (this.loroSubscriptionActive) {
        await this.pb.collection('loro_updates').unsubscribe('*');
        this.loroSubscriptionActive = false;
      }
    } catch (error) {
      console.warn('[PocketBase] Error during unsubscribeAll:', error);
    }

    this.subscriptions.clear();
  }

  /**
   * Check if subscriptions are active (for debugging)
   */
  getSubscriptionStatus(): {
    loroUpdates: boolean;
    activeCallbacks: { loroUpdates: number };
  } {
    return {
      loroUpdates: this.loroSubscriptionActive,
      activeCallbacks: {
        loroUpdates: this.loroUpdateCallbacks.size,
      },
    };
  }

  // ==================== Utilities ====================

  /**
   * Convert Uint8Array to Base64 string (for storage)
   * Uses chunked approach to avoid stack overflow with large arrays
   */
  static encodeUpdateData(updateBytes: Uint8Array): string {
    // Use chunked approach to avoid stack overflow with spread operator
    const CHUNK_SIZE = 8192;
    let binaryString = '';
    for (let i = 0; i < updateBytes.length; i += CHUNK_SIZE) {
      const chunk = updateBytes.subarray(i, i + CHUNK_SIZE);
      binaryString += String.fromCharCode(...chunk);
    }
    return btoa(binaryString);
  }

  /**
   * Convert Base64 string back to Uint8Array (for applying)
   */
  static decodeUpdateData(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Serialize version vector for storage
   */
  static serializeVersion(version: any): string | undefined {
    if (!version) return undefined;
    try {
      return JSON.stringify(version);
    } catch {
      return undefined;
    }
  }

  /**
   * Deserialize version vector from storage
   */
  static deserializeVersion(serialized: string | undefined): any {
    if (!serialized) return undefined;
    try {
      return JSON.parse(serialized);
    } catch {
      return undefined;
    }
  }
}

// Export singleton instance
export const pbClient = new PocketBaseClient();
