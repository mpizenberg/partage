/**
 * Sync Manager - Orchestrates CRDT synchronization
 *
 * Responsibilities:
 * - Push local Loro updates to PocketBase server
 * - Pull and apply remote Loro updates
 * - Handle real-time subscriptions
 * - Detect and handle online/offline transitions
 * - Queue operations when offline
 *
 * Architecture:
 * - Local-first: Loro operations happen immediately in memory
 * - Server is just a relay for encrypted CRDT updates
 * - Conflicts are resolved automatically by Loro CRDT
 *
 * Debugging notes:
 * If multi-device sync appears "stuck", verify:
 * - Are we pushing non-empty CRDT updates?
 * - Are updates being written to the server?
 * - Are we fetching/receiving updates on other devices?
 * - When we apply an update, does the local snapshot/entry count change?
 *
 * If `applyRemoteUpdate` logs show no observable change even for known-new updates,
 * it may be because we are not applying updates in the right order or we are
 * skipping/duplicating records due to timestamp cursor issues (client clock skew).
 *
 * To reduce sensitivity to skew, we can use PocketBase server timestamps (`created`/`updated`)
 * as the incremental sync cursor instead of the client-provided `timestamp` field.
 *
 * The extra logging below aims to distinguish those cases.
 */

import type { LoroEntryStore } from '../crdt/loro-wrapper.js';
import type { PartageDB } from '../storage/indexeddb.js';
import { PocketBaseClient, type LoroUpdateRecord } from '../../api/pocketbase-client.js';

export interface SyncManagerConfig {
  loroStore: LoroEntryStore;
  storage: PartageDB;
  apiClient?: PocketBaseClient;
  enableAutoSync?: boolean;
  onUpdate?: (groupId: string) => void | Promise<void>; // Callback when updates are applied
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  status: SyncStatus;
  lastSyncTimestamp: number | null;
  lastError: string | null;
  isOnline: boolean;
  activeSubscriptions: number;
}

/**
 * Queued operation for offline support
 */
interface QueuedOperation {
  groupId: string;
  timestamp: number;
  actorId: string;
  updateData: string;
}

/**
 * Sync Manager for Loro CRDT operations
 */
export class SyncManager {
  private loroStore: LoroEntryStore;
  private storage: PartageDB;
  private apiClient: PocketBaseClient;
  private enableAutoSync: boolean;
  private onUpdate?: (groupId: string) => void | Promise<void>;

  // Sync state
  private status: SyncStatus = 'idle';
  private isOnline: boolean = navigator.onLine;
  // Cursor for incremental sync: last applied client-provided timestamp per group.
  private lastSyncTimestamp: Map<string, number> = new Map(); // groupId -> timestamp
  private lastError: string | null = null;

  // Real-time subscriptions
  private activeSubscriptions: Map<string, () => void> = new Map();
  private subscribedGroups: Map<string, string> = new Map(); // groupId -> actorId (for re-subscription)

  // DEBUG: Track applied update record IDs to detect duplicate application/no-op imports.
  // This is in-memory only; if the app reloads, we will re-apply from server history.
  private appliedUpdateIds: Set<string> = new Set();

  // Offline queue
  private offlineQueue: QueuedOperation[] = [];
  private isSyncingQueue: boolean = false;

  // Event listeners
  private onlineListener?: () => void;
  private offlineListener?: () => void;

  // Subscription health check interval
  private healthCheckInterval?: ReturnType<typeof setInterval>;

  constructor(config: SyncManagerConfig) {
    this.loroStore = config.loroStore;
    this.storage = config.storage;
    this.apiClient = config.apiClient || new PocketBaseClient();
    this.enableAutoSync = config.enableAutoSync ?? true;
    this.onUpdate = config.onUpdate;

    // Set up online/offline detection
    this.setupNetworkListeners();

    // Load offline queue from storage
    this.loadOfflineQueue();
  }

  // ==================== Public API ====================

  /**
   * Get current sync state
   */
  getState(): SyncState {
    return {
      status: this.status,
      lastSyncTimestamp: this.getLatestSyncTimestamp(),
      lastError: this.lastError,
      isOnline: this.isOnline,
      activeSubscriptions: this.activeSubscriptions.size,
    };
  }

