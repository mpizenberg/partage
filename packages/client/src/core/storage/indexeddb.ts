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
  name: string;
  defaultCurrency: string;
  createdAt: number;
  createdBy: string;
  currentKeyVersion: number;
  settings: string; // JSON stringified
}

interface GroupKeyRecord {
  id: string; // `${groupId}:${version}`
  groupId: string;
  version: number;
  key: string; // Base64 encoded symmetric key
}

interface LoroSnapshotRecord {
  groupId: string;
  snapshot: Uint8Array;
  updatedAt: number;
}

interface PendingOperationRecord {
  id: string;
  groupId: string;
  operation: string; // JSON stringified
  createdAt: number;
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

        // Pending operations store
        if (!db.objectStoreNames.contains(STORES.PENDING_OPS)) {
          const pendingOpsStore = db.createObjectStore(STORES.PENDING_OPS, { keyPath: 'id' });
          pendingOpsStore.createIndex('groupId', 'groupId', { unique: false });
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
  async saveUserKeypair(keypair: SerializedKeypair, signingKeypair?: {
    publicKey: string;
    privateKey: string;
  }): Promise<void> {
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
      name: group.name,
      defaultCurrency: group.defaultCurrency,
      createdAt: group.createdAt,
      createdBy: group.createdBy,
      currentKeyVersion: group.currentKeyVersion,
      settings: JSON.stringify(group.settings),
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
      name: record.name,
      defaultCurrency: record.defaultCurrency,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      currentKeyVersion: record.currentKeyVersion,
      settings: JSON.parse(record.settings),
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
      name: record.name,
      defaultCurrency: record.defaultCurrency,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      currentKeyVersion: record.currentKeyVersion,
      settings: JSON.parse(record.settings),
    }));
  }

  /**
   * Delete a group
   */
  async deleteGroup(groupId: string): Promise<void> {
    await this.ensureOpen();

    const transaction = this.db!.transaction(
      [STORES.GROUPS, STORES.GROUP_KEYS, STORES.LORO_SNAPSHOTS, STORES.PENDING_OPS],
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
   * Save a group key with version
   */
  async saveGroupKey(groupId: string, version: number, keyString: string): Promise<void> {
    await this.ensureOpen();

    const record: GroupKeyRecord = {
      id: `${groupId}:${version}`,
      groupId,
      version,
      key: keyString,
    };

    return this.put(STORES.GROUP_KEYS, record);
  }

  /**
   * Get a specific group key version
   */
  async getGroupKey(groupId: string, version: number): Promise<string | null> {
    await this.ensureOpen();

    const record = await this.get<GroupKeyRecord>(STORES.GROUP_KEYS, `${groupId}:${version}`);
    return record?.key ?? null;
  }

  /**
   * Get all key versions for a group
   */
  async getAllGroupKeys(groupId: string): Promise<Map<number, string>> {
    await this.ensureOpen();

    const records = await this.getAllFromIndex<GroupKeyRecord>(
      STORES.GROUP_KEYS,
      'groupId',
      groupId
    );

    const keys = new Map<number, string>();
    for (const record of records) {
      keys.set(record.version, record.key);
    }

    return keys;
  }

  // Loro Snapshots Management

  /**
   * Save Loro CRDT snapshot for a group
   */
  async saveLoroSnapshot(groupId: string, snapshot: Uint8Array): Promise<void> {
    await this.ensureOpen();

    const record: LoroSnapshotRecord = {
      groupId,
      snapshot,
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
