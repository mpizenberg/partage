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
const DB_NAME = STORAGE_CONFIG.DB_NAME;
const DB_VERSION = STORAGE_CONFIG.DB_VERSION;
// Object store names
const STORES = {
    IDENTITY: 'identity',
    GROUPS: 'groups',
    GROUP_KEYS: 'groupKeys',
    LORO_SNAPSHOTS: 'loroSnapshots',
    PENDING_OPS: 'pendingOperations',
};
/**
 * PartageDB - IndexedDB wrapper for Partage
 */
export class PartageDB {
    db = null;
    /**
     * Open database connection
     */
    async open() {
        if (this.db)
            return;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
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
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
    /**
     * Delete the entire database (for testing)
     */
    static async deleteDatabase() {
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
    async saveUserKeypair(keypair, signingKeypair) {
        await this.ensureOpen();
        const record = {
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
    async getUserKeypair() {
        await this.ensureOpen();
        const record = await this.get(STORES.IDENTITY, 'user');
        if (!record)
            return null;
        const keypair = {
            publicKey: record.publicKey,
            privateKey: record.privateKey,
            publicKeyHash: record.publicKeyHash,
        };
        const signingKeypair = record.signingPublicKey && record.signingPrivateKey
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
    async saveGroup(group) {
        await this.ensureOpen();
        const record = {
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
    async getGroup(groupId) {
        await this.ensureOpen();
        const record = await this.get(STORES.GROUPS, groupId);
        if (!record)
            return null;
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
    async getAllGroups() {
        await this.ensureOpen();
        const records = await this.getAll(STORES.GROUPS);
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
    async deleteGroup(groupId) {
        await this.ensureOpen();
        const transaction = this.db.transaction([STORES.GROUPS, STORES.GROUP_KEYS, STORES.LORO_SNAPSHOTS, STORES.PENDING_OPS], 'readwrite');
        // Delete group
        transaction.objectStore(STORES.GROUPS).delete(groupId);
        // Delete all group keys
        const groupKeysStore = transaction.objectStore(STORES.GROUP_KEYS);
        const groupKeysIndex = groupKeysStore.index('groupId');
        const keysCursor = groupKeysIndex.openCursor(IDBKeyRange.only(groupId));
        keysCursor.onsuccess = (event) => {
            const cursor = event.target.result;
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
            const cursor = event.target.result;
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
    async saveGroupKey(groupId, version, keyString) {
        await this.ensureOpen();
        const record = {
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
    async getGroupKey(groupId, version) {
        await this.ensureOpen();
        const record = await this.get(STORES.GROUP_KEYS, `${groupId}:${version}`);
        return record?.key ?? null;
    }
    /**
     * Get all key versions for a group
     */
    async getAllGroupKeys(groupId) {
        await this.ensureOpen();
        const records = await this.getAllFromIndex(STORES.GROUP_KEYS, 'groupId', groupId);
        const keys = new Map();
        for (const record of records) {
            keys.set(record.version, record.key);
        }
        return keys;
    }
    // Loro Snapshots Management
    /**
     * Save Loro CRDT snapshot for a group
     */
    async saveLoroSnapshot(groupId, snapshot) {
        await this.ensureOpen();
        const record = {
            groupId,
            snapshot,
            updatedAt: Date.now(),
        };
        return this.put(STORES.LORO_SNAPSHOTS, record);
    }
    /**
     * Get Loro snapshot for a group
     */
    async getLoroSnapshot(groupId) {
        await this.ensureOpen();
        const record = await this.get(STORES.LORO_SNAPSHOTS, groupId);
        return record?.snapshot ?? null;
    }
    // Pending Operations Management
    /**
     * Save a pending operation (for offline sync)
     */
    async savePendingOperation(groupId, operationId, operation) {
        await this.ensureOpen();
        const record = {
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
    async getPendingOperations(groupId) {
        await this.ensureOpen();
        const records = await this.getAllFromIndex(STORES.PENDING_OPS, 'groupId', groupId);
        return records.map((record) => ({
            id: record.id,
            operation: JSON.parse(record.operation),
        }));
    }
    /**
     * Clear a pending operation (after successful sync)
     */
    async clearPendingOperation(operationId) {
        await this.ensureOpen();
        return this.delete(STORES.PENDING_OPS, operationId);
    }
    /**
     * Clear all pending operations for a group
     */
    async clearAllPendingOperations(groupId) {
        await this.ensureOpen();
        const transaction = this.db.transaction(STORES.PENDING_OPS, 'readwrite');
        const store = transaction.objectStore(STORES.PENDING_OPS);
        const index = store.index('groupId');
        const request = index.openCursor(IDBKeyRange.only(groupId));
        request.onsuccess = (event) => {
            const cursor = event.target.result;
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
    async ensureOpen() {
        if (!this.db) {
            await this.open();
        }
    }
    get(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    getAll(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    getAllFromIndex(storeName, indexName, query) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(query);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    put(storeName, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(value);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}
// Singleton instance
let dbInstance = null;
/**
 * Get the singleton database instance
 */
export function getDB() {
    if (!dbInstance) {
        dbInstance = new PartageDB();
    }
    return dbInstance;
}