  /**
   * Initial sync for a group - fetch all updates and apply them
   */
  async initialSync(groupId: string, actorId: string): Promise<void> {
    if (!this.isOnline) {
      throw new Error('Cannot perform initial sync while offline');
    }

    this.setStatus('syncing');
    this.lastError = null;

    try {
      console.log(`[SyncManager] Initial sync for group ${groupId}, local actorId=${actorId}`);

      // Fetch all updates from the server
      const updates = await this.apiClient.fetchAllUpdates(groupId);
      console.log(`[SyncManager] Fetched ${updates.length} updates from server`);

      // Log each update's actorId to see who created them
      for (const update of updates) {
        console.log(
          `[SyncManager] Update: id=${update.id}, actorId=${update.actorId}, timestamp=${update.timestamp}, bytes=${update.updateData.length}`
        );
      }

      // Apply updates in chronological order
      for (const update of updates) {
        await this.applyRemoteUpdate(update, actorId);
      }

      // Update last sync timestamp
      if (updates.length > 0) {
        const latestTimestamp = Math.max(...updates.map((u) => u.timestamp));
        this.lastSyncTimestamp.set(groupId, latestTimestamp);
      } else {
        this.lastSyncTimestamp.set(groupId, Date.now());
      }

      // Save snapshot to storage
      await this.saveSnapshot(groupId);

      console.log('[SyncManager] Initial sync completed');
      this.setStatus('idle');
    } catch (error) {
      this.handleError('Initial sync failed', error);
      throw error;
    }
  }

  /**
   * Incremental sync - fetch updates since last sync
   */
  async incrementalSync(groupId: string, actorId: string): Promise<void> {
    if (!this.isOnline) {
      console.log('[SyncManager] Skipping incremental sync (offline)');
      return;
    }

    this.setStatus('syncing');
    this.lastError = null;

    try {
      const sinceTimestamp = this.lastSyncTimestamp.get(groupId) || 0;
      console.log(`[SyncManager] Incremental sync since ${sinceTimestamp}`);

      // Fetch updates since last sync
      const updates = await this.apiClient.fetchUpdates(groupId, { sinceTimestamp });
      console.log(`[SyncManager] Fetched ${updates.length} new updates`);

      // Apply updates
      for (const update of updates) {
        await this.applyRemoteUpdate(update, actorId);
      }

      // Update last sync timestamp
      if (updates.length > 0) {
        const latestTimestamp = Math.max(...updates.map((u) => u.timestamp));
        this.lastSyncTimestamp.set(groupId, latestTimestamp);
      }

      // Save snapshot
      await this.saveSnapshot(groupId);

      this.setStatus('idle');
    } catch (error) {
      this.handleError('Incremental sync failed', error);
    }
  }

  /**
   * Push a local Loro update to the server
   */
  async pushUpdate(
    groupId: string,
    actorId: string,
    updateBytes: Uint8Array,
    version?: any
  ): Promise<void> {
    const timestamp = Date.now();
    const updateData = PocketBaseClient.encodeUpdateData(updateBytes);

    const operation: QueuedOperation = {
      groupId,
      timestamp,
      actorId,
      updateData,
    };

    // DEBUG: Verify we are pushing non-empty updates
    console.log(
      `[SyncManager] pushUpdate(group=${groupId}) actor=${actorId} bytes=${updateBytes.byteLength} ts=${timestamp}`
    );
    if (updateBytes.byteLength === 0) {
      console.warn(
        `[SyncManager] WARNING: exporting an EMPTY update for group=${groupId}. Other devices will never see changes if this persists.`
      );
    }

    if (!this.isOnline) {
      // Queue for later
      console.log('[SyncManager] Offline - queueing update');
      this.offlineQueue.push(operation);
      await this.saveOfflineQueue();
      return;
    }

    try {
      // For PocketBase JSON fields, pass the actual object, not a stringified version
      // Convert Map to plain object if needed (Loro versions might be Maps)
      let versionObj: any = undefined;
      if (version) {
        if (version instanceof Map) {
          versionObj = Object.fromEntries(version);
        } else if (typeof version === 'object') {
          versionObj = version;
        }
      }
      console.log(`[SyncManager] pushUpdate data: groupId=${groupId}, actorId=${actorId}, updateData.length=${updateData.length}, version=${JSON.stringify(versionObj)}`);

      await this.apiClient.pushUpdate({
        groupId,
        timestamp,
        actorId,
        updateData,
        version: versionObj,
      });

      console.log(
        `[SyncManager] Update pushed successfully group=${groupId} actor=${actorId} bytes=${updateBytes.byteLength} ts=${timestamp}`
      );

      // Update last sync timestamp
      this.lastSyncTimestamp.set(groupId, timestamp);
    } catch (error) {
      console.error(
        `[SyncManager] Failed to push update group=${groupId} actor=${actorId} bytes=${updateBytes.byteLength}:`,
        error
      );
      // Log PocketBase error details if available
      if (error && typeof error === 'object' && 'data' in error) {
        console.error('[SyncManager] PocketBase error data:', JSON.stringify((error as any).data, null, 2));
      }
      if (error && typeof error === 'object' && 'response' in error) {
        console.error('[SyncManager] PocketBase response:', JSON.stringify((error as any).response, null, 2));
      }

      // Queue for retry
      this.offlineQueue.push(operation);
      await this.saveOfflineQueue();

      throw error;
    }
  }

