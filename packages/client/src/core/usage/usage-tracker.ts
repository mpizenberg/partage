/**
 * Usage Tracker - Local estimation of server costs
 *
 * Tracks network bandwidth and storage usage to help users understand
 * their impact on server costs and encourage fair donations.
 *
 * All data stored locally, never sent to server (privacy-respecting).
 */

import type { PartageDB } from '../storage/indexeddb.js';
import type { UsageStats, CostBreakdown } from '@partage/shared';
import { USAGE_PRICING } from '@partage/shared';

export class UsageTracker {
  private storage: PartageDB;
  private initialized: boolean = false;

  constructor(storage: PartageDB) {
    this.storage = storage;
  }

  /**
   * Initialize usage tracking (creates record if not exists)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const existing = await this.storage.getUsageStats();
    if (!existing) {
      // First time - create initial record
      await this.storage.saveUsageStats({
        totalBytesTransferred: 0,
        trackingSince: Date.now(),
        lastStorageEstimateTimestamp: null,
        lastStorageEstimateSizeBytes: null,
        totalStorageCost: 0,
      });
    }

    this.initialized = true;
  }

  /**
   * Track network bytes transferred (measured via Performance API)
   */
  async trackBytesTransferred(bytes: number): Promise<void> {
    await this.initialize();

    const stats = await this.storage.getUsageStats();
    if (!stats) return;

    await this.storage.saveUsageStats({
      ...stats,
      totalBytesTransferred: stats.totalBytesTransferred + bytes,
    });
  }

  /**
   * Update storage estimate (called on page load if >1 day elapsed)
   * Calculates storage cost since last estimate and adds to accumulated total
   * @param totalSizeBytes - Total size of all Loro snapshots + incremental updates
   */
  async updateStorageEstimate(totalSizeBytes: number): Promise<void> {
    await this.initialize();

    const stats = await this.storage.getUsageStats();
    if (!stats) return;

    const now = Date.now();
    const lastEstimate = stats.lastStorageEstimateTimestamp;

    // Check if we should update (first time or >1 day elapsed)
    const shouldUpdate =
      !lastEstimate || now - lastEstimate >= USAGE_PRICING.STORAGE_ESTIMATE_INTERVAL;

    if (!shouldUpdate) {
      return;
    }

    // Calculate storage cost increment since last estimate
    let costIncrement = 0;
    if (lastEstimate && stats.lastStorageEstimateSizeBytes !== null) {
      // Time elapsed in months
      const millisecondsElapsed = now - lastEstimate;
      const monthsElapsed = millisecondsElapsed / (30 * 24 * 60 * 60 * 1000);

      // Use last storage size for the period (approximation)
      const storageMB = stats.lastStorageEstimateSizeBytes / (1024 * 1024);
      costIncrement = storageMB * USAGE_PRICING.STORAGE_PER_MB * monthsElapsed;
      console.log('storageMb:', storageMB);
      console.log('STORAGE_PER_MB:', USAGE_PRICING.STORAGE_PER_MB);
      console.log('monthsElapsed:', monthsElapsed);
    }

    await this.storage.saveUsageStats({
      ...stats,
      lastStorageEstimateTimestamp: now,
      lastStorageEstimateSizeBytes: totalSizeBytes,
      totalStorageCost: stats.totalStorageCost + costIncrement,
    });
  }

  /**
   * Get current usage statistics
   */
  async getUsageStats(): Promise<UsageStats | null> {
    await this.initialize();

    const record = await this.storage.getUsageStats();
    if (!record) return null;

    return {
      totalBytesTransferred: record.totalBytesTransferred,
      trackingSince: record.trackingSince,
      lastStorageEstimate:
        record.lastStorageEstimateTimestamp !== null && record.lastStorageEstimateSizeBytes !== null
          ? {
              timestamp: record.lastStorageEstimateTimestamp,
              sizeBytes: record.lastStorageEstimateSizeBytes,
            }
          : null,
    };
  }

  /**
   * Calculate total storage size across all groups
   * @returns Total size in bytes of all Loro snapshots + incremental updates
   */
  async calculateTotalStorageSize(): Promise<number> {
    const groups = await this.storage.getAllGroups();
    let totalSize = 0;

    for (const group of groups) {
      // Add base snapshot size
      const snapshot = await this.storage.getLoroSnapshot(group.id);
      if (snapshot) {
        totalSize += snapshot.byteLength;
      }
    }

    return totalSize;
  }

  /**
   * Calculate cost breakdown for display
   */
  async calculateCostBreakdown(): Promise<CostBreakdown> {
    await this.initialize();

    const record = await this.storage.getUsageStats();
    if (!record) {
      return {
        baseCost: 0,
        storageCost: 0,
        cpuCost: 0,
        networkCost: 0,
        totalCost: 0,
        monthsSinceStart: 0,
        averagePerMonth: 0,
      };
    }

    const now = Date.now();
    const monthsSinceStart = (now - record.trackingSince) / (30 * 24 * 60 * 60 * 1000);

    // Base cost: $0.10/month * months
    const baseCost = USAGE_PRICING.BASE_COST * monthsSinceStart;

    // Network cost: bytes * price per MB
    const totalNetworkMB = record.totalBytesTransferred / (1024 * 1024);
    const networkCost = totalNetworkMB * USAGE_PRICING.BANDWIDTH_PER_MB;

    // Storage cost: accumulated over time (updated at most once per day)
    const storageCost = record.totalStorageCost;

    // CPU cost: proportional to storage cost
    const cpuCost = storageCost * USAGE_PRICING.CPU_MULTIPLIER;

    const totalCost = baseCost + storageCost + cpuCost + networkCost;

    return {
      baseCost,
      storageCost,
      cpuCost,
      networkCost,
      totalCost,
      monthsSinceStart,
      averagePerMonth: monthsSinceStart > 0 ? totalCost / monthsSinceStart : 0,
    };
  }

  /**
   * Refresh storage estimate if needed (called on page load)
   */
  async refreshStorageEstimateIfNeeded(): Promise<void> {
    await this.initialize();

    const stats = await this.storage.getUsageStats();
    if (!stats) return;

    const now = Date.now();
    const lastEstimate = stats.lastStorageEstimateTimestamp;

    // Check if we should update (first time or >1 day elapsed)
    const shouldUpdate =
      !lastEstimate || now - lastEstimate >= USAGE_PRICING.STORAGE_ESTIMATE_INTERVAL;

    if (shouldUpdate) {
      const totalSize = await this.calculateTotalStorageSize();
      await this.updateStorageEstimate(totalSize);
    }
  }

  /**
   * Reset usage tracking (e.g., after making a donation)
   */
  async reset(): Promise<void> {
    await this.initialize();

    await this.storage.saveUsageStats({
      totalBytesTransferred: 0,
      trackingSince: Date.now(),
      lastStorageEstimateTimestamp: null,
      lastStorageEstimateSizeBytes: null,
      totalStorageCost: 0,
    });
  }
}
