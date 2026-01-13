/**
 * PocketBase API client for Partage
 *
 * Handles communication with the PocketBase server for:
 * - Group metadata sync
 * - Loro CRDT update distribution
 * - Real-time subscriptions
 */

import PocketBase, { type RecordSubscription } from 'pocketbase';

// const POCKETBASE_URL = import.meta.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090';
const POCKETBASE_URL = import.meta.env.VITE_POCKETBASE_URL || '';

/**
 * Group record schema (matches PocketBase collection)
 */
export interface GroupRecord {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
  lastActivityAt: number;
  memberCount: number;
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

  // ==================== Groups API ====================

  /**
   * Create a new group
   * Returns the group record with PocketBase-generated ID
   */
  async createGroup(data: {
    name: string;
    createdAt: number;
    createdBy: string;
    lastActivityAt: number;
    memberCount: number;
  }): Promise<GroupRecord> {
    return await this.pb.collection('groups').create<GroupRecord>(data);
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
        sort: '-lastActivityAt',
      });
    return result.items;
  }

  /**
   * Update group's last activity timestamp
   */
  async updateGroupActivity(groupId: string, timestamp: number): Promise<void> {
    try {
      await this.pb.collection('groups').update(groupId, {
        lastActivityAt: timestamp,
      });
    } catch (error) {
      // Ignore errors for activity updates (non-critical)
      console.warn('Failed to update group activity:', error);
    }
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
    const record = await this.pb.collection('loro_updates').create<LoroUpdateRecord>(data);

    // Update group activity timestamp
    this.updateGroupActivity(data.groupId, data.timestamp).catch(() => {
      // Ignore errors
    });

    return record;
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
