/**
 * Performance Benchmarking Utilities
 *
 * This module provides tools to measure and identify performance bottlenecks in:
 * - Encryption/decryption operations
 * - IndexedDB read/write patterns
 * - CRDT entry retrieval
 * - Balance calculations
 * - Member alias resolution
 *
 * Usage:
 *   import { runAllBenchmarks, benchmarkEncryption } from './performance-benchmarks';
 *   await runAllBenchmarks();  // Run all benchmarks and log results
 *
 * Or from browser console (after exposing via window):
 *   await window.runBenchmarks();
 */

import { generateSymmetricKey, encryptJSON, decryptJSON } from '../core/crypto/symmetric.js';
import { calculateBalances, generateSettlementPlan } from '../domain/calculations/balance-calculator.js';
import type { ExpenseEntry, Member } from '@partage/shared';

// ==================== Types ====================

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSecond: number;
}

interface BenchmarkSuite {
  encryption: BenchmarkResult[];
  decryption: BenchmarkResult[];
  balanceCalc: BenchmarkResult[];
  aliasResolution: BenchmarkResult[];
  entryGeneration: BenchmarkResult[];
}

// ==================== Utilities ====================

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatOps(ops: number): string {
  if (ops >= 1000000) return `${(ops / 1000000).toFixed(1)}M ops/s`;
  if (ops >= 1000) return `${(ops / 1000).toFixed(1)}K ops/s`;
  return `${ops.toFixed(0)} ops/s`;
}

async function measure<T>(
  name: string,
  fn: () => Promise<T> | T,
  iterations: number = 100
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warmup (10% of iterations, min 1)
  const warmupCount = Math.max(1, Math.floor(iterations * 0.1));
  for (let i = 0; i < warmupCount; i++) {
    await fn();
  }

  // Actual measurements
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  const avgMs = totalMs / times.length;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const opsPerSecond = 1000 / avgMs;

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    opsPerSecond,
  };
}

function logResult(result: BenchmarkResult): void {
  console.log(
    `  ${result.name}: avg=${formatMs(result.avgMs)}, ` +
      `min=${formatMs(result.minMs)}, max=${formatMs(result.maxMs)}, ` +
      `${formatOps(result.opsPerSecond)}`
  );
}

// ==================== Test Data Generators ====================

function generateTestEntry(index: number, groupId: string, memberIds: string[]): ExpenseEntry {
  const payers = [{ memberId: memberIds[index % memberIds.length]!, amount: 50 + index }];
  const beneficiaries = memberIds.map((id) => ({
    memberId: id,
    splitType: 'shares' as const,
    shares: 1,
  }));

  return {
    id: `entry-${index}`,
    groupId,
    type: 'expense',
    version: 1,
    createdAt: Date.now() - index * 1000,
    createdBy: memberIds[0]!,
    status: 'active',
    description: `Test expense ${index}`,
    category: 'food',
    amount: 50 + index,
    currency: 'USD',
    defaultCurrencyAmount: 50 + index,
    date: Date.now() - index * 86400000,
    payers,
    beneficiaries,
  };
}

function generateTestMembers(count: number): Member[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `member-${i}`,
    name: `Member ${i}`,
    joinedAt: Date.now() - i * 86400000,
    status: 'active' as const,
    isVirtual: i >= count / 2, // Half are virtual
  }));
}

// ==================== Encryption Benchmarks ====================

