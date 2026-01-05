/**
 * Loro CRDT wrapper with two-layer encryption
 *
 * Architecture:
 * - Layer 1 (Loro/Unencrypted): Metadata (id, timestamp, actor, version)
 * - Layer 2 (Encrypted): Sensitive entry data (description, amounts, members)
 *
 * This allows:
 * - Server to relay CRDT operations without seeing sensitive content
 * - Efficient CRDT conflict resolution on metadata
 * - End-to-end encryption of actual entry details
 */
import { Loro, LoroMap } from 'loro-crdt';
import { encryptJSON, decryptJSON } from '../crypto/symmetric.js';
/**
 * Loro CRDT wrapper for encrypted entry management
 */
export class LoroEntryStore {
    loro;
    entries;
    constructor() {
        this.loro = new Loro();
        this.entries = this.loro.getMap('entries');
    }
    /**
     * Create a new entry (expense or transfer)
     */
    async createEntry(entry, groupKey, _actorId) {
        // Separate metadata from payload
        const { metadata, payload } = this.splitEntry(entry);
        // Encrypt the sensitive payload
        const encrypted = await encryptJSON(payload, groupKey);
        const encryptedPayload = this.serializeEncryptedData(encrypted);
        // Store metadata + encrypted payload in Loro
        const entryMetadata = {
            ...metadata,
            encryptedPayload,
        };
        // Use Loro map to store the entry
        const entryMap = this.entries.setContainer(entry.id, new LoroMap());
        this.setMetadataInMap(entryMap, entryMetadata);
    }
    /**
     * Modify an existing entry (creates new version)
     */
    async modifyEntry(originalId, updatedEntry, groupKey, actorId) {
        // Create a new entry with version incremented
        const newEntry = {
            ...updatedEntry,
            previousVersionId: originalId,
            modifiedAt: Date.now(),
            modifiedBy: actorId,
        };
        await this.createEntry(newEntry, groupKey, actorId);
    }
    /**
     * Soft delete an entry
     */
    async deleteEntry(entryId, actorId, groupKey, reason) {
        const entry = await this.getEntry(entryId, groupKey);
        if (!entry) {
            throw new Error(`Entry ${entryId} not found`);
        }
        // Mark as deleted in metadata
        const entryMap = this.entries.get(entryId);
        if (entryMap && entryMap instanceof LoroMap) {
            entryMap.set('status', 'deleted');
            entryMap.set('deletedAt', Date.now());
            entryMap.set('deletedBy', actorId);
            // If there's a deletion reason, we need to re-encrypt the payload with it
            if (reason) {
                const { payload } = this.splitEntry(entry);
                const updatedPayload = { ...payload, deletionReason: reason };
                const encrypted = await encryptJSON(updatedPayload, groupKey);
                const encryptedPayload = this.serializeEncryptedData(encrypted);
                entryMap.set('encryptedPayload', encryptedPayload);
            }
        }
    }
    /**
     * Get a single entry by ID
     */
    async getEntry(entryId, groupKey) {
        const entryMap = this.entries.get(entryId);
        if (!entryMap || !(entryMap instanceof LoroMap)) {
            return null;
        }
        const metadata = this.getMetadataFromMap(entryMap);
        const payload = await this.decryptPayload(metadata.encryptedPayload, groupKey);
        return this.mergeEntry(metadata, payload);
    }
    /**
     * Get all active entries for a group
     */
    async getAllEntries(groupId, groupKey) {
        const allEntries = [];
        const entriesObj = this.entries.toJSON();
        for (const [entryId, _] of Object.entries(entriesObj)) {
            const entry = await this.getEntry(entryId, groupKey);
            if (entry && entry.groupId === groupId) {
                allEntries.push(entry);
            }
        }
        return allEntries;
    }
    /**
     * Get all active (non-deleted) entries
     */
    async getActiveEntries(groupId, groupKey) {
        const allEntries = await this.getAllEntries(groupId, groupKey);
        return allEntries.filter((entry) => entry.status === 'active');
    }
    /**
     * Export Loro snapshot as bytes (for storage/sync)
     */
    exportSnapshot() {
        return this.loro.export({ mode: 'snapshot' });
    }
    /**
     * Import Loro snapshot from bytes
     */
    importSnapshot(snapshot) {
        this.loro.import(snapshot);
        this.entries = this.loro.getMap('entries');
    }
    /**
     * Get the current Loro version (for sync)
     */
    getVersion() {
        return this.loro.oplogVersion();
    }
    /**
     * Apply updates from another Loro instance
     */
    applyUpdate(update) {
        this.loro.import(update);
    }
    /**
     * Export updates since a given version (for incremental sync)
     */
    exportFrom(version) {
        return this.loro.export({ mode: 'update', from: version });
    }
    // ==================== Private Helper Methods ====================
    /**
     * Split an entry into metadata and encrypted payload
     */
    splitEntry(entry) {
        const metadata = {
            id: entry.id,
            groupId: entry.groupId,
            type: entry.type,
            version: entry.version,
            previousVersionId: entry.previousVersionId,
            createdAt: entry.createdAt,
            createdBy: entry.createdBy,
            modifiedAt: entry.modifiedAt,
            modifiedBy: entry.modifiedBy,
            deletedAt: entry.deletedAt,
            deletedBy: entry.deletedBy,
            status: entry.status,
        };
        let payload;
        if (entry.type === 'expense') {
            const expenseEntry = entry;
            payload = {
                description: expenseEntry.description,
                category: expenseEntry.category,
                location: expenseEntry.location,
                amount: expenseEntry.amount,
                currency: expenseEntry.currency,
                defaultCurrencyAmount: expenseEntry.defaultCurrencyAmount,
                exchangeRate: expenseEntry.exchangeRate,
                date: expenseEntry.date,
                notes: expenseEntry.notes,
                payers: expenseEntry.payers,
                beneficiaries: expenseEntry.beneficiaries,
                deletionReason: expenseEntry.deletionReason,
            };
        }
        else {
            const transferEntry = entry;
            payload = {
                from: transferEntry.from,
                to: transferEntry.to,
                amount: transferEntry.amount,
                currency: transferEntry.currency,
                defaultCurrencyAmount: transferEntry.defaultCurrencyAmount,
                exchangeRate: transferEntry.exchangeRate,
                date: transferEntry.date,
                notes: transferEntry.notes,
                deletionReason: transferEntry.deletionReason,
            };
        }
        return { metadata, payload };
    }
    /**
     * Merge metadata and decrypted payload back into Entry
     */
    mergeEntry(metadata, payload) {
        const base = {
            id: metadata.id,
            groupId: metadata.groupId,
            version: metadata.version,
            previousVersionId: metadata.previousVersionId,
            createdAt: metadata.createdAt,
            createdBy: metadata.createdBy,
            modifiedAt: metadata.modifiedAt,
            modifiedBy: metadata.modifiedBy,
            deletedAt: metadata.deletedAt,
            deletedBy: metadata.deletedBy,
            status: metadata.status,
            amount: payload.amount,
            currency: payload.currency,
            defaultCurrencyAmount: payload.defaultCurrencyAmount,
            exchangeRate: payload.exchangeRate,
            date: payload.date,
            notes: payload.notes,
            deletionReason: payload.deletionReason,
        };
        if (metadata.type === 'expense') {
            const expensePayload = payload;
            return {
                ...base,
                type: 'expense',
                description: expensePayload.description,
                category: expensePayload.category,
                location: expensePayload.location,
                payers: expensePayload.payers,
                beneficiaries: expensePayload.beneficiaries,
            };
        }
        else {
            const transferPayload = payload;
            return {
                ...base,
                type: 'transfer',
                from: transferPayload.from,
                to: transferPayload.to,
            };
        }
    }
    /**
     * Serialize encrypted data to Base64 string
     */
    serializeEncryptedData(encrypted) {
        const combined = {
            ciphertext: Array.from(encrypted.ciphertext),
            iv: Array.from(encrypted.iv),
        };
        return btoa(JSON.stringify(combined));
    }
    /**
     * Deserialize encrypted data from Base64 string
     */
    deserializeEncryptedData(serialized) {
        const parsed = JSON.parse(atob(serialized));
        return {
            ciphertext: new Uint8Array(parsed.ciphertext),
            iv: new Uint8Array(parsed.iv),
        };
    }
    /**
     * Decrypt an encrypted payload
     */
    async decryptPayload(encryptedPayload, groupKey) {
        const encrypted = this.deserializeEncryptedData(encryptedPayload);
        return await decryptJSON(encrypted, groupKey);
    }
    /**
     * Set metadata in a Loro map
     */
    setMetadataInMap(map, metadata) {
        map.set('id', metadata.id);
        map.set('groupId', metadata.groupId);
        map.set('type', metadata.type);
        map.set('version', metadata.version);
        if (metadata.previousVersionId)
            map.set('previousVersionId', metadata.previousVersionId);
        map.set('createdAt', metadata.createdAt);
        map.set('createdBy', metadata.createdBy);
        if (metadata.modifiedAt)
            map.set('modifiedAt', metadata.modifiedAt);
        if (metadata.modifiedBy)
            map.set('modifiedBy', metadata.modifiedBy);
        if (metadata.deletedAt)
            map.set('deletedAt', metadata.deletedAt);
        if (metadata.deletedBy)
            map.set('deletedBy', metadata.deletedBy);
        map.set('status', metadata.status);
        map.set('encryptedPayload', metadata.encryptedPayload);
    }
    /**
     * Get metadata from a Loro map
     */
    getMetadataFromMap(map) {
        const obj = map.toJSON();
        return {
            id: obj.id,
            groupId: obj.groupId,
            type: obj.type,
            version: obj.version,
            previousVersionId: obj.previousVersionId,
            createdAt: obj.createdAt,
            createdBy: obj.createdBy,
            modifiedAt: obj.modifiedAt,
            modifiedBy: obj.modifiedBy,
            deletedAt: obj.deletedAt,
            deletedBy: obj.deletedBy,
            status: obj.status,
            encryptedPayload: obj.encryptedPayload,
        };
    }
}