  /**
   * Subscribe to real-time updates for a group
   */
  async subscribeToGroup(groupId: string, actorId: string): Promise<void> {
    if (!this.isOnline) {
      console.log('[SyncManager] Cannot subscribe while offline');
      return;
    }

    // Unsubscribe existing subscription (but don't remove from subscribedGroups)
    if (this.activeSubscriptions.has(groupId)) {
      const unsubscribe = this.activeSubscriptions.get(groupId);
      if (unsubscribe) {
        await unsubscribe();
      }
      this.activeSubscriptions.delete(groupId);
    }

    try {
      const unsubscribe = await this.apiClient.subscribeToUpdates(groupId, (update) => {
        // Ignore our own updates
        if (update.actorId === actorId) {
          console.log('[SyncManager] Ignoring own update');
          return;
        }

        console.log(`[SyncManager] Received real-time update from ${update.actorId}`);
        this.applyRemoteUpdate(update, actorId).catch((error) => {
          console.error('[SyncManager] Failed to apply real-time update:', error);
        });
      });

      this.activeSubscriptions.set(groupId, unsubscribe);
      this.subscribedGroups.set(groupId, actorId); // Track for re-subscription
      console.log(`[SyncManager] Subscribed to group ${groupId}`);

      // Start health check if not already running
      this.startHealthCheck();
    } catch (error) {
      this.handleError('Subscription failed', error);
    }
  }

  /**
   * Start periodic health check for subscriptions
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return; // Already running
    }

    // Check subscription health every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      if (!this.isOnline) {
        return;
      }

      // For each subscribed group, do an incremental sync to catch any missed updates
      for (const [groupId, actorId] of this.subscribedGroups) {
        try {
          console.log(`[SyncManager] Health check: incremental sync for group ${groupId}`);
          await this.incrementalSync(groupId, actorId);
        } catch (error) {
          console.warn(`[SyncManager] Health check sync failed for group ${groupId}:`, error);
        }
      }
    }, 30000); // 30 seconds

    console.log('[SyncManager] Started subscription health check');
  }

  /**
   * Stop the health check interval
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
      console.log('[SyncManager] Stopped subscription health check');
    }
  }

  /**
   * Unsubscribe from a group
   */
  async unsubscribeFromGroup(groupId: string): Promise<void> {
    const unsubscribe = this.activeSubscriptions.get(groupId);
    if (unsubscribe) {
      await unsubscribe();
      this.activeSubscriptions.delete(groupId);
      this.subscribedGroups.delete(groupId);
      console.log(`[SyncManager] Unsubscribed from group ${groupId}`);
    }

    // Stop health check if no more subscriptions
    if (this.subscribedGroups.size === 0) {
      this.stopHealthCheck();
    }
  }

  /**
   * Unsubscribe from all groups
   */
  async unsubscribeAll(): Promise<void> {
    for (const [groupId] of this.activeSubscriptions) {
      await this.unsubscribeFromGroup(groupId);
    }
    this.subscribedGroups.clear();
    this.stopHealthCheck();
  }

  /**
   * Force sync all queued operations (useful after coming back online)
   */
  async syncOfflineQueue(): Promise<void> {
    if (this.isSyncingQueue || this.offlineQueue.length === 0) {
      return;
    }

    if (!this.isOnline) {
      console.log('[SyncManager] Cannot sync queue while offline');
      return;
    }

    this.isSyncingQueue = true;
    console.log(`[SyncManager] Syncing ${this.offlineQueue.length} queued operations`);

    const failed: QueuedOperation[] = [];

    for (const operation of this.offlineQueue) {
      try {
        await this.apiClient.pushUpdate({
          groupId: operation.groupId,
          timestamp: operation.timestamp,
          actorId: operation.actorId,
          updateData: operation.updateData,
        });
      } catch (error) {
        console.error('[SyncManager] Failed to sync queued operation:', error);
        failed.push(operation);
      }
    }

    // Keep failed operations in queue
    this.offlineQueue = failed;
    await this.saveOfflineQueue();

    this.isSyncingQueue = false;
    console.log(`[SyncManager] Queue sync completed. ${failed.length} operations failed.`);
  }