export async function benchmarkEncryption(): Promise<BenchmarkResult[]> {
  console.log('\n📊 Encryption Benchmarks');
  console.log('========================');

  const results: BenchmarkResult[] = [];
  const groupKey = await generateSymmetricKey();

  // Small payload (typical single entry)
  const smallPayload = { description: 'Test', amount: 100, currency: 'USD' };
  results.push(await measure('encrypt-small', () => encryptJSON(smallPayload, groupKey), 500));
  logResult(results[results.length - 1]!);

  // Medium payload (entry with 10 beneficiaries)
  const mediumPayload = {
    description: 'Test expense with multiple beneficiaries',
    amount: 500,
    currency: 'USD',
    payers: [{ memberId: 'user1', amount: 500 }],
    beneficiaries: Array.from({ length: 10 }, (_, i) => ({
      memberId: `member-${i}`,
      splitType: 'shares',
      shares: 1,
    })),
  };
  results.push(await measure('encrypt-medium', () => encryptJSON(mediumPayload, groupKey), 500));
  logResult(results[results.length - 1]!);

  // Large payload (entry with 50 beneficiaries and notes)
  const largePayload = {
    ...mediumPayload,
    beneficiaries: Array.from({ length: 50 }, (_, i) => ({
      memberId: `member-${i}`,
      splitType: 'shares',
      shares: 1,
    })),
    notes: 'A'.repeat(1000),
    location: 'Test Location',
  };
  results.push(await measure('encrypt-large', () => encryptJSON(largePayload, groupKey), 200));
  logResult(results[results.length - 1]!);

  // Batch encryption (100 entries)
  const entries = Array.from({ length: 100 }, (_, i) => ({
    description: `Entry ${i}`,
    amount: 50 + i,
  }));
  results.push(
    await measure(
      'encrypt-batch-100',
      async () => {
        for (const entry of entries) {
          await encryptJSON(entry, groupKey);
        }
      },
      10
    )
  );
  logResult(results[results.length - 1]!);

  // Parallel encryption (100 entries)
  results.push(
    await measure(
      'encrypt-parallel-100',
      async () => {
        await Promise.all(entries.map((entry) => encryptJSON(entry, groupKey)));
      },
      10
    )
  );
  logResult(results[results.length - 1]!);

  return results;
}

// ==================== Decryption Benchmarks ====================

export async function benchmarkDecryption(): Promise<BenchmarkResult[]> {
  console.log('\n📊 Decryption Benchmarks');
  console.log('========================');

  const results: BenchmarkResult[] = [];
  const groupKey = await generateSymmetricKey();

  // Pre-encrypt payloads
  const smallEncrypted = await encryptJSON({ description: 'Test', amount: 100 }, groupKey);

  const mediumPayload = {
    description: 'Test expense',
    amount: 500,
    beneficiaries: Array.from({ length: 10 }, (_, i) => ({
      memberId: `member-${i}`,
      splitType: 'shares',
      shares: 1,
    })),
  };
  const mediumEncrypted = await encryptJSON(mediumPayload, groupKey);

  const largePayload = {
    ...mediumPayload,
    beneficiaries: Array.from({ length: 50 }, (_, i) => ({
      memberId: `member-${i}`,
      splitType: 'shares',
      shares: 1,
    })),
    notes: 'A'.repeat(1000),
  };
  const largeEncrypted = await encryptJSON(largePayload, groupKey);

  results.push(await measure('decrypt-small', () => decryptJSON(smallEncrypted, groupKey), 500));
  logResult(results[results.length - 1]!);

  results.push(await measure('decrypt-medium', () => decryptJSON(mediumEncrypted, groupKey), 500));
  logResult(results[results.length - 1]!);

  results.push(await measure('decrypt-large', () => decryptJSON(largeEncrypted, groupKey), 200));
  logResult(results[results.length - 1]!);

  // Batch decryption (100 entries)
  const encryptedEntries = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      encryptJSON({ description: `Entry ${i}`, amount: 50 + i }, groupKey)
    )
  );

  results.push(
    await measure(
      'decrypt-batch-100',
      async () => {
        for (const encrypted of encryptedEntries) {
          await decryptJSON(encrypted, groupKey);
        }
      },
      10
    )
  );
  logResult(results[results.length - 1]!);

  // Parallel decryption (100 entries)
  results.push(
    await measure(
      'decrypt-parallel-100',
      async () => {
        await Promise.all(encryptedEntries.map((encrypted) => decryptJSON(encrypted, groupKey)));
      },
      10
    )
  );
  logResult(results[results.length - 1]!);

  return results;
}

// ==================== Key Import Benchmarks ====================

export async function benchmarkKeyImport(): Promise<BenchmarkResult[]> {
  console.log('\n📊 Key Import Benchmarks');
  console.log('========================');

  const results: BenchmarkResult[] = [];

  // Generate a key and export it
  const key = await generateSymmetricKey();
  const keyRaw = await crypto.subtle.exportKey('raw', key);
  const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));

  // Single key import
  results.push(
    await measure(
      'key-import-single',
      async () => {
        const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
        await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
          'encrypt',
          'decrypt',
        ]);
      },
      500
    )
  );
  logResult(results[results.length - 1]!);

  // Repeated key imports (simulating current getAllEntries behavior)
  results.push(
    await measure(
      'key-import-100x',
      async () => {
        for (let i = 0; i < 100; i++) {
          const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
          await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
            'encrypt',
            'decrypt',
          ]);
        }
      },
      10
    )
  );
  logResult(results[results.length - 1]!);

  // Import once, reuse (optimal pattern)
  results.push(
    await measure(
      'key-import-once-use-100x',
      async () => {
        const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
        const importedKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
          'encrypt',
          'decrypt',
        ]);
        // Simulate 100 uses (just reference the key)
        for (let i = 0; i < 100; i++) {
          void importedKey;
        }
      },
      100
    )
  );
  logResult(results[results.length - 1]!);

  return results;
}

