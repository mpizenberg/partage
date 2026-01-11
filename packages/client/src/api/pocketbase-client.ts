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
console.log('POCKETBASE_URL', POCKETBASE_URL);

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

/**
 * Invitation record schema (matches PocketBase collection)
 */
export interface InvitationRecord {
  id: string;
  groupId: string;
  inviterPublicKeyHash: string;
  createdAt: number;
  expiresAt?: number;
  maxUses?: number;
  usedCount: number;
  status: string; // 'active' | 'expired' | 'revoked'
  collectionId?: string;
  collectionName?: string;
  created?: string;
  updated?: string;
}

/**
 * Join request record schema (matches PocketBase collection)
 */
export interface JoinRequestRecord {
  id: string;
  invitationId: string;
  groupId: string;
  requesterPublicKey: string;
  requesterPublicKeyHash: string;
  requesterName: string;
  requestedAt: number;
  status: string; // 'pending' | 'approved' | 'rejected'
  approvedBy?: string;
  approvedAt?: number;
  rejectedBy?: string;
  rejectedAt?: number;
  rejectionReason?: string;
  collectionId?: string;
  collectionName?: string;
  created?: string;
  updated?: string;
}

/**
 * Key package record schema (matches PocketBase collection)
 */
export interface KeyPackageRecord {
  id: string;
  joinRequestId: string;
  groupId: string;
  recipientPublicKeyHash: string;
  senderPublicKeyHash: string;
  senderPublicKey: string;
  senderSigningPublicKey: string;
  encryptedKeys: any; // JSON object with iv, ciphertext
  createdAt: number;
  signature: string;
  collectionId?: string;
  collectionName?: string;
  created?: string;
  updated?: string;
}

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
      console.log('[PocketBase] Creating loro_updates subscription');
      await this.pb
        .collection('loro_updates')
        .subscribe<LoroUpdateRecord>('*', (e: RecordSubscription<LoroUpdateRecord>) => {
          // Route to the appropriate callback based on groupId
          if (e.action === 'create') {
            const callback = this.loroUpdateCallbacks.get(e.record.groupId);
            if (callback) {
              console.log(`[PocketBase] Routing update for group ${e.record.groupId} to callback`);
              callback(e.record);
            } else {
              console.log(`[PocketBase] No callback registered for group ${e.record.groupId}`);
            }
          }
        });
      this.loroSubscriptionActive = true;
    } else {
      console.log(
        `[PocketBase] Reusing existing loro_updates subscription, adding callback for group ${groupId}`
      );
    }

    // Create unsubscribe function that only removes the callback, not the subscription
    const unsubscribe = async () => {
      console.log(`[PocketBase] Removing callback for group ${groupId}`);
      this.loroUpdateCallbacks.delete(groupId);
      this.subscriptions.delete(subscriptionKey);

      // Only truly unsubscribe if no more callbacks
      if (this.loroUpdateCallbacks.size === 0 && this.loroSubscriptionActive) {
        console.log('[PocketBase] No more callbacks, unsubscribing from loro_updates');
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
    this.joinRequestCallbacks.clear();
    this.keyPackageCallbacks.clear();

    // Unsubscribe from PocketBase collections
    try {
      if (this.loroSubscriptionActive) {
        await this.pb.collection('loro_updates').unsubscribe('*');
        this.loroSubscriptionActive = false;
      }
      if (this.joinRequestSubscriptionActive) {
        await this.pb.collection('join_requests').unsubscribe('*');
        this.joinRequestSubscriptionActive = false;
      }
      if (this.keyPackageSubscriptionActive) {
        await this.pb.collection('key_packages').unsubscribe('*');
        this.keyPackageSubscriptionActive = false;
      }
    } catch (error) {
      console.warn('[PocketBase] Error during unsubscribeAll:', error);
    }

    this.subscriptions.clear();
    console.log('[PocketBase] Unsubscribed from all collections');
  }

  /**
   * Check if subscriptions are active (for debugging)
   */
  getSubscriptionStatus(): {
    loroUpdates: boolean;
    joinRequests: boolean;
    keyPackages: boolean;
    activeCallbacks: { loroUpdates: number; joinRequests: number; keyPackages: number };
  } {
    return {
      loroUpdates: this.loroSubscriptionActive,
      joinRequests: this.joinRequestSubscriptionActive,
      keyPackages: this.keyPackageSubscriptionActive,
      activeCallbacks: {
        loroUpdates: this.loroUpdateCallbacks.size,
        joinRequests: this.joinRequestCallbacks.size,
        keyPackages: this.keyPackageCallbacks.size,
      },
    };
  }

  // ==================== Invitations API ====================

  /**
   * Create an invitation for a group
   */
  async createInvitation(data: {
    groupId: string;
    inviterPublicKeyHash: string;
    createdAt: number;
    expiresAt?: number;
    maxUses?: number;
    usedCount: number;
    status: string;
  }): Promise<InvitationRecord> {
    return await this.pb.collection('invitations').create<InvitationRecord>(data);
  }

  /**
   * Get an invitation by ID
   */
  async getInvitation(invitationId: string): Promise<InvitationRecord> {
    return await this.pb.collection('invitations').getOne<InvitationRecord>(invitationId);
  }

  /**
   * List invitations for a group
   */
  async listInvitations(groupId: string): Promise<InvitationRecord[]> {
    const result = await this.pb.collection('invitations').getList<InvitationRecord>(1, 50, {
      filter: `groupId="${groupId}"`,
      sort: '-createdAt',
    });
    return result.items;
  }

  /**
   * Update invitation (e.g., increment usedCount, revoke)
   */
  async updateInvitation(
    invitationId: string,
    data: Partial<InvitationRecord>
  ): Promise<InvitationRecord> {
    return await this.pb.collection('invitations').update<InvitationRecord>(invitationId, data);
  }

  // ==================== Join Requests API ====================

  /**
   * Create a join request
   */
  async createJoinRequest(data: {
    invitationId: string;
    groupId: string;
    requesterPublicKey: string;
    requesterPublicKeyHash: string;
    requesterName: string;
    requestedAt: number;
    status: string;
  }): Promise<JoinRequestRecord> {
    return await this.pb.collection('join_requests').create<JoinRequestRecord>(data);
  }

  /**
   * Get a join request by ID
   */
  async getJoinRequest(joinRequestId: string): Promise<JoinRequestRecord> {
    return await this.pb.collection('join_requests').getOne<JoinRequestRecord>(joinRequestId);
  }

  /**
   * List join requests for a group
   */
  async listJoinRequests(
    groupId: string,
    options?: { status?: string }
  ): Promise<JoinRequestRecord[]> {
    const filter = options?.status
      ? `groupId="${groupId}" && status="${options.status}"`
      : `groupId="${groupId}"`;

    const result = await this.pb.collection('join_requests').getList<JoinRequestRecord>(1, 50, {
      filter,
      sort: '-requestedAt',
    });
    return result.items;
  }

  /**
   * List join requests for a specific user (by public key hash)
   */
  async listJoinRequestsByUser(requesterPublicKeyHash: string): Promise<JoinRequestRecord[]> {
    const result = await this.pb.collection('join_requests').getList<JoinRequestRecord>(1, 50, {
      filter: `requesterPublicKeyHash="${requesterPublicKeyHash}"`,
      sort: '-requestedAt',
    });
    return result.items;
  }

  /**
   * Update join request (e.g., approve, reject)
   */
  async updateJoinRequest(
    joinRequestId: string,
    data: Partial<JoinRequestRecord>
  ): Promise<JoinRequestRecord> {
    return await this.pb.collection('join_requests').update<JoinRequestRecord>(joinRequestId, data);
  }

  // ==================== Key Packages API ====================

  /**
   * Create a key package for a new member
   */
  async createKeyPackage(data: {
    joinRequestId: string;
    groupId: string;
    recipientPublicKeyHash: string;
    keyVersion: number;
    reason?: string;
    senderPublicKeyHash: string;
    senderPublicKey: string;
    senderSigningPublicKey: string;
    encryptedKeys: any;
    createdAt: number;
    signature: string;
  }): Promise<KeyPackageRecord> {
    try {
      return await this.pb.collection('key_packages').create<KeyPackageRecord>(data);
    } catch (error: any) {
      console.error('[PocketBase] Failed to create key package:', error);
      console.error('[PocketBase] Error data:', error.data);
      console.error('[PocketBase] Sent data:', data);
      throw error;
    }
  }

  /**
   * Get key packages for a recipient (user checking for their keys)
   */
  async getKeyPackagesForRecipient(recipientPublicKeyHash: string): Promise<KeyPackageRecord[]> {
    const result = await this.pb.collection('key_packages').getList<KeyPackageRecord>(1, 50, {
      filter: `recipientPublicKeyHash="${recipientPublicKeyHash}"`,
      sort: '-createdAt',
    });
    return result.items;
  }

  /**
   * Get key package for a specific join request
   */
  async getKeyPackageForJoinRequest(joinRequestId: string): Promise<KeyPackageRecord | null> {
    try {
      const result = await this.pb.collection('key_packages').getList<KeyPackageRecord>(1, 1, {
        filter: `joinRequestId="${joinRequestId}"`,
      });
      return result.items[0] || null;
    } catch {
      return null;
    }
  }

  // ==================== Real-time Subscriptions (Phase 5) ====================

  // Track active subscription callbacks for join_requests
  private joinRequestCallbacks: Map<string, (joinRequest: JoinRequestRecord) => void> = new Map();
  private joinRequestSubscriptionActive: boolean = false;

  // Track active subscription callbacks for key_packages
  private keyPackageCallbacks: Map<string, (keyPackage: KeyPackageRecord) => void> = new Map();
  private keyPackageSubscriptionActive: boolean = false;

  /**
   * Subscribe to join requests for a group (for existing members)
   */
  async subscribeToJoinRequests(
    groupId: string,
    onJoinRequest: (joinRequest: JoinRequestRecord) => void
  ): Promise<() => void> {
    const subscriptionKey = `join_requests:${groupId}`;

    // Store the callback for this group
    this.joinRequestCallbacks.set(groupId, onJoinRequest);

    // Only create the PocketBase subscription once
    if (!this.joinRequestSubscriptionActive) {
      console.log('[PocketBase] Creating join_requests subscription');
      await this.pb
        .collection('join_requests')
        .subscribe<JoinRequestRecord>('*', (e: RecordSubscription<JoinRequestRecord>) => {
          if (e.action === 'create') {
            const callback = this.joinRequestCallbacks.get(e.record.groupId);
            if (callback) {
              console.log(`[PocketBase] Routing join request for group ${e.record.groupId}`);
              callback(e.record);
            }
          }
        });
      this.joinRequestSubscriptionActive = true;
    } else {
      console.log(`[PocketBase] Reusing existing join_requests subscription for group ${groupId}`);
    }

    const unsubscribe = async () => {
      console.log(`[PocketBase] Removing join_requests callback for group ${groupId}`);
      this.joinRequestCallbacks.delete(groupId);
      this.subscriptions.delete(subscriptionKey);

      if (this.joinRequestCallbacks.size === 0 && this.joinRequestSubscriptionActive) {
        console.log('[PocketBase] No more callbacks, unsubscribing from join_requests');
        try {
          await this.pb.collection('join_requests').unsubscribe('*');
          this.joinRequestSubscriptionActive = false;
        } catch (error) {
          console.warn('Error unsubscribing from join requests:', error);
        }
      }
    };

    this.subscriptions.set(subscriptionKey, unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to key packages for a user (for new members waiting for keys)
   */
  async subscribeToKeyPackages(
    recipientPublicKeyHash: string,
    onKeyPackage: (keyPackage: KeyPackageRecord) => void
  ): Promise<() => void> {
    const subscriptionKey = `key_packages:${recipientPublicKeyHash}`;

    // Store the callback for this recipient
    this.keyPackageCallbacks.set(recipientPublicKeyHash, onKeyPackage);

    // Only create the PocketBase subscription once
    if (!this.keyPackageSubscriptionActive) {
      console.log('[PocketBase] Creating key_packages subscription');
      await this.pb
        .collection('key_packages')
        .subscribe<KeyPackageRecord>('*', (e: RecordSubscription<KeyPackageRecord>) => {
          if (e.action === 'create') {
            const callback = this.keyPackageCallbacks.get(e.record.recipientPublicKeyHash);
            if (callback) {
              console.log(
                `[PocketBase] Routing key package for recipient ${e.record.recipientPublicKeyHash}`
              );
              callback(e.record);
            }
          }
        });
      this.keyPackageSubscriptionActive = true;
    } else {
      console.log(
        `[PocketBase] Reusing existing key_packages subscription for ${recipientPublicKeyHash}`
      );
    }

    const unsubscribe = async () => {
      console.log(`[PocketBase] Removing key_packages callback for ${recipientPublicKeyHash}`);
      this.keyPackageCallbacks.delete(recipientPublicKeyHash);
      this.subscriptions.delete(subscriptionKey);

      if (this.keyPackageCallbacks.size === 0 && this.keyPackageSubscriptionActive) {
        console.log('[PocketBase] No more callbacks, unsubscribing from key_packages');
        try {
          await this.pb.collection('key_packages').unsubscribe('*');
          this.keyPackageSubscriptionActive = false;
        } catch (error) {
          console.warn('Error unsubscribing from key packages:', error);
        }
      }
    };

    this.subscriptions.set(subscriptionKey, unsubscribe);
    return unsubscribe;
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
