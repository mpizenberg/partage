/**
 * Network Monitor - Tracks all network usage via Performance API
 *
 * Uses the Resource Timing API to monitor all network requests
 * (fetch, XHR, images, scripts, CSS, etc.) and report total bytes transferred.
 */

import type { UsageTracker } from './usage-tracker.js';

export class NetworkMonitor {
  private usageTracker: UsageTracker;
  private observer: PerformanceObserver | null = null;
  private isRunning: boolean = false;

  constructor(usageTracker: UsageTracker) {
    this.usageTracker = usageTracker;
  }

  /**
   * Start monitoring network usage
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Process existing resource entries (from page load before monitor started)
    this.processExistingEntries();

    // Set up observer for new resource loads (without buffered to avoid duplicates)
    try {
      this.observer = new PerformanceObserver((list) => {
        this.processEntries(list.getEntries() as PerformanceResourceTiming[]);
      });

      this.observer.observe({ type: 'resource', buffered: false });
    } catch (err) {
      console.warn('[NetworkMonitor] Failed to create PerformanceObserver:', err);
    }
  }

  /**
   * Stop monitoring network usage
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * Process existing performance entries (from before monitor started)
   */
  private processExistingEntries(): void {
    try {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      this.processEntries(entries);
    } catch (err) {
      console.warn('[NetworkMonitor] Failed to process existing entries:', err);
    }
  }

  /**
   * Process a batch of performance entries
   */
  private processEntries(entries: PerformanceResourceTiming[]): void {
    let totalBytes = 0;

    for (const entry of entries) {
      totalBytes += entry.transferSize;
    }

    // Update usage tracker with total bytes from this batch
    if (totalBytes > 0) {
      // transferSize measures the total HTTP transaction size (primarily response body + headers)
      this.usageTracker
        .trackBytesTransferred(totalBytes)
        .catch((err) => console.warn('[NetworkMonitor] Failed to track bytes:', err));
    }
  }

  /**
   * Get current monitoring status
   */
  isActive(): boolean {
    return this.isRunning;
  }
}
