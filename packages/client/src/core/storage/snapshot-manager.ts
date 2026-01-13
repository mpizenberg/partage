import { PartageDB } from './indexeddb.js';
import type { LoroEntryStore } from '../crdt/loro-wrapper.js';

/**
 * Manages incremental snapshot storage and consolidation
 *
 * Strategy:
 * - Save incremental updates after each mutation (1-10 KB writes)
 * - Consolidate when threshold reached (e.g., 50 updates)
 * - Always consolidate on app load (ensures clean state)
 */
export class SnapshotManager {
  private db: PartageDB;
  private consolidationThreshold: number;

  constructor(db: PartageDB, consolidationThreshold = 50) {
    this.db = db;
    this.consolidationThreshold = consolidationThreshold;
  }

  /**
   * Save incremental update after mutation
   * Automatically consolidates if threshold reached
   */
  async saveIncremental(
    groupId: string,
    loroStore: LoroEntryStore
  ): Promise<void> {
    const { updateData, version } = loroStore.exportIncrementalUpdate();

    // If no changes, skip save (optimization for no-op transactions)
    if (updateData.byteLength === 0) {
      return;
    }

    // Save incremental update (small write)
    await this.db.saveLoroIncrementalUpdate(groupId, updateData, version);
    loroStore.markAsSaved();

    // Check if consolidation is needed (query count from index - fast)
    const updateCount = await this.db.getLoroIncrementalUpdateCount(groupId);
    if (updateCount >= this.consolidationThreshold) {
      await this.consolidate(groupId, loroStore);
    }
  }

  /**
   * Load snapshot + incremental updates
   * Always consolidates on load for clean startup
   */
  async load(groupId: string, loroStore: LoroEntryStore): Promise<void> {
    // Load base snapshot
    const snapshot = await this.db.getLoroSnapshot(groupId);
    if (!snapshot) {
      // Mark as saved so incremental updates start from here
      loroStore.markAsSaved();
      return;
    }

    // Import snapshot (also sets lastSavedVersion in importSnapshot method)
    loroStore.importSnapshot(snapshot);

    // Load and apply incremental updates
    const updates = await this.db.getLoroIncrementalUpdates(groupId);
    if (updates.length > 0) {
      for (const update of updates) {
        loroStore.applyUpdate(update.updateData);
      }

      // Always consolidate on load (design decision)
      await this.consolidate(groupId, loroStore);
    } else {
      // No incremental updates, just mark as saved
      loroStore.markAsSaved();
    }
  }

  /**
   * Consolidate: replace base snapshot with current state, clear incrementals
   * This creates a new checkpoint and resets the incremental update chain
   */
  async consolidate(groupId: string, loroStore: LoroEntryStore): Promise<void> {
    // Export full snapshot
    const snapshot = loroStore.exportSnapshot();
    const version = loroStore.getVersion();

    // Save as new base snapshot (includes version for debugging)
    await this.db.saveLoroSnapshot(groupId, snapshot, version);

    // Clear incremental updates (they're now baked into snapshot)
    await this.db.clearLoroIncrementalUpdates(groupId);

    // Reset saved version tracker
    loroStore.resetSavedVersion();
  }

  /**
   * Consolidate on idle (call from AppContext on visibility change)
   * Only consolidates if there are pending incremental updates
   */
  async consolidateOnIdle(groupId: string, loroStore: LoroEntryStore): Promise<void> {
    const updateCount = await this.db.getLoroIncrementalUpdateCount(groupId);
    if (updateCount > 0) {
      await this.consolidate(groupId, loroStore);
    }
  }
}
