/**
 * IndexedDB storage layer for Partage
 * Handles persistent storage of:
 * - User keypairs
 * - Group metadata
 * - Group keys (versioned)
 * - Loro CRDT snapshots
 * - Pending sync operations
 */

import { STORAGE_CONFIG } from '@partage/shared';
import type { SerializedKeypair, Group } from '@partage/shared';

const DB_NAME = STORAGE_CONFIG.DB_NAME;
const DB_VERSION = STORAGE_CONFIG.DB_VERSION;

// Object store names
const STORES = {
  IDENTITY: 'identity',
  GROUPS: 'groups',
  GROUP_KEYS: 'groupKeys',
  LORO_SNAPSHOTS: 'loroSnapshots',
  PENDING_OPS: 'pendingOperations',
  SW_NOTIFICATION_STATE: 'swNotificationState',
  USAGE_STATS: 'usageStats',
} as const;

// Database schema interfaces
interface IdentityRecord {
  id: 'user'; // Singleton
  publicKey: string;
  privateKey: string;
  publicKeyHash: string;
  signingPublicKey?: string;
  signingPrivateKey?: string;
}

interface GroupRecord {
  id: string;
  // name removed - now stored in encrypted GroupMetadataState
  defaultCurrency: string;
  createdAt: number;
  createdBy: string;
  currentKeyVersion: number;
  settings: string; // JSON stringified
  members?: string; // JSON stringified Member[]
}

interface GroupKeyRecord {
  id: string; // groupId (single key per group, no versioning)
  groupId: string;
  key: string; // Base64 encoded symmetric key
}

interface LoroSnapshotRecord {
  groupId: string;
  snapshot: Uint8Array;
  version: any; // Loro version vector
  updatedAt: number;
}

interface LoroIncrementalUpdateRecord {
  id: string; // `${groupId}:${sequence.toString().padStart(8, '0')}`
  groupId: string;
  updateData: Uint8Array; // Binary, NOT Base64
  version: any; // Loro version vector
  timestamp: number;
  sequence: number; // Auto-increment per group
}

interface PendingOperationRecord {
  id: string;
  groupId: string;
  operation: string; // JSON stringified
  createdAt: number;
}

interface UsageStatsRecord {
  id: 'usage'; // Singleton
  totalBytesTransferred: number;
  trackingSince: number;
  lastStorageEstimateTimestamp: number | null;
  lastStorageEstimateSizeBytes: number | null;
  totalStorageCost: number; // Accumulated storage cost over time (USD)
}

/**
 * PartageDB - IndexedDB wrapper for Partage
 */
export class PartageDB {
  private db: IDBDatabase | null = null;

