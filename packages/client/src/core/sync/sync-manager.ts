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
 */

import type { LoroEntryStore } from '../crdt/loro-wrapper.js';
import type { PartageDB } from '../storage/indexeddb.js';
import { PocketBaseClient, type LoroUpdateRecord } from '../../api/pocketbase-client.js';

export interface SyncManagerConfig {
  loroStore: LoroEntryStore;
  storage: PartageDB;
  apiClient?: PocketBaseClient;
  enableAutoSync?: boolean;
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

  // Sync state
  private status: SyncStatus = 'idle';
  private isOnline: boolean = navigator.onLine;
  private lastSyncTimestamp: Map<string, number> = new Map(); // groupId -> timestamp
  private lastError: string | null = null;

  // Real-time subscriptions
  private activeSubscriptions: Map<string, () => void> = new Map();

  // Offline queue
  private offlineQueue: QueuedOperation[] = [];
  private isSyncingQueue: boolean = false;

  // Event listeners
  private onlineListener?: () => void;
  private offlineListener?: () => void;

  constructor(config: SyncManagerConfig) {
    this.loroStore = config.loroStore;
    this.storage = config.storage;
    this.apiClient = config.apiClient || new PocketBaseClient();
    this.enableAutoSync = config.enableAutoSync ?? true;

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
      console.log(`[SyncManager] Initial sync for group ${groupId}`);

      // Fetch all updates from the server
      const updates = await this.apiClient.fetchAllUpdates(groupId);
      console.log(`[SyncManager] Fetched ${updates.length} updates from server`);

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

    if (!this.isOnline) {
      // Queue for later
      console.log('[SyncManager] Offline - queueing update');
      this.offlineQueue.push(operation);
      await this.saveOfflineQueue();
      return;
    }

    try {
      await this.apiClient.pushUpdate({
        groupId,
        timestamp,
        actorId,
        updateData,
        version: PocketBaseClient.serializeVersion(version),
      });

      console.log('[SyncManager] Update pushed successfully');

      // Update last sync timestamp
      this.lastSyncTimestamp.set(groupId, timestamp);
    } catch (error) {
      console.error('[SyncManager] Failed to push update:', error);

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

    // Unsubscribe existing subscription
    if (this.activeSubscriptions.has(groupId)) {
      await this.unsubscribeFromGroup(groupId);
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
      console.log(`[SyncManager] Subscribed to group ${groupId}`);
    } catch (error) {
      this.handleError('Subscription failed', error);
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
      console.log(`[SyncManager] Unsubscribed from group ${groupId}`);
    }
  }

  /**
   * Unsubscribe from all groups
   */
  async unsubscribeAll(): Promise<void> {
    for (const [groupId] of this.activeSubscriptions) {
      await this.unsubscribeFromGroup(groupId);
    }
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
    await this.unsubscribeAll();
    this.removeNetworkListeners();
  }

  // ==================== Private Methods ====================

  /**
   * Apply a remote update to the local Loro instance
   */
  private async applyRemoteUpdate(update: LoroUpdateRecord, _actorId: string): Promise<void> {
    try {
      const updateBytes = PocketBaseClient.decodeUpdateData(update.updateData);
      this.loroStore.applyUpdate(updateBytes);

      // Update last sync timestamp
      this.lastSyncTimestamp.set(update.groupId, update.timestamp);

      console.log(`[SyncManager] Applied update from ${update.actorId}`);
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
    this.onlineListener = () => {
      console.log('[SyncManager] Network online');
      this.isOnline = true;
      this.setStatus('idle');

      // Attempt to sync offline queue
      if (this.enableAutoSync) {
        this.syncOfflineQueue().catch((error) => {
          console.error('[SyncManager] Failed to sync offline queue:', error);
        });
      }
    };

    this.offlineListener = () => {
      console.log('[SyncManager] Network offline');
      this.isOnline = false;
      this.setStatus('offline');

      // Unsubscribe from all real-time subscriptions
      this.unsubscribeAll().catch((error) => {
        console.error('[SyncManager] Failed to unsubscribe:', error);
      });
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