  /**
   * Cleanup - unsubscribe and remove listeners
   */
  async destroy(): Promise<void> {
    this.stopHealthCheck();
    await this.unsubscribeAll();
    this.removeNetworkListeners();
  }

  // ==================== Private Methods ====================

  /**
   * Apply a remote update to the local Loro instance
   */
  private async applyRemoteUpdate(update: LoroUpdateRecord, _actorId: string): Promise<void> {
    try {
      // DEBUG: capture before/after snapshots to confirm the update actually changes state
      const beforeSnapshot = this.loroStore.exportSnapshot();
      const beforeSize = beforeSnapshot.byteLength;

      // Extra DEBUG: attempt to detect "view is stale" vs "import is a no-op"
      // by sampling snapshot bytes (head/tail) and a JSON representation if available.
      const beforeHead = Array.from(beforeSnapshot.slice(0, Math.min(16, beforeSnapshot.length)));
      const beforeTail = Array.from(
        beforeSnapshot.slice(Math.max(0, beforeSnapshot.length - 16), beforeSnapshot.length)
      );

      const updateBytes = PocketBaseClient.decodeUpdateData(update.updateData);
      console.log(
        `[SyncManager] applyRemoteUpdate(group=${update.groupId}) id=${update.id} from=${update.actorId} updateBytes=${updateBytes.byteLength} ts=${update.timestamp}`
      );

      if (updateBytes.byteLength === 0) {
        console.warn(
          `[SyncManager] WARNING: received an EMPTY remote update for group=${update.groupId} from=${update.actorId} (ts=${update.timestamp}).`
        );
      }

      // Log a small signature of the update bytes to spot duplicates/collisions.
      const updateSig = Array.from(updateBytes.slice(0, Math.min(12, updateBytes.length)));
      console.log(
        `[SyncManager] applyRemoteUpdate(group=${update.groupId}) updateSig(head12)=${JSON.stringify(updateSig)}`
      );

      // If we have seen this record id already, applying will likely be a no-op.
      // This helps diagnose duplicate delivery (e.g. applying from initialSync + subscription).
      const seen = this.appliedUpdateIds?.has(update.id) ?? false;
      if (seen) {
        console.warn(
          `[SyncManager] applyRemoteUpdate: update id=${update.id} already applied earlier; import likely no-op`
        );
      }

      this.loroStore.applyUpdate(updateBytes);

      const afterSnapshot = this.loroStore.exportSnapshot();
      const afterSize = afterSnapshot.byteLength;

      const afterHead = Array.from(afterSnapshot.slice(0, Math.min(16, afterSnapshot.length)));
      const afterTail = Array.from(
        afterSnapshot.slice(Math.max(0, afterSnapshot.length - 16), afterSnapshot.length)
      );

      const delta = afterSize - beforeSize;
      console.log(
        `[SyncManager] applyRemoteUpdate(group=${update.groupId}) snapshotBytes before=${beforeSize} after=${afterSize} delta=${delta}`
      );

      // If delta is zero, compare small snapshot signatures to tell whether bytes changed anyway.
      // (Size can remain equal even if content changes.)
      const headChanged = JSON.stringify(beforeHead) !== JSON.stringify(afterHead);
      const tailChanged = JSON.stringify(beforeTail) !== JSON.stringify(afterTail);

      if (delta === 0) {
        console.warn(
          `[SyncManager] applyRemoteUpdate(group=${update.groupId}) snapshotSizeUnchanged; headChanged=${headChanged} tailChanged=${tailChanged}`
        );
      }

      // Mark applied (for duplicate detection)
      if (this.appliedUpdateIds) {
        this.appliedUpdateIds.add(update.id);
      }

      // Update last sync timestamp
      this.lastSyncTimestamp.set(update.groupId, update.timestamp);

      // Save updated snapshot
      await this.saveSnapshot(update.groupId);

      console.log(`[SyncManager] Applied update from ${update.actorId}`);

      // Notify listeners that data has changed
      if (this.onUpdate) {
        await this.onUpdate(update.groupId);
      }
    } catch (error) {
      console.error('[SyncManager] Failed to apply remote update:', error);
      throw error;
    }
  }

