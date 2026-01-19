/**
 * Performance Benchmark Tests
 *
 * Run with: pnpm test:bench
 * Or specifically: pnpm vitest run src/benchmarks/performance-benchmarks.test.ts
 *
 * These tests measure real-world performance scenarios and output timing data.
 * Use the results to identify bottlenecks before and after optimizations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LoroEntryStore } from '../core/crdt/loro-wrapper.js';
import { PartageDB } from '../core/storage/indexeddb.js';
import { generateSymmetricKey, encryptJSON } from '../core/crypto/symmetric.js';
import { calculateBalances } from '../domain/calculations/balance-calculator.js';
import type { ExpenseEntry } from '@partage/shared';

// ==================== Test Utilities ====================

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function timeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

function generateExpenseEntry(
  index: number,
  groupId: string,
  memberIds: string[],
  createdBy: string
): ExpenseEntry {
  return {
    id: `entry-${index}-${crypto.randomUUID().slice(0, 8)}`,
    groupId,
    type: 'expense',
    version: 1,
    createdAt: Date.now() - index * 1000,
    createdBy,
    status: 'active',
    description: `Expense ${index}: ${['Dinner', 'Groceries', 'Transport', 'Coffee'][index % 4]}`,
    category: ['food', 'groceries', 'transport', 'food'][index % 4] as any,
    amount: 10 + (index % 100),
    currency: 'USD',
    defaultCurrencyAmount: 10 + (index % 100),
    date: Date.now() - index * 86400000,
    payers: [{ memberId: memberIds[index % memberIds.length]!, amount: 10 + (index % 100) }],
    beneficiaries: memberIds.map((id) => ({
      memberId: id,
      splitType: 'shares' as const,
      shares: 1,
    })),
  };
}

// ==================== Benchmark Tests ====================

describe('Performance Benchmarks', () => {
  let db: PartageDB;
  let groupKey: CryptoKey;
  const groupId = 'bench-group-' + Date.now();

  beforeAll(async () => {
    db = new PartageDB();
    await db.open();
    groupKey = await generateSymmetricKey();

    // Export key to string and store it
    const keyRaw = await crypto.subtle.exportKey('raw', groupKey);
    const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
    await db.saveGroupKey(groupId, keyBase64);
  });

  afterAll(async () => {
    await db.deleteGroup(groupId);
    // Note: Can't close IndexedDB in jsdom, just let it be garbage collected
  });

  describe('Encryption Performance', () => {
    it('should encrypt single entries quickly', async () => {
      const entry = { description: 'Test', amount: 100, currency: 'USD' };
      const iterations = 100;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const { durationMs } = await timeAsync(() => encryptJSON(entry, groupKey));
        times.push(durationMs);
      }

      const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  Single entry encryption: avg=${formatMs(avgMs)} (${iterations} iterations)`);

      // Encryption should be fast
      expect(avgMs).toBeLessThan(10); // Less than 10ms average
    });

    it('should measure batch vs parallel encryption', async () => {
      const entries = Array.from({ length: 50 }, (_, i) => ({
        description: `Entry ${i}`,
        amount: 50 + i,
      }));

      // Sequential
      const { durationMs: seqMs } = await timeAsync(async () => {
        for (const entry of entries) {
          await encryptJSON(entry, groupKey);
        }
      });

      // Parallel
      const { durationMs: parMs } = await timeAsync(async () => {
        await Promise.all(entries.map((entry) => encryptJSON(entry, groupKey)));
      });

      console.log(`  Batch encryption (50 entries):`);
      console.log(`    Sequential: ${formatMs(seqMs)}`);
      console.log(`    Parallel:   ${formatMs(parMs)}`);
      console.log(`    Speedup:    ${(seqMs / parMs).toFixed(2)}x`);

      // Parallel should be at least somewhat faster (may not be in test env)
      expect(parMs).toBeLessThanOrEqual(seqMs * 1.5); // Allow some variance
    });
  });

  describe('Loro Entry Store Performance', () => {
    it('should measure createEntry performance', async () => {
      const store = new LoroEntryStore('bench-peer');
      const memberIds = ['member-1', 'member-2', 'member-3'];

      const iterations = 50;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const entry = generateExpenseEntry(i, groupId, memberIds, 'member-1');
        const { durationMs } = await timeAsync(() =>
          store.createEntry(entry, groupKey, 'member-1')
        );
        times.push(durationMs);
      }

      const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  createEntry: avg=${formatMs(avgMs)} (${iterations} iterations)`);

      expect(avgMs).toBeLessThan(20); // Should be fast
    });

    it('should measure getAllEntries with varying sizes', async () => {
      const memberIds = ['member-1', 'member-2', 'member-3', 'member-4', 'member-5'];

      // Test different entry counts
      for (const entryCount of [10, 50, 100]) {
        const store = new LoroEntryStore('bench-peer-' + entryCount);
        const testGroupId = `bench-group-${entryCount}-${Date.now()}`;

        // Store the key for this group
        const keyRaw = await crypto.subtle.exportKey('raw', groupKey);
        const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
        await db.saveGroupKey(testGroupId, keyBase64);

        // Create entries
        for (let i = 0; i < entryCount; i++) {
          const entry = generateExpenseEntry(i, testGroupId, memberIds, 'member-1');
          await store.createEntry(entry, groupKey, 'member-1');
        }

        // Measure getAllEntries
        const times: number[] = [];
        for (let run = 0; run < 5; run++) {
          const { durationMs } = await timeAsync(() => store.getAllEntries(testGroupId, groupKey));
          times.push(durationMs);
        }

        const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`  getAllEntries (${entryCount} entries): avg=${formatMs(avgMs)}`);

        // Cleanup
        await db.deleteGroup(testGroupId);
      }
    });
  });

  describe('Balance Calculation Performance', () => {
    it('should measure balance calculation at scale', async () => {
      const memberCounts = [5, 10, 20];
      const entryCounts = [50, 200, 500];

      for (const memberCount of memberCounts) {
        const memberIds = Array.from({ length: memberCount }, (_, i) => `member-${i}`);

        for (const entryCount of entryCounts) {
          const entries: ExpenseEntry[] = Array.from({ length: entryCount }, (_, i) =>
            generateExpenseEntry(i, groupId, memberIds, memberIds[0]!)
          );

          const times: number[] = [];
          for (let run = 0; run < 10; run++) {
            const start = performance.now();
            calculateBalances(entries);
            times.push(performance.now() - start);
          }

          const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
          console.log(
            `  Balance calc (${memberCount} members, ${entryCount} entries): avg=${formatMs(avgMs)}`
          );

          // Should be fast even at scale
          expect(avgMs).toBeLessThan(100);
        }
      }
    });
  });

  describe('Key Import Overhead', () => {
    it('should measure key import cost (current pattern)', async () => {
      const keyRaw = await crypto.subtle.exportKey('raw', groupKey);
      const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));

      // Measure repeated imports (current getAllEntries behavior)
      const importCount = 100;
      const { durationMs } = await timeAsync(async () => {
        for (let i = 0; i < importCount; i++) {
          const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
          await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
            'encrypt',
            'decrypt',
          ]);
        }
      });

      console.log(`  Key import (${importCount}x repeated): ${formatMs(durationMs)}`);
      console.log(`    Per-import cost: ${formatMs(durationMs / importCount)}`);

      // This helps quantify the cost of not caching keys
    });

    it('should show benefit of caching key import', async () => {
      const keyRaw = await crypto.subtle.exportKey('raw', groupKey);
      const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
      const operations = 100;

      // Without caching (import per operation)
      const { durationMs: withoutCacheMs } = await timeAsync(async () => {
        for (let i = 0; i < operations; i++) {
          const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
          const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
            'encrypt',
            'decrypt',
          ]);
          // Simulate using the key
          await encryptJSON({ test: i }, key);
        }
      });

      // With caching (import once)
      const { durationMs: withCacheMs } = await timeAsync(async () => {
        const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
        const cachedKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
          'encrypt',
          'decrypt',
        ]);
        for (let i = 0; i < operations; i++) {
          await encryptJSON({ test: i }, cachedKey);
        }
      });

      console.log(`  ${operations} encrypt operations:`);
      console.log(`    Without key caching: ${formatMs(withoutCacheMs)}`);
      console.log(`    With key caching:    ${formatMs(withCacheMs)}`);
      console.log(
        `    Savings:             ${formatMs(withoutCacheMs - withCacheMs)} (${(((withoutCacheMs - withCacheMs) / withoutCacheMs) * 100).toFixed(1)}%)`
      );
    });
  });

  describe('Alias Resolution Overhead', () => {
    it('should compare linear vs map-based alias lookup', () => {
      const aliasCount = 30;
      const lookups = 500;

      const aliases = Array.from({ length: aliasCount }, (_, i) => ({
        newMemberId: `new-${i}`,
        existingMemberId: `existing-${i}`,
        linkedAt: Date.now(),
        linkedBy: 'admin',
      }));

      // Linear search (current pattern)
      const linearStart = performance.now();
      for (let i = 0; i < lookups; i++) {
        const memberId = `existing-${i % aliasCount}`;
        aliases.find((a) => a.existingMemberId === memberId);
      }
      const linearMs = performance.now() - linearStart;

      // Map-based (optimized pattern)
      const mapStart = performance.now();
      const aliasMap = new Map(aliases.map((a) => [a.existingMemberId, a]));
      for (let i = 0; i < lookups; i++) {
        const memberId = `existing-${i % aliasCount}`;
        aliasMap.get(memberId);
      }
      const mapMs = performance.now() - mapStart;

      console.log(`  Alias lookup (${aliasCount} aliases, ${lookups} lookups):`);
      console.log(`    Linear search: ${formatMs(linearMs)}`);
      console.log(`    Map lookup:    ${formatMs(mapMs)}`);
      console.log(`    Speedup:       ${(linearMs / mapMs).toFixed(1)}x`);

      // Map should be faster
      expect(mapMs).toBeLessThan(linearMs);
    });
  });

  describe('IndexedDB Operations', () => {
    it('should measure snapshot save/load performance', async () => {
      const store = new LoroEntryStore('bench-snapshot-peer');
      const memberIds = ['member-1', 'member-2', 'member-3'];
      const testGroupId = 'bench-snapshot-' + Date.now();

      // Store key
      const keyRaw = await crypto.subtle.exportKey('raw', groupKey);
      const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
      await db.saveGroupKey(testGroupId, keyBase64);

      // Create entries to build up snapshot size
      for (let i = 0; i < 100; i++) {
        const entry = generateExpenseEntry(i, testGroupId, memberIds, 'member-1');
        await store.createEntry(entry, groupKey, 'member-1');
      }

      const snapshot = store.exportSnapshot();
      console.log(`  Snapshot size (100 entries): ${(snapshot.length / 1024).toFixed(2)} KB`);

      // Measure save
      const { durationMs: saveMs } = await timeAsync(() =>
        db.saveLoroSnapshot(testGroupId, snapshot)
      );
      console.log(`  Snapshot save: ${formatMs(saveMs)}`);

      // Measure load
      const { durationMs: loadMs } = await timeAsync(() => db.getLoroSnapshot(testGroupId));
      console.log(`  Snapshot load: ${formatMs(loadMs)}`);

      // Cleanup
      await db.deleteGroup(testGroupId);
    });

    it('should measure incremental update save overhead', async () => {
      const store = new LoroEntryStore('bench-incremental-peer');
      const memberIds = ['member-1', 'member-2', 'member-3'];
      const testGroupId = 'bench-incremental-' + Date.now();

      // Store key
      const keyRaw = await crypto.subtle.exportKey('raw', groupKey);
      const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
      await db.saveGroupKey(testGroupId, keyBase64);

      // Initial snapshot
      await db.saveLoroSnapshot(testGroupId, store.exportSnapshot());
      store.markAsSaved();

      // Measure incremental saves
      const updateSizes: number[] = [];
      const saveTimes: number[] = [];

      for (let i = 0; i < 20; i++) {
        const entry = generateExpenseEntry(i, testGroupId, memberIds, 'member-1');
        await store.createEntry(entry, groupKey, 'member-1');

        const { updateData, version } = store.exportIncrementalUpdate();
        updateSizes.push(updateData.length);

        const { durationMs } = await timeAsync(() =>
          db.saveLoroIncrementalUpdate(testGroupId, updateData, version)
        );
        saveTimes.push(durationMs);
        store.markAsSaved();
      }

      const avgSize = updateSizes.reduce((a, b) => a + b, 0) / updateSizes.length;
      const avgSaveMs = saveTimes.reduce((a, b) => a + b, 0) / saveTimes.length;

      console.log(`  Incremental updates (20 entries):`);
      console.log(`    Avg update size: ${avgSize.toFixed(0)} bytes`);
      console.log(`    Avg save time:   ${formatMs(avgSaveMs)}`);

      // Cleanup
      await db.deleteGroup(testGroupId);
    });
  });
});