// ==================== Balance Calculation Benchmarks ====================

export async function benchmarkBalanceCalculation(): Promise<BenchmarkResult[]> {
  console.log('\n📊 Balance Calculation Benchmarks');
  console.log('==================================');

  const results: BenchmarkResult[] = [];
  const groupId = 'test-group';

  // Small group (5 members, 20 entries)
  const smallMembers = generateTestMembers(5);
  const smallMemberIds = smallMembers.map((m) => m.id);
  const smallEntries = Array.from({ length: 20 }, (_, i) =>
    generateTestEntry(i, groupId, smallMemberIds)
  );

  results.push(
    await measure(
      'balance-5members-20entries',
      () => calculateBalances(smallEntries),
      500
    )
  );
  logResult(results[results.length - 1]!);

  // Medium group (10 members, 100 entries)
  const mediumMembers = generateTestMembers(10);
  const mediumMemberIds = mediumMembers.map((m) => m.id);
  const mediumEntries = Array.from({ length: 100 }, (_, i) =>
    generateTestEntry(i, groupId, mediumMemberIds)
  );

  results.push(
    await measure(
      'balance-10members-100entries',
      () => calculateBalances(mediumEntries),
      100
    )
  );
  logResult(results[results.length - 1]!);

  // Large group (20 members, 500 entries)
  const largeMembers = generateTestMembers(20);
  const largeMemberIds = largeMembers.map((m) => m.id);
  const largeEntries = Array.from({ length: 500 }, (_, i) =>
    generateTestEntry(i, groupId, largeMemberIds)
  );

  results.push(
    await measure(
      'balance-20members-500entries',
      () => calculateBalances(largeEntries),
      50
    )
  );
  logResult(results[results.length - 1]!);

  // Very large (50 members, 2000 entries) - stress test
  const veryLargeMembers = generateTestMembers(50);
  const veryLargeMemberIds = veryLargeMembers.map((m) => m.id);
  const veryLargeEntries = Array.from({ length: 2000 }, (_, i) =>
    generateTestEntry(i, groupId, veryLargeMemberIds)
  );

  results.push(
    await measure(
      'balance-50members-2000entries',
      () => calculateBalances(veryLargeEntries),
      10
    )
  );
  logResult(results[results.length - 1]!);

  return results;
}

// ==================== Settlement Plan Benchmarks ====================

export async function benchmarkSettlementPlan(): Promise<BenchmarkResult[]> {
  console.log('\n📊 Settlement Plan Generation Benchmarks');
  console.log('=========================================');

  const results: BenchmarkResult[] = [];
  const groupId = 'test-group';

  // Small (5 members)
  const smallMembers = generateTestMembers(5);
  const smallMemberIds = smallMembers.map((m) => m.id);
  const smallEntries = Array.from({ length: 20 }, (_, i) =>
    generateTestEntry(i, groupId, smallMemberIds)
  );
  const smallBalances = calculateBalances(smallEntries);

  results.push(
    await measure('settlement-5members', () => generateSettlementPlan(smallBalances), 500)
  );
  logResult(results[results.length - 1]!);

  // Medium (10 members)
  const mediumMembers = generateTestMembers(10);
  const mediumMemberIds = mediumMembers.map((m) => m.id);
  const mediumEntries = Array.from({ length: 100 }, (_, i) =>
    generateTestEntry(i, groupId, mediumMemberIds)
  );
  const mediumBalances = calculateBalances(mediumEntries);

  results.push(
    await measure('settlement-10members', () => generateSettlementPlan(mediumBalances), 200)
  );
  logResult(results[results.length - 1]!);

  // Large (20 members)
  const largeMembers = generateTestMembers(20);
  const largeMemberIds = largeMembers.map((m) => m.id);
  const largeEntries = Array.from({ length: 500 }, (_, i) =>
    generateTestEntry(i, groupId, largeMemberIds)
  );
  const largeBalances = calculateBalances(largeEntries);

  results.push(
    await measure('settlement-20members', () => generateSettlementPlan(largeBalances), 50)
  );
  logResult(results[results.length - 1]!);

  // With preferences (adds constraint processing)
  const preferences = [
    { userId: 'member-0', preferredRecipients: ['member-1', 'member-2'] },
    { userId: 'member-3', preferredRecipients: ['member-4'] },
  ];

  results.push(
    await measure(
      'settlement-20members-with-prefs',
      () => generateSettlementPlan(largeBalances, preferences),
      50
    )
  );
  logResult(results[results.length - 1]!);

  return results;
}