  /**
   * Save Loro snapshot to storage
   */
  private async saveSnapshot(groupId: string): Promise<void> {
    try {
      const snapshot = this.loroStore.exportSnapshot();
      await this.storage.saveLoroSnapshot(groupId, snapshot);
      console.log('[SyncManager] Snapshot saved to storage');
    } catch (error) {
      console.error('[SyncManager] Failed to save snapshot:', error);
    }
  }

  /**
   * Set sync status
   */
  private setStatus(status: SyncStatus): void {
    this.status = status;
  }

  /**
   * Handle sync error
   */
  private handleError(message: string, error: unknown): void {
    this.lastError = `${message}: ${error}`;
    this.setStatus('error');
    console.error(`[SyncManager] ${this.lastError}`);
  }

  /**
   * Get the latest sync timestamp across all groups
   */
  private getLatestSyncTimestamp(): number | null {
    const timestamps = Array.from(this.lastSyncTimestamp.values());
    return timestamps.length > 0 ? Math.max(...timestamps) : null;
  }

  // ==================== Network Detection ====================

  /**
   * Set up online/offline event listeners
   */
  private setupNetworkListeners(): void {
    this.onlineListener = async () => {
      console.log('[SyncManager] Network online');
      this.isOnline = true;
      this.setStatus('idle');

      // Attempt to sync offline queue
      if (this.enableAutoSync) {
        try {
          await this.syncOfflineQueue();
        } catch (error) {
          console.error('[SyncManager] Failed to sync offline queue:', error);
        }
      }

      // Re-subscribe to all groups that were subscribed before going offline
      // This uses the subscribedGroups map which persists across offline periods
      for (const [groupId, actorId] of this.subscribedGroups) {
        console.log(`[SyncManager] Re-subscribing to group ${groupId} after coming online`);
        try {
          // First do an incremental sync to catch up on missed updates
          await this.incrementalSync(groupId, actorId);
          // Then re-establish real-time subscription
          await this.subscribeToGroup(groupId, actorId);
        } catch (error) {
          console.error(`[SyncManager] Failed to re-subscribe to group ${groupId}:`, error);
        }
      }
    };

    this.offlineListener = () => {
      console.log('[SyncManager] Network offline');
      this.isOnline = false;
      this.setStatus('offline');
      this.stopHealthCheck();

      // Note: We don't call unsubscribeAll() here because:
      // 1. It would clear subscribedGroups, losing track of what to re-subscribe to
      // 2. PocketBase subscriptions will naturally fail when offline
      // 3. When back online, we re-subscribe in the onlineListener
      // Instead, just clear the active subscription callbacks
      this.activeSubscriptions.clear();
    };

    window.addEventListener('online', this.onlineListener);
    window.addEventListener('offline', this.offlineListener);
  }

  /**
   * Remove network event listeners
   */
  private removeNetworkListeners(): void {
    if (this.onlineListener) {
      window.removeEventListener('online', this.onlineListener);
    }
    if (this.offlineListener) {
      window.removeEventListener('offline', this.offlineListener);
    }
  }

  // ==================== Offline Queue Persistence ====================

  /**
   * Load offline queue from IndexedDB
   */
  private async loadOfflineQueue(): Promise<void> {
    try {
      const operations = await this.storage.getQueuedOperations();
      this.offlineQueue = operations as QueuedOperation[];
      console.log(`[SyncManager] Loaded ${this.offlineQueue.length} queued operations`);
    } catch (error) {
      console.error('[SyncManager] Failed to load offline queue:', error);
    }
  }

  /**
   * Save offline queue to IndexedDB
   */
  private async saveOfflineQueue(): Promise<void> {
    try {
      // Clear existing queue
      await this.storage.clearQueuedOperations();

      // Save new queue
      for (const operation of this.offlineQueue) {
        await this.storage.queueOperation({
          type: 'loro_update',
          groupId: operation.groupId,
          data: operation,
          timestamp: operation.timestamp,
        });
      }

      console.log(`[SyncManager] Saved ${this.offlineQueue.length} operations to queue`);
    } catch (error) {
      console.error('[SyncManager] Failed to save offline queue:', error);
    }
  }
}
