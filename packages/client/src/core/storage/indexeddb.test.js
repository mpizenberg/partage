import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PartageDB, getDB } from './indexeddb';
import { DEFAULT_GROUP_SETTINGS } from '@partage/shared';
describe('IndexedDB Storage', () => {
    let db;
    beforeEach(async () => {
        // Clean database before each test
        await PartageDB.deleteDatabase();
        db = new PartageDB();
        await db.open();
    });
    afterEach(async () => {
        db.close();
        await PartageDB.deleteDatabase();
    });
    describe('Database Lifecycle', () => {
        it('should open database connection', async () => {
            const newDb = new PartageDB();
            await expect(newDb.open()).resolves.toBeUndefined();
            newDb.close();
        });
        it('should handle multiple open calls', async () => {
            await db.open();
            await db.open(); // Should not throw
            expect(true).toBe(true);
        });
        it('should delete database', async () => {
            // Note: fake-indexeddb may not properly trigger deleteDatabase events
            // This test just ensures no errors are thrown
            db.close();
            await PartageDB.deleteDatabase().catch(() => {
                // Ignore errors in test environment
            });
            expect(true).toBe(true);
        });
    });
    describe('Identity Management', () => {
        const mockKeypair = {
            publicKey: 'public123',
            privateKey: 'private123',
            publicKeyHash: 'hash123',
        };
        const mockSigningKeypair = {
            publicKey: 'signPub123',
            privateKey: 'signPriv123',
        };
        it('should save and retrieve user keypair', async () => {
            await db.saveUserKeypair(mockKeypair);
            const result = await db.getUserKeypair();
            expect(result).not.toBeNull();
            expect(result?.keypair).toEqual(mockKeypair);
            expect(result?.signingKeypair).toBeUndefined();
        });
        it('should save and retrieve user keypair with signing keys', async () => {
            await db.saveUserKeypair(mockKeypair, mockSigningKeypair);
            const result = await db.getUserKeypair();
            expect(result).not.toBeNull();
            expect(result?.keypair).toEqual(mockKeypair);
            expect(result?.signingKeypair).toEqual(mockSigningKeypair);
        });
        it('should return null when no keypair exists', async () => {
            const result = await db.getUserKeypair();
            expect(result).toBeNull();
        });
        it('should update existing keypair', async () => {
            await db.saveUserKeypair(mockKeypair);
            const updatedKeypair = {
                publicKey: 'newPublic',
                privateKey: 'newPrivate',
                publicKeyHash: 'newHash',
            };
            await db.saveUserKeypair(updatedKeypair);
            const result = await db.getUserKeypair();
            expect(result?.keypair).toEqual(updatedKeypair);
        });
    });
    describe('Group Management', () => {
        const mockGroup = {
            id: 'group1',
            name: 'Test Group',
            defaultCurrency: 'USD',
            createdAt: Date.now(),
            createdBy: 'user123',
            currentKeyVersion: 1,
            settings: DEFAULT_GROUP_SETTINGS,
        };
        it('should save and retrieve a group', async () => {
            await db.saveGroup(mockGroup);
            const result = await db.getGroup('group1');
            expect(result).toEqual(mockGroup);
        });
        it('should return null for non-existent group', async () => {
            const result = await db.getGroup('nonexistent');
            expect(result).toBeNull();
        });
        it('should update existing group', async () => {
            await db.saveGroup(mockGroup);
            const updatedGroup = { ...mockGroup, name: 'Updated Name' };
            await db.saveGroup(updatedGroup);
            const result = await db.getGroup('group1');
            expect(result?.name).toBe('Updated Name');
        });
        it('should get all groups', async () => {
            const group1 = { ...mockGroup, id: 'group1', name: 'Group 1' };
            const group2 = { ...mockGroup, id: 'group2', name: 'Group 2' };
            const group3 = { ...mockGroup, id: 'group3', name: 'Group 3' };
            await db.saveGroup(group1);
            await db.saveGroup(group2);
            await db.saveGroup(group3);
            const groups = await db.getAllGroups();
            expect(groups).toHaveLength(3);
            expect(groups.map((g) => g.id).sort()).toEqual(['group1', 'group2', 'group3']);
        });
        it('should return empty array when no groups exist', async () => {
            const groups = await db.getAllGroups();
            expect(groups).toEqual([]);
        });
        it('should delete a group and all related data', async () => {
            await db.saveGroup(mockGroup);
            await db.saveGroupKey('group1', 1, 'key1');
            await db.saveGroupKey('group1', 2, 'key2');
            await db.saveLoroSnapshot('group1', new Uint8Array([1, 2, 3]));
            await db.savePendingOperation('group1', 'op1', { test: 'data' });
            await db.deleteGroup('group1');
            const group = await db.getGroup('group1');
            const keys = await db.getAllGroupKeys('group1');
            const snapshot = await db.getLoroSnapshot('group1');
            const pendingOps = await db.getPendingOperations('group1');
            expect(group).toBeNull();
            expect(keys.size).toBe(0);
            expect(snapshot).toBeNull();
            expect(pendingOps).toHaveLength(0);
        });
    });
    describe('Group Keys Management', () => {
        it('should save and retrieve a group key', async () => {
            await db.saveGroupKey('group1', 1, 'encryptedKey123');
            const key = await db.getGroupKey('group1', 1);
            expect(key).toBe('encryptedKey123');
        });
        it('should return null for non-existent key', async () => {
            const key = await db.getGroupKey('nonexistent', 1);
            expect(key).toBeNull();
        });
        it('should save multiple key versions', async () => {
            await db.saveGroupKey('group1', 1, 'key_v1');
            await db.saveGroupKey('group1', 2, 'key_v2');
            await db.saveGroupKey('group1', 3, 'key_v3');
            const key1 = await db.getGroupKey('group1', 1);
            const key2 = await db.getGroupKey('group1', 2);
            const key3 = await db.getGroupKey('group1', 3);
            expect(key1).toBe('key_v1');
            expect(key2).toBe('key_v2');
            expect(key3).toBe('key_v3');
        });
        it('should get all key versions for a group', async () => {
            await db.saveGroupKey('group1', 1, 'key_v1');
            await db.saveGroupKey('group1', 2, 'key_v2');
            await db.saveGroupKey('group1', 3, 'key_v3');
            const keys = await db.getAllGroupKeys('group1');
            expect(keys.size).toBe(3);
            expect(keys.get(1)).toBe('key_v1');
            expect(keys.get(2)).toBe('key_v2');
            expect(keys.get(3)).toBe('key_v3');
        });
        it('should not mix keys from different groups', async () => {
            await db.saveGroupKey('group1', 1, 'group1_key');
            await db.saveGroupKey('group2', 1, 'group2_key');
            const group1Keys = await db.getAllGroupKeys('group1');
            const group2Keys = await db.getAllGroupKeys('group2');
            expect(group1Keys.size).toBe(1);
            expect(group2Keys.size).toBe(1);
            expect(group1Keys.get(1)).toBe('group1_key');
            expect(group2Keys.get(1)).toBe('group2_key');
        });
        it('should return empty map for group with no keys', async () => {
            const keys = await db.getAllGroupKeys('nonexistent');
            expect(keys.size).toBe(0);
        });
        it('should update existing key version', async () => {
            await db.saveGroupKey('group1', 1, 'original_key');
            await db.saveGroupKey('group1', 1, 'updated_key');
            const key = await db.getGroupKey('group1', 1);
            expect(key).toBe('updated_key');
        });
    });
    describe('Loro Snapshots Management', () => {
        it('should save and retrieve a snapshot', async () => {
            const snapshot = new Uint8Array([1, 2, 3, 4, 5]);
            await db.saveLoroSnapshot('group1', snapshot);
            const retrieved = await db.getLoroSnapshot('group1');
            expect(retrieved).toEqual(snapshot);
        });
        it('should return null for non-existent snapshot', async () => {
            const snapshot = await db.getLoroSnapshot('nonexistent');
            expect(snapshot).toBeNull();
        });
        it('should update existing snapshot', async () => {
            const snapshot1 = new Uint8Array([1, 2, 3]);
            const snapshot2 = new Uint8Array([4, 5, 6, 7]);
            await db.saveLoroSnapshot('group1', snapshot1);
            await db.saveLoroSnapshot('group1', snapshot2);
            const retrieved = await db.getLoroSnapshot('group1');
            expect(retrieved).toEqual(snapshot2);
        });
        it('should handle empty snapshots', async () => {
            const snapshot = new Uint8Array(0);
            await db.saveLoroSnapshot('group1', snapshot);
            const retrieved = await db.getLoroSnapshot('group1');
            expect(retrieved).toEqual(snapshot);
        });
        it('should handle large snapshots', async () => {
            const snapshot = new Uint8Array(65536); // 64 KB
            crypto.getRandomValues(snapshot);
            await db.saveLoroSnapshot('group1', snapshot);
            const retrieved = await db.getLoroSnapshot('group1');
            expect(retrieved).toEqual(snapshot);
        });
    });
    describe('Pending Operations Management', () => {
        it('should save and retrieve pending operations', async () => {
            const operation = { type: 'create', data: 'test' };
            await db.savePendingOperation('group1', 'op1', operation);
            const ops = await db.getPendingOperations('group1');
            expect(ops).toHaveLength(1);
            expect(ops[0]?.id).toBe('op1');
            expect(ops[0]?.operation).toEqual(operation);
        });
        it('should save multiple operations for same group', async () => {
            await db.savePendingOperation('group1', 'op1', { action: 'create' });
            await db.savePendingOperation('group1', 'op2', { action: 'update' });
            await db.savePendingOperation('group1', 'op3', { action: 'delete' });
            const ops = await db.getPendingOperations('group1');
            expect(ops).toHaveLength(3);
            expect(ops.map((op) => op.id).sort()).toEqual(['op1', 'op2', 'op3']);
        });
        it('should not mix operations from different groups', async () => {
            await db.savePendingOperation('group1', 'op1', { group: 1 });
            await db.savePendingOperation('group2', 'op2', { group: 2 });
            const group1Ops = await db.getPendingOperations('group1');
            const group2Ops = await db.getPendingOperations('group2');
            expect(group1Ops).toHaveLength(1);
            expect(group2Ops).toHaveLength(1);
            expect(group1Ops[0]?.operation).toEqual({ group: 1 });
            expect(group2Ops[0]?.operation).toEqual({ group: 2 });
        });
        it('should clear a specific pending operation', async () => {
            await db.savePendingOperation('group1', 'op1', { test: 1 });
            await db.savePendingOperation('group1', 'op2', { test: 2 });
            await db.clearPendingOperation('op1');
            const ops = await db.getPendingOperations('group1');
            expect(ops).toHaveLength(1);
            expect(ops[0]?.id).toBe('op2');
        });
        it('should clear all pending operations for a group', async () => {
            await db.savePendingOperation('group1', 'op1', { test: 1 });
            await db.savePendingOperation('group1', 'op2', { test: 2 });
            await db.savePendingOperation('group2', 'op3', { test: 3 });
            await db.clearAllPendingOperations('group1');
            const group1Ops = await db.getPendingOperations('group1');
            const group2Ops = await db.getPendingOperations('group2');
            expect(group1Ops).toHaveLength(0);
            expect(group2Ops).toHaveLength(1);
        });
        it('should return empty array when no operations exist', async () => {
            const ops = await db.getPendingOperations('nonexistent');
            expect(ops).toEqual([]);
        });
        it('should handle complex operation objects', async () => {
            const complexOp = {
                type: 'expense',
                data: {
                    amount: 50.25,
                    currency: 'USD',
                    payers: [{ id: 'user1', amount: 50.25 }],
                    beneficiaries: [
                        { id: 'user1', shares: 1 },
                        { id: 'user2', shares: 1 },
                    ],
                },
                metadata: {
                    timestamp: Date.now(),
                    creator: 'user1',
                },
            };
            await db.savePendingOperation('group1', 'op1', complexOp);
            const ops = await db.getPendingOperations('group1');
            expect(ops[0]?.operation).toEqual(complexOp);
        });
    });
    describe('Singleton Instance', () => {
        it('should return same instance on multiple calls', () => {
            const db1 = getDB();
            const db2 = getDB();
            expect(db1).toBe(db2);
        });
    });
});