  /**
   * Open database connection
   */
  async open(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Identity store (singleton)
        if (!db.objectStoreNames.contains(STORES.IDENTITY)) {
          db.createObjectStore(STORES.IDENTITY, { keyPath: 'id' });
        }

        // Groups store
        if (!db.objectStoreNames.contains(STORES.GROUPS)) {
          db.createObjectStore(STORES.GROUPS, { keyPath: 'id' });
        }

        // Group keys store (versioned)
        if (!db.objectStoreNames.contains(STORES.GROUP_KEYS)) {
          const groupKeysStore = db.createObjectStore(STORES.GROUP_KEYS, { keyPath: 'id' });
          groupKeysStore.createIndex('groupId', 'groupId', { unique: false });
        }

        // Loro snapshots store
        if (!db.objectStoreNames.contains(STORES.LORO_SNAPSHOTS)) {
          db.createObjectStore(STORES.LORO_SNAPSHOTS, { keyPath: 'groupId' });
        }

        // Loro incremental updates store (NEW - for performance optimization)
        if (!db.objectStoreNames.contains('loroIncrementalUpdates')) {
          const incrementalStore = db.createObjectStore('loroIncrementalUpdates', {
            keyPath: 'id',
          });
          incrementalStore.createIndex('groupId', 'groupId', { unique: false });
          incrementalStore.createIndex('groupId_sequence', ['groupId', 'sequence'], {
            unique: true,
          });
        }

        // Pending operations store
        if (!db.objectStoreNames.contains(STORES.PENDING_OPS)) {
          const pendingOpsStore = db.createObjectStore(STORES.PENDING_OPS, { keyPath: 'id' });
          pendingOpsStore.createIndex('groupId', 'groupId', { unique: false });
        }

        // Service worker notification state store (for background sync)
        if (!db.objectStoreNames.contains(STORES.SW_NOTIFICATION_STATE)) {
          db.createObjectStore(STORES.SW_NOTIFICATION_STATE, { keyPath: 'id' });
        }

        // Usage stats store (singleton)
        if (!db.objectStoreNames.contains(STORES.USAGE_STATS)) {
          db.createObjectStore(STORES.USAGE_STATS, { keyPath: 'id' });
        }
      };
    });
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Delete the entire database (for testing)
   */
  static async deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Identity Management

  /**
   * Save user keypair to storage
   */
  async saveUserKeypair(
    keypair: SerializedKeypair,
    signingKeypair?: {
      publicKey: string;
      privateKey: string;
    }
  ): Promise<void> {
    await this.ensureOpen();

    const record: IdentityRecord = {
      id: 'user',
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      publicKeyHash: keypair.publicKeyHash,
      signingPublicKey: signingKeypair?.publicKey,
      signingPrivateKey: signingKeypair?.privateKey,
    };

    return this.put(STORES.IDENTITY, record);
  }

  /**
   * Get user keypair from storage
   */
  async getUserKeypair(): Promise<{
    keypair: SerializedKeypair;
    signingKeypair?: { publicKey: string; privateKey: string };
  } | null> {
    await this.ensureOpen();

    const record = await this.get<IdentityRecord>(STORES.IDENTITY, 'user');
    if (!record) return null;

    const keypair: SerializedKeypair = {
      publicKey: record.publicKey,
      privateKey: record.privateKey,
      publicKeyHash: record.publicKeyHash,
    };

    const signingKeypair =
      record.signingPublicKey && record.signingPrivateKey
        ? {
            publicKey: record.signingPublicKey,
            privateKey: record.signingPrivateKey,
          }
        : undefined;

    return { keypair, signingKeypair };
  }

  // Group Management

  /**
   * Save group metadata
   */
  async saveGroup(group: Group): Promise<void> {
    await this.ensureOpen();

    const record: GroupRecord = {
      id: group.id,
      defaultCurrency: group.defaultCurrency,
      createdAt: group.createdAt,
      createdBy: group.createdBy,
      currentKeyVersion: group.currentKeyVersion,
      settings: JSON.stringify(group.settings),
      members: group.activeMembers ? JSON.stringify(group.activeMembers) : undefined,
    };

    return this.put(STORES.GROUPS, record);
  }

  /**
   * Get group by ID
   */
  async getGroup(groupId: string): Promise<Group | null> {
    await this.ensureOpen();

    const record = await this.get<GroupRecord>(STORES.GROUPS, groupId);
    if (!record) return null;

    return {
      id: record.id,
      defaultCurrency: record.defaultCurrency,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      currentKeyVersion: record.currentKeyVersion,
      settings: JSON.parse(record.settings),
      activeMembers: record.members ? JSON.parse(record.members) : undefined,
    };
  }

  /**
   * Get all groups
   */
  async getAllGroups(): Promise<Group[]> {
    await this.ensureOpen();

    const records = await this.getAll<GroupRecord>(STORES.GROUPS);
    return records.map((record) => ({
      id: record.id,
      defaultCurrency: record.defaultCurrency,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      currentKeyVersion: record.currentKeyVersion,
      settings: JSON.parse(record.settings),
      activeMembers: record.members ? JSON.parse(record.members) : undefined,
    }));
  }

  /**
   * Delete a group
   */
  async deleteGroup(groupId: string): Promise<void> {
    await this.ensureOpen();

    const transaction = this.db!.transaction(
      [
        STORES.GROUPS,
        STORES.GROUP_KEYS,
        STORES.LORO_SNAPSHOTS,
        'loroIncrementalUpdates',
        STORES.PENDING_OPS,
      ],
      'readwrite'
    );

    // Delete group
    transaction.objectStore(STORES.GROUPS).delete(groupId);

    // Delete all group keys
    const groupKeysStore = transaction.objectStore(STORES.GROUP_KEYS);
    const groupKeysIndex = groupKeysStore.index('groupId');
    const keysCursor = groupKeysIndex.openCursor(IDBKeyRange.only(groupId));
    keysCursor.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    // Delete Loro snapshot
    transaction.objectStore(STORES.LORO_SNAPSHOTS).delete(groupId);

    // Delete incremental updates
    const incrementalStore = transaction.objectStore('loroIncrementalUpdates');
    const incrementalIndex = incrementalStore.index('groupId');
    const incrementalCursor = incrementalIndex.openCursor(IDBKeyRange.only(groupId));
    incrementalCursor.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    // Delete pending operations
    const pendingOpsStore = transaction.objectStore(STORES.PENDING_OPS);
    const pendingOpsIndex = pendingOpsStore.index('groupId');
    const opsCursor = pendingOpsIndex.openCursor(IDBKeyRange.only(groupId));
    opsCursor.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Group Keys Management

  /**
   * Save a group key (single key per group, no versioning)
   */
  async saveGroupKey(groupId: string, keyString: string): Promise<void> {
    await this.ensureOpen();

    const record: GroupKeyRecord = {
      id: groupId,
      groupId,
      key: keyString,
    };

    return this.put(STORES.GROUP_KEYS, record);
  }

  /**
   * Get the group key (single key per group)
   */
  async getGroupKey(groupId: string): Promise<string | null> {
    await this.ensureOpen();

    const record = await this.get<GroupKeyRecord>(STORES.GROUP_KEYS, groupId);
    return record?.key ?? null;
  }

  // Loro Snapshots Management

  /**
   * Save Loro CRDT snapshot for a group
   */
  async saveLoroSnapshot(groupId: string, snapshot: Uint8Array, version?: any): Promise<void> {
    await this.ensureOpen();

    const record: LoroSnapshotRecord = {
      groupId,
      snapshot,
      version: version ?? null,
      updatedAt: Date.now(),
    };

    return this.put(STORES.LORO_SNAPSHOTS, record);
  }

  /**
   * Get Loro snapshot for a group
   */
  async getLoroSnapshot(groupId: string): Promise<Uint8Array | null> {
    await this.ensureOpen();

    const record = await this.get<LoroSnapshotRecord>(STORES.LORO_SNAPSHOTS, groupId);
    return record?.snapshot ?? null;
  }

  // Loro Incremental Updates Management

  /**
   * Get next sequence number for a group (max + 1)
   */
  private async getNextIncrementalSequence(groupId: string): Promise<number> {
    const records = await this.getAllFromIndex<LoroIncrementalUpdateRecord>(
      'loroIncrementalUpdates',
      'groupId',
      groupId
    );

    if (records.length === 0) return 1;

    const maxSequence = Math.max(...records.map((r) => r.sequence));
    return maxSequence + 1;
  }

  /**
   * Save incremental update with auto-incrementing sequence
   */
  async saveLoroIncrementalUpdate(
    groupId: string,
    updateData: Uint8Array,
    version: any
  ): Promise<void> {
    await this.ensureOpen();

    const sequence = await this.getNextIncrementalSequence(groupId);
    const id = `${groupId}:${sequence.toString().padStart(8, '0')}`;

    const record: LoroIncrementalUpdateRecord = {
      id,
      groupId,
      updateData,
      version,
      timestamp: Date.now(),
      sequence,
    };

    return this.put('loroIncrementalUpdates', record);
  }

  /**
   * Get all incremental updates for a group (ordered by sequence)
   */
  async getLoroIncrementalUpdates(groupId: string): Promise<LoroIncrementalUpdateRecord[]> {
    await this.ensureOpen();

    const records = await this.getAllFromIndex<LoroIncrementalUpdateRecord>(
      'loroIncrementalUpdates',
      'groupId',
      groupId
    );

    // Sort by sequence (should already be in order, but ensure it)
    return records.sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Count incremental updates for a group (fast index query)
   */
  async getLoroIncrementalUpdateCount(groupId: string): Promise<number> {
    await this.ensureOpen();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction('loroIncrementalUpdates', 'readonly');
      const store = transaction.objectStore('loroIncrementalUpdates');
      const index = store.index('groupId');
      const request = index.count(IDBKeyRange.only(groupId));

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all incremental updates for a group (after consolidation)
   */
  async clearLoroIncrementalUpdates(groupId: string): Promise<void> {
    await this.ensureOpen();

    const transaction = this.db!.transaction('loroIncrementalUpdates', 'readwrite');
    const store = transaction.objectStore('loroIncrementalUpdates');
    const index = store.index('groupId');
    const request = index.openCursor(IDBKeyRange.only(groupId));

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Pending Operations Management

  /**
   * Save a pending operation (for offline sync)
   */
  async savePendingOperation(
    groupId: string,
    operationId: string,
    operation: unknown
  ): Promise<void> {
    await this.ensureOpen();

    const record: PendingOperationRecord = {
      id: operationId,
      groupId,
      operation: JSON.stringify(operation),
      createdAt: Date.now(),
    };

    return this.put(STORES.PENDING_OPS, record);
  }

  /**
   * Get all pending operations for a group
   */
  async getPendingOperations(groupId: string): Promise<Array<{ id: string; operation: unknown }>> {
    await this.ensureOpen();

    const records = await this.getAllFromIndex<PendingOperationRecord>(
      STORES.PENDING_OPS,
      'groupId',
      groupId
    );

    return records.map((record) => ({
      id: record.id,
      operation: JSON.parse(record.operation),
    }));
  }

  /**
   * Clear a pending operation (after successful sync)
   */
  async clearPendingOperation(operationId: string): Promise<void> {
    await this.ensureOpen();

    return this.delete(STORES.PENDING_OPS, operationId);
  }

  /**
   * Clear all pending operations for a group
   */
  async clearAllPendingOperations(groupId: string): Promise<void> {
    await this.ensureOpen();

    const transaction = this.db!.transaction(STORES.PENDING_OPS, 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_OPS);
    const index = store.index('groupId');
    const request = index.openCursor(IDBKeyRange.only(groupId));

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Queue an operation (alias for savePendingOperation with automatic ID)
   */
  async queueOperation(operation: {
    type: string;
    groupId: string;
    data: unknown;
    timestamp: number;
  }): Promise<void> {
    const operationId = `${operation.type}_${operation.timestamp}_${crypto.randomUUID()}`;
    return this.savePendingOperation(operation.groupId, operationId, operation);
  }

  /**
   * Get all queued operations (all groups)
   */
  async getQueuedOperations(): Promise<Array<unknown>> {
    await this.ensureOpen();

    const records = await this.getAll<PendingOperationRecord>(STORES.PENDING_OPS);
    return records.map((record) => JSON.parse(record.operation));
  }

  /**
   * Clear all queued operations (all groups)
   */
  async clearQueuedOperations(): Promise<void> {
    await this.ensureOpen();

    const transaction = this.db!.transaction(STORES.PENDING_OPS, 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_OPS);
    const request = store.clear();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Replace all queued operations atomically (clear + batch write in single transaction)
   * This is more efficient than clear() + multiple queueOperation() calls
   */
  async replaceQueuedOperations(
    operations: Array<{
      type: string;
      groupId: string;
      data: unknown;
      timestamp: number;
    }>
  ): Promise<void> {
    await this.ensureOpen();

    const transaction = this.db!.transaction(STORES.PENDING_OPS, 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_OPS);

    // Clear existing operations first
    store.clear();

    // Add all new operations in the same transaction
    for (const operation of operations) {
      const operationId = `${operation.type}_${operation.timestamp}_${crypto.randomUUID()}`;
      const record: PendingOperationRecord = {
        id: operationId,
        groupId: operation.groupId,
        operation: JSON.stringify(operation),
        createdAt: Date.now(),
      };
      store.put(record);
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Usage Stats Management

  /**
   * Get usage stats (singleton)
   */
  async getUsageStats(): Promise<UsageStatsRecord | null> {
    await this.ensureOpen();

    const record = await this.get<UsageStatsRecord>(STORES.USAGE_STATS, 'usage');
    return record ?? null;
  }

  /**
   * Save usage stats
   */
  async saveUsageStats(stats: Omit<UsageStatsRecord, 'id'>): Promise<void> {
    await this.ensureOpen();

    const record: UsageStatsRecord = {
      id: 'usage',
      ...stats,
    };

    return this.put(STORES.USAGE_STATS, record);
  }

  // Generic IndexedDB operations

  private async ensureOpen(): Promise<void> {
    if (!this.db) {
      await this.open();
    }
  }

  private get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private getAll<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private getAllFromIndex<T>(
    storeName: string,
    indexName: string,
    query: IDBValidKey
  ): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(query);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private put<T>(storeName: string, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private delete(storeName: string, key: IDBValidKey): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

// Singleton instance
let dbInstance: PartageDB | null = null;

/**
 * Get the singleton database instance
 */
export function getDB(): PartageDB {
  if (!dbInstance) {
    dbInstance = new PartageDB();
  }
  return dbInstance;
}