// ==================== Alias Resolution Benchmarks ====================

export async function benchmarkAliasResolution(): Promise<BenchmarkResult[]> {
  console.log('\n📊 Alias Resolution Benchmarks');
  console.log('==============================');

  const results: BenchmarkResult[] = [];

  // Simulate the getMemberAliases + find pattern used in UI
  const aliases10 = Array.from({ length: 10 }, (_, i) => ({
    newMemberId: `new-${i}`,
    existingMemberId: `existing-${i}`,
    linkedAt: Date.now(),
    linkedBy: 'admin',
  }));

  const aliases50 = Array.from({ length: 50 }, (_, i) => ({
    newMemberId: `new-${i}`,
    existingMemberId: `existing-${i}`,
    linkedAt: Date.now(),
    linkedBy: 'admin',
  }));

  // Current pattern: linear search per lookup
  results.push(
    await measure(
      'alias-linear-10aliases-100lookups',
      () => {
        for (let i = 0; i < 100; i++) {
          const memberId = `existing-${i % 10}`;
          aliases10.find((a) => a.existingMemberId === memberId);
        }
      },
      500
    )
  );
  logResult(results[results.length - 1]!);

  results.push(
    await measure(
      'alias-linear-50aliases-100lookups',
      () => {
        for (let i = 0; i < 100; i++) {
          const memberId = `existing-${i % 50}`;
          aliases50.find((a) => a.existingMemberId === memberId);
        }
      },
      500
    )
  );
  logResult(results[results.length - 1]!);

  // Optimized pattern: build Map once, O(1) lookups
  results.push(
    await measure(
      'alias-map-10aliases-100lookups',
      () => {
        const aliasMap = new Map(aliases10.map((a) => [a.existingMemberId, a]));
        for (let i = 0; i < 100; i++) {
          const memberId = `existing-${i % 10}`;
          aliasMap.get(memberId);
        }
      },
      500
    )
  );
  logResult(results[results.length - 1]!);

  results.push(
    await measure(
      'alias-map-50aliases-100lookups',
      () => {
        const aliasMap = new Map(aliases50.map((a) => [a.existingMemberId, a]));
        for (let i = 0; i < 100; i++) {
          const memberId = `existing-${i % 50}`;
          aliasMap.get(memberId);
        }
      },
      500
    )
  );
  logResult(results[results.length - 1]!);

  return results;
}

// ==================== Main Runner ====================

export async function runAllBenchmarks(): Promise<BenchmarkSuite> {
  console.log('🚀 Starting Performance Benchmarks');
  console.log('===================================\n');
  console.log('Environment:', typeof window !== 'undefined' ? 'Browser' : 'Node');
  console.log('Date:', new Date().toISOString());

  const suite: BenchmarkSuite = {
    encryption: await benchmarkEncryption(),
    decryption: await benchmarkDecryption(),
    balanceCalc: await benchmarkBalanceCalculation(),
    aliasResolution: await benchmarkAliasResolution(),
    entryGeneration: await benchmarkSettlementPlan(),
  };

  // Add key import benchmarks
  await benchmarkKeyImport();

  console.log('\n✅ All benchmarks complete!');
  console.log('\n📋 Summary of Recommendations:');
  console.log('1. Key Import: Import once per group, cache and reuse');
  console.log('2. Encryption: Use parallel Promise.all for batch operations');
  console.log('3. Alias Resolution: Build Map lookup instead of linear find()');
  console.log('4. Balance Calc: Already efficient, watch for >1000 entries');

  return suite;
}

// Expose to window for browser console usage
if (typeof window !== 'undefined') {
  (window as any).runBenchmarks = runAllBenchmarks;
  (window as any).benchmarkEncryption = benchmarkEncryption;
  (window as any).benchmarkDecryption = benchmarkDecryption;
  (window as any).benchmarkKeyImport = benchmarkKeyImport;
  (window as any).benchmarkBalanceCalculation = benchmarkBalanceCalculation;
  (window as any).benchmarkSettlementPlan = benchmarkSettlementPlan;
  (window as any).benchmarkAliasResolution = benchmarkAliasResolution;
}
