import { describe, it, expect, beforeEach } from 'vitest';
import { LoroEntryStore } from './loro-wrapper';
import { generateSymmetricKey } from '../crypto/symmetric';
describe('LoroEntryStore', () => {
    let store;
    let groupKey;
    const groupId = 'test-group-1';
    const actorId = 'actor-1';
    beforeEach(async () => {
        store = new LoroEntryStore();
        groupKey = await generateSymmetricKey();
    });
    describe('Entry Creation', () => {
        it('should create an expense entry', async () => {
            const expense = {
                id: 'expense-1',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Dinner',
                amount: 100,
                currency: 'USD',
                date: Date.now(),
                category: 'food',
                payers: [{ memberId: 'member-1', amount: 100 }],
                beneficiaries: [
                    { memberId: 'member-1', splitType: 'shares', shares: 1 },
                    { memberId: 'member-2', splitType: 'shares', shares: 1 },
                ],
            };
            await store.createEntry(expense, groupKey, actorId);
            const retrieved = await store.getEntry('expense-1', groupKey);
            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe('expense-1');
            expect(retrieved?.type).toBe('expense');
            expect(retrieved?.description).toBe('Dinner');
            expect(retrieved?.amount).toBe(100);
        });
        it('should create a transfer entry', async () => {
            const transfer = {
                id: 'transfer-1',
                groupId,
                type: 'transfer',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                from: 'member-1',
                to: 'member-2',
                amount: 50,
                currency: 'USD',
                date: Date.now(),
            };
            await store.createEntry(transfer, groupKey, actorId);
            const retrieved = await store.getEntry('transfer-1', groupKey);
            expect(retrieved).toBeDefined();
            expect(retrieved?.type).toBe('transfer');
            expect(retrieved?.from).toBe('member-1');
            expect(retrieved?.to).toBe('member-2');
        });
        it('should encrypt sensitive data', async () => {
            const expense = {
                id: 'expense-2',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Secret lunch',
                amount: 75,
                currency: 'EUR',
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 75 }],
                beneficiaries: [{ memberId: 'member-1', splitType: 'exact', amount: 75 }],
            };
            await store.createEntry(expense, groupKey, actorId);
            // Export snapshot and check that description is not in plaintext
            const snapshot = store.exportSnapshot();
            const snapshotStr = new TextDecoder().decode(snapshot);
            expect(snapshotStr).not.toContain('Secret lunch');
        });
    });
    describe('Entry Modification', () => {
        it('should create a new version when modifying an entry', async () => {
            const original = {
                id: 'expense-3',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Original',
                amount: 100,
                currency: 'USD',
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 100 }],
                beneficiaries: [{ memberId: 'member-1', splitType: 'exact', amount: 100 }],
            };
            await store.createEntry(original, groupKey, actorId);
            const modified = {
                ...original,
                id: 'expense-3-v2',
                version: 2,
                description: 'Modified',
                amount: 150,
            };
            await store.modifyEntry('expense-3', modified, groupKey, actorId);
            const retrieved = await store.getEntry('expense-3-v2', groupKey);
            expect(retrieved).toBeDefined();
            expect(retrieved?.version).toBe(2);
            expect(retrieved?.previousVersionId).toBe('expense-3');
            expect(retrieved?.description).toBe('Modified');
            expect(retrieved?.modifiedBy).toBe(actorId);
            expect(retrieved?.modifiedAt).toBeDefined();
        });
    });
    describe('Entry Deletion', () => {
        it('should soft delete an entry', async () => {
            const expense = {
                id: 'expense-4',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'To be deleted',
                amount: 50,
                currency: 'USD',
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 50 }],
                beneficiaries: [{ memberId: 'member-1', splitType: 'exact', amount: 50 }],
            };
            await store.createEntry(expense, groupKey, actorId);
            await store.deleteEntry('expense-4', actorId, groupKey);
            const retrieved = await store.getEntry('expense-4', groupKey);
            expect(retrieved).toBeDefined();
            expect(retrieved?.status).toBe('deleted');
            expect(retrieved?.deletedBy).toBe(actorId);
            expect(retrieved?.deletedAt).toBeDefined();
        });
        it('should include deletion reason', async () => {
            const expense = {
                id: 'expense-5',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Wrong entry',
                amount: 25,
                currency: 'USD',
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 25 }],
                beneficiaries: [{ memberId: 'member-1', splitType: 'exact', amount: 25 }],
            };
            await store.createEntry(expense, groupKey, actorId);
            await store.deleteEntry('expense-5', actorId, groupKey, 'Duplicate entry');
            const retrieved = await store.getEntry('expense-5', groupKey);
            expect(retrieved?.deletionReason).toBe('Duplicate entry');
        });
        it('should throw error when deleting non-existent entry', async () => {
            await expect(store.deleteEntry('non-existent', actorId, groupKey)).rejects.toThrow('Entry non-existent not found');
        });
    });
    describe('Entry Retrieval', () => {
        beforeEach(async () => {
            const expense1 = {
                id: 'expense-6',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Expense 1',
                amount: 100,
                currency: 'USD',
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 100 }],
                beneficiaries: [{ memberId: 'member-1', splitType: 'exact', amount: 100 }],
            };
            const expense2 = {
                id: 'expense-7',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Expense 2',
                amount: 200,
                currency: 'USD',
                date: Date.now(),
                payers: [{ memberId: 'member-2', amount: 200 }],
                beneficiaries: [{ memberId: 'member-2', splitType: 'exact', amount: 200 }],
            };
            await store.createEntry(expense1, groupKey, actorId);
            await store.createEntry(expense2, groupKey, actorId);
        });
        it('should get all entries for a group', async () => {
            const entries = await store.getAllEntries(groupId, groupKey);
            expect(entries.length).toBe(2);
        });
        it('should get only active entries', async () => {
            await store.deleteEntry('expense-6', actorId, groupKey);
            const activeEntries = await store.getActiveEntries(groupId, groupKey);
            expect(activeEntries.length).toBe(1);
            expect(activeEntries[0].id).toBe('expense-7');
        });
        it('should return null for non-existent entry', async () => {
            const entry = await store.getEntry('non-existent', groupKey);
            expect(entry).toBeNull();
        });
    });
    describe('Snapshot and Sync', () => {
        it('should export and import snapshots', async () => {
            const expense = {
                id: 'expense-8',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Snapshot test',
                amount: 300,
                currency: 'USD',
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 300 }],
                beneficiaries: [{ memberId: 'member-1', splitType: 'exact', amount: 300 }],
            };
            await store.createEntry(expense, groupKey, actorId);
            const snapshot = store.exportSnapshot();
            expect(snapshot).toBeInstanceOf(Uint8Array);
            const newStore = new LoroEntryStore();
            newStore.importSnapshot(snapshot);
            const retrieved = await newStore.getEntry('expense-8', groupKey);
            expect(retrieved).toBeDefined();
            expect(retrieved?.description).toBe('Snapshot test');
        });
        it('should get version', () => {
            const version = store.getVersion();
            expect(version).toBeDefined();
        });
        it('should export updates from a version', async () => {
            const initialVersion = store.getVersion();
            const expense = {
                id: 'expense-9',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Update test',
                amount: 400,
                currency: 'USD',
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 400 }],
                beneficiaries: [{ memberId: 'member-1', splitType: 'exact', amount: 400 }],
            };
            await store.createEntry(expense, groupKey, actorId);
            const update = store.exportFrom(initialVersion);
            expect(update).toBeInstanceOf(Uint8Array);
            expect(update.length).toBeGreaterThan(0);
        });
        it('should apply updates from another store', async () => {
            const store1 = new LoroEntryStore();
            const store2 = new LoroEntryStore();
            const expense = {
                id: 'expense-10',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Sync test',
                amount: 500,
                currency: 'USD',
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 500 }],
                beneficiaries: [{ memberId: 'member-1', splitType: 'exact', amount: 500 }],
            };
            await store1.createEntry(expense, groupKey, actorId);
            const snapshot = store1.exportSnapshot();
            store2.importSnapshot(snapshot);
            const retrieved = await store2.getEntry('expense-10', groupKey);
            expect(retrieved).toBeDefined();
            expect(retrieved?.description).toBe('Sync test');
        });
    });
    describe('Currency Handling', () => {
        it('should store and retrieve currency conversion data', async () => {
            const expense = {
                id: 'expense-11',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Euro expense',
                amount: 100,
                currency: 'EUR',
                defaultCurrencyAmount: 110,
                exchangeRate: 1.1,
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 100 }],
                beneficiaries: [{ memberId: 'member-1', splitType: 'exact', amount: 100 }],
            };
            await store.createEntry(expense, groupKey, actorId);
            const retrieved = await store.getEntry('expense-11', groupKey);
            expect(retrieved?.currency).toBe('EUR');
            expect(retrieved?.defaultCurrencyAmount).toBe(110);
            expect(retrieved?.exchangeRate).toBe(1.1);
        });
    });
    describe('Complex Expense Scenarios', () => {
        it('should handle multiple payers', async () => {
            const expense = {
                id: 'expense-12',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Split payment',
                amount: 200,
                currency: 'USD',
                date: Date.now(),
                payers: [
                    { memberId: 'member-1', amount: 120 },
                    { memberId: 'member-2', amount: 80 },
                ],
                beneficiaries: [
                    { memberId: 'member-1', splitType: 'shares', shares: 1 },
                    { memberId: 'member-2', splitType: 'shares', shares: 1 },
                ],
            };
            await store.createEntry(expense, groupKey, actorId);
            const retrieved = await store.getEntry('expense-12', groupKey);
            expect(retrieved.payers.length).toBe(2);
            expect(retrieved.payers[0].amount).toBe(120);
            expect(retrieved.payers[1].amount).toBe(80);
        });
        it('should handle mixed split types', async () => {
            const expense = {
                id: 'expense-13',
                groupId,
                type: 'expense',
                version: 1,
                createdAt: Date.now(),
                createdBy: actorId,
                status: 'active',
                description: 'Mixed split',
                amount: 150,
                currency: 'USD',
                date: Date.now(),
                payers: [{ memberId: 'member-1', amount: 150 }],
                beneficiaries: [
                    { memberId: 'member-1', splitType: 'exact', amount: 50 },
                    { memberId: 'member-2', splitType: 'shares', shares: 2 },
                    { memberId: 'member-3', splitType: 'shares', shares: 1 },
                ],
            };
            await store.createEntry(expense, groupKey, actorId);
            const retrieved = await store.getEntry('expense-13', groupKey);
            expect(retrieved.beneficiaries.length).toBe(3);
            expect(retrieved.beneficiaries[0].splitType).toBe('exact');
            expect(retrieved.beneficiaries[1].splitType).toBe('shares');
        });
    });
});
